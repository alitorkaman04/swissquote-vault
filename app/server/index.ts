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
 * The ONE thing that is real: the bank's signature is a genuine ECDSA approval
 * of the recovery user operation, verified on-chain by the weighted validator.
 */
import express from "express"
import cors from "cors"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { createKernelAccount, createZeroDevPaymasterClient } from "@zerodev/sdk"
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants"
import {
  WeightedValidatorContractVersion,
  createWeightedKernelAccountClient,
  createWeightedValidator,
  getRecoveryAction,
  toECDSASigner,
} from "@zerodev/weighted-validator"
import { type Address, type Hex, createPublicClient, http, isAddress } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { baseSepolia } from "viem/chains"

// ---------------------------------------------------------------- config
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_FILE = path.join(__dirname, "data.json")
const PORT = Number(process.env.PORT ?? 8787)
const PROJECT_ID = process.env.ZERODEV_PROJECT_ID ?? process.env.VITE_ZERODEV_PROJECT_ID
const RECOVERY_DELAY_SECONDS = Number(process.env.RECOVERY_DELAY_SECONDS ?? process.env.VITE_RECOVERY_DELAY_SECONDS ?? 30)
const CHAIN = baseSepolia
const ZERODEV_RPC_URL = `https://rpc.zerodev.app/api/v3/${PROJECT_ID}/chain/${CHAIN.id}`
const ENTRY_POINT = getEntryPoint("0.7")
const KERNEL_VERSION = KERNEL_V3_1

type Data = {
  bankGuardianPrivateKey: Hex
  clients: Record<string, { name: string; walletAddress?: Address; backupAddress?: Address; passkeyName?: string; recoveredAt?: number }>
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
}

function load(): Data {
  if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
  const fresh: Data = {
    bankGuardianPrivateKey: (process.env.BANK_GUARDIAN_PRIVATE_KEY as Hex) ?? generatePrivateKey(),
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
const publicClient = createPublicClient({ chain: CHAIN, transport: http() })

console.log(`Swissquote guardian service (MOCK)  http://localhost:${PORT}`)
console.log(`  guardian address : ${bankAccount.address}`)
console.log(`  recovery delay   : ${RECOVERY_DELAY_SECONDS}s (production: 48h)`)
if (!PROJECT_ID) console.warn("  WARNING: ZERODEV_PROJECT_ID not set - recovery signing will fail")

// ---------------------------------------------------------------- helpers
const app = express()
app.use(cors())
app.use(express.json({ limit: "1mb" }))

function auth(token: string | undefined) {
  const clientId = token ? db.tokens[token] : undefined
  if (!clientId) throw Object.assign(new Error("not authenticated"), { status: 401 })
  return clientId
}
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
    const { walletAddress, backupAddress, passkeyName } = req.body
    if (!isAddress(walletAddress) || !isAddress(backupAddress)) return res.status(400).send("bad addresses")
    Object.assign(db.clients[clientId], { walletAddress, backupAddress, passkeyName })
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
    res.json({ walletAddress: c.walletAddress, backupAddress: c.backupAddress, passkeyName: c.passkeyName, recoveredAt: c.recoveredAt ?? null })
  } catch (e: any) {
    res.status(e.status ?? 500).send(e.message)
  }
})

// ---------------------------------------------------------------- recovery (guardian service)
app.post("/recovery/request", (req, res) => {
  try {
    const clientId = auth(req.body?.token)
    const c = db.clients[clientId]
    if (!c.walletAddress) return res.status(400).send("no wallet on file for this client")
    const { callData, newPasskeyName } = req.body
    // Only one live recovery per wallet.
    for (const r of Object.values(db.recoveries)) {
      if (r.walletAddress === c.walletAddress && ["pending", "ready"].includes(refreshStatus(r).status)) {
        return res.json(r)
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
app.post("/recovery/:id/cancel", (req, res) => {
  const r = db.recoveries[req.params.id]
  if (!r) return res.status(404).send("unknown recovery")
  if (r.status === "signed") return res.status(409).send("already executed")
  r.status = "cancelled"
  save(db)
  console.log(`[recovery] ${r.id} CANCELLED by the client's existing device`)
  res.json(r)
})
app.post("/recovery/:id/sign", async (req, res) => {
  const r = db.recoveries[req.params.id]
  if (!r) return res.status(404).send("unknown recovery")
  refreshStatus(r)
  if (r.status === "cancelled") return res.status(409).send("recovery was cancelled")
  if (r.status === "pending") return res.status(425).send(`delay not elapsed, ${Math.ceil((r.unlockAt - Date.now()) / 1000)}s left`)
  if (r.bankSignature) return res.json({ signature: r.bankSignature })
  try {
    const c = db.clients[r.clientId]
    const signature = await bankApprove(r.walletAddress, c.backupAddress!, r.callData)
    r.bankSignature = signature
    r.status = "signed"
    save(db)
    console.log(`[recovery] ${r.id} co-signed by Swissquote guardian`)
    res.json({ signature })
  } catch (e: any) {
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

/** The bank's one real cryptographic act: approve the recovery user operation with its key share. */
async function bankApprove(walletAddress: Address, backupAddress: Address, callData: Hex) {
  const signer = await toECDSASigner({ signer: bankAccount })
  const validator = await createWeightedValidator(publicClient, {
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
    validatorContractVersion: WeightedValidatorContractVersion.V0_0_2_PATCHED,
    signer,
    config: {
      threshold: 100,
      signers: [
        { publicKey: bankAccount.address, weight: 50 },
        { publicKey: backupAddress, weight: 50 },
      ],
      delay: 0,
    },
  })
  const account = await createKernelAccount(publicClient, {
    address: walletAddress,
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
    plugins: { regular: validator, action: getRecoveryAction(ENTRY_POINT.version) },
  })
  const paymaster = createZeroDevPaymasterClient({ chain: CHAIN, transport: http(ZERODEV_RPC_URL) })
  const client = createWeightedKernelAccountClient({
    account,
    chain: CHAIN,
    bundlerTransport: http(ZERODEV_RPC_URL),
    client: publicClient,
    paymaster: { getPaymasterData: (userOperation) => paymaster.sponsorUserOperation({ userOperation }) },
  })
  return client.approveUserOperation({
    callData,
    validatorContractVersion: WeightedValidatorContractVersion.V0_0_2_PATCHED,
  })
}

// ---------------------------------------------------------------- compliance (mock)
// Production: Chainalysis / Elliptic API against OFAC + SECO lists. Demo: a fixed blocklist.
const SANCTIONED: Address[] = [
  "0x000000000000000000000000000000000000bad1", // demo "sanctioned" counterparty - use it in the pitch
]
const DAILY_LIMIT_USDC = 25_000
const HIGH_VALUE_USDC = Number(process.env.VITE_HIGH_VALUE_THRESHOLD_USDC ?? 1000)

app.post("/compliance/screen", (req, res) => {
  const { from, to, amountUsdc } = req.body ?? {}
  const amount = Number(amountUsdc ?? 0)
  const checks = [
    {
      name: "Sanctions screening (OFAC / SECO lists)",
      passed: !SANCTIONED.map((a) => a.toLowerCase()).includes(String(to).toLowerCase()),
      detail: "Counterparty address checked against sanctions lists",
    },
    {
      name: "Address format",
      passed: isAddress(String(to)) && String(to).toLowerCase() !== String(from).toLowerCase(),
      detail: "Valid address, not self-transfer",
    },
    {
      name: `Daily limit (${DAILY_LIMIT_USDC.toLocaleString()} USDC)`,
      passed: amount <= DAILY_LIMIT_USDC,
      detail: "Cumulative 24h outgoing volume",
    },
    {
      name: `High-value check (> ${HIGH_VALUE_USDC.toLocaleString()} USDC)`,
      passed: amount <= HIGH_VALUE_USDC,
      detail: amount > HIGH_VALUE_USDC ? "Requires e-banking confirmation (step-up authentication)" : "Below threshold",
    },
  ]
  const sanctions = checks[0].passed
  const format = checks[1].passed
  const limit = checks[2].passed
  const highValue = checks[3].passed
  let decision: "allow" | "review" | "block" = "allow"
  const reasons: string[] = []
  if (!sanctions) {
    decision = "block"
    reasons.push("Counterparty appears on a sanctions list")
  }
  if (!format) {
    decision = "block"
    reasons.push("Invalid counterparty")
  }
  if (!limit) {
    decision = "block"
    reasons.push("Exceeds daily limit")
  }
  if (decision === "allow" && !highValue) {
    decision = "review"
    reasons.push("High-value transfer: confirm in e-banking before signing")
  }
  res.json({ decision, reasons, checks })
})

app.get("/compliance/dapps", (_req, res) =>
  res.json([
    {
      id: "uniswap",
      name: "Uniswap",
      url: "https://app.uniswap.org",
      category: "DEX",
      contracts: ["0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4"],
      note: "Swap tokens. Reviewed by Swissquote Digital Assets; audited; live since 2018.",
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

app.listen(PORT)
