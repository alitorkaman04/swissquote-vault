# From prototype to production

| | Hackathon prototype (this repo) | Pilot (3 months, ~1,000 clients) | Production |
| --- | --- | --- | --- |
| Identity | Mock login, code `000000` | Swissquote e-banking SSO + existing 2FA | Same |
| Everyday key | Passkey (real) | Passkey, synced via iCloud / Google passkeys | Same, plus optional hardware key |
| Backup | Raw key shown once | Printed backup kit **or** second passkey on another device | Client chooses 2 of 3: phone, second device, printed kit |
| Guardian key | JSON file on the mock server | HSM-backed key per client, four-eyes access | Same, with key rotation and audit trail |
| Recovery delay | 30 s, enforced by the guardian service | 48 h, enforced by the guardian service **and** on-chain (`delay` on the weighted validator) | Same, with configurable delay per risk profile |
| Veto | Signed by the old passkey (ERC-1271), session fallback | Passkey-signed only; push notifications to all devices | Same, plus on-chain cancel from the old passkey |
| Compliance | Mock sanctions list, static dApp list, client-side limits | Screening provider (Chainalysis / Elliptic), curated dApp registry | Same, plus on-chain spending-limit policy as a second layer |
| Gas | ZeroDev paymaster, "sponsor all" | Swissquote-funded paymaster with per-client and per-contract policies | Same |
| Chain | Base Sepolia | Base mainnet | Base + Ethereum mainnet, same account design |
| Infrastructure | ZeroDev bundler, paymaster and passkey server | Same, with SLA | Self-hosted passkey server; bundler redundancy |
| Legal | Analysis in `legal-swiss.md` | FINMA ruling request on the guardian model; client terms per `legal-swiss.md` | Launch |

## What never changes

- The client's passkey is the only key that can move funds.
- Swissquote's key can only ever co-sign a passkey replacement, never a transfer.
- Assets live in the client's own on-chain account, not on Swissquote's balance sheet.
