/**
 * MOCK Swissquote backend  (see docs/mocks.md)
 * --------------------------------------------
 * Stands in for three things Swissquote already has or would operate:
 *   1. e-banking identity (login + 2FA)                      -> /auth/login
 *   2. a "guardian service" holding ONE key share per client -> /guardian, /recovery/*
 *      In production: HSM-backed, with the 48h delay, push notification to the
 *      client's registered devices, and fraud/KYC re-verification before signing.
 *   3. compliance (sanctions screening, approved dApp list)  -> /compliance/*
 *
 * Everything is stored in server/data.json. The bank key is a demo key.
 * What is real: the bank's signature is a genuine ECDSA approval of the recovery user
 * operation, verified on-chain by the weighted validator - and before giving it, the bank
 * checks the client's backup-key approval (registered backup key, on-chain recovery setup)
 * (server/guardian.ts). The independent recovery partner is a SEPARATE process
 * (server/partner.ts) with its own key and storage.
 */
import express from "express"
import cors from "cors"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { type Address, type Hex, isAddress } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { screenTransfer } from "./compliance.js"
import { Refused, coSign, hasProjectId, isDoRecovery, isSignedByVault, publicClient, verifyClientApproval } from "./guardian.js"

// ---------------------------------------------------------------- config
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_FILE = path.join(__dirname, "data.json")
const PORT = Number(process.env.PORT ?? 8787)
const RECOVERY_DELAY_SECONDS = Number(process.env.RECOVERY_DELAY_SECONDS ?? process.env.VITE_RECOVERY_DELAY_SECONDS ?? 30)

type Data = {
  bankGuardianPrivateKey: Hex
  clients: Record<
    string,
    { name: string; walletAddress?: Address; backupAddress?: Address; partnerAddress?: Address; passkeyName?: string; recoveredAt?: number }
  >
  tokens: Record<string, string> // token -> clientId
  recoveries: Record<string, Recovery>
}
type Recovery = {
  id: string
  clientId: string
  walletAddress: Address
  newPasskeyName: string
  callData: Hex
  status: "pending" | "cancelled" | "ready" | "signed"
  createdAt: number
  unlockAt: number
  bankSignature?: Hex
  vetoedBy?: "passkey" | "identity"
}

function load(): Data {
  if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
  const fresh: Data = {
    bankGuardianPrivateKey: (process.env.BANK_GUARDIAN_PRIVATE_KEY as Hex) || generatePrivateKey(),
    clients: {
      // Demo client. Any clientId works on first login (auto-created) - this is a mock.
      "demo": { name: "Demo Client" },
    },
    tokens: {},
    recoveries: {},
  }
  save(fresh)
  return fresh
}
function save(d: Data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2))
}
const db = load()
const bankAccount = privateKeyToAccount(db.bankGuardianPrivateKey)

console.log(`Swissquote guardian service (MOCK)  http://localhost:${PORT}`)
console.log(`  guardian address : ${bankAccount.address}`)
console.log(`  recovery delay   : ${RECOVERY_DELAY_SECONDS}s (production: 48h)`)
if (!process.env.BANK_GUARDIAN_PRIVATE_KEY)
  console.log("  NOTE: guardian key lives in server/data.json - keep that file (or set BANK_GUARDIAN_PRIVATE_KEY in .env)")
if (!hasProjectId) console.warn("  WARNING: ZERODEV_PROJECT_ID not set - recovery signing will fail")

// ---------------------------------------------------------------- helpers
const app = express()
app.use(cors())
app.use(express.json({ limit: "1mb" }))

function auth(token: string | undefined) {
  const clientId = token ? db.tokens[token] : undefined
  if (!clientId) throw Object.assign(new Error("not authenticated"), { status: 401 })
  return clientId
}
const cancelMessage = (id: string) => `Cancel Vault recovery ${id}`
function refreshStatus(r: Recovery) {
  if (r.status === "pending" && Date.now() >= r.unlockAt) r.status = "ready"
  return r
}

// ---------------------------------------------------------------- identity (mock)
app.post("/auth/login", (req, res) => {
  const { clientId, password, otp } = req.body ?? {}
  if (!clientId || password !== "demo" || otp !== "000000") {
    return res.status(401).send("Invalid credentials (demo: password 'demo', 2FA code '000000')")
  }
  db.clients[clientId] ??= { name: clientId }
  const token = randomUUID()
  db.tokens[token] = clientId
  save(db)
  res.json({ clientId, name: db.clients[clientId].name, token })
})

// ---------------------------------------------------------------- guardian key
app.get("/guardian", (_req, res) => res.json({ address: bankAccount.address }))

// ---------------------------------------------------------------- wallet <-> client link (ownership verification)
app.post("/wallet", (req, res) => {
  try {
    const clientId = auth(req.body?.token)
    const { walletAddress, backupAddress, partnerAddress, passkeyName } = req.body
    if (!isAddress(walletAddress) || !isAddress(backupAddress)) return res.status(400).send("bad addresses")
    if (partnerAddress !== undefined && !isAddress(partnerAddress)) return res.status(400).send("bad partner address")
    const c = db.clients[clientId]
    // A Vault's recovery addresses are fixed at creation: nobody (e.g. someone who reset the
    // e-banking password) can swap in their own backup address later.
    if (c.walletAddress?.toLowerCase() === walletAddress.toLowerCase() && c.backupAddress && c.backupAddress.toLowerCase() !== backupAddress.toLowerCase()) {
      return res.status(409).send("recovery addresses are fixed at creation")
    }
    // Public addresses only: Swissquote never receives the backup KEY.
    Object.assign(db.clients[clientId], { walletAddress, backupAddress, partnerAddress, passkeyName, recoveredAt: undefined })
    save(db)
    res.json({ ok: true })
  } catch (e: any) {
    res.status(e.status ?? 500).send(e.message)
  }
})
app.get("/wallet", (req, res) => {
  try {
    const clientId = auth(String(req.query.token ?? ""))
    const c = db.clients[clientId]
    if (!c.walletAddress) return res.json(null)
    res.json({
      walletAddress: c.walletAddress,
      backupAddress: c.backupAddress,
      partnerAddress: c.partnerAddress ?? null,
      passkeyName: c.passkeyName,
      recoveredAt: c.recoveredAt ?? null,
    })
  } catch (e: any) {
    res.status(e.status ?? 500).send(e.message)
  }
})

// ---------------------------------------------------------------- step-up authentication (mock 2FA)
app.post("/auth/stepup", (req, res) => {
  try {
    auth(req.body?.token)
    if (req.body?.otp !== "000000") return res.status(401).send("Invalid security code (demo: 000000)")
    res.json({ ok: true, until: Date.now() + 5 * 60_000 })
  } catch (e: any) {
    res.status(e.status ?? 500).send(e.message)
  }
})

// ---------------------------------------------------------------- wallet ownership proof (FINMA Guidance 02/2019)
// The bank issues a challenge; the client's smart account signs it with the passkey (ERC-1271);
// the bank verifies the signature ON-CHAIN against the wallet address it has on file.
const challenges: Record<string, { clientId: string; message: string; issuedAt: number }> = {}
app.post("/ownership/challenge", (req, res) => {
  try {
    const clientId = auth(req.body?.token)
    const c = db.clients[clientId]
    if (!c.walletAddress) return res.status(400).send("no wallet on file")
    const nonce = randomUUID()
    const message = [
      "Swissquote wallet ownership check",
      `Client: ${clientId}`,
      `Wallet: ${c.walletAddress}`,
      `Nonce: ${nonce}`,
      `Issued: ${new Date().toISOString()}`,
    ].join("\n")
    challenges[nonce] = { clientId, message, issuedAt: Date.now() }
    res.json({ nonce, message })
  } catch (e: any) {
    res.status(e.status ?? 500).send(e.message)
  }
})
app.post("/ownership/verify", async (req, res) => {
  try {
    const clientId = auth(req.body?.token)
    const c = db.clients[clientId]
    const ch = challenges[req.body?.nonce]
    if (!ch || ch.clientId !== clientId) return res.status(400).send("unknown challenge")
    if (Date.now() - ch.issuedAt > 5 * 60_000) return res.status(400).send("challenge expired")
    const valid = await publicClient.verifyMessage({
      address: c.walletAddress!,
      message: ch.message,
      signature: req.body?.signature as Hex,
    })
    delete challenges[req.body.nonce]
    if (!valid) return res.status(401).json({ verified: false })
    ;(c as typeof c & { ownershipVerifiedAt?: number }).ownershipVerifiedAt = Date.now()
    save(db)
    console.log(`[ownership] ${clientId} proved control of ${c.walletAddress} (ERC-1271, verified on-chain)`)
    res.json({ verified: true, walletAddress: c.walletAddress, verifiedAt: Date.now() })
  } catch (e: any) {
    console.error(e)
    res.status(500).send(e.message)
  }
})

// ---------------------------------------------------------------- recovery (guardian service)
app.post("/recovery/request", (req, res) => {
  try {
    const clientId = auth(req.body?.token)
    const c = db.clients[clientId]
    if (!c.walletAddress) return res.status(400).send("no wallet on file for this client")
    const { callData, newPasskeyName } = req.body
    // The bank only ever co-signs a doRecovery call (the on-chain selector binding enforces this too).
    if (!isDoRecovery(callData)) return res.status(400).send("recovery request must be a doRecovery call")
    // One live recovery per wallet: a new request supersedes an abandoned one (new passkey = new callData).
    for (const r of Object.values(db.recoveries)) {
      if (r.walletAddress === c.walletAddress && ["pending", "ready"].includes(refreshStatus(r).status)) {
        r.status = "cancelled"
        console.log(`[recovery] ${r.id} superseded by a new request`)
      }
    }
    const r: Recovery = {
      id: randomUUID(),
      clientId,
      walletAddress: c.walletAddress,
      newPasskeyName,
      callData,
      status: "pending",
      createdAt: Date.now(),
      unlockAt: Date.now() + RECOVERY_DELAY_SECONDS * 1000,
    }
    db.recoveries[r.id] = r
    save(db)
    console.log(`[recovery] requested for ${r.walletAddress} - notifying registered devices, unlock in ${RECOVERY_DELAY_SECONDS}s`)
    res.json(r)
  } catch (e: any) {
    res.status(e.status ?? 500).send(e.message)
  }
})
app.get("/recovery/pending", (req, res) => {
  const walletAddress = String(req.query.walletAddress ?? "").toLowerCase()
  const r = Object.values(db.recoveries).find(
    (x) => x.walletAddress.toLowerCase() === walletAddress && ["pending", "ready"].includes(refreshStatus(x).status),
  )
  res.json(r ?? null)
})
app.get("/recovery/:id", (req, res) => {
  const r = db.recoveries[req.params.id]
  if (!r) return res.status(404).send("unknown recovery")
  res.json(refreshStatus(r))
})
// Veto. Strong path: a message signed by a device that still holds the current passkey
// (verified on-chain via ERC-1271). Fallback: the client's e-banking session.
app.post("/recovery/:id/cancel", async (req, res) => {
  const r = db.recoveries[req.params.id]
  if (!r) return res.status(404).send("unknown recovery")
  if (r.status === "signed") return res.status(409).send("already executed")
  let vetoedBy: "passkey" | "identity" | null = null
  const { signature, message, token } = req.body ?? {}
  if (signature && message === cancelMessage(r.id) && (await isSignedByVault(r.walletAddress, message, signature))) {
    vetoedBy = "passkey"
  }
  if (!vetoedBy && token && db.tokens[token] === r.clientId) vetoedBy = "identity"
  if (!vetoedBy) return res.status(401).send("veto must be signed by the current passkey or an authenticated client session")
  r.status = "cancelled"
  ;(r as Recovery & { vetoedBy?: string }).vetoedBy = vetoedBy
  save(db)
  console.log(`[recovery] ${r.id} CANCELLED (${vetoedBy === "passkey" ? "signed by the current passkey" : "authenticated client session"})`)
  res.json(r)
})
app.post("/recovery/:id/sign", async (req, res) => {
  const r = db.recoveries[req.params.id]
  if (!r) return res.status(404).send("unknown recovery")
  // Identity is re-checked at signing time: only the client who requested it may collect the bank's half.
  if (!req.body?.token || db.tokens[req.body.token] !== r.clientId) return res.status(401).send("not authenticated")
  refreshStatus(r)
  if (r.status === "cancelled") return res.status(409).send("recovery was cancelled")
  try {
    // Checked FIRST, before the delay: a login (e.g. via a stolen inbox) is never enough.
    // The client's backup key must have approved exactly this recovery (checked against the backup key on file and the Vault's on-chain recovery header).
    const c = db.clients[r.clientId]
    if (!c.backupAddress) throw new Refused("no backup key on file for this client")
    const known = { backup: c.backupAddress, swissquote: bankAccount.address, partner: c.partnerAddress }
    await verifyClientApproval(bankAccount, r.walletAddress, r.callData, req.body?.backupApproval, known)
    if (r.status === "pending") return res.status(425).send(`delay not elapsed, ${Math.ceil((r.unlockAt - Date.now()) / 1000)}s left`)
    if (r.bankSignature) return res.json({ signature: r.bankSignature })
    const signature = await coSign(bankAccount, r.walletAddress, r.callData, known)
    r.bankSignature = signature
    r.status = "signed"
    save(db)
    console.log(`[recovery] ${r.id} backup approval verified; co-signed by Swissquote guardian`)
    res.json({ signature })
  } catch (e: any) {
    if (e instanceof Refused) {
      console.log(`[recovery] ${r.id} REFUSED: ${e.message}`)
      return res.status(403).send(`Swissquote refused to co-sign: ${e.message}`)
    }
    console.error(e)
    res.status(500).send(e.message)
  }
})

// Called by the new device once the recovery user operation is confirmed on-chain.
// The new passkey becomes the one on file; old devices see they were replaced.
app.post("/recovery/:id/complete", (req, res) => {
  const r = db.recoveries[req.params.id]
  if (!r) return res.status(404).send("unknown recovery")
  if (r.status !== "signed") return res.status(409).send("recovery not signed")
  const c = db.clients[r.clientId]
  c.passkeyName = r.newPasskeyName
  c.recoveredAt = Date.now()
  ;(r as Recovery & { txHash?: string; completedAt?: number }).txHash = req.body?.txHash
  ;(r as Recovery & { completedAt?: number }).completedAt = Date.now()
  save(db)
  console.log(`[recovery] ${r.id} completed on-chain - ${r.newPasskeyName} is now the client's passkey`)
  res.json({ ok: true })
})

// ---------------------------------------------------------------- compliance (mock lists, real rules)
// Rules live in server/compliance.ts (unit-tested). Production swaps the lists for a screening provider.
app.post("/compliance/screen", (req, res) => {
  const { from, to, amountUsdc } = req.body ?? {}
  res.json(screenTransfer({ from, to, amountUsdc }))
})

app.get("/compliance/dapps", (_req, res) =>
  res.json([
    {
      id: "uniswap",
      name: "Uniswap",
      url: "https://app.uniswap.org",
      category: "DEX",
      contracts: ["0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4"],
      note: "Swap tokens. (Demo list) Reviewed by Swissquote; audited; live since 2018.",
    },
    {
      id: "aave",
      name: "Aave v3",
      url: "https://app.aave.com",
      category: "Lending",
      contracts: ["0x07eA79F68B2B3df564D0A34F8e19D9B1e339814b"],
      note: "Supply and borrow. Approved for clients with 'Advanced' profile.",
    },
    {
      id: "morpho",
      name: "Morpho",
      url: "https://app.morpho.org",
      category: "Lending",
      contracts: [],
      note: "Vault deposits. Approved; limits apply.",
    },
  ]),
)

// ---------------------------------------------------------------- demo only
// "Switch Swissquote off": really stops this process, so the demo can show that the Vault still
// signs, and still recovers through the independent partner, with no Swissquote at all.
// Localhost only; restart with `npm run bank`.
app.post("/demo/shutdown", (req, res) => {
  const ip = req.socket.remoteAddress ?? ""
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)) return res.status(403).send("localhost only")
  console.log("[demo] Swissquote switched OFF - restart with: npm run bank")
  res.json({ ok: true })
  setTimeout(() => process.exit(0), 200)
})

app.listen(PORT)
