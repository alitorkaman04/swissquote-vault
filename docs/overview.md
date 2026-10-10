# Swissquote Vault: overview for judges

One page answering the six required topics of the Swissquote Wallet challenge, in order. Each answer links to the detailed document.

**The story, live on Base Sepolia:** create a Vault → sign in and sign a real transaction → lose the phone → recover. Same address, same funds. A Vault with a real recovery transaction: [0xf47c…Cd9a on Basescan](https://sepolia.basescan.org/address/0xf47c2936C39953118BFcED58A4852ff29447Cd9a).

## 1. Custody model and threat model

An ERC-4337 smart account (ZeroDev Kernel v3.1) whose only spending key is a **passkey** in the phone's secure chip, unlocked with Face ID. Recovery keys can do one thing only, enforced by the account on-chain: replace a lost passkey.

| Recovery key | Held by | Weight |
| --- | --- | --- |
| Backup key | The client, offline | 60 |
| Guardian key | Swissquote | 40 |
| Guardian key | An independent recovery partner | 40 |

Recovery needs 100. The client's backup key is always required; **Swissquote alone, or Swissquote together with the partner (80), can never move or recover the funds.**

- **Who could steal funds?** Only someone with the unlocked phone and the client's biometrics, or someone holding the backup key *and* a guardian's co-signature who also survives a waiting period during which the client is alerted and can cancel.
- **Who could lock the client out?** Nobody can take the passkey away without a recovery. The real risk is the client losing both the phone and the backup kit.
- **Could Swissquote move the funds without the client, alone or with a partner?** No, on-chain: 40, or 40 + 40 = 80, is below the threshold.

Model choice with pros and cons against custodial, seed phrase, MPC and Shamir: [custody-model.md](custody-model.md). 18 attack scenarios: [threat-model.md](threat-model.md).

## 2. Architecture

Diagram with every mocked part marked `[MOCK]`: [architecture.md](architecture.md). What is real and what is mocked: [mocks.md](mocks.md).

- **Real, on Base Sepolia:** passkeys, the smart account, the recovery validator, gasless transfers and dApp approvals, transaction simulation, the ownership proof.
- **Mocked:** bank login and 2FA, the two guardians' key storage, the partner's identity check, the sanctions and dApp lists. The Swissquote guardian and the partner each run as **their own process with their own storage**; the app never holds a guardian key. Mocked steps are labelled MOCK in the app.

## 3. Wallet creation

After the client signs in to Swissquote, Face ID creates a passkey: the private key is generated inside the secure enclave and never leaves it. The backup key is generated on the device and shown once; Swissquote never sees it. The Vault address and the public recovery addresses are registered to the KYC'd client at creation, so wallet and identity are linked from the first block. One sponsored transaction then deploys the account and installs recovery.

## 4. Authentication

Every signature needs the passkey (biometric user verification), and WebAuthn binds it to Swissquote's domain, so a phishing site can't use it. **Small transfers: Face ID. Above 1,000 USDC: also the Swissquote security code** (step-up). Before every signature: sanctions screening, limits and an on-chain simulation. Details: [architecture.md](architecture.md), "Authentication before signing".

## 5. Recovery

Swissquote login → new passkey → recovery request (every device that still holds the old passkey is alerted and can cancel with a passkey-signed veto) → the client's backup key approves → after the waiting period (48 h in production, 30 s in the demo) Swissquote verifies the backup approval and co-signs → `doRecovery` installs the new passkey.

- **Attacker with the stolen phone and email:** refused, shown live. Their key isn't the backup key, so the app refuses, Swissquote refuses to co-sign, and the on-chain rules would reject it anyway.
- **If Swissquote's services are permanently gone:** the passkey keeps signing without any Swissquote server, and a lost phone is recovered with the backup kit plus the independent partner (60 + 40). Shown live by switching the Swissquote service off.

Details: [threat-model.md](threat-model.md), [legal-swiss.md](legal-swiss.md) ("If Swissquote stops operating").

## 6. Business case

Today self-custody clients withdraw to MetaMask and take their activity elsewhere. Vault keeps them, and their trading, one tap from Swissquote; earns on swaps through approved routes; and attracts crypto-native clients. Crypto brought Swissquote CHF 85.7 m in 2025 and fell 66% in H1 2026. With labelled assumptions: about **CHF 1.28 m contribution in year 1 and CHF 5.06 m in year 3** (still CHF 0.71 m / 3.34 m at the weaker H1 2026 crypto run-rate), against CHF 0.34–0.41 m running cost; sponsoring gas costs under CHF 1 per user per year. Details: [business-case.md](business-case.md).

## Custody, the Travel Rule, and the bonus topics

- **Custody:** Swissquote never holds the key that moves funds and its signature is never needed for a transfer, so Vault sits on the non-custodial side of FINMA practice. The "Swissquote plus a partner" grey zone is closed on-chain.
- **Travel Rule:** transfers between the client's Swissquote account and their own Vault go to a self-hosted wallet whose ownership is **verified by construction**: created in the KYC session, plus a one-tap ownership proof verified on-chain. For payments the client signs from the Vault to third parties, Swissquote is not the sending institution. Details: [legal-swiss.md](legal-swiss.md).
- **Gasless transactions:** every operation is paid by a paymaster funded by Swissquote; the client never holds ETH. Abuse prevention: [architecture.md](architecture.md), "Gas sponsorship".
- **Compliant dApp interaction:** approved-dApp list with unknown sites blocked, limited approvals that can be revoked, sanctions screening, plain-language simulation, step-up above 1,000 USDC.
- **Recovery that refuses an attacker with the stolen phone and email:** shown live (section 5).
