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
npm run dev                 # starts the web app (http://localhost:5173) and the mock bank (http://localhost:8787)
```

Demo login for the mock Swissquote backend: client `demo`, password `demo`, 2FA code `000000`.
Test USDC for Base Sepolia: https://faucet.circle.com

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

## How it works

```
                    ┌──────────────────────────── Base Sepolia ────────────────────────────┐
                    │  Kernel v3.1 smart account (ERC-4337, EntryPoint 0.7)                │
                    │                                                                      │
 phone passkey ───► │  sudo validator: WebAuthn (P-256)        → can do anything           │
                    │                                                                      │
 backup key  ─┐     │  regular validator: Weighted 2-of-2      → bound to ONE selector:    │
 bank key    ─┴───► │    bank 50 + backup 50, threshold 100       doRecovery(validator,data)│
                    │                                             i.e. replace the passkey  │
                    └──────────────────────────────────────────────────────────────────────┘
                                      ▲ user operations, gas sponsored by paymaster
                                      │
   web app (this repo) ───────────────┘
        │
        └── mock Swissquote backend (server/): identity, guardian key, delay + veto, screening, dApp list
```

- `src/lib/wallet.ts` — create / login / resume, balances, gasless transfers
- `src/lib/recovery.ts` — new passkey → 2-of-2 recovery user operation
- `src/lib/bank.ts` — client for the mock backend
- `server/index.ts` — the mock backend (clearly marked; see `docs/mocks.md`)

Built with `@zerodev/sdk`, `@zerodev/passkey-validator`, `@zerodev/weighted-validator`, `viem`. No custom cryptography.
