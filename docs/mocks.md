# What is mocked, what is real

The challenge allows mocking a bank backend, a compliance provider and key-share servers if it is clearly
labelled in the demo and the README, **and if a mocked share holder runs as a separate process with its own
storage, while the client app never holds its share.** Here is how Vault complies:

- **Three processes** (`npm run dev` starts them): the web app; the Swissquote mock (`server/index.ts`, own key in `server/data.json`); the independent recovery partner (`server/partner.ts`, own key in `server/partner-data.json`).
- **The client app never holds a guardian key.** It only ever receives each guardian's *public* address and, after the waiting period, its co-signature.
- **Labelled in the demo:** a "Real / MOCK" legend sits beside the phone, and every mocked step carries a `MOCK` tag in the app (bank login, partner identity check, recovery delay, sanctions list).

| Component | Status | Notes |
| --- | --- | --- |
| Passkey creation and signing (WebAuthn, secure enclave) | **Real** | Platform authenticator on the device; public key stored by ZeroDev's passkey server so the user can log in by name on any device |
| Smart account (Kernel v3.1, ERC-4337) | **Real** | Deployed on Base Sepolia on first transaction |
| Gasless transfers (paymaster) | **Real** | ZeroDev paymaster sponsors gas; in production Swissquote funds the paymaster |
| USDC transfers | **Real** | Circle test USDC on Base Sepolia |
| Recovery validator (weighted: backup 60, Swissquote 40, partner 40, threshold 100, bound to `doRecovery`) | **Real** | On-chain; every signature is a genuine ECDSA approval verified by the validator contract |
| Guardians' checks before co-signing | **Real** | Each guardian checks the Vault's recovery setup on-chain (installed, number of keys, weights) against the public addresses registered at creation, and verifies that the client's backup key signed exactly this recovery (`server/guardian.ts`) |
| Backup-key check on the recovery screen | **Real** | The entered key must be the Vault's registered backup key, and the on-chain recovery setup must match; the attacker demo shows a refusal |
| Independent recovery partner | **Mock** | `server/partner.ts`, separate process, own key and storage. Fictional Swiss trust company. Identity check = client number (production: video identification against an escrowed KYC file); 45 s waiting period (production: 30 days) |
| "Switch Swissquote off" (demo) | **Real process stop** | Development builds only; really stops the mock bank process (localhost only). The Vault keeps signing; recovery goes through the partner |
| Swissquote e-banking login + 2FA | **Mock** | `server/index.ts`; any client id, password `demo`, code `000000` |
| Swissquote guardian key custody | **Mock** | A demo key in the bank process's own JSON file. Production: HSM / KMS, access gated by the identity layer |
| 48-hour waiting period + device notification + veto | **Mock (timing)** | Implemented as a 30 s delay enforced by the guardian service; "notification" is the old device polling the service every 4 s. Production: push notification, 48 h, veto signed by the old passkey; additionally enforced on-chain by moving recovery to ZeroDev's `WeightedECDSAValidator` (on-chain approvals + timer + veto) |
| Sanctions screening | **Mock** | Fixed blocklist. Production: Chainalysis / Elliptic against OFAC + SECO |
| Approved dApp list | **Mock** | Static list. Production: maintained by Swissquote Digital Assets with per-client risk profiles |
| Transaction simulation | **Real** | `eth_call` simulation before every signature |
| Wallet ownership proof (ERC-1271) | **Real** | The passkey signs a bank challenge; the bank verifies the signature on-chain against the smart account (`verifyMessage`, ERC-6492/1271). Challenge issuance and record-keeping are mocked |
| Recovery veto signed by the current passkey | **Real signature, mock transport** | The old device signs `Cancel Vault recovery <id>` (ERC-1271), verified on-chain by the guardian service. Fallback for the demo: the client's authenticated session |
| High-value step-up (2FA before signing) | **Mock** | Code `000000`. Production: Swissquote's existing 2FA |
| dApp allowances and revoke | **Real** | Allowances read from the USDC contract; revoke is an on-chain `approve(spender, 0)` |
