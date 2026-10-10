# Threat model

**Assets:** the client's funds in the smart account; the client's ability to recover access.
**Goal:** a legitimate client can always get back in, even if Swissquote is gone; an attacker who compromises any *one* thing (phone, email, bank login, backup kit, Swissquote, the partner), or the two institutions together, cannot take the funds.

**In short:** stealing funds needs the unlocked phone + biometrics, or the backup key + a guardian's co-signature + an unnoticed waiting period. Locking the client out needs the loss of both the phone and the backup kit. Swissquote, alone or with the partner (40 + 40 = 80 < 100), can never move or recover the funds: the chain refuses.

## Attacker scenarios

| # | Attacker has… | What they try | What stops them | Residual risk |
| --- | --- | --- | --- | --- |
| T1 | **Nothing; client loses phone** | – | Recovery: new passkey + backup key + Swissquote identity + delay. Same address, same funds | Client must keep the backup kit (or a second passkey) |
| T2 | **Stolen locked phone** | Send funds | Every signature needs Face ID / Touch ID; the passkey can't be exported from the secure enclave | None while the phone stays locked. Client recovers to rotate the passkey |
| T3 | **Stolen unlocked phone / coerced biometrics** | Drain the Vault | Daily limit, high-value step-up with the Swissquote security code (second channel), sanctions screening | Small transfers under the limit until the client recovers. Production: on-chain spending limits (ZeroDev policies) |
| T4 | **Stolen phone + email inbox** (bonus scenario) | Reset the e-banking password, request a recovery to their own passkey | The backup key is on neither. Any other key is refused: the app checks it against the Vault's on-chain recovery keys, and Swissquote refuses to co-sign without a genuine backup approval (verified against the chain). **Demoed:** Recover → "Demo: try as a thief with the phone + email" | None alone |
| T5 | **Phished Swissquote password + 2FA, or SIM swap** | Same as T4 | Same: needs the backup key, which Swissquote never had. Old devices are alerted and can cancel | None alone |
| T6 | **Stolen backup kit + one guardian's cooperation** (phished bank login, or a fooled partner) | Full recovery takeover | Waiting period (48 h / 30 days); alerts to every device holding the passkey; one-tap passkey-signed cancel; guardian fraud checks | Client unreachable for the whole delay. This is the "two independent compromises" case |
| T7 | **Rogue Swissquote employee** | Move funds or take over | Guardian key can't sign anything but half of a recovery, and only with a backup approval; HSM with four-eyes access; recovery still triggers alerts + delay | Collusion with a stolen backup kit = T6 |
| T8 | **Swissquote breached (guardian key stolen)** | Take over accounts | 40 < 100: useless without each client's own backup key. Client can rotate guardians with the passkey (`renew`; not in the prototype UI) | – |
| T9 | **Swissquote unavailable / insolvent** | – (availability) | Funds are in the client's own on-chain account, not on Swissquote's balance sheet. Passkey keeps signing with any ERC-4337 bundler. Lost phone: backup key + independent partner (60 + 40). **Demoed:** Security → "Switch Swissquote off" | Gas no longer sponsored (Vault pays its own); screening and dApp list gone |
| T10 | **Partner breached / rogue partner** | Take over accounts | Same as T8: 40 < 100, needs the client's backup key; the partner re-checks identity and waits 30 days, during which the passkey can veto | – |
| T11 | **Swissquote and the partner collude** (or are compelled together) | Recover or move funds without the client | 40 + 40 = 80 < 100: refused by the validator contract. Each guardian also refuses an approval that, with its own, doesn't reach the threshold (`server/guardian.ts`). Unit-tested (`tests/recovery-rules.test.ts`) | – |
| T12 | **Malicious dApp / phishing transaction** | Trick the client into an approval or transfer | Approved-dApp list; unknown dApps blocked; human-readable review; on-chain simulation before signing; allowances visible and revocable | Approved dApp itself compromised |
| T13 | **Phishing website** | Get a signature from the passkey | WebAuthn origin binding: the passkey only signs for Swissquote's domain | – |
| T14 | **Sanctioned counterparty** | Receive funds from a Swissquote client | Sanctions screening blocks before signing | Client bypasses the app (it's self-custody) |
| T15 | **Passkey server compromised** | Steal keys | It stores public keys only | Availability of login-by-name. Production: Swissquote self-hosts |
| T16 | **Smart-contract bug** | Exploit the account | Only audited ZeroDev Kernel v3.1 + plugin contracts; no custom Solidity, no custom cryptography | Upstream bug |
| T17 | **Gas-sponsorship abuse** | Drain Swissquote's paymaster | Production policy: sponsor only registered KYC'd Vaults, only USDC / approved dApps / `doRecovery`, per-account rate and monthly budget (see `architecture.md`) | Bounded by policy; testnet project sponsors all |
| T18 | **Attacker spams cancel to block a legitimate recovery** | Deny the client recovery | A veto must be signed by the Vault's current passkey (ERC-1271, verified on-chain) or come from the client's authenticated e-banking session; the partner accepts only the passkey | Attacker with the client's bank login can delay a Swissquote recovery; the partner path still works |

## How recovery tells the client from an attacker

The bonus asks for a recovery that refuses an attacker who has stolen the client's phone **and** email. Ours requires **independent factors plus time**, and the decisive one is checked by the blockchain:

1. **What you kept:** the backup key, which only the client has (never on the phone, never emailed, never seen by Swissquote). Checked against the Vault's recovery keys read from the chain; and the contract itself accepts nothing that doesn't reach the threshold.
2. **Who you are:** Swissquote e-banking identity (KYC'd, 2FA), or the partner's identity check. Each guardian also verifies the backup approval before it co-signs.
3. **What you still hold:** any device with the current passkey sees the recovery and can cancel it with a passkey-signed veto.
4. **Time:** a waiting period long enough for the client to notice.

| Compromised | Can recover? |
| --- | --- |
| Phone | No (no backup key; can't unlock the passkey) |
| Email / SIM | No (no backup key) |
| **Phone + email** | **No: key not among the on-chain recovery keys, and Swissquote refuses (live demo)** |
| Bank credentials | No (no backup key) |
| Backup kit | No (no guardian will co-sign without identity) |
| Swissquote + partner | No (80 < 100, on-chain) |
| Backup kit + a guardian | Only if the client ignores the alerts for the whole delay |
| Legitimate client, phone lost | **Yes**: backup key + Swissquote (or the partner if Swissquote is gone) |
