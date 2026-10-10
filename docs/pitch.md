# Pitch

The deck is the "Swissquote Vault" slides artifact (exports to PowerPoint or PDF). Speaker notes on each slide hold the words below.

## 3-minute script (about 20 seconds per slide, demo separate)

1. **Cover:** "This is Swissquote Vault: the self-custody wallet Swissquote could launch. The client holds the keys; Swissquote stays one tap away. Everything you'll see runs on a real blockchain."
2. **Problem:** "Today a client who wants their own keys withdraws to MetaMask and leaves: no recovery, no checks, and their next trade happens anywhere. Crypto brought Swissquote 85.7 million last year and fell 66% this half-year."
3. **Three keys:** "The passkey on the phone does everything. The client's backup key and Swissquote's guardian key form a recovery pair that the account only lets do one thing: replace a lost passkey."
4. **How it works:** "ERC-4337 smart account on Base, passkey validator, recovery validator bound to doRecovery, Swissquote's paymaster pays gas. Audited ZeroDev modules; only bank-side services are mocked."
5. **Demo** (see `demo-script.md`).
6. **Recovery:** "Recovery needs identity, the backup key only the client has, and 48 hours during which every old device can cancel. One stolen factor is never enough."
7. **Compliance:** "Sanctions screening, simulation, approved dApps, step-up for large amounts, gasless, phishing-proof passkeys."
8. **Legal:** "Swissquote never holds the key that moves funds and its signature is never needed, so under FINMA practice it's not custody. Ownership verification is built in. The recovery grey zone is the question for FINMA."
9. **Business:** "About 1.3 million contribution in year one, 5 million in year three, against 300k to run. Gas is under a franc per user per year."
10. **Close:** "Swissquote alone can't move a cent. The client alone can. Thank you."

## Likely judge questions

| Question | Short answer |
| --- | --- |
| What if the client loses the phone **and** the backup kit? | Then they can't recover, as with any self-custody wallet. Production adds a second passkey on another device (laptop, hardware key) as an alternative backup, so the client chooses 2 of 3 among phone, second device and printed kit. |
| Can Swissquote and an attacker collude? | Swissquote + a stolen backup kit could start a recovery, but it runs through a 48-hour window during which every client device is alerted and can cancel. Swissquote also runs fraud checks before signing. Docs: threat-model.md, T6/T7. |
| Isn't the 48-hour delay just a promise by Swissquote? | In the prototype yes, it's enforced by the guardian service. The weighted validator has an on-chain `delay` parameter, so production enforces it in the contract too. |
| What's mocked? | Bank login, the guardian key's storage (an HSM in production), sanctions lists and the dApp list. Everything on-chain is real. See mocks.md. |
| Why a smart account and not MPC? | No key shares to manage and no MPC servers to run; the rules (who can do what) are enforced on-chain and auditable; passkeys give a familiar Face ID experience; gas sponsorship comes for free with ERC-4337. |
| Why Base? | Cheap, fast Ethereum L2 with native USDC and good ERC-4337 support. The design works on any EVM chain. |
| What if ZeroDev disappears? | The account is standard ERC-4337: any bundler works. The passkey server only stores public keys; Swissquote would self-host it. |
| Can a client bypass the compliance checks? | Yes, by using the passkey from another app, because it's their money (self-custody). The checks protect the client and Swissquote's sponsored gas; they are not custody controls. |
| What does Swissquote earn? | Retained crypto trading, fees on swaps through approved routes, new crypto-native clients. Gas cost is negligible. See business-case.md. |
| Is the backup key secure shown on screen? | In the demo it's shown raw for transparency. Production: a printed kit or a second passkey. |
| What did you build in 24 hours? | The wallet app, the passkey + recovery smart-account setup, gasless transfers, compliance checks, the mock bank backend, and all the docs. |

## If something breaks during the live demo

- Stay calm and say: "Live chains are live. Here's the recording." Then play the backup video.
- Show the account's history on Basescan: every transaction from rehearsal is there.
