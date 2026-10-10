/**
 * DEV-ONLY design preview. Renders each screen with sample data so the UI can be reviewed
 * without a passkey, the bank service or the blockchain. Not included in production builds.
 *   /?preview=login | create | welcome | kit | home | banner | review | receive | apps | connect | security | recover
 *             | attacker | down | offline | partner | replaced
 */
import type { ReactNode } from "react"
import type { Address } from "viem"
import { BankLogin, Onboard, StageAside, SwissquoteDown } from "./App"
import { BackupKit } from "./screens/BackupKit"
import { Dashboard } from "./screens/Dashboard"
import { AttackerRefused, Recover } from "./screens/Recover"
import { PartnerRecover } from "./screens/PartnerRecover"
import { Icon } from "./ui"
import type { Wallet } from "./lib/wallet"
import { activityKey } from "./lib/activity"

const ADDRESS = "0xCbF1aac42FB105bc57be2b0b21E5dba1cE6B33b6" as Address
const GUARDIAN = "0x8422b6a2b2c7475ccf318575117A690b18e4b0C6" as Address
const BACKUP = "0x5F1e9cF0b5e2C4a1d3B7a9E6c8D0f2A4b6C8e0D2" as Address
const PARTNER = "0x3B6f0d1E2a9C4b8D7e5F1a2B3c4D5e6F7a8B9c0D" as Address
const UNISWAP = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4"
const view = new URLSearchParams(location.search).get("preview") || "home"

// ---------------------------------------------------------------- fake network
const pad = (hex: string) => "0x" + hex.replace(/^0x/, "").padStart(64, "0")
const realFetch = window.fetch.bind(window)
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
  if (url.includes("localhost:8788")) {
    const path = new URL(url).pathname
    if (path === "/guardian") return json({ address: PARTNER, name: "Independent recovery partner (fictional, mocked)", delaySeconds: 45 })
    return json(null)
  }
  if (url.includes("localhost:8787")) {
    const path = new URL(url).pathname
    if (path === "/guardian") return json({ address: GUARDIAN })
    if (path === "/wallet") return json({ walletAddress: ADDRESS, backupAddress: BACKUP, passkeyName: "demo-1010-120733", recoveredAt: null })
    if (path === "/recovery/pending")
      return json(view === "banner" ? { id: "r1", createdAt: Date.now() - 20000, unlockAt: Date.now() + 10000, status: "pending" } : null)
    if (path === "/compliance/dapps")
      return json([
        { id: "uniswap", name: "Uniswap", url: "", category: "DEX", contracts: [UNISWAP], note: "Swap tokens. Reviewed by Swissquote Digital Assets; audited; live since 2018." },
        { id: "aave", name: "Aave v3", url: "", category: "Lending", contracts: ["0x07eA79F68B2B3df564D0A34F8e19D9B1e339814b"], note: "" },
        { id: "morpho", name: "Morpho", url: "", category: "Lending", contracts: [], note: "" },
      ])
    if (path === "/compliance/screen") {
      const b = JSON.parse(String(init?.body ?? "{}"))
      const amount = Number(b.amountUsdc)
      const sanctioned = String(b.to).toLowerCase().endsWith("bad1")
      return json({
        decision: sanctioned ? "block" : amount > 1000 ? "review" : "allow",
        reasons: sanctioned ? ["Counterparty appears on a sanctions list"] : [],
        checks: [
          { name: "Sanctions screening (OFAC / SECO lists)", passed: !sanctioned, detail: "Counterparty address checked against sanctions lists" },
          { name: "Address format", passed: true, detail: "Valid address, not self-transfer" },
          { name: "Daily limit (25,000 USDC)", passed: true, detail: "Cumulative 24h outgoing volume" },
          { name: "High-value check (> 1,000 USDC)", passed: amount <= 1000, detail: amount > 1000 ? "Requires e-banking confirmation (step-up authentication)" : "Below threshold" },
        ],
      })
    }
    return json({})
  }
  if (init?.body && String(init.body).includes('"jsonrpc"')) {
    const req = JSON.parse(String(init.body))
    const one = (r: { id: number; method: string; params: unknown[] }) => {
      let result: unknown = "0x"
      if (r.method === "eth_chainId") result = "0x14a34"
      else if (r.method === "eth_blockNumber") result = "0x100"
      else if (r.method === "eth_getBalance") result = "0x0"
      else if (r.method === "eth_getCode") result = "0x6001"
      else if (r.method === "eth_call") {
        const data = String((r.params[0] as { data?: string; input?: string }).data ?? (r.params[0] as { input?: string }).input ?? "")
        if (data.startsWith("0x70a08231")) result = pad((17_000_000).toString(16))
        else if (data.startsWith("0xdd62ed3e")) result = pad(data.toLowerCase().includes(UNISWAP.slice(2).toLowerCase()) ? (1_000_000).toString(16) : "0")
        else result = pad("1")
      }
      return { jsonrpc: "2.0", id: r.id, result }
    }
    return json(Array.isArray(req) ? req.map(one) : one(req))
  }
  return realFetch(input, init)
}

// ---------------------------------------------------------------- sample data
localStorage.setItem(
  activityKey(ADDRESS),
  JSON.stringify([
    { at: Date.now() - 2 * 60_000, label: "Sent to 0x8422b6…b0C6", txHash: "0xabc", amount: "−1 USDC", gas: "0.0000021 ETH" },
    { at: Date.now() - 9 * 60_000, label: "Proved wallet ownership to Swissquote (verified on-chain)", txHash: "" },
    { at: Date.now() - 25 * 60_000, label: "Allowed Uniswap to use 1 USDC", txHash: "0xdef", gas: "0.0000018 ETH" },
    { at: Date.now() - 3 * 3600_000, label: "Vault activated: account deployed, recovery installed", txHash: "0x123", gas: "0.0000094 ETH" },
  ]),
)
const wallet = {
  session: { passkeyName: "demo-1010-120733", address: ADDRESS, serializedPasskeyValidator: "", backupAddress: BACKUP, bankGuardianAddress: GUARDIAN, partnerAddress: PARTNER },
  client: {},
} as unknown as Wallet
const bankSession = { clientId: "demo", name: "Demo", token: "t" }
const noop = () => {}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="stage">
      <StageAside />
      <div className="phone">
        <header className="topbar">
          <div className="brand">
            <span className="mark" />
            <div>
              <div className="word">Vault</div>
              <span className="by">Self-custody · prototype for Swissquote</span>
            </div>
          </div>
          {view !== "login" && (
            <button className="who">
              <span className="avatar">d</span>demo
              <Icon name="logout" size={15} />
            </button>
          )}
        </header>
        {children}
      </div>
    </div>
  )
}

export function Preview() {
  const screens: Record<string, ReactNode> = {
    login: <BankLogin onLoggedIn={noop} onUnreachable={noop} />,
    create: <Onboard bankSession={bankSession} guardian={GUARDIAN} existing={null} onCreated={noop} onLoggedIn={noop} onRecover={noop} />,
    welcome: (
      <Onboard bankSession={bankSession} guardian={GUARDIAN} existing={{ walletAddress: ADDRESS, passkeyName: "demo-1010-120733" }} onCreated={noop} onLoggedIn={noop} onRecover={noop} />
    ),
    kit: <BackupKit wallet={wallet} backupPrivateKey={"0x66f63415addf9a6c75ef2d77ad175f1dcad5f345da26267f12523c53deacb46d"} onDone={noop} />,
    recover: <Recover bankSession={bankSession} guardian={GUARDIAN} existing={{ walletAddress: ADDRESS, passkeyName: "x" }} onRecovered={async () => {}} onBack={noop} />,
    attacker: (
      <div className="screen">
        <div className="title">
          <h1>Recover your Vault</h1>
          <p>Demo: a thief with the stolen phone and the email inbox tries to recover.</p>
        </div>
        <AttackerRefused
          chain="Refused. 0x3a91F2… is not one of this Vault’s 3 recovery keys on Base Sepolia."
          bank="Swissquote refused to co-sign: the approval is not signed by a recovery key of this Vault"
        />
      </div>
    ),
    down: <SwissquoteDown hasLocalVault onOpen={async () => {}} onPartnerRecover={noop} onRetry={noop} />,
    partner: <PartnerRecover knownAddress={ADDRESS} onRecovered={async () => {}} onBack={noop} />,
    offline: <Dashboard wallet={wallet} bankSession={bankSession} offline onLostDevice={noop} />,
  }
  return <Shell>{screens[view] ?? <Dashboard wallet={wallet} bankSession={bankSession} onLostDevice={noop} />}</Shell>
}
