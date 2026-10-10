import { useCallback, useEffect, useState } from "react"
import { type Address, encodeFunctionData, erc20Abi, isAddress, parseUnits } from "viem"
import { Unreachable, bank, type ApprovedDapp, type BankSession, type ScreeningResult } from "../lib/bank"
import { partner } from "../lib/partner"
import { MoveToSwissquote } from "./MoveToSwissquote"
import { EXPLORER_ADDRESS, EXPLORER_TX, HIGH_VALUE_THRESHOLD_USDC, USDC_ADDRESS, USDC_DECIMALS } from "../lib/config"
import { getBalances, getUsdcAllowance, isDeployed, publicClient, revokeUsdcAllowance, sendCalls, sendUsdc, signMessageWithPasskey, type Wallet } from "../lib/wallet"
import QRCode from "qrcode"
import {
  AddressGroups,
  Alert,
  Button,
  CopyButton,
  Field,
  Icon,
  type IconName,
  errorMessage,
  formatAmount,
  formatGas,
  relativeTime,
  short,
} from "../ui"

import { appendActivity, readActivity, type Activity } from "../lib/activity"

type Tab = "send" | "receive" | "dapps" | "security" | "move"

/** A recovery in progress against this Vault, at Swissquote or at the independent partner. */
type PendingRecovery = { id: string; createdAt: number; via: "swissquote" | "partner" }

/** Demo shortcuts so nobody has to type an address live. */
const DEMO_RECIPIENT = "0x8422b6a2b2c7475ccf318575117A690b18e4b0C6"
const DEMO_SANCTIONED = "0x000000000000000000000000000000000000bad1"

export function Dashboard({
  wallet,
  bankSession,
  onLostDevice,
  offline = false,
  onSwissquoteDown,
}: {
  wallet: Wallet
  bankSession: BankSession
  onLostDevice: () => void
  /** Swissquote unreachable: the Vault keeps working on its own. */
  offline?: boolean
  onSwissquoteDown?: () => void
}) {
  const { address } = wallet.session
  const [tab, setTab] = useState<Tab>("send")
  const [vetoBusy, setVetoBusy] = useState(false)
  const [vetoNote, setVetoNote] = useState<string | null>(null)
  const [balances, setBalances] = useState<{ usdc: string; eth: string } | null>(null)
  const [deployed, setDeployed] = useState<boolean | null>(null)
  const [activity, setActivity] = useState<Activity[]>(() => readActivity(wallet.session.address))
  const [pendingRecovery, setPendingRecovery] = useState<PendingRecovery | null>(null)
  const [copied, setCopied] = useState(false)
  const [replaced, setReplaced] = useState(false)
  const [sqBalance, setSqBalance] = useState<string | null>(null)
  const loadAccount = useCallback(() => {
    if (offline) return
    bank.account(bankSession.token).then((a) => setSqBalance(a.balanceUsdc)).catch(() => {})
  }, [bankSession.token, offline])
  useEffect(() => {
    loadAccount()
  }, [loadAccount])
  const [, setTick] = useState(0)

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

  // Keep "3 min ago" labels fresh.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  // The OLD device watches for recovery attempts so the legitimate owner can veto one,
  // and notices when a completed recovery has replaced its passkey.
  useEffect(() => {
    const poll = () => {
      // Both guardians are watched: a recovery can be started at Swissquote or at the independent partner.
      Promise.allSettled([offline ? Promise.resolve(null) : bank.pendingForWallet(address), partner.pendingForWallet(address)]).then(
        ([b, p]) => {
          const viaBank = b.status === "fulfilled" && b.value ? { id: b.value.id, createdAt: b.value.createdAt, via: "swissquote" as const } : null
          const viaPartner = p.status === "fulfilled" && p.value ? { id: p.value.id, createdAt: p.value.createdAt, via: "partner" as const } : null
          setPendingRecovery(viaBank ?? viaPartner)
        },
      )
      if (offline) return
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
  }, [address, bankSession.token, wallet.session.passkeyName, offline])

  function addActivity(a: Activity) {
    setActivity(appendActivity(address, a))
  }

  async function veto(req: PendingRecovery) {
    setVetoBusy(true)
    try {
      // Strong veto: this device proves it still holds the passkey by signing the veto (ERC-1271).
      const message = bank.cancelMessage(req.id)
      if (req.via === "partner") {
        // The partner accepts only a veto signed by the Vault's current passkey.
        await partner.cancelRecovery(req.id, message, await signMessageWithPasskey(wallet, message))
        setVetoNote("Recovery cancelled — veto signed with this phone’s passkey.")
        setPendingRecovery(null)
        setTimeout(() => setVetoNote(null), 8000)
        return
      }
      let signature: `0x${string}` | undefined
      try {
        signature = await signMessageWithPasskey(wallet, message)
      } catch {
        signature = undefined // fall back to the e-banking session
      }
      const r = await bank.cancelRecovery(req.id, { token: bankSession.token, message, signature })
      setVetoNote(r.vetoedBy === "passkey" ? "Recovery cancelled — veto signed with this phone’s passkey." : "Recovery cancelled.")
      setPendingRecovery(null)
      setTimeout(() => setVetoNote(null), 8000)
    } catch (e) {
      setVetoNote(`Could not cancel: ${errorMessage(e)}`)
    } finally {
      setVetoBusy(false)
    }
  }

  if (replaced) {
    return (
      <div className="screen">
        <div className="title">
          <span className="ico lg" style={{ background: "var(--bad-bg)", color: "var(--bad)" }}>
            <Icon name="lock" size={28} />
          </span>
          <h1>This device no longer controls your Vault</h1>
          <p>
            Its passkey was replaced by a recovery from another device. Your funds are safe at the same address, under the
            new passkey.
          </p>
        </div>
        <div className="card flat">
          <span className="section-label">Vault</span>
          <span className="mono">{address}</span>
        </div>
        <Alert kind="warn">If you didn’t do this, contact Swissquote immediately.</Alert>
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

  const actions: { id: Tab; label: string; icon: IconName }[] = [
    { id: "send", label: "Send", icon: "send" },
    { id: "receive", label: "Receive", icon: "receive" },
    { id: "dapps", label: "Apps", icon: "apps" },
    { id: "security", label: "Security", icon: "shield" },
  ]

  return (
    <div className="screen">
      {offline && (
        <div className="offline-strip" role="status">
          <Icon name="power" size={18} />
          <span>
            <b>Swissquote unreachable.</b> Your Vault works on its own: your passkey signs, recovery goes through the
            independent partner. Swissquote’s checks are off.
          </span>
        </div>
      )}
      {pendingRecovery && (
        <div className="banner" role="alert">
          <div className="head">
            <span className="pulse" />
            Someone is recovering this Vault
          </div>
          <span style={{ fontSize: 14, lineHeight: 1.45 }}>
            A new device requested recovery
            {pendingRecovery.via === "partner" ? " through the independent recovery partner" : ""} at{" "}
            {new Date(pendingRecovery.createdAt).toLocaleTimeString()}. If that isn’t you, stop it now — nothing happens
            until the waiting period ends.
          </span>
          <Button variant="danger" icon="faceid" busy={vetoBusy} onClick={() => veto(pendingRecovery)} block>
            That’s not me — cancel recovery
          </Button>
        </div>
      )}
      {vetoNote && (
        <Alert kind={vetoNote.startsWith("Could not") ? "bad" : "ok"}>
          <b>{vetoNote}</b>
          {!vetoNote.startsWith("Could not") && <span>Your funds never moved.</span>}
        </Alert>
      )}

      <section className="balance-card" aria-label="Balance">
        <div>
          <div className="label">Balance</div>
          <div className="amount" style={{ marginTop: 8 }}>
            {balances ? formatAmount(balances.usdc) : "—"}
            <small>USDC</small>
          </div>
          <div className="eth">{balances ? `${Number(balances.eth).toFixed(5)} ETH · no ETH needed for fees` : "Loading balance…"}</div>
        </div>
        <div className="foot">
          <button
            className="addr-chip"
            title="Copy address"
            onClick={() =>
              navigator.clipboard.writeText(address).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }
          >
            {copied ? "Copied" : short(address, 6)}
            <Icon name={copied ? "check" : "copy"} size={14} />
          </button>
          <a
            className={`net-pill${deployed === false ? " pending" : ""}`}
            href={EXPLORER_ADDRESS(address)}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: "none" }}
          >
            {deployed === false ? "Activates with first transfer" : "Base · recoverable"}
          </a>
        </div>
      </section>

      <nav className="actions" aria-label="Wallet actions">
        {actions.map((a) => (
          <button key={a.id} className={`action${tab === a.id ? " active" : ""}`} onClick={() => setTab(a.id)} aria-pressed={tab === a.id}>
            <span className="disc">
              <Icon name={a.icon} size={22} />
            </span>
            {a.label}
          </button>
        ))}
      </nav>

      <button className="protect" onClick={() => setTab("security")}>
        <Icon name="shieldCheck" size={20} />
        <span>
          <b>Protected</b> · {wallet.session.partnerAddress ? "passkey + backup with Swissquote or partner" : "passkey + 2-of-2 recovery"}
        </span>
        <span className="keys3" aria-hidden="true">
          <span><Icon name="phone" size={13} /></span>
          <span><Icon name="key" size={13} /></span>
          <span><Icon name="bank" size={13} /></span>
          {wallet.session.partnerAddress && <span><Icon name="partner" size={13} /></span>}
        </span>
      </button>

      {!offline && (
        <button className={`protect sq${tab === "move" ? " active" : ""}`} onClick={() => setTab("move")}>
          <Icon name="bank" size={20} />
          <span className="stack">
            <b>Swissquote account</b>
            <span>{sqBalance ? `${formatAmount(sqBalance)} USDC` : "—"}</span>
          </span>
          <span className="go">
            Move from Vault <Icon name="chevron" size={14} />
          </span>
        </button>
      )}

      {tab === "move" && !offline && (
        <MoveToSwissquote
          wallet={wallet}
          bankSession={bankSession}
          vaultBalance={balances?.usdc}
          onMoved={(a) => {
            addActivity(a)
            refresh()
            loadAccount()
          }}
        />
      )}
      {tab === "send" && (
        <Send wallet={wallet} bankSession={bankSession} offline={offline} onSent={(a) => { addActivity(a); refresh() }} balance={balances?.usdc} />
      )}
      {tab === "receive" && <Receive address={address} />}
      {tab === "dapps" && <Dapps wallet={wallet} onSent={(a) => { addActivity(a); refresh() }} />}
      {tab === "security" && (
        <Security
          wallet={wallet}
          bankSession={bankSession}
          offline={offline}
          onLostDevice={onLostDevice}
          onSwissquoteDown={onSwissquoteDown}
          onEvent={(label) => addActivity({ at: Date.now(), label, txHash: "" })}
        />
      )}

      {activity.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Activity</h2>
            <a className="btn quiet sm" href={EXPLORER_ADDRESS(address)} target="_blank" rel="noreferrer">
              All on Basescan <Icon name="external" size={14} />
            </a>
          </div>
          <div className="list">
            {activity.map((a) => (
              <div className="item" key={`${a.at}-${a.txHash}`}>
                <div className="left">
                  <span className={`ico ${activityTone(a.label)}`}>
                    <Icon name={activityIcon(a.label)} size={18} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="name">{a.label}</div>
                    <div className="sub">
                      {relativeTime(a.at)}
                      {a.gas ? ` · fee ${a.gas}` : ""}
                    </div>
                  </div>
                </div>
                <div className="right">
                  {a.amount && <div style={{ fontWeight: 600 }}>{a.amount}</div>}
                  {a.txHash ? (
                    <a className="sub" href={EXPLORER_TX(a.txHash)} target="_blank" rel="noreferrer" title="View on Basescan">
                      <Icon name="external" size={14} />
                    </a>
                  ) : (
                    <span className="sub">off-chain</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function activityIcon(label: string): IconName {
  if (label.startsWith("Sent")) return "send"
  if (label.startsWith("Allowed")) return "apps"
  if (label.startsWith("Revoked")) return "ban"
  if (label.startsWith("Recovered")) return "recover"
  if (label.startsWith("Proved")) return "shieldCheck"
  if (label.startsWith("Vault activated")) return "spark"
  if (label.startsWith("Moved") || label.startsWith("Sent to Swissquote")) return "bank"
  return "check"
}
function activityTone(label: string) {
  if (label.startsWith("Proved") || label.startsWith("Vault activated") || label.startsWith("Recovered") || label.startsWith("Moved")) return "ok"
  return ""
}

// ---------------------------------------------------------------------------
// Send USDC: screen -> simulate -> sign with passkey -> sent (gas paid by Swissquote)
// ---------------------------------------------------------------------------

function Send({
  wallet,
  bankSession,
  onSent,
  balance,
  offline: startOffline = false,
}: {
  wallet: Wallet
  bankSession: BankSession
  onSent: (a: Activity) => void
  balance?: string
  offline?: boolean
}) {
  const [offline, setOffline] = useState(startOffline)
  const [otp, setOtp] = useState("")
  const [steppedUp, setSteppedUp] = useState(false)
  const [stepBusy, setStepBusy] = useState(false)
  const [to, setTo] = useState("")
  const [amount, setAmount] = useState("1")
  const [stage, setStage] = useState<"form" | "review" | "signing" | "done">("form")
  const [screening, setScreening] = useState<ScreeningResult | null>(null)
  const [simulation, setSimulation] = useState<{ ok: boolean; detail: string } | null>(null)
  const [result, setResult] = useState<{ txHash: string; gas?: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function review() {
    setErr(null)
    if (!isAddress(to)) return setErr("Enter a valid recipient address.")
    if (!(Number(amount) > 0)) return setErr("Enter an amount.")
    setBusy(true)
    try {
      // Swissquote's screening is a service on top of self-custody: if Swissquote is unreachable the
      // client can still sign (and is told the checks are off). The simulation runs on the public chain.
      const screen = offline
        ? Promise.resolve(null)
        : bank.screen({ from: wallet.session.address, to: to as Address, amountUsdc: amount }).catch((e) => {
            if (e instanceof Unreachable) {
              setOffline(true)
              return null
            }
            throw e
          })
      const [s, sim] = await Promise.all([screen, simulateTransfer(wallet.session.address, to as Address, amount)])
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
      const { txHash, gasCostWei } = await sendUsdc(wallet, to as Address, amount)
      const gas = formatGas(gasCostWei)
      setResult({ txHash, gas })
      setStage("done")
      onSent({ at: Date.now(), label: `Sent to ${short(to)}`, txHash, amount: `−${amount} USDC`, gas })
    } catch (e) {
      setErr(errorMessage(e))
      setStage("review")
    }
  }

  async function paste() {
    try {
      const t = (await navigator.clipboard.readText()).trim()
      if (t) setTo(t)
    } catch {
      /* clipboard permission denied: user can type */
    }
  }

  if (stage === "done" && result) {
    return (
      <section className="card">
        <div className="success">
          <span className="ring"><Icon name="check" size={36} stroke={2.4} /></span>
          <h3>Sent {formatAmount(amount)} USDC</h3>
          <p className="muted">to {short(to, 8)}</p>
          <span className="pill ok">
            <Icon name="fuel" size={14} /> Fee {result.gas ? `${result.gas} ` : ""}
            {offline ? "sponsored (demo)" : "paid by Swissquote"}
          </span>
        </div>
        <a className="btn ghost block" href={EXPLORER_TX(result.txHash)} target="_blank" rel="noreferrer">
          <Icon name="external" size={18} /> View on Basescan
        </a>
        <Button variant="quiet" onClick={() => { setStage("form"); setResult(null); setTo(""); setSteppedUp(false); setOtp("") }} block>
          Send another
        </Button>
      </section>
    )
  }

  if (stage === "review" || stage === "signing") {
    const needsStepUp = screening?.decision === "review" && !steppedUp
    const blocked = screening?.decision === "block" || simulation?.ok === false || needsStepUp
    const after = balance ? Number(balance) - Number(amount) : null
    return (
      <section className="card">
        <div className="card-head">
          <h2>Review before signing</h2>
          <span className="section-label">Step 2 of 2</span>
        </div>
        <div className="review-hero">
          <div className="amt">
            {formatAmount(amount)}
            <small>USDC</small>
          </div>
          <div className="to">
            to <span className="mono">{short(to, 8)}</span>
          </div>
        </div>
        <div className="list kv">
          <div className="item">
            <span>Network fee</span>
            <span className="right pill ok"><Icon name="fuel" size={13} /> {offline ? "Sponsored in this demo" : "Paid by Swissquote"}</span>
          </div>
          <div className="item"><span>Balance after</span><span className="right" style={after !== null && after < 0 ? { color: "var(--bad)" } : undefined}>{after !== null ? formatAmount(after) : "—"} USDC</span></div>
        </div>
        {screening && (
          <div className="checks" aria-label="Compliance checks">
            {screening.checks.map((c) => {
              // The high-value check turns green once the client confirmed with their security code.
              const passed = c.passed || (steppedUp && c.name.startsWith("High-value"))
              const detail = passed && !c.passed ? "Confirmed with security code" : c.detail
              return (
                <div className="c" key={c.name}>
                  <span className={passed ? "pass" : "fail"}><Icon name={passed ? "check" : "x"} size={18} stroke={2.2} /></span>
                  <span>
                    {c.name}
                    <span className="d">{detail}</span>
                  </span>
                </div>
              )
            })}
            {simulation && (
              <div className="c">
                <span className={simulation.ok ? "pass" : "fail"}><Icon name={simulation.ok ? "check" : "x"} size={18} stroke={2.2} /></span>
                <span>
                  Transaction simulation
                  <span className="d">{simulation.detail}</span>
                </span>
              </div>
            )}
          </div>
        )}
        {offline && (
          <Alert kind="warn">
            <b>Swissquote is unreachable — its checks are off</b>
            <span>
              Self-custody means you can still sign. No sanctions screening or limits: you are responsible for this transfer.
              The simulation above still ran on the public network.
            </span>
          </Alert>
        )}
        {!screening && simulation && (
          <div className="checks">
            <div className="c">
              <span className={simulation.ok ? "pass" : "fail"}><Icon name={simulation.ok ? "check" : "x"} size={18} stroke={2.2} /></span>
              <span>
                Transaction simulation
                <span className="d">{simulation.detail}</span>
              </span>
            </div>
          </div>
        )}
        {screening && (
          <p className="hint">
            <span className="mock-tag">MOCK</span> Sanctions list and limits are demo data; the simulation runs on the real network.
          </p>
        )}
        {screening?.decision === "block" && <Alert kind="bad"><b>Blocked.</b><span>{screening.reasons.join("; ")}.</span></Alert>}
        {screening?.decision === "review" && !steppedUp && (
          <Alert kind="warn">
            <b>High-value transfer</b>
            <span>Confirm with your Swissquote security code before signing.</span>
            <div className="row" style={{ marginTop: 4 }}>
              <div className="input" style={{ minHeight: 44, flex: 1.4 }}>
                <input
                  inputMode="numeric"
                  placeholder="Code (demo: 000000)"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  style={{ padding: "10px 0", fontFamily: "var(--mono)" }}
                />
              </div>
              <Button
                small
                busy={stepBusy}
                onClick={async () => {
                  setStepBusy(true)
                  setErr(null)
                  try {
                    await bank.stepUp(bankSession.token, otp.trim())
                    setSteppedUp(true)
                  } catch (e) {
                    setErr(errorMessage(e))
                  } finally {
                    setStepBusy(false)
                  }
                }}
              >
                Confirm
              </Button>
            </div>
          </Alert>
        )}
        {screening?.decision === "review" && steppedUp && <Alert kind="ok">High-value transfer confirmed with your security code.</Alert>}
        {err && <Alert kind="bad">{err}</Alert>}
        <div className="row split">
          <Button variant="ghost" onClick={() => setStage("form")} disabled={stage === "signing"}>
            Back
          </Button>
          <Button variant="primary" icon="faceid" onClick={sign} busy={stage === "signing"} disabled={blocked}>
            {stage === "signing" ? "Signing…" : "Sign with passkey"}
          </Button>
        </div>
      </section>
    )
  }

  const tooMuch = balance !== undefined && Number(amount) > Number(balance)
  return (
    <section className="card">
      <div className="card-head">
        <h2>Send USDC</h2>
        <span className="pill ok"><Icon name="fuel" size={13} /> No gas needed</span>
      </div>
      <Field
        label="To"
        value={to}
        onChange={setTo}
        placeholder="0x…"
        mono
        action={
          <button type="button" className="btn quiet sm" onClick={paste}>
            <Icon name="paste" size={15} /> Paste
          </button>
        }
      />
      <Field
        label="Amount"
        value={amount}
        onChange={setAmount}
        type="number"
        inputMode="decimal"
        big
        suffix="USDC"
        action={
          balance !== undefined ? (
            <button type="button" className="chip" onClick={() => setAmount(String(Math.floor(Number(balance) * 100) / 100))}>
              Max
            </button>
          ) : undefined
        }
        hint={
          tooMuch
            ? "More than your balance — the simulation will refuse it."
            : `Available: ${balance !== undefined ? formatAmount(balance) : "—"} USDC · over ${HIGH_VALUE_THRESHOLD_USDC.toLocaleString("en-US")} needs your security code`
        }
      />
      <div className="chips" aria-label="Demo shortcuts">
        <button type="button" className="chip demo" onClick={() => setTo(DEMO_RECIPIENT)}>
          <Icon name="send" size={13} /> Test recipient
        </button>
        <button type="button" className="chip demo" onClick={() => setTo(DEMO_SANCTIONED)}>
          <Icon name="ban" size={13} /> Sanctioned address
        </button>
        <button type="button" className="chip demo" onClick={() => setAmount("1500")}>
          <Icon name="alert" size={13} /> High-value amount
        </button>
      </div>
      {err && <Alert kind="bad">{err}</Alert>}
      <Button variant="primary" onClick={review} busy={busy} block>
        Review transfer
      </Button>
      <p className="hint center-text">
        Need test USDC? faucet.circle.com → Base Sepolia → paste your address.
      </p>
    </section>
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
// Receive: address + QR code
// ---------------------------------------------------------------------------

function Receive({ address }: { address: Address }) {
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => {
    QRCode.toDataURL(address, { margin: 0, width: 400, color: { dark: "#0f1b2d", light: "#ffffff" } }).then(setQr).catch(() => {})
  }, [address])
  return (
    <section className="card" style={{ alignItems: "stretch" }}>
      <div className="card-head">
        <h2>Receive on Base</h2>
        <span className="pill">USDC · ETH</span>
      </div>
      <div className="qr-wrap">
        {qr ? <img src={qr} alt="QR code of your Vault address" width={200} height={200} /> : <div style={{ width: 200, height: 200 }} />}
      </div>
      <AddressGroups address={address} />
      <CopyButton text={address} label="Copy address" small={false} />
      <Alert kind="info">
        Transfers from your Swissquote account arrive here directly: the bank already knows this wallet is yours.
      </Alert>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Approved dApps: allowlist + simulated interaction (a real on-chain approve)
// ---------------------------------------------------------------------------

const DAPP_COLORS: Record<string, string> = { uniswap: "#d6337a", aave: "#6b5cc4", morpho: "#2a6fdb" }

function Dapps({ wallet, onSent }: { wallet: Wallet; onSent: (a: Activity) => void }) {
  const [dapps, setDapps] = useState<ApprovedDapp[]>([])
  const [custom, setCustom] = useState("")
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<ApprovedDapp | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const [allowances, setAllowances] = useState<Record<string, string>>({})
  const [revoking, setRevoking] = useState<string | null>(null)

  const loadAllowances = useCallback(async (list: ApprovedDapp[]) => {
    const entries = await Promise.all(
      list
        .filter((d) => d.contracts[0])
        .map(async (d) => [d.id, await getUsdcAllowance(wallet.session.address, d.contracts[0]).catch(() => "0")] as const),
    )
    setAllowances(Object.fromEntries(entries))
  }, [wallet.session.address])

  useEffect(() => {
    bank.dapps().then((list) => { setDapps(list); loadAllowances(list) }).catch(() => {})
  }, [loadAllowances])

  async function revoke(d: ApprovedDapp) {
    setRevoking(d.id)
    setErr(null)
    try {
      const { txHash, gasCostWei } = await revokeUsdcAllowance(wallet, d.contracts[0])
      onSent({ at: Date.now(), label: `Revoked ${d.name}’s access to USDC`, txHash, gas: formatGas(gasCostWei) })
      await loadAllowances(dapps)
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setRevoking(null)
    }
  }

  function tryCustom() {
    const host = custom.replace(/^https?:\/\//, "").split("/")[0]
    setBlockedMsg(`${host || "That app"} isn’t on Swissquote’s approved list, so it’s blocked. Swissquote reviews new apps before clients can connect to them.`)
  }

  async function approveOneUsdc(d: ApprovedDapp) {
    if (!d.contracts[0]) return setErr("This app has no contract registered for the demo.")
    setBusy(true)
    setErr(null)
    try {
      const { txHash, gasCostWei } = await sendCalls(wallet, [
        {
          to: USDC_ADDRESS,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [d.contracts[0], parseUnits("1", USDC_DECIMALS)] }),
        },
      ])
      setDone(txHash)
      onSent({ at: Date.now(), label: `Allowed ${d.name} to use 1 USDC`, txHash, gas: formatGas(gasCostWei) })
      await loadAllowances(dapps)
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (connecting) {
    return (
      <section className="card">
        <div className="card-head">
          <div className="left" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="avatar-letter" style={{ background: DAPP_COLORS[connecting.id] ?? "var(--ink)" }}>{connecting.name[0]}</span>
            <div>
              <h2>{connecting.name} wants to connect</h2>
              <span className="muted">{connecting.category}</span>
            </div>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 14 }}>{connecting.note}</p>
        <div className="list kv">
          <div className="item"><span>Permission</span><span className="right" style={{ fontWeight: 600 }}>Use up to 1 USDC</span></div>
          <div className="item"><span>Contract</span><span className="right mono">{short(connecting.contracts[0] ?? "", 8)}</span></div>
          <div className="item"><span>Status</span><span className="right pill ok"><Icon name="check" size={13} /> Approved by Swissquote</span></div>
          <div className="item"><span>Network fee</span><span className="right pill ok"><Icon name="fuel" size={13} /> Paid by Swissquote</span></div>
        </div>
        <Alert kind="info">A limited approval: {connecting.name} can never touch more than 1 USDC, and you can revoke it any time.</Alert>
        {done && (
          <Alert kind="ok">
            <b>Connected.</b>
            <a href={EXPLORER_TX(done)} target="_blank" rel="noreferrer">View on Basescan</a>
          </Alert>
        )}
        {err && <Alert kind="bad">{err}</Alert>}
        <div className="row split">
          <Button variant="ghost" onClick={() => { setConnecting(null); setDone(null) }}>{done ? "Done" : "Back"}</Button>
          {!done && (
            <Button variant="primary" icon="faceid" busy={busy} onClick={() => approveOneUsdc(connecting)}>
              Sign with passkey
            </Button>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Approved apps</h2>
        <span className="pill"><Icon name="shieldCheck" size={13} /> Reviewed by Swissquote</span>
      </div>
      <div className="list">
        {dapps.map((d) => {
          const allowed = Number(allowances[d.id] ?? 0)
          return (
            <div className="item" key={d.id}>
              <div className="left">
                <span className="avatar-letter" style={{ background: DAPP_COLORS[d.id] ?? "var(--ink)" }}>{d.name[0]}</span>
                <div>
                  <div className="name">{d.name}</div>
                  <div className="sub">{allowed > 0 ? <span style={{ color: "var(--ok)", fontWeight: 600 }}>Connected · up to {allowed} USDC</span> : d.category}</div>
                </div>
              </div>
              {allowed > 0 ? (
                <Button variant="ghost" small busy={revoking === d.id} onClick={() => revoke(d)}>Revoke</Button>
              ) : (
                <Button variant="ghost" small onClick={() => setConnecting(d)}>Connect</Button>
              )}
            </div>
          )
        })}
        {dapps.length === 0 && <p className="muted">Loading the approved list…</p>}
      </div>
      {err && !connecting && <Alert kind="bad">{err}</Alert>}
      <hr className="divider" />
      <Field
        label="Open another app"
        value={custom}
        onChange={setCustom}
        placeholder="https://some-new-yield-farm.xyz"
        action={
          <button type="button" className="btn quiet sm" onClick={tryCustom}>
            Open
          </button>
        }
      />
      <div className="chips">
        <button type="button" className="chip demo" onClick={() => { setCustom("https://free-usdc-airdrop.xyz"); setBlockedMsg(null) }}>
          <Icon name="alert" size={13} /> Try a fake airdrop site
        </button>
      </div>
      {blockedMsg && <Alert kind="bad"><b>Blocked.</b><span>{blockedMsg}</span></Alert>}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Security: ownership proof, where the keys live, the "lost phone" entry point
// ---------------------------------------------------------------------------

function Security({
  wallet,
  bankSession,
  offline,
  onLostDevice,
  onSwissquoteDown,
  onEvent,
}: {
  wallet: Wallet
  bankSession: BankSession
  offline: boolean
  onLostDevice: () => void
  onSwissquoteDown?: () => void
  onEvent: (label: string) => void
}) {
  const s = wallet.session
  const [shutdownErr, alertShutdown] = useState<string | null>(null)
  const [proof, setProof] = useState<{ state: "idle" | "busy" | "ok" | "fail"; detail?: string }>({ state: "idle" })

  async function proveOwnership() {
    setProof({ state: "busy" })
    try {
      const { nonce, message } = await bank.ownershipChallenge(bankSession.token)
      const signature = await signMessageWithPasskey(wallet, message)
      const res = await bank.ownershipVerify(bankSession.token, nonce, signature)
      setProof(
        res.verified
          ? { state: "ok", detail: `Swissquote verified on-chain that this passkey controls ${short(res.walletAddress, 8)}.` }
          : { state: "fail", detail: "Signature did not verify." },
      )
      if (res.verified) onEvent("Proved wallet ownership to Swissquote (verified on-chain)")
    } catch (e) {
      setProof({ state: "fail", detail: errorMessage(e) })
    }
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Where your keys live</h2>
          <span className="pill ok dot">Protected</span>
        </div>
        <div className="list">
          <div className="item">
            <div className="left">
              <span className="ico dark"><Icon name="phone" size={18} /></span>
              <div><div className="name">This phone’s passkey</div><div className="sub">“{s.passkeyName}” · moves funds</div></div>
            </div>
            <span className="pill ok">Full control</span>
          </div>
          <div className="item">
            <div className="left">
              <span className="ico"><Icon name="key" size={18} /></span>
              <div><div className="name">Your backup key</div><div className="sub mono">{short(s.backupAddress, 6)}</div></div>
            </div>
            <span className="pill">{s.partnerAddress ? "Recovery · 60" : "Recovery only"}</span>
          </div>
          <div className="item">
            <div className="left">
              <span className="ico"><Icon name="bank" size={18} /></span>
              <div><div className="name">Swissquote guardian</div><div className="sub mono">{short(s.bankGuardianAddress, 6)}</div></div>
            </div>
            <span className="pill">{s.partnerAddress ? "Recovery · 40" : "Recovery only"}</span>
          </div>
          {s.partnerAddress && (
            <div className="item">
              <div className="left">
                <span className="ico"><Icon name="partner" size={18} /></span>
                <div><div className="name">Independent partner</div><div className="sub"><span className="mono">{short(s.partnerAddress, 6)}</span> · if Swissquote is gone</div></div>
              </div>
              <span className="pill">Recovery · 40</span>
            </div>
          )}
        </div>
        <p className="muted">
          {s.partnerAddress
            ? "Recovery needs 100 points: your backup key (60) plus Swissquote or the partner (40). Swissquote and the partner together reach only 80, so they can never act without you. Recovery can only replace your passkey — never send tokens — and this phone is alerted and can cancel it."
            : "The recovery pair is bound on-chain to one function: replacing your passkey. It can’t send tokens, and every recovery waits out a delay during which this phone is alerted and can cancel it."}
        </p>
      </section>

      {!offline && (
        <section className="card">
          <div className="card-head">
            <h2>Prove ownership to Swissquote</h2>
            <span className="pill">{bankSession.clientId} · KYC</span>
          </div>
          <p className="muted">
            Swiss rules require the bank to verify that an external wallet belongs to its client. One tap: Swissquote sends a
            challenge, your passkey signs it, and the bank checks the signature on-chain.
          </p>
          {proof.state === "ok" && <Alert kind="ok"><b>Ownership verified</b><span>{proof.detail}</span></Alert>}
          {proof.state === "fail" && <Alert kind="bad">{proof.detail}</Alert>}
          <Button variant="primary" icon="faceid" busy={proof.state === "busy"} onClick={proveOwnership} block>
            Sign ownership proof
          </Button>
        </section>
      )}

      <section className="card flat">
        <h2>Lost your phone?</h2>
        <p className="muted">
          Recover on a new device with your Swissquote login and your backup key. For the demo, this makes this device
          forget the Vault.
        </p>
        <Button variant="ghost" icon="recover" onClick={onLostDevice} block>
          Simulate losing this phone
        </Button>
      </section>

      {import.meta.env.DEV && !offline && onSwissquoteDown && (
        <section className="card flat">
          <h2>What if Swissquote disappears?</h2>
          <p className="muted">
            <span className="mock-tag">DEMO</span> Really stops the mock Swissquote service. Your Vault keeps signing, and a
            lost phone is recovered through the independent partner. Restart it with <code>npm run bank</code>.
          </p>
          <Button
            variant="ghost"
            icon="power"
            block
            onClick={async () => {
              try {
                await bank.demoShutdown()
                onSwissquoteDown()
              } catch (e) {
                alertShutdown(errorMessage(e))
              }
            }}
          >
            Switch Swissquote off
          </Button>
          {shutdownErr && <Alert kind="bad">Couldn’t switch it off: {shutdownErr}. Open the app at localhost.</Alert>}
        </section>
      )}
    </>
  )
}
