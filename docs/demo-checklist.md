# Demo-day checklist

## The night before
- [ ] Record the backup video (QuickTime → File → New Screen Recording), following `demo-script.md`. Upload it; put the link in `submission.md`.
- [ ] Push everything. Open the GitHub repo in a browser and check the README renders with screenshots and the CI badge is green.
- [ ] Submit on DoraHacks: repo link, video link, text from `submission.md`.
- [ ] Charge the laptop. Pack the charger.
- [ ] Sleep.

## 60 minutes before judging
- [ ] Connect to Wi-Fi; have your phone's hotspot ready as a fallback (the app needs internet for the blockchain).
- [ ] Terminal: `cd ~/Documents/GitHub/swissquote-vault/app && npm run dev`. Check the yellow `[bank]` lines show the guardian address and the magenta `[partner]` lines show the partner address.
- [ ] Keep `app/server/data.json` **and** `app/server/partner-data.json`: they hold the two guardian keys. Deleting either makes existing Vaults unrecoverable through that guardian.
- [ ] The Chrome Vault must be one **created after the partner update** (Security tab shows four keys: passkey, backup 60, Swissquote 40, partner 40). Older Vaults still work but have no partner.
- [ ] **Chrome** (old phone): `localhost:5173`, signed in as `demo`, dashboard showing a balance of at least 5 USDC. If the balance is low, get more at faucet.circle.com.
- [ ] **Safari** (new phone): `localhost:5173`, signed out or on the "Welcome back" screen. Do **not** leave a half-finished recovery open.
- [ ] Backup kit `.txt` file open in TextEdit (you'll paste the key).
- [ ] Basescan tab open on the Vault address.
- [ ] Slides open in Present mode on a second desktop (swipe between slides and browser).
- [ ] Do one quick send of 1 USDC to warm everything up. Then stop touching it.
- [ ] Close every other tab and app. Turn on Do Not Disturb.

## Which browser holds the passkey right now?
After every recovery, the browser that recovered becomes the "old phone". Before judging, make sure **Chrome** is the one that can send (try a 1 USDC send). If Safari holds it, do one more recovery from Chrome so the roles are right, or swap the browsers in your head.

## If something fails live
1. Say: "Live blockchains are live. Here's what it looked like ten minutes ago." Play the video.
2. Show the account's history on Basescan: every transaction from the rehearsals is there.
3. Keep talking about the design while the video plays. The judges score the design, not the Wi-Fi.
