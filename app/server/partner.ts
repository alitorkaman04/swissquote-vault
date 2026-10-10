/**
 * MOCK independent recovery partner  (see docs/mocks.md, docs/custody-model.md)
 * ------------------------------------------------------------------------------
 * Answers the challenge question: "how does the client get their funds back if
 * Swissquote's services are permanently gone?"
 *
 * In production: an independent, regulated Swiss trust company or notary, contracted at
 * onboarding (fictional here). It holds ONE recovery key with weight 40, the same as
 * Swissquote's. On-chain rules (threshold 100):
 *   client backup 60 + partner 40      = 100  -> the client can recover without Swissquote
 *   Swissquote 40 + partner 40         =  80  -> the two institutions can never act without the client
 *
 * Runs as its OWN process with its OWN key and storage (server/partner-data.json),
 * separate from the Swissquote mock; the client app never holds this key.
 * It is the slow, last-resort path: it only acts with the client's backup approval,
 * after an identity check (mocked) and a longer waiting period during which the Vault's
 * current passkey can veto.
 */
import express from "express"
import cors from "cors"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { type Address, type Hex, getAddress, isAddress } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { Refused, coSign, isDoRecovery, isSignedByVault, verifyClientApproval } from "./guardian.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_FILE = path.join(__dirname, "partner-data.json")
const PORT = Number(process.env.PARTNER_PORT ?? 8788)
const DELAY_SECONDS = Number(process.env.PARTNER_DELAY_SECONDS ?? process.env.VITE_PARTNER_DELAY_SECONDS ?? 45)
const NAME = "Independent recovery partner (fictional, mocked)"

type Recovery = {
  id: string
  walletAddress: Address
  newPasskeyName: string
  callData: Hex
  status: "pending" | "cancelled" | "ready" | "signed"
  createdAt: number
  unlockAt: number
  partnerSignature?: Hex
  vetoed?: boolean
}
type Data = {
  partnerPrivateKey: Hex
  /** Vaults registered at onboarding, with the identity the partner re-verifies (escrowed KYC in production). */
  vaults: Record<string, { holder: string; registeredAt: number; backupAddress?: Address; swissquoteAddress?: Address }>
  recoveries: Record<string, Recovery & { token: string }>
}

function load(): Data {
  if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
  const fresh: Data = {
    partnerPrivateKey: (process.env.PARTNER_PRIVATE_KEY as Hex) || generatePrivateKey(),
    vaults: {},
    recoveries: {},
  }
  save(fresh)
  return fresh
}
function save(d: Data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2))
}
const db = load()
const partnerAccount = privateKeyToAccount(db.partnerPrivateKey)
const key = (a: string) => a.toLowerCase()
const cancelMessage = (id: string) => `Cancel Vault recovery ${id}`
function refresh(r: Recovery) {
  if (r.status === "pending" && Date.now() >= r.unlockAt) r.status = "ready"
  return r
}
const partnerKnown = (v: Data["vaults"][string]) => ({ backup: v.backupAddress!, swissquote: v.swissquoteAddress!, partner: partnerAccount.address })
const publicView = ({ token: _t, ...r }: Recovery & { token: string }) => ({ ...refresh(r), via: "partner" as const })

console.log(`Independent recovery partner (MOCK)  http://localhost:${PORT}`)
console.log(`  partner address  : ${partnerAccount.address}`)
console.log(`  waiting period   : ${DELAY_SECONDS}s (production: 30 days)`)
if (!process.env.PARTNER_PRIVATE_KEY) console.log("  NOTE: partner key lives in server/partner-data.json - keep that file")

const app = express()
app.use(cors())
app.use(express.json({ limit: "1mb" }))

app.get("/guardian", (_req, res) => res.json({ address: partnerAccount.address, name: NAME, delaySeconds: DELAY_SECONDS }))

// Onboarding: the client registers their Vault with the partner (public address + identity reference).
app.post("/register", (req, res) => {
  const { walletAddress, holder, backupAddress, swissquoteAddress } = req.body ?? {}
  if (!isAddress(walletAddress) || typeof holder !== "string" || !holder.trim()) return res.status(400).send("bad registration")
  if (!isAddress(backupAddress) || !isAddress(swissquoteAddress)) return res.status(400).send("bad recovery addresses")
  const existing = db.vaults[key(walletAddress)]
  // First registration wins: nobody can re-register a Vault under another identity later.
  if (existing && existing.holder.toLowerCase() !== holder.trim().toLowerCase()) {
    return res.status(409).send("this Vault is already registered to another holder")
  }
  // Recovery addresses are fixed at creation: they can't be swapped later.
  if (existing?.backupAddress && getAddress(backupAddress) !== existing.backupAddress) {
    return res.status(409).send("recovery addresses are fixed at creation")
  }
  db.vaults[key(walletAddress)] = {
    holder: holder.trim(),
    registeredAt: existing?.registeredAt ?? Date.now(),
    backupAddress: getAddress(backupAddress),
    swissquoteAddress: getAddress(swissquoteAddress),
  }
  save(db)
  console.log(`[partner] registered ${walletAddress} for ${holder.trim()}`)
  res.json({ ok: true })
})

// Public recovery addresses of a registered Vault (no identity data).
app.get("/vault/:address", (req, res) => {
  const v = db.vaults[key(req.params.address)]
  if (!v?.backupAddress || !v.swissquoteAddress) return res.status(404).send("not registered")
  res.json({ backupAddress: v.backupAddress, swissquoteAddress: v.swissquoteAddress })
})

// The client asks the partner to co-sign a recovery. Requires: a registered Vault, the holder's identity
// (mock: client number; production: video identification against the escrowed KYC file), a doRecovery
// call, and the client's backup approval - verified against the registered backup key and the Vault's on-chain recovery header.
app.post("/recovery/request", async (req, res) => {
  const { walletAddress, holder, callData, newPasskeyName, backupApproval } = req.body ?? {}
  try {
    if (!isAddress(walletAddress)) return res.status(400).send("bad Vault address")
    const vault = db.vaults[key(walletAddress)]
    if (!vault) throw new Refused("this Vault was never registered with the recovery partner")
    if (String(holder ?? "").trim().toLowerCase() !== vault.holder.toLowerCase()) {
      throw new Refused("identity check failed: you are not the registered holder of this Vault")
    }
    if (!isDoRecovery(callData)) return res.status(400).send("recovery request must be a doRecovery call")
    if (!vault.backupAddress || !vault.swissquoteAddress) throw new Refused("this Vault was registered without its recovery addresses")
    await verifyClientApproval(partnerAccount, getAddress(walletAddress), callData, backupApproval, partnerKnown(vault))
    for (const r of Object.values(db.recoveries)) {
      if (key(r.walletAddress) === key(walletAddress) && ["pending", "ready"].includes(refresh(r).status)) r.status = "cancelled"
    }
    const r = {
      id: randomUUID(),
      token: randomUUID(),
      walletAddress: getAddress(walletAddress),
      newPasskeyName: String(newPasskeyName ?? ""),
      callData,
      status: "pending" as const,
      createdAt: Date.now(),
      unlockAt: Date.now() + DELAY_SECONDS * 1000,
    }
    db.recoveries[r.id] = r
    save(db)
    console.log(`[partner] recovery ${r.id} for ${r.walletAddress}: identity + backup approval OK, unlock in ${DELAY_SECONDS}s`)
    res.json({ ...publicView(r), token: r.token })
  } catch (e: any) {
    if (e instanceof Refused) {
      console.log(`[partner] REFUSED for ${walletAddress}: ${e.message}`)
      return res.status(403).send(`Recovery partner refused: ${e.message}`)
    }
    console.error(e)
    res.status(500).send(e.message)
  }
})

app.get("/recovery/pending", (req, res) => {
  const w = key(String(req.query.walletAddress ?? ""))
  const r = Object.values(db.recoveries).find((x) => key(x.walletAddress) === w && ["pending", "ready"].includes(refresh(x).status))
  res.json(r ? publicView(r) : null)
})
app.get("/recovery/:id", (req, res) => {
  const r = db.recoveries[req.params.id]
  if (!r) return res.status(404).send("unknown recovery")
  res.json(publicView(r))
})

// Veto: only the Vault itself (its current passkey, ERC-1271, verified on-chain) can cancel.
app.post("/recovery/:id/cancel", async (req, res) => {
  const r = db.recoveries[req.params.id]
  if (!r) return res.status(404).send("unknown recovery")
  if (r.status === "signed") return res.status(409).send("already executed")
  const { message, signature } = req.body ?? {}
  if (message !== cancelMessage(r.id) || !(await isSignedByVault(r.walletAddress, message, signature))) {
    return res.status(401).send("veto must be signed by the Vault's current passkey")
  }
  r.status = "cancelled"
  r.vetoed = true
  save(db)
  console.log(`[partner] recovery ${r.id} CANCELLED by the Vault's current passkey`)
  res.json({ ...publicView(r), vetoedBy: "passkey" })
})

app.post("/recovery/:id/sign", async (req, res) => {
  const r = db.recoveries[req.params.id]
  if (!r) return res.status(404).send("unknown recovery")
  if (req.body?.token !== r.token) return res.status(401).send("not the requester")
  refresh(r)
  if (r.status === "cancelled") return res.status(409).send("recovery was cancelled")
  if (r.status === "pending") return res.status(425).send(`waiting period not over, ${Math.ceil((r.unlockAt - Date.now()) / 1000)}s left`)
  if (r.partnerSignature) return res.json({ signature: r.partnerSignature })
  try {
    const vault = db.vaults[key(r.walletAddress)]
    if (!vault?.backupAddress || !vault.swissquoteAddress) throw new Refused("this Vault was registered without its recovery addresses")
    const signature = await coSign(partnerAccount, r.walletAddress, r.callData, partnerKnown(vault))
    r.partnerSignature = signature
    r.status = "signed"
    save(db)
    console.log(`[partner] recovery ${r.id} co-signed by the independent partner`)
    res.json({ signature })
  } catch (e: any) {
    console.error(e)
    res.status(e instanceof Refused ? 403 : 500).send(e.message)
  }
})

app.listen(PORT)
