# What is mocked, what is real

The challenge brief allows mocking banking infrastructure, compliance providers and key-share servers
as long as the distinction is documented. Here it is.

| Component | Status | Notes |
| --- | --- | --- |
| Passkey creation and signing (WebAuthn, secure enclave) | **Real** | Platform authenticator on the device; public key stored by ZeroDev's passkey server so the user can log in by name on any device |
| Smart account (Kernel v3.1, ERC-4337) | **Real** | Deployed on Base Sepolia on first transaction |
| Gasless transfers (paymaster) | **Real** | ZeroDev paymaster sponsors gas; in production Swissquote funds the paymaster |
| USDC transfers | **Real** | Circle test USDC on Base Sepolia |
| Recovery validator (2-of-2 weighted, bound to `doRecovery`) | **Real** | On-chain; both signatures are genuine ECDSA approvals verified by the validator contract |
| Swissquote e-banking login + 2FA | **Mock** | `server/index.ts`; any client id, password `demo`, code `000000` |
| Swissquote guardian key custody | **Mock** | A demo key in a JSON file. Production: HSM / KMS, one key share per client, access gated by the identity layer |
| 48-hour waiting period + device notification + veto | **Mock (timing)** | Implemented as a 30 s delay enforced by the guardian service; "notification" is the old device polling the service. Production: push notification, 48 h, veto signed by the old passkey; additionally hardened on-chain via the weighted validator's `delay` parameter |
| Sanctions screening | **Mock** | Fixed blocklist. Production: Chainalysis / Elliptic against OFAC + SECO |
| Approved dApp list | **Mock** | Static list. Production: maintained by Swissquote Digital Assets with per-client risk profiles |
| Transaction simulation | **Real** | `eth_call` simulation before every signature |
