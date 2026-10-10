# Live demo script (about 3 minutes)

**Setup before judging:** Terminal running `npm run dev` in `app/`. Chrome window = "old phone" (signed in, Vault open, some USDC). Safari window = "new phone" (nothing set up yet). Basescan tab open. Backup kit text file open.

| Time | Do | Say |
| --- | --- | --- |
| 0:00 | Chrome: dashboard | "This is the Vault: a self-custody wallet one tap from your Swissquote account. Three boxes: this phone's passkey controls everything; my backup and Swissquote can only do recovery, together." |
| 0:20 | Send tab → recipient → 5 USDC → Review | "Before I sign: sanctions screening, limits, and a real on-chain simulation. Network fee: paid by Swissquote. I never need ETH." |
| 0:40 | Sign with passkey → Touch ID → Basescan link | "That's a real transaction on Base, signed by a key in the Secure Enclave. Swissquote never saw it." |
| 1:00 | Recipient `0x…bad1` → Review | "Sanctioned address: blocked before I can sign." |
| 1:10 | Apps tab → unknown URL → blocked; Uniswap → Connect → **Revoke** | "Only Swissquote-approved dApps, with limited approvals I can revoke." |
| 1:20 | Security tab → Sign ownership proof | "Swiss rules say the bank must verify this wallet is mine. One tap: the bank challenges, my passkey signs, the bank checks it on-chain." |
| 1:25 | Safari ("new phone"): sign in → "I lost my phone" → create passkey | "I lost my phone. On a new one I sign in to Swissquote: that proves who I am." |
| 1:45 | **Switch to Chrome:** yellow banner "Someone is recovering this Vault" | "Meanwhile every device I still have gets this. If it's a thief with my bank password, one tap cancels it." |
| *optional* | Click cancel → Touch ID → green "veto signed with this phone's passkey"; Safari shows "Recovery cancelled". Then restart the recovery in Safari | "The veto is signed by my passkey and verified on-chain: a thief can't fake it. Now let's say it really is me." |
| 2:00 | Back to Safari: paste backup key → countdown | "But it's me. I add my backup key, which Swissquote never had. In production we wait 48 hours; here 30 seconds." |
| 2:30 | Complete recovery → dashboard, same address, same balance | "Same address, same funds. Only the passkey changed." |
| 2:45 | Send 1 USDC from Safari; **Chrome now shows "This device no longer controls your Vault"** | "And the new phone signs. The old phone is locked out." |
| 2:55 | Close | "Swissquote alone can't move a cent. The client alone can. That's not custody, and it keeps the client one tap from their bank." |

## The closer: "Try it with your own phone"

After the lifecycle, offer the judge the laptop: Chrome → sign out → sign in as `judge1` (any new name, password `demo`, code `000000`) → **Create with passkey** → in the passkey dialog choose **"Use a phone, tablet or security key"** → a QR code appears → the judge scans it with their iPhone and uses **their** Face ID → backup kit → **Activate my Vault** (Face ID on their phone again) → "Your Vault is live on the network".

Say: "That wallet is now controlled by a key inside your phone. Swissquote never saw it, you never saw a seed phrase, and the gas was paid for you. That's the product."

Use a fresh client name for every judge (`judge1`, `judge2`, …).

**Rehearse twice before judging**, including the Safari recovery and the cancel banner.

**Backup plan:** if the network is slow, show the recorded video and the Basescan history of the account.
