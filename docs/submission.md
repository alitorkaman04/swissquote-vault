# DoraHacks submission (paste-ready)

**Project name:** Swissquote Vault

**Track:** Swissquote Wallet

**One-liner:** A self-custody wallet Swissquote could launch tomorrow: the client's passkey controls the funds, Swissquote can only help recover a lost phone (and never without the client), and every transaction is gasless and screened.

**Description**

Today a Swissquote client who wants to hold their own keys has to withdraw to an external wallet and leave the bank's ecosystem: seed phrases, no recovery, no checks. Swissquote Vault keeps them one tap from their account. The full story runs live on Base Sepolia: **create → sign in and sign a real transaction → lose the phone → recover**, same address, same funds.

**1. Custody model and threat model.** An ERC-4337 smart account (ZeroDev Kernel v3.1) whose only spending key is a **passkey** in the phone's secure chip (Face ID). Recovery keys can do exactly one thing, enforced on-chain: replace a lost passkey. Weights: client backup key 60, Swissquote 40, an independent recovery partner 40, threshold 100. So the client's backup key is always required; **Swissquote alone, or Swissquote together with the partner (80), can never move or recover the funds**. *Who could steal funds?* Only someone with the unlocked phone and biometrics, or someone with the backup key plus a guardian's co-signature who survives a 48-hour window the client can veto. *Who could lock the client out?* Only loss of both phone and backup kit. 18 scenarios in `docs/threat-model.md`; pros and cons against custodial, seed phrase, MPC and Shamir in `docs/custody-model.md`.

**2. Architecture.** Diagram in `docs/architecture.md`, with mocked parts marked. Real: passkeys, smart account, recovery validator, gasless transfers and dApp approvals, simulation, ownership proof, all on Base Sepolia. Mocked: bank login and 2FA, the two guardians' key storage (each runs as **its own process with its own storage**; the app never holds a guardian key), the partner's identity check, sanctions and dApp lists. Every mocked step is labelled MOCK in the app (`docs/mocks.md`).

**3. Wallet creation.** After e-banking login, the client creates a passkey with Face ID; the private key is generated in and never leaves the secure enclave. The backup key is generated on the device and shown once. The Vault address is registered to the KYC'd client record at creation, so identity and wallet are linked from block zero.

**4. Authentication.** Every signature needs the passkey (biometrics), bound to Swissquote's domain (phishing-proof). Small transfers: Face ID only. **Above 1,000 USDC: also the Swissquote security code** (step-up), plus sanctions screening, limits and an on-chain simulation before every signature.

**5. Recovery.** New phone → new passkey → Swissquote login → the backup key is checked against the one registered at creation, and the Vault's recovery setup is read from the chain → old devices are alerted and can cancel with a passkey-signed veto → after the waiting period Swissquote verifies the backup approval and co-signs → `doRecovery` installs the new passkey. **If Swissquote is permanently gone**, the passkey keeps working without it, and a lost phone is recovered with the backup kit plus the independent partner (live: "Switch Swissquote off"). **Bonus: an attacker with the stolen phone and email is refused live**: their key isn't the Vault's backup key, which the on-chain rules require, and Swissquote refuses to co-sign.

**6. Business case.** Retains self-custody clients and their crypto activity (crypto brought Swissquote CHF 85.7 m in 2025 and fell 66% in H1 2026), earns on swaps through approved routes, attracts crypto-native clients. Model: about CHF 1.3 m contribution in year 1 and CHF 5.1 m in year 3 against about CHF 0.35–0.4 m running cost; gas is under CHF 1 per user per year (`docs/business-case.md`).

**Custody and the Travel Rule.** Swissquote never holds the key that moves funds and its signature is never needed for a transfer, so under FINMA practice Vault is on the non-custodial side; the "Swissquote plus a partner" grey zone is closed on-chain (80 < 100). Transfers between the client's Swissquote account and their own Vault are to a self-hosted wallet whose ownership is **verified by construction** (created in the KYC session, one-tap ERC-1271 ownership proof verified on-chain), which is what FINMA Guidance 02/2019 requires. For payments the client signs from the Vault to third parties, Swissquote is **not** the sending institution: it never holds or transfers the assets (`docs/legal-swiss.md`).

**Bonus topics tackled**
- **Gasless transactions:** every operation is sponsored by a paymaster; the client never holds ETH. Swissquote pays; abuse prevention in production: sponsor only registered KYC'd Vaults, only USDC, approved dApps and recovery, per-account rate limits and monthly budget (`docs/architecture.md`).
- **Compliant dApp interaction:** approved-dApp list with unknown sites blocked; limited approvals with on-chain allowance display and one-tap revoke; sanctions screening; plain-language simulation before signing; step-up above 1,000 USDC.
- **Recovery that refuses an attacker with the stolen phone and email:** live demo, enforced on-chain and by the guardian.
- **Swiss regulatory considerations:** custody analysis, Travel Rule, ownership proof, client terms, questions for FINMA.

**AI tools used**
- **Claude (Anthropic), in the Claude app with agentic coding:** wrote the application code (React app, ZeroDev integration, mock bank and partner services), the unit tests and CI, the documentation, the pitch deck and the demo script, following our instructions and decisions; researched FINMA sources, Swissquote's published figures and the ZeroDev contracts.
- **What we did ourselves:** chose the direction and the trade-offs, ran and tested every flow on our own devices (Mac with Chrome and Safari, iPhone via cross-device passkeys), reported every bug we hit, reviewed the outputs, and will present and defend the design.
- No other AI tools were used.

**Tech:** React, TypeScript, viem, ZeroDev SDK (Kernel v3.1, passkey validator, weighted validator, paymaster, bundler), WebAuthn passkeys, Base Sepolia, Node/Express mock services, Vitest, GitHub Actions. No custom smart contracts and no custom cryptography.

**Links**
- Repo: https://github.com/alitorkaman04/swissquote-vault
- Demo video: [paste link]
- Docs: `docs/` (custody model, threat model, architecture, legal, business case, mocks)
- Smart account on Basescan: https://sepolia.basescan.org/address/0xCbF1aac42FB105bc57be2b0b21E5dba1cE6B33b6
