# From prototype to production

| | Hackathon prototype (this repo) | Pilot (3 months, ~1,000 clients) | Production |
| --- | --- | --- | --- |
| Identity | Mock login, code `000000` | Swissquote e-banking SSO + existing 2FA | Same |
| Everyday key | Passkey (real) | Passkey, synced via iCloud / Google passkeys | Same, plus optional hardware key |
| Backup | Raw key shown once | Printed backup kit **or** second passkey on another device | Client chooses 2 of 3: phone, second device, printed kit |
| Guardian key | JSON file in the mock bank process | HSM-backed key, four-eyes access | Same, with key rotation and audit trail |
| Independent partner | Separate mock process, fictional, ID check = client number | Contract with a Swiss trust company / notary; video identification against an escrowed KYC file | Same; partner contract with the client survives Swissquote |
| Recovery delay | 30 s (Swissquote) / 45 s (partner), enforced by each guardian service | 48 h / 30 days, enforced by the guardians **and** on-chain (recovery moved to ZeroDev's `WeightedECDSAValidator`: on-chain approvals, timer, `veto`) | Same, with configurable delay per risk profile |
| Veto | Signed by the old passkey (ERC-1271), session fallback | Passkey-signed only; push notifications to all devices | Same, plus on-chain cancel from the old passkey |
| Compliance | Mock sanctions list, static dApp list, client-side limits | Screening provider (Chainalysis / Elliptic), curated dApp registry | Same, plus on-chain spending-limit policy as a second layer |
| Gas | ZeroDev paymaster, "sponsor all" | Swissquote-funded paymaster with per-client and per-contract policies | Same |
| Chain | Base Sepolia | Base mainnet | Base + Ethereum mainnet, same account design |
| Bitcoin | – (ERC-4337 is EVM-only) | Stays in Swissquote custody | MPC wallet for BTC with the same guardian logic (client share + Swissquote + partner), if demand justifies it |
| Infrastructure | ZeroDev bundler, paymaster and passkey server | Same, with SLA | Self-hosted passkey server; bundler redundancy |
| Legal | Analysis in `legal-swiss.md` | FINMA ruling request on the guardian model; client terms per `legal-swiss.md` | Launch |

## What never changes

- The client's passkey is the only key that can move funds.
- Swissquote's key can only ever co-sign a passkey replacement, never a transfer, and never without the client's backup key, even together with the partner.
- Assets live in the client's own on-chain account, not on Swissquote's balance sheet.
