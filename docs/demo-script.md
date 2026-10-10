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
| 2:00 | Back to Safari: paste backup key → countdown | "But it's me. I add my backup key, which Swissquote never had. In production we wait 48 hours; here 30 seconds." |
| 2:30 | Complete recovery → dashboard, same address, same balance | "Same address, same funds. Only the passkey changed." |
| 2:45 | Send 1 USDC from Safari | "And the new phone signs." |
| 2:55 | Close | "Swissquote alone can't move a cent. The client alone can. That's not custody, and it keeps the client one tap from their bank." |

**Rehearse twice before judging**, including the Safari recovery and the cancel banner.

**Backup plan:** if the network is slow, show the recorded video and the Basescan history of the account.
