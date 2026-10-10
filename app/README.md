# Swissquote Vault — app

Self-custody wallet prototype: passkey-controlled ERC-4337 smart account on **Base Sepolia**,
gasless USDC transfers, compliance checks, and bank-assisted (but not bank-controlled) recovery.

## Run it

Requirements: Node.js 20+ and a free [ZeroDev](https://dashboard.zerodev.app) project on Base Sepolia
(ZeroDev provides the bundler, the gas-sponsoring paymaster and the passkey server).

```bash
cd app
cp .env.example .env        # then put your ZeroDev Project ID in VITE_ZERODEV_PROJECT_ID
npm install
npm run dev                 # starts three processes: the web app (http://localhost:5173),
                            # the mock Swissquote bank (:8787) and the mock independent recovery partner (:8788)
```

Demo login for the mock Swissquote backend: client `demo`, password `demo`, 2FA code `000000`.
Test USDC for Base Sepolia: https://faucet.circle.com

**Keep `app/server/data.json` and `app/server/partner-data.json`.** They hold the two guardian keys (each in its own
process's storage): deleting one makes every wallet created so far unrecoverable through that guardian (their on-chain
recovery config names those keys). To pin them explicitly, set `BANK_GUARDIAN_PRIVATE_KEY` / `PARTNER_PRIVATE_KEY` in `.env`.

## Demo script (what the judges see)

1. **Sign in to Swissquote** (mock e-banking).
2. **Create your Vault** → Touch ID / Face ID → a passkey is created; the wallet address is derived from it and linked to the KYC'd client.
3. **Backup kit** → the client's recovery key, shown once.
4. **Send USDC** → compliance checks (sanctions list, limits, high-value step-up) + on-chain simulation → sign with passkey → **gas paid by Swissquote** → Basescan link.
   - try recipient `0x000000000000000000000000000000000000bad1` to see a sanctions block
   - try an amount above 1,000 to see the high-value step-up
5. **Apps** → approved dApp list; connecting runs a real on-chain approval; unknown apps are blocked.
6. **Security → Simulate losing this phone**, then on a *new device* (a private browser window works):
   sign in to Swissquote → "I lost my phone" → new passkey → countdown starts and the **old device sees a cancel banner** → enter backup key → when the delay ends the bank co-signs → passkey replaced on-chain, same address, same funds.
   - **"Demo: try as a thief with the phone + email"** on the backup-key step: a random key is refused on-chain and Swissquote refuses to co-sign.
7. **Security → Switch Swissquote off** (dev builds): really stops the mock bank. The Vault keeps signing ("Open my Vault without Swissquote"), and a lost phone is recovered with the backup kit + the independent partner. Restart the bank with `npm run bank`.

## How it works

```
                    ┌──────────────────────────── Base Sepolia ────────────────────────────┐
                    │  Kernel v3.1 smart account (ERC-4337, EntryPoint 0.7)                │
                    │                                                                      │
 phone passkey ───► │  sudo validator: WebAuthn (P-256)        → can do anything           │
                    │                                                                      │
 backup key  ─┐     │  regular validator: Weighted             → bound to ONE selector:    │
 bank key    ─┼───► │    backup 60 + bank 40 + partner 40,        doRecovery(validator,data)│
 partner key ─┘     │    threshold 100 (bank + partner = 80 ✗)   i.e. replace the passkey  │
                    └──────────────────────────────────────────────────────────────────────┘
                                      ▲ user operations, gas sponsored by paymaster
                                      │
   web app (this repo) ───────────────┘
        │
        ├── mock Swissquote backend (server/index.ts, process 1): identity, guardian key, delay + veto, screening, dApp list
        └── mock independent partner  (server/partner.ts, process 2): its own guardian key, ID check, longer delay
```

- `src/lib/wallet.ts` — create / login / resume, balances, gasless transfers
- `src/lib/onchainRecovery.ts` — the recovery rules: weights, checking the Vault's on-chain recovery setup, verifying approvals
- `src/lib/recovery.ts` — new passkey → backup-key check → recovery user operation
- `src/lib/bank.ts`, `src/lib/partner.ts` — clients for the two mock services
- `server/index.ts`, `server/partner.ts` — the two mock services (clearly marked; see `docs/mocks.md`)
- `server/guardian.ts` — what both guardians check on-chain before co-signing

Built with `@zerodev/sdk`, `@zerodev/passkey-validator`, `@zerodev/weighted-validator`, `viem`. No custom cryptography.
