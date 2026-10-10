import { useCallback, useEffect, useState } from "react"
import { type Address, encodeFunctionData, erc20Abi, isAddress, parseUnits } from "viem"
import { bank, type ApprovedDapp, type BankSession, type RecoveryRequest, type ScreeningResult } from "../lib/bank"
import { EXPLORER_ADDRESS, EXPLORER_TX, USDC_ADDRESS, USDC_DECIMALS } from "../lib/config"
import { getBalances, isDeployed, publicClient, sendCalls, sendUsdc, type Wallet } from "../lib/wallet"
import { Alert, Button, Field, errorMessage, short } from "../ui"

type Activity = { at: number; label: string; txHash: string; amount?: string }
const ACTIVITY_KEY = "swissquote-vault:activity"

export function Dashboard({ wallet, bankSession, onLostDevice }: { wallet: Wallet; bankSession: BankSession; onLostDevice: () => void }) {
  const { address } = wallet.session
  const [tab, setTab] = useState<"send" | "dapps" | "security">("send")
  const [balances, setBalances] = useState<{ usdc: string; eth: string } | null>(null)
  const [deployed, setDeployed] = useState<boolean | null>(null)
  const [activity, setActivity] = useState<Activity[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(ACTIVITY_KEY) ?? "[]")
    } catch {
      return []
    }
  })
  const [pendingRecovery, setPendingRecovery] = useState<RecoveryRequest | null>(null)
  const [copied, setCopied] = useState(false)
  const [replaced, setReplaced] = useState(false)

  const refresh = useCallback(async () => {
    const [b, d] = await Promise.all([getBalances(address), isDeployed(address)])
    setBalances(b)
    setDeployed(d)
  }, [address])

  useEffect(() => {
    refresh().catch(() => {})
    const t = setInterval(() => refresh().catch(() => {}), 15000)
    return () => clearInterval(t)
  }, [refresh])

  // The OLD device watches for recovery attempts so the legitimate owner can veto one,
  // and notices when a completed recovery has replaced its passkey.
  useEffect(() => {
    const poll = () => {
      bank.pendingForWallet(address).then(setPendingRecovery).catch(() => {})
      bank
        .getWallet(bankSession.token)
        .then((onFile) => {
          // Only after a recovery completed: the passkey on file is newer than this device's.
          if (onFile?.recoveredAt && onFile.passkeyName !== wallet.session.passkeyName) setReplaced(true)
        })
        .catch(() => {})
    }
    poll()
    const t = setInterval(poll, 4000)
    return () => clearInterval(t)
  }, [address, bankSession.token, wallet.session.passkeyName])

  function addActivity(a: Activity) {
    setActivity((prev) => {
      const next = [a, ...prev].slice(0, 20)
      localStorage.setItem(ACTIVITY_KEY, JSON.stringify(next))
      return next
    })
  }

  if (replaced) {
    return (
      <div className="screen">
        <Alert kind="bad">
          <b>This device no longer controls your Vault.</b>
          <span>
            Its passkey was replaced by a recovery from another device. Your funds are safe at the same address, under the
            new passkey. If you didn’t do this, contact Swissquote immediately.
          </span>
        </Alert>
        <div className="card flat">
          <span className="muted">Vault</span>
          <span className="mono">{address}</span>
        </div>
        <Button
          variant="ghost"
          block
          onClick={() => {
            localStorage.removeItem("swissquote-vault:session")
            onLostDevice()
          }}
        >
          Set up this device again
        </Button>
      </div>
    )
  }

  return (
    <div className="screen">
      {pendingRecovery && (
        <Alert kind="warn">
          <b>Someone is recovering this Vault from a new device.</b>
          <span>
            Requested {new Date(pendingRecovery.createdAt).toLocaleTimeString()}. If that isn’t you, stop it now — nothing
            happens until the waiting period ends.
          </span>
          <Button
            variant="danger"
            onClick={() => bank.cancelRecovery(pendingRecovery.id).then(() => setPendingRecovery(null))}
          >
            That’s not me — cancel recovery
          </Button>
        </Alert>
      )}

      <div className="balance">
        <div className="amount">
          {balances ? Number(balances.usdc).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
          <span>USDC</span>
        </div>
        <div className="sub">
          <a href={EXPLORER_ADDRESS(address)} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
            {short(address, 8)}
          </a>
          {" · "}
          {balances ? `${Number(balances.eth).toFixed(5)} ETH` : ""}
          {" · "}
          {deployed === false ? "activates with your first transfer" : deployed ? "active" : ""}
        </div>
        <button
          className="btn ghost"
          style={{ marginTop: 10, padding: "6px 12px", fontSize: 13 }}
          onClick={() => {
            navigator.clipboard.writeText(address).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? "Copied" : "Copy address"}
        </button>
      </div>

      <div className="keys">
        <div className="key you">
          <b>This phone</b>
          Passkey · full control
          <div className="muted">Signs every transfer</div>
        </div>
        <div className="key">
          <b>Your backup</b>
          Recovery only
          <div className="muted">Half of the recovery pair</div>
        </div>
        <div className="key">
          <b>Swissquote</b>
          Recovery only
          <div className="muted">Other half · after a delay</div>
        </div>
      </div>

      <div className="tabs">
        {(["send", "dapps", "security"] as const).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t === "send" ? "Send" : t === "dapps" ? "Apps" : "Security"}
          </button>
        ))}
      </div>

      {tab === "send" && <Send wallet={wallet} onSent={(a) => { addActivity(a); refresh() }} balance={balances?.usdc} />}
      {tab === "dapps" && <Dapps wallet={wallet} onSent={(a) => { addActivity(a); refresh() }} />}
      {tab === "security" && <Security wallet={wallet} bankSession={bankSession} onLostDevice={onLostDevice} />}

      {activity.length > 0 && (
        <div className="card">
          <h2>Recent</h2>
          <div className="list">
            {activity.map((a) => (
              <div className="item" key={a.txHash}>
                <div>
                  <div className="name">{a.label}</div>
                  <div className="sub">{new Date(a.at).toLocaleString()}</div>
                </div>
                <div className="right">
                  {a.amount && <div>{a.amount}</div>}
                  <a className="sub" href={EXPLORER_TX(a.txHash)} target="_blank" rel="noreferrer">
                    view on Basescan
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Send USDC: screen -> simulate -> sign with passkey -> sent (gas paid by Swissquote)
// ---------------------------------------------------------------------------

function Send({ wallet, onSent, balance }: { wallet: Wallet; onSent: (a: Activity) => void; balance?: string }) {
  const [to, setTo] = useState("")
  const [amount, setAmount] = useState("1")
  const [stage, setStage] = useState<"form" | "review" | "signing" | "done">("form")
  const [screening, setScreening] = useState<ScreeningResult | null>(null)
  const [simulation, setSimulation] = useState<{ ok: boolean; detail: string } | null>(null)
  const [result, setResult] = useState<{ txHash: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function review() {
    setErr(null)
    if (!isAddress(to)) return setErr("Enter a valid recipient address.")
    if (!(Number(amount) > 0)) return setErr("Enter an amount.")
    setBusy(true)
    try {
      const [s, sim] = await Promise.all([
        bank.screen({ from: wallet.session.address, to: to as Address, amountUsdc: amount }),
        simulateTransfer(wallet.session.address, to as Address, amount),
      ])
      setScreening(s)
      setSimulation(sim)
      setStage("review")
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function sign() {
    setErr(null)
    setStage("signing")
    try {
      const { txHash } = await sendUsdc(wallet, to as Address, amount)
      setResult({ txHash })
      setStage("done")
      onSent({ at: Date.now(), label: `Sent to ${short(to)}`, txHash, amount: `−${amount} USDC` })
    } catch (e) {
      setErr(errorMessage(e))
      setStage("review")
    }
  }

  if (stage === "done" && result) {
    return (
      <div className="card">
        <Alert kind="ok">
          <b>Sent {amount} USDC</b>
          <span>Gas was paid by Swissquote. You never needed ETH.</span>
          <a href={EXPLORER_TX(result.txHash)} target="_blank" rel="noreferrer">
            View the transaction on Basescan
          </a>
        </Alert>
        <Button variant="ghost" onClick={() => { setStage("form"); setResult(null); setTo("") }} block>
          Send another
        </Button>
      </div>
    )
  }

  if (stage === "review" || stage === "signing") {
    const blocked = screening?.decision === "block" || simulation?.ok === false
    return (
      <div className="card">
        <h2>Review before signing</h2>
        <div className="list">
          <div className="item"><span>To</span><span className="right mono">{short(to, 8)}</span></div>
          <div className="item"><span>Amount</span><span className="right">{amount} USDC</span></div>
          <div className="item"><span>Network fee</span><span className="right pill ok">Paid by Swissquote</span></div>
          <div className="item"><span>Balance after</span><span className="right">{balance ? (Number(balance) - Number(amount)).toFixed(2) : "—"} USDC</span></div>
        </div>
        {screening && (
          <div className="checks">
            {screening.checks.map((c) => (
              <div key={c.name}>
                <span className={`mark ${c.passed ? "pass" : "fail"}`}>{c.passed ? "✓" : "✕"}</span>
                <span>
                  {c.name}
                  <span className="muted"> — {c.detail}</span>
                </span>
              </div>
            ))}
            {simulation && (
              <div>
                <span className={`mark ${simulation.ok ? "pass" : "fail"}`}>{simulation.ok ? "✓" : "✕"}</span>
                <span>
                  Transaction simulation<span className="muted"> — {simulation.detail}</span>
                </span>
              </div>
            )}
          </div>
        )}
        {screening?.decision === "block" && <Alert kind="bad">Blocked: {screening.reasons.join("; ")}.</Alert>}
        {screening?.decision === "review" && (
          <Alert kind="warn">
            High-value transfer. In production this asks you to confirm in Swissquote e-banking first (step-up). Demo continues.
          </Alert>
        )}
        {err && <Alert kind="bad">{err}</Alert>}
        <div className="row">
          <Button variant="ghost" onClick={() => setStage("form")} disabled={stage === "signing"}>
            Back
          </Button>
          <Button variant="primary" onClick={sign} busy={stage === "signing"} disabled={blocked}>
            Sign with passkey
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <Field label="Recipient" value={to} onChange={setTo} placeholder="0x…" hint="Try 0x000000000000000000000000000000000000bad1 to see a sanctions block." />
      <Field label="Amount (USDC)" value={amount} onChange={setAmount} type="number" />
      {err && <Alert kind="bad">{err}</Alert>}
      <Button variant="primary" onClick={review} busy={busy} block>
        Review transfer
      </Button>
      <p className="muted">
        No USDC yet? Get test USDC for this address at faucet.circle.com (Base Sepolia).
      </p>
    </div>
  )
}

async function simulateTransfer(from: Address, to: Address, amount: string) {
  try {
    await publicClient.simulateContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, parseUnits(amount, USDC_DECIMALS)],
      account: from,
    })
    return { ok: true, detail: "would succeed on-chain" }
  } catch (e) {
    const m = errorMessage(e)
    return { ok: false, detail: m.includes("exceeds balance") || m.includes("insufficient") ? "insufficient USDC balance" : m }
  }
}

// ---------------------------------------------------------------------------
// Approved dApps: allowlist + simulated interaction (a real on-chain approve)
// ---------------------------------------------------------------------------

function Dapps({ wallet, onSent }: { wallet: Wallet; onSent: (a: Activity) => void }) {
  const [dapps, setDapps] = useState<ApprovedDapp[]>([])
  const [custom, setCustom] = useState("")
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<ApprovedDapp | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    bank.dapps().then(setDapps).catch(() => {})
  }, [])

  function tryCustom() {
    const host = custom.replace(/^https?:\/\//, "").split("/")[0]
    setBlockedMsg(`${host || "That app"} isn’t on Swissquote’s approved list. You can request a review from the Security tab.`)
  }

  async function approveOneUsdc(d: ApprovedDapp) {
    if (!d.contracts[0]) return setErr("This app has no contract registered for the demo.")
    setBusy(true)
    setErr(null)
    try {
      const { txHash } = await sendCalls(wallet, [
        {
          to: USDC_ADDRESS,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [d.contracts[0], parseUnits("1", USDC_DECIMALS)] }),
        },
      ])
      setDone(txHash)
      onSent({ at: Date.now(), label: `Allowed ${d.name} to use 1 USDC`, txHash })
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (connecting) {
    return (
      <div className="card">
        <h2>{connecting.name} wants to connect</h2>
        <p>{connecting.note}</p>
        <div className="list">
          <div className="item"><span>Action</span><span className="right">Allow {connecting.name} to use up to 1 USDC</span></div>
          <div className="item"><span>Contract</span><span className="right mono">{short(connecting.contracts[0] ?? "", 8)}</span></div>
          <div className="item"><span>Status</span><span className="right pill ok">Approved by Swissquote</span></div>
          <div className="item"><span>Network fee</span><span className="right pill ok">Paid by Swissquote</span></div>
        </div>
        {done && (
          <Alert kind="ok">
            Done. <a href={EXPLORER_TX(done)} target="_blank" rel="noreferrer">View on Basescan</a>
          </Alert>
        )}
        {err && <Alert kind="bad">{err}</Alert>}
        <div className="row">
          <Button variant="ghost" onClick={() => { setConnecting(null); setDone(null) }}>Back</Button>
          {!done && (
            <Button variant="primary" busy={busy} onClick={() => approveOneUsdc(connecting)}>
              Sign with passkey
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <h2>Approved apps</h2>
      <p className="muted">Reviewed by Swissquote Digital Assets. Interactions are simulated before you sign.</p>
      <div className="list">
        {dapps.map((d) => (
          <div className="item" key={d.id}>
            <div>
              <div className="name">{d.name}</div>
              <div className="sub">{d.category}</div>
            </div>
            <Button variant="ghost" onClick={() => setConnecting(d)}>Connect</Button>
          </div>
        ))}
      </div>
      <Field label="Open another app" value={custom} onChange={setCustom} placeholder="https://some-new-yield-farm.xyz" />
      <Button variant="ghost" onClick={tryCustom} block>Open</Button>
      {blockedMsg && <Alert kind="bad">{blockedMsg}</Alert>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Security: where the keys live + the "lost phone" entry point
// ---------------------------------------------------------------------------

function Security({ wallet, bankSession, onLostDevice }: { wallet: Wallet; bankSession: BankSession; onLostDevice: () => void }) {
  const s = wallet.session
  return (
    <div className="card">
      <h2>Where your keys live</h2>
      <div className="list">
        <div className="item">
          <div><div className="name">Passkey “{s.passkeyName}”</div><div className="sub">Secure enclave on this phone. Moves funds.</div></div>
          <span className="pill ok">you</span>
        </div>
        <div className="item">
          <div><div className="name">Backup key</div><div className="sub mono">{short(s.backupAddress, 8)}</div></div>
          <span className="pill">you, offline</span>
        </div>
        <div className="item">
          <div><div className="name">Swissquote guardian</div><div className="sub mono">{short(s.bankGuardianAddress, 8)}</div></div>
          <span className="pill">bank · recovery only</span>
        </div>
        <div className="item">
          <div><div className="name">Linked client</div><div className="sub">{bankSession.clientId} (KYC verified)</div></div>
          <span className="pill">ownership</span>
        </div>
      </div>
      <p className="muted">
        Recovery (bank + backup) is bound on-chain to one function: replacing your passkey. It can’t send tokens, and
        every recovery waits out a delay during which this phone is alerted and can cancel it.
      </p>
      <Button variant="ghost" onClick={onLostDevice} block>
        Simulate losing this phone
      </Button>
    </div>
  )
}
