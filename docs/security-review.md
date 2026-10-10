# Security review (internal, during the hackathon)

Before freezing the code we ran a review of the repo from the point of view of a bank security engineer:
"what would a judge from Swissquote find?" Findings and what we did about them.

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | A freshly created wallet was not recoverable until its first outgoing transaction (recovery validator installed lazily) | High (design gap) | **Fixed.** "Activate my Vault" deploys the account and installs recovery in one sponsored operation right after creation; falls back to first-transfer installation if it fails |
| 2 | Re-starting an abandoned recovery reused the old request, so the bank signed stale calldata while the client used a new passkey → on-chain signature mismatch | High (demo-breaking) | **Fixed.** A new request supersedes any pending one |
| 3 | The guardian service signed any calldata it was given | Medium | **Fixed.** Only `doRecovery(address,bytes)` is accepted (the on-chain selector binding enforces this too) |
| 4 | `/recovery/:id/sign` was unauthenticated | Medium | **Fixed.** Requires the requesting client's session |
| 5 | Recovery veto accepted from anyone who knew the request id | Medium | **Fixed.** Veto must be signed by the current passkey (ERC-1271, verified on-chain) or come from the client's authenticated session (demo fallback) |
| 6 | UI text claimed a thief "would need your Face ID to cancel", but the session fallback also works | Low (overstatement) | **Fixed.** Copy and docs state both paths |
| 7 | README said "2-of-3 guardian model"; the design at the time was sudo passkey + 2-of-2 recovery pair (since replaced by backup 60 / Swissquote 40 / partner 40, see #13) | Low (inconsistency) | **Fixed** |
| 8 | Guardian key regenerates if `server/data.json` is deleted, orphaning existing wallets | Low (ops) | **Documented**; `BANK_GUARDIAN_PRIVATE_KEY` env var to pin it |
| 9 | Server used a single public RPC (rate limits) | Low | **Fixed.** Fallback RPCs |
| 10 | `POST /wallet` lets a session overwrite its wallet record | Low (mock) | **Partly fixed.** A Vault's recovery addresses are fixed at creation (bank and partner refuse to change them); registering a new Vault is allowed for demo re-runs. Production links a wallet only after an ownership proof |
| 11 | Backup key displayed raw in the browser | Low (demo) | **Accepted**; production uses a printed kit or a second passkey (`roadmap.md`) |
| 12 | Veto errors were swallowed silently | Low (UX) | **Fixed** |
| 13 | If Swissquote disappeared **and** the phone was lost, the 2-of-2 left the client locked out | High (requirement gap) | **Fixed.** Independent recovery partner (separate process, own key): backup 60 + Swissquote 40 + partner 40, threshold 100 |
| 14 | The bank co-signed after the delay without checking that the client's backup key had approved, so a stolen inbox + reset password got a co-signature (useless on-chain, but a needless step) | Medium | **Fixed.** Both guardians verify the backup approval (registered backup key, on-chain recovery setup) before co-signing, and refuse if the approval plus their own weight doesn't reach the threshold |
| 15 | The app trusted locally stored recovery addresses | Low | **Fixed.** Recovery uses the addresses registered with the guardians and checks them against the Vault's on-chain recovery setup (installed, number of keys, total weight). The validator's per-key getter doesn't decode with the SDK's published ABI, so individual keys aren't read back; the contract still enforces them |
| 16 | Docs claimed the validator's on-chain `delay` could enforce the waiting period; with offline signature collection it only supports `delay = 0` | Low (accuracy) | **Fixed.** Docs now name the production path (ZeroDev `WeightedECDSAValidator`: on-chain approvals, timer, veto) |
| 17 | Signing out of Swissquote and back in reopened a remembered Vault without a biometric check (the passkey was only asked for at the next signature) | Medium | **Fixed.** Lock screen: a remembered Vault opens only after a passkey assertion (Face ID / fingerprint); the bank login alone never opens it |
| 18 | The deployed weighted validator answers `weightedStorage` with three words while the SDK's ABI expects four, so the guardians refused every co-signature | High (recovery blocked) | **Fixed.** The header is decoded by hand (either layout); the key count follows from the total weight. Unit-tested |

## What a reviewer should still know

- Compliance checks run in the app and the bank service, not on-chain. This is deliberate for self-custody; see `architecture.md`, "Known limitations".
- The recovery delays (30 s Swissquote, 45 s partner) are enforced by the guardian services in the prototype. Production enforces them on-chain as well (see `custody-model.md`).
- Everything on-chain is audited ZeroDev code (Kernel v3.1, passkey validator, weighted validator, recovery action); we wrote no Solidity.
- Unit tests cover the compliance rules, the recovery weights (Swissquote + partner can never recover; no single key can) and approval verification; CI runs type-check, tests and build on every push.
