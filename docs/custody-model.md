# Custody model

**One sentence:** the client alone controls the funds; Swissquote alone controls nothing; Swissquote plus the client's backup can only replace a lost passkey, after a waiting period the client can veto.

## The three keys

| Key | Where it lives | Who holds it | What it can do on-chain |
| --- | --- | --- | --- |
| **Passkey** (P-256, WebAuthn) | Secure enclave of the client's phone (synced via iCloud Keychain / Google Password Manager if the client allows) | Client | **Everything.** It is the account's *sudo* validator: transfers, dApp calls, changing settings |
| **Backup key** (secp256k1) | Offline backup kit (printed sheet / password manager). Generated on the device, never sent to Swissquote | Client | **Only `doRecovery`**, and only together with the Swissquote guardian |
| **Swissquote guardian key** (secp256k1) | Swissquote HSM (mocked as a server-side key in the prototype) | Swissquote | **Only `doRecovery`**, and only together with the client's backup key |

The backup key and the guardian key form a **2-of-2 weighted validator** (weights 50 + 50, threshold 100) that is installed as a *regular* (non-sudo) validator and **bound on-chain to a single function selector: `doRecovery(validator, data)`**. Kernel enforces this binding in the smart account: a user operation signed by the recovery validator that calls anything else (a USDC transfer, an approval, a module change) is rejected by the account itself, not by our app.

`doRecovery` re-initialises the passkey validator with a new public key. Be precise about what that means: the recovery pair can never move funds **directly**, but by installing a passkey it controls, a party holding *both* recovery keys could take over the account. That is inherent to any recovery scheme. Our protections are therefore about making sure no attacker ever holds both halves unnoticed: the halves are held by different parties (client offline / bank HSM), the bank half requires a verified identity, and every recovery runs through a waiting period during which the client's devices are notified and can cancel.

## Who can do what

| Actor | Move funds | Replace the passkey | Notes |
| --- | --- | --- | --- |
| Client with phone | ✅ | ✅ (can also rotate guardians via `renew`; not in the prototype UI) | Normal operation |
| Client without phone (lost) | ❌ | ✅ with backup key + Swissquote login + delay | Recovery path |
| Swissquote alone | ❌ | ❌ | Holds one half of a recovery-only key pair |
| Swissquote + stolen backup kit | ⚠️ only indirectly, by replacing the passkey | ⚠️ only after the delay, and the client's devices are notified and can cancel | See threat model T6 / T8 |
| Thief with backup kit only | ❌ | ❌ | Needs Swissquote login *and* survives the veto window |
| Thief with Swissquote credentials only | ❌ | ❌ | Needs the backup key |

## Why this is self-custody (and why it matters)

- Swissquote **cannot unilaterally dispose of** the assets: no single key it holds can sign a transfer, and even the recovery pair cannot sign one. This is the property Swiss regulators look at when deciding whether a provider is a custodian (see `legal-swiss.md`).
- The assets are **not on Swissquote's balance sheet** and sit in the client's own smart account on a public chain. If Swissquote disappeared, the client's passkey keeps working unchanged.
- Swissquote **still adds the value of a bank**: a recovery path tied to a verified identity, gas sponsorship, compliance checks, and a curated dApp list.

## Lifecycle

| Step | What happens | Code |
| --- | --- | --- |
| Create | Client signs in to Swissquote → creates a passkey (Face ID) → smart-account address is derived from it → backup key generated on-device and shown once → wallet linked to the KYC'd client record | `app/src/lib/wallet.ts` `createWallet` |
| Authenticate | Every signature requires the passkey, i.e. biometric user verification on the device. Re-login on a new device = passkey from the OS passkey manager | `loginWallet`, `resumeWallet` |
| Sign | Gasless ERC-4337 user operation signed by the passkey; Swissquote's paymaster pays the network fee | `sendUsdc`, `sendCalls` |
| Activate | Right after creation, one sponsored operation deploys the account and installs the recovery validator + recovery action, so the wallet is recoverable from day one. If it fails, the same happens with the first transfer | `activateWallet`, `pluginMigrations` in `buildEverydayClient` |
| Lose access | Phone lost / wiped | – |
| Recover | New device: new passkey → Swissquote login → recovery request (old devices notified, delay starts) → backup key approves → after the delay Swissquote approves → `doRecovery` installs the new passkey as sudo validator. **Same address, same funds** | `app/src/lib/recovery.ts`, `server/index.ts` |
| Veto | During the delay, any of the client's existing devices shows "Someone is recovering this Vault" with a one-tap cancel | `Dashboard.tsx` banner, `/recovery/:id/cancel` |

## Prototype vs production

| Aspect | Prototype | Production |
| --- | --- | --- |
| Waiting period | 30 s, enforced by the Swissquote guardian service before it signs | 48 h, **also enforced on-chain** via the weighted validator's `delay` parameter, so not even a compromised guardian service can skip it |
| Veto | Old device cancels the request at the guardian service | Old passkey can additionally invalidate the pending recovery on-chain (rotate the recovery config with `renew`) |
| Guardian key | Plain key in a JSON file | HSM, four-eyes access, signs only after identity re-verification + fraud checks |
| Backup | Raw key shown on screen | Printed kit or a second passkey on another device (e.g. a laptop or a hardware key) |
