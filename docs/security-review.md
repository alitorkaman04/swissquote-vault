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
| 7 | README said "2-of-3 guardian model"; the design is sudo passkey + 2-of-2 recovery pair | Low (inconsistency) | **Fixed** |
| 8 | Guardian key regenerates if `server/data.json` is deleted, orphaning existing wallets | Low (ops) | **Documented**; `BANK_GUARDIAN_PRIVATE_KEY` env var to pin it |
| 9 | Server used a single public RPC (rate limits) | Low | **Fixed.** Fallback RPCs |
| 10 | `POST /wallet` lets a session overwrite its wallet record | Low (mock) | **Accepted** for demo re-runs; production links a wallet only after an ownership proof |
| 11 | Backup key displayed raw in the browser | Low (demo) | **Accepted**; production uses a printed kit or a second passkey (`roadmap.md`) |
| 12 | Veto errors were swallowed silently | Low (UX) | **Fixed** |

## What a reviewer should still know

- Compliance checks run in the app and the bank service, not on-chain. This is deliberate for self-custody; see `architecture.md`, "Known limitations".
- The 30-second recovery delay is enforced by the guardian service in the prototype. Production also sets the weighted validator's on-chain `delay`.
- Everything on-chain is audited ZeroDev code (Kernel v3.1, passkey validator, weighted validator, recovery action); we wrote no Solidity.
- Unit tests cover the compliance rules and helpers; CI runs type-check, tests and build on every push.
