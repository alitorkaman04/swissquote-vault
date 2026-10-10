# Business case

## The problem in Swissquote's numbers

- **1,220,818 client accounts**, CHF 96.3 bn client assets (H1 2026). [Finance Magnates, 13 Aug 2026]
- **CHF 85.7 m net crypto income in 2025**, about 12% of CHF 724.2 m operating income. [Swissquote Annual Report 2025]
- **H1 2026 crypto income: CHF 14.6 m, down 66%**, and FY2026 revenue guidance was cut to about CHF 730 m. [Finance Magnates]

Crypto is a large, volatile revenue line, and today Swissquote has no answer for the client who says "not your keys, not your coins". That client withdraws to MetaMask or a Ledger. From then on, every swap, every DeFi deposit and every future purchase can happen somewhere else.

**Vault keeps self-custody clients one tap from their Swissquote account**: buy on Swissquote, move to Vault instantly, move back to sell, all with the same login.

## Where the money comes from

| Lever | How | Model input |
| --- | --- | --- |
| **1. Retention** | Clients who want self-custody stay instead of leaving with their crypto activity | 20% of Vault users would otherwise have moved their crypto trading away |
| **2. Swap and dApp routing fee** | Swaps through Swissquote-approved routes inside Vault | CHF 5,000 swapped per user per year at 0.5% |
| **3. New clients** | Crypto-native users who would never open "a bank" but will open a wallet that happens to have a bank behind it | 2,000 (year 1) to 8,000 (year 3) new accounts at CHF 300/yr, half the average account |
| **4. Premium features (not in the model)** | Higher limits, multi-device recovery, inheritance planning (guardian-assisted transfer to heirs) | Upside |

## Model

Base inputs from Swissquote's reports; **everything else is a labelled assumption**.

| Input | Value | Source |
| --- | --- | --- |
| Client accounts | 1,220,818 | H1 2026 |
| Share of clients active in crypto | 10% (≈122,000) | **Assumption** |
| Net crypto income per crypto client | ≈ CHF 714 / yr | CHF 85.7 m ÷ (1.2 m × 10%) |
| Vault adoption among crypto clients | 5% year 1, 15% year 3 | **Assumption** |
| User operations per Vault user | 24 / yr | **Assumption** |
| Gas per user operation on an L2 | ≈ USD 0.03 | **Assumption** (L2 fees vary) |
| Independent recovery partner fee | CHF 5 per Vault per year, paid by Swissquote | **Assumption** (key custody in an HSM + rare video identifications) |

| | Year 1 | Year 3 |
| --- | ---: | ---: |
| Vault users | 6,104 | 18,312 |
| Retained crypto income | CHF 871,900 | CHF 2,615,600 |
| Swap / dApp fees | CHF 152,600 | CHF 457,800 |
| New-client revenue | CHF 600,000 | CHF 2,400,000 |
| **Revenue** | **CHF 1.62 m** | **CHF 5.47 m** |
| Gas sponsorship | CHF 3,900 | CHF 11,600 |
| Account-abstraction infrastructure (bundler, paymaster, passkey server) | CHF 60,000 | CHF 60,000 |
| Guardian service (HSM, ops, recovery support) | CHF 250,000 | CHF 250,000 |
| Independent recovery partner | CHF 30,500 | CHF 91,600 |
| **Running cost** | **CHF 0.34 m** | **CHF 0.41 m** |
| **Contribution** | **CHF 1.28 m** | **CHF 5.06 m** |

One-off build (6 people × 9 months) estimated at about CHF 1.5 m, paid back in a little over a year at year-1 contribution.

**Gas is not the cost driver**: sponsoring every transaction costs under CHF 1 per user per year on an L2. The real costs are people and the guardian service. The independent partner, which lets clients recover even if Swissquote is gone, costs about CHF 5 per Vault per year and is also a selling point: "your access doesn't depend on us".

## Lower operating cost and risk than custody

| | Custodial crypto (today) | Vault |
| --- | --- | --- |
| Client assets on/with Swissquote | Yes: segregation, reconciliation, custody controls | No: in the client's own on-chain account |
| Loss of keys | Swissquote's problem | Client's keys; Swissquote offers recovery but holds no assets |
| "I lost my seed phrase" support | Not applicable | Replaced by a self-serve recovery flow with no seed phrase |
| Hack of Swissquote's hot wallet | Client funds at risk | Guardian key can't move funds |

## Why Swissquote, why now

- **Trust:** Swissquote is a listed Swiss bank. "Self-custody with a Swiss bank as your safety net" is a sentence no pure wallet company can say.
- **Identity:** the bank already has KYC, 2FA and an app clients use. Recovery tied to that identity is better than any seed phrase.
- **Rails:** passkeys, ERC-4337 smart accounts and L2 gas costs make this possible now; three years ago it wasn't.
- **Timing:** crypto income is down 66% in H1 2026. Retaining the most engaged crypto clients through the cycle matters most when volumes are low.

## Sources

- [Finance Magnates, Swissquote inches toward CHF 100 billion club even as crypto income craters (13 Aug 2026)](https://www.financemagnates.com/forex/swissquote-inches-toward-chf-100-billion-club-even-as-crypto-income-craters/)
- [Swissquote Annual Report 2025, letter to shareholders](https://www.swissquote.com/en/group/annual-report/2025/main-chapters/shareholders)
