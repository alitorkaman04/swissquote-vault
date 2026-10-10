# Cheat sheet (keep next to the laptop)

## The story in four sentences
1. Today, Swissquote clients who want to hold their own crypto keys have to leave for apps like MetaMask: seed phrases, no recovery, no protection.
2. Vault gives them a wallet where **their phone's Face ID is the key**: only they can move the money.
3. If they lose the phone, they recover with **three things together**: their Swissquote login, a backup key only they have, and a waiting period during which their old devices can cancel it. If Swissquote is ever gone, an independent partner takes Swissquote's place.
4. Swissquote can only help with recovery, never move money, not even together with the partner, so it isn't a custodian, and the client stays one tap from their bank.

## Ten words
**Blockchain** public ledger (we use **Base**, a cheap Ethereum network) · **Testnet** practice network, fake money · **USDC** a digital dollar · **Wallet** holds the key that moves tokens · **Self-custody** you hold the key · **Seed phrase** 24-word backup we *don't* use · **Passkey** Face ID key in the phone's secure chip · **Smart account** a wallet with rules · **Gas** the network fee · **Paymaster** Swissquote pays the gas

## Demo order (Chrome = old phone, Safari = new phone)
Dashboard → Send 5 USDC (checks, Touch ID, Basescan) → `…bad1` blocked → Apps: unknown blocked, Uniswap connect, Revoke → Security: ownership proof → Safari: "I lost my phone", new passkey → **Chrome banner** → (optional: cancel with Touch ID, restart) → **"Demo: try as a thief" → refused** → backup key → 30 s → Complete → Safari sends 1 USDC → Chrome locked out.

## Closer for judges
Sign in as `judgeN` → Create with passkey → "Use a phone, tablet or security key" → judge scans QR with their iPhone → Face ID → Activate. "That key is in *your* phone. No seed phrase, no gas, Swissquote never saw it."

## Numbers
1.22 m Swissquote accounts · CHF 85.7 m crypto income 2025 · −66 % crypto income H1 2026 · Year 1 contribution ≈ CHF 1.3 m, year 3 ≈ CHF 5.1 m · running cost ≈ CHF 0.35–0.4 m/yr · gas < CHF 1 per user per year · 48 h recovery delay in production (30 s demo) · recovery weights: backup 60, Swissquote 40, partner 40, need 100

## Fifteen questions, short answers
| Q | A |
| --- | --- |
| Where is the key? | In the phone's secure chip as a passkey. It never leaves. Swissquote never sees it. |
| Stolen phone? | Needs Face ID for every signature. Thief can't sign. Client recovers to a new phone; old phone is locked out. |
| Can Swissquote take the money? | No. Its key (40) can only help replace the passkey, only with the client's backup key (60), after a delay the client can cancel. Even Swissquote + partner = 80, not enough. |
| What if Swissquote goes bankrupt? | The money is in the client's own account. The passkey still works (we can switch Swissquote off live). Lost phone: backup kit + independent partner = 100. |
| Phone and email stolen? | Refused: they don't have the backup key. The chain rejects their key and Swissquote won't co-sign. We show it live. |
| Travel Rule? | Swissquote ↔ own Vault: verified self-hosted wallet, automatic. Vault → third party: the client sends, Swissquote isn't the sending institution. |
| Who can cancel a recovery? | A device that still holds the current passkey; the veto is signed by it and verified on-chain. |
| Lost phone *and* backup? | Then no recovery, like any self-custody wallet. Production adds a second passkey on another device as an alternative backup. |
| Bank login + stolen backup kit? | 48 h window, every client device alerted, one-tap cancel, bank fraud checks. Two independent compromises *and* an unreachable client. |
| Is the delay just a promise? | In the prototype each guardian enforces it. Production moves recovery to a ZeroDev validator with an on-chain timer and veto, so even the bank can't skip it. |
| What's mocked? | Bank login, the two guardians' key storage (separate processes; HSMs in prod), partner's ID check, sanctions and dApp lists. Labelled MOCK in the app. Everything on-chain is real. |
| Why smart account, not MPC? | Rules are enforced on-chain and auditable; no key shares or MPC servers; passkeys give Face ID UX; gas sponsorship comes with ERC-4337. |
| Can the client bypass compliance checks? | Yes, with another app, because it's self-custody. The checks protect the client and Swissquote's sponsored gas; they're not custody controls. |
| Ownership verification for FINMA? | Wallet created inside the KYC'd session; one tap signs a bank challenge with the passkey; the bank verifies it on-chain. |
| What did you build in 24 h? | The app, the passkey + recovery smart-account setup, gasless transfers, compliance checks, mock bank, docs, tests. |

## If it breaks
"Live blockchains are live. Here's the recording." Play the video; show the account on Basescan; keep talking about the design.
