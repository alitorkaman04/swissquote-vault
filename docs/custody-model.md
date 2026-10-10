# Custody model

**One sentence:** the client alone controls the funds; Swissquote alone controls nothing; the client's backup key plus *one* guardian (Swissquote, or an independent partner if Swissquote is gone) can only replace a lost passkey, after a waiting period the client can veto.

**Model chosen:** an ERC-4337 smart-contract account (ZeroDev Kernel v3.1) controlled by a **passkey**, with an on-chain **weighted recovery validator** that can only call `doRecovery`. This is the "smart-contract account" row of the challenge table, combined with a split-recovery idea borrowed from the Shamir row, except the split is enforced by the chain, not by reassembling a secret.

## The four keys

| Key | Where it lives | Who holds it | Weight | What it can do on-chain |
| --- | --- | --- | --- | --- |
| **Passkey** (P-256, WebAuthn) | Secure enclave of the client's phone (synced via iCloud Keychain / Google Password Manager if the client allows) | Client | sudo | **Everything**: transfers, dApp calls, settings |
| **Backup key** (secp256k1) | Offline backup kit (printed sheet / password manager). Generated on the device, never sent to Swissquote | Client | **60** | Only `doRecovery`, and only together with one guardian |
| **Swissquote guardian key** | Swissquote HSM (mock: separate process `server/index.ts`, own storage) | Swissquote | **40** | Only `doRecovery`, and only together with the client's backup |
| **Partner guardian key** | Independent Swiss trust company / notary, contracted at onboarding (mock: separate process `server/partner.ts`, own storage, fictional) | Partner | **40** | Only `doRecovery`, and only together with the client's backup |

Threshold: **100**. The arithmetic is the custody model:

| Who signs | Weight | Result |
| --- | --- | --- |
| Backup + Swissquote | 60 + 40 = 100 | ✅ Normal recovery |
| Backup + partner | 60 + 40 = 100 | ✅ Recovery **if Swissquote is gone** |
| Swissquote + partner | 40 + 40 = 80 | ❌ **The institutions can never act without the client** |
| Any single key | ≤ 60 | ❌ |

The recovery keys form a weighted validator installed as a *regular* (non-sudo) validator and **bound on-chain to one function selector: `doRecovery(validator, data)`**. Kernel enforces this binding in the smart account itself: a recovery-signed operation that calls anything else (a transfer, an approval, a module change) is rejected by the account, not by our app. Vaults created before the partner existed use the legacy 2-of-2 (backup 50 + Swissquote 50); the app tells the two apart by the number of keys in the Vault's on-chain recovery header.

`doRecovery` re-initialises the passkey validator with a new public key. Be precise about what that means: recovery keys can never move funds **directly**, but whoever completes a recovery installs a passkey and so controls the account afterwards. That is inherent to any recovery scheme. Our protections are about making sure no attacker ever completes one: the client's backup key is always required (on-chain), the guardians each verify the client's backup approval against the chain before co-signing, they re-check identity, and every recovery runs through a waiting period during which the client's devices are alerted and can cancel.

## The three questions the challenge asks

**Who could steal funds?**
Only someone who can produce a passkey signature (the client's unlocked phone and biometrics), or someone who completes a recovery, which needs the client's backup key **and** a guardian's co-signature **and** survives the waiting period without the client objecting. No single compromise is enough: not the phone (locked by Face ID), not the email inbox, not the bank login, not the backup kit, not Swissquote, not the partner. See `threat-model.md` for the 18 scenarios.

**Who could lock the client out?**
Nobody can take the passkey away from the client without a recovery. Swissquote cannot freeze the account (it holds no key with any power except co-signing a recovery). The realistic lock-out risks are the client losing both the phone *and* the backup kit (mitigation: a second passkey on another device, or a printed kit in a safe), and both guardians becoming unavailable at the same time *and* the phone being lost.

**Could Swissquote, alone or together with a partner, move the funds without the client?**
No, and this is enforced on-chain, not by policy. Swissquote's key (40) and the partner's key (40) total 80, below the threshold of 100; the validator rejects the operation. Neither key can sign a transfer under any circumstances (selector binding). The only path to the funds runs through the client's backup key.

## Why this model, and not the others

| Model | Pros | Cons | Why not (alone) |
| --- | --- | --- | --- |
| Custodial account | Simplest; full recovery | Not a wallet; bank custody duties and capital; the client gains nothing over today's Swissquote account | Doesn't meet the brief: the client doesn't hold keys |
| Seed phrase | Universal, any chain | A typical Swissquote client won't keep 24 words safe; no recovery; phishing target | The failure mode we're replacing |
| MPC / threshold signatures | Chain-agnostic (Bitcoin too); one key on-chain | Key shares are a custody question (whoever holds 2 of 3 shares controls funds); complex share refresh; recovery invisible on-chain | Swissquote holding a share that can co-sign transfers looks like power of disposal |
| Split backup (Shamir / SLIP-39) | Familiar; offline | The seed is reassembled somewhere: that device sees the whole key; Swissquote + partner could reassemble without the client if they hold 2 of 3 | Our weights solve exactly this grey zone on-chain |
| **Smart account + passkey + weighted recovery (ours)** | No seed phrase; Face ID; gasless; recovery rules enforced by the chain; institutions provably can't act alone or together; same address after recovery | **EVM-only**; depends on audited but complex contracts; gas for recovery; passkey sync depends on the OS | Chosen: best fit for "keys, control, one step from Swissquote" |

**EVM-only?** Yes. Vault covers USDC and EVM assets on Base (and any EVM chain with an ERC-4337 EntryPoint, at the same address). For Bitcoin, Swissquote would keep custodial BTC or add an MPC wallet later; see `roadmap.md`.
**Who pays gas?** Swissquote, through a paymaster (see `architecture.md`, "Gas sponsorship"). If Swissquote is gone, the Vault pays its own gas (ETH, or USDC through an ERC-20 paymaster).
**What does recovery look like on-chain?** One user operation calling `doRecovery`, signed by the backup key and one guardian, visible on Basescan. Same account address, same funds, new passkey.

## Who can do what

| Actor | Move funds | Replace the passkey | Notes |
| --- | --- | --- | --- |
| Client with phone | ✅ | ✅ (can also rotate guardians via `renew`; not in the prototype UI) | Normal operation |
| Client without phone (lost) | ❌ | ✅ backup key + Swissquote (identity + delay) | Normal recovery |
| Client without phone, Swissquote gone | ❌ | ✅ backup key + partner (identity + longer delay) | Escape hatch, demoed |
| Swissquote alone | ❌ | ❌ | 40 < 100 |
| Swissquote + partner | ❌ | ❌ | 80 < 100, enforced on-chain |
| Thief with phone + email | ❌ | ❌ | No Face ID, no backup key; their key is not the Vault's backup key, and Swissquote refuses to co-sign (demoed) |
| Thief with backup kit only | ❌ | ❌ | Needs a guardian, who re-checks identity, plus the veto window |
| Backup kit + a guardian's cooperation | ⚠️ only indirectly, by replacing the passkey | ⚠️ after the delay; the client's devices are alerted and can cancel | Threat model T6 |

## Why this is self-custody (and why it matters)

- Swissquote **cannot unilaterally dispose of** the assets: no key it holds can sign a transfer, and even with a partner it can't recover. This is the property Swiss regulators look at when deciding whether a provider is a custodian (see `legal-swiss.md`).
- The assets are **not on Swissquote's balance sheet** and sit in the client's own smart account on a public chain. If Swissquote disappeared, the passkey keeps working (demo: "Switch Swissquote off"), and a lost phone is recovered through the partner.
- Swissquote **still adds the value of a bank**: a recovery path tied to a verified identity, gas sponsorship, compliance checks, and a curated dApp list.

## Lifecycle

| Step | What happens | Code |
| --- | --- | --- |
| Create | Client signs in to Swissquote → creates a passkey (Face ID) → smart-account address derived from it → backup key generated on-device and shown once → wallet linked to the KYC'd client record and registered with the partner (public addresses only) | `app/src/lib/wallet.ts` `createWallet`, `App.tsx` `Onboard` |
| Authenticate | Every signature requires the passkey, i.e. biometric user verification. Above 1,000 USDC also the Swissquote security code (step-up) | `loginWallet`, `resumeWallet`, Send tab |
| Sign | Gasless ERC-4337 user operation signed by the passkey; the paymaster pays the fee | `sendUsdc`, `sendCalls` |
| Activate | Right after creation, one sponsored operation deploys the account and installs the recovery validator + recovery action, so the Vault is recoverable from day one | `activateWallet`, `pluginMigrations` |
| Lose access | Phone lost / wiped / stolen | – |
| Recover | New device: Swissquote login → new passkey → recovery request (old devices alerted, delay starts) → backup key checked against the registered one and approves → after the delay Swissquote verifies that approval and co-signs → `doRecovery`. **Same address, same funds** | `app/src/lib/recovery.ts`, `server/guardian.ts`, `server/index.ts` |
| Recover without Swissquote | Same, with the partner instead: backup kit + identity check at the partner + longer delay | `PartnerRecover.tsx`, `server/partner.ts` |
| Veto | During the delay, any device holding the current passkey shows "Someone is recovering this Vault" and cancels with a passkey-signed message (verified on-chain), at Swissquote or the partner | `Dashboard.tsx` banner |

## Prototype vs production

| Aspect | Prototype | Production |
| --- | --- | --- |
| Waiting period | 30 s (Swissquote), 45 s (partner), enforced by each guardian service before it signs | 48 h (Swissquote), 30 days (partner). **Also enforced on-chain** by switching the recovery module to ZeroDev's `WeightedECDSAValidator`, whose guardians approve on-chain (`approveWithSig`), which starts an on-chain timer (`validAfter = now + delay`) that the account itself can `veto`. The validator we use (offline signatures) only supports `delay = 0`, which is why the prototype enforces it off-chain |
| Veto | Passkey-signed cancel message (ERC-1271), verified on-chain by the guardian | Additionally on-chain via `veto` (above) |
| Guardian keys | Plain keys in each process's JSON file | HSMs, four-eyes access; each guardian signs only after identity re-verification + fraud checks |
| Partner identity check | Client number | Video identification against the KYC file escrowed with the partner at onboarding |
| Backup | Raw key shown on screen | Printed kit or a second passkey on another device (laptop, hardware key) |
