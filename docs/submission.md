# DoraHacks submission (paste-ready)

**Project name:** Swissquote Vault

**Track:** Swissquote Wallet

**One-liner:** A self-custody wallet Swissquote could launch: the client's passkey controls the funds, Swissquote can only help recover a lost passkey, and every transaction is gasless and screened.

**Description**

Today a Swissquote client who wants to hold their own keys has to withdraw to an external wallet and leave the bank's ecosystem: seed phrases, no recovery, no checks. Swissquote Vault keeps them one tap from their account.

- **Create:** sign in to Swissquote, create a passkey with Face ID. No seed phrase. The wallet is an ERC-4337 smart account (Kernel v3.1) on Base, linked to the KYC'd client at creation.
- **Sign:** every transfer is signed by the passkey in the phone's secure chip. Swissquote's paymaster pays the gas, so the client never needs ETH.
- **Recover:** a lost phone is recovered with three factors: Swissquote identity, a backup key only the client holds, and a waiting period during which every old device is alerted and can cancel. Swissquote's guardian key and the client's backup form a 2-of-2 recovery validator that is bound on-chain to a single function, replacing the passkey, so it can never sign a transfer. Same address, same funds.
- **Compliance:** sanctions screening, limits, high-value step-up, on-chain simulation before every signature, an approved-dApp list with limited approvals, and passkeys bound to Swissquote's domain.
- **Legal:** Swissquote never holds the key that moves funds and its signature is never required, which places Vault on the non-custodial side of FINMA practice. Wallet ownership (FINMA Guidance 02/2019) is verified by construction.
- **Business:** retains self-custody clients, earns on approved swap routes, attracts crypto-native clients. Sponsoring gas costs under CHF 1 per user per year.

**What's real:** passkeys, the smart account, the recovery validator, gasless USDC transfers and dApp approvals, all on Base Sepolia. **Mocked** (documented in `docs/mocks.md`): bank login, the guardian key's HSM, sanctions and dApp lists.

**Tech:** React, TypeScript, viem, ZeroDev SDK (passkey validator, weighted validator, paymaster, bundler), Base Sepolia, Node mock backend.

**Links**
- Repo: https://github.com/alitorkaman04/swissquote-vault
- Demo video: [paste link]
- Docs: `docs/` (architecture, custody model, threat model, legal, business case)
- Smart account on Basescan: https://sepolia.basescan.org/address/0xCbF1aac42FB105bc57be2b0b21E5dba1cE6B33b6
