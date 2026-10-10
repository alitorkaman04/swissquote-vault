# Threat model

**Assets:** the client's funds in the smart account; the client's ability to recover access.
**Goal:** a legitimate client can always get back in; an attacker who compromises any *one* thing (phone, email, bank login, backup kit, or Swissquote itself) cannot take the funds.

## Attacker scenarios

| # | Attacker has… | What they try | What stops them | Residual risk |
| --- | --- | --- | --- | --- |
| T1 | **Nothing; client loses phone** | – | Recovery: new passkey + backup key + Swissquote identity + delay. Same address, same funds | Client must keep the backup kit (or a second passkey) |
| T2 | **Stolen locked phone** | Send funds | Every signature needs Face ID / Touch ID; passkey can't be exported from the secure enclave | None while the phone stays locked. Client recovers to rotate the passkey |
| T3 | **Stolen unlocked phone / coerced biometrics** | Drain the Vault | Daily limit, high-value step-up in e-banking (second channel), sanctions screening on the destination | Small transfers under the limit are possible until the client recovers. Production: on-chain spending limits |
| T4 | **Phished Swissquote password + 2FA, or SIM swap / email takeover** | Request a recovery to their own passkey | Needs the client's backup key, which Swissquote never had. Old devices are notified and can cancel during the delay | None alone |
| T5 | **Stolen backup kit** | Recover to their own passkey | Needs a Swissquote login (identity + 2FA) and survives the veto window | None alone |
| T6 | **Backup kit + Swissquote credentials** | Full recovery takeover | 48 h waiting period; push notification to all of the client's devices; one-tap cancel; Swissquote fraud checks before the guardian signs | Client unreachable for 48 h. This is the "two independent compromises" case |
| T7 | **Rogue Swissquote employee** | Move funds or take over | Guardian key alone can't sign anything except half of a recovery; can't move funds at all; HSM with four-eyes access; recovery still triggers notification + delay | Collusion with a stolen backup kit = T6 |
| T8 | **Swissquote breached (guardian key stolen)** | Take over accounts | Guardian key is half of a 2-of-2; useless without each client's individual backup key. Client can rotate the guardian with the passkey (`renew`) | – |
| T9 | **Swissquote unavailable / insolvent** | – (availability) | Funds are in the client's own on-chain account, not on Swissquote's balance sheet. Passkey keeps working with any ERC-4337 bundler | Recovery degraded until the client rotates to a new guardian; gas no longer sponsored |
| T10 | **Malicious dApp / phishing transaction** | Trick the client into an approval or transfer | Approved-dApp list; unknown dApps blocked; human-readable review; on-chain simulation before signing | Approved dApp itself compromised |
| T11 | **Phishing website** | Get a signature from the passkey | WebAuthn origin binding: the passkey only signs for Swissquote's domain | – |
| T12 | **Sanctioned counterparty** | Receive funds from a Swissquote client | Sanctions screening blocks before signing | Client bypasses the app (it's self-custody) |
| T13 | **Passkey server compromised** | Steal keys | It stores public keys only | Availability of login-by-name. Production: Swissquote self-hosts |
| T14 | **Smart-contract bug** | Exploit the account | Only audited ZeroDev Kernel v3.1 + plugin contracts; no custom Solidity | Upstream bug |
| T15 | **Gas-sponsorship abuse** | Drain Swissquote's paymaster | Paymaster policies (rate, per-account, approved contracts) | Bounded by policy |

## How recovery tells the client from an attacker

The bonus criterion asks for a recovery flow that distinguishes a legitimate user from an attacker who compromised the phone or email. Ours requires **three independent factors**, plus time:

1. **Who you are:** Swissquote e-banking identity (KYC'd, 2FA).
2. **What you kept:** the backup key, which only the client has (Swissquote never sees it).
3. **What you still hold:** if the client still has *any* old device, they see the recovery and can cancel it.
4. **Time:** a waiting period long enough for the client to notice.

| Compromised | Can recover? |
| --- | --- |
| Phone | No (no backup key, and no bank login if it's stolen locked) |
| Email / SIM | No (no backup key) |
| Bank credentials | No (no backup key) |
| Backup kit | No (no bank identity) |
| Bank credentials + backup kit | Only if the client ignores the alert on their devices for the whole delay |
| Legitimate client, phone lost | **Yes**: has identity + backup key; no device left to object |
