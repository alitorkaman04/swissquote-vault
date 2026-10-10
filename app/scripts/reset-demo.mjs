// Fresh demo: forget every client, Vault, recovery and deposit, but KEEP the keys.
//
//   npm run reset-demo        (stop `npm run dev` first; the servers keep the data in memory)
//
// Kept: the Swissquote guardian key, Swissquote's deposit (treasury) key and the partner key.
// Deleting those would break every Vault already registered with them and lose the treasury's test USDC.
// A timestamped backup of both files is written next to them before anything changes.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server")
const stamp = new Date().toISOString().replace(/[:.]/g, "-")

function reset(file, keep, fresh) {
  const full = path.join(dir, file)
  if (!fs.existsSync(full)) {
    console.log(`  ${file}: not found, nothing to reset (it is created on the next start)`)
    return
  }
  const data = JSON.parse(fs.readFileSync(full, "utf8"))
  fs.copyFileSync(full, `${full}.bak-${stamp}`)
  const next = { ...fresh }
  for (const k of keep) if (data[k] !== undefined) next[k] = data[k]
  fs.writeFileSync(full, JSON.stringify(next, null, 2))
  console.log(`  ${file}: reset (kept ${keep.filter((k) => data[k] !== undefined).join(", ")}); backup ${path.basename(full)}.bak-${stamp}`)
}

console.log("Resetting the demo data...")
reset("data.json", ["bankGuardianPrivateKey", "depositPrivateKey"], {
  clients: { demo: { name: "Demo Client" } },
  tokens: {},
  recoveries: {},
  deposits: {},
  withdrawals: [],
})
reset("partner-data.json", ["partnerPrivateKey"], { vaults: {}, recoveries: {} })
console.log("Done. Now: npm run dev, then open http://localhost:5173/?reset in each browser.")
