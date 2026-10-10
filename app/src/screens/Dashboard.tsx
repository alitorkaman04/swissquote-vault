import { useCallback, useEffect, useState } from "react"
import { type Address, encodeFunctionData, erc20Abi, isAddress, parseUnits } from "viem"
import { bank, type ApprovedDapp, type BankSession, type RecoveryRequest, type ScreeningResult } from "../lib/bank"
import { EXPLORER_ADDRESS, EXPLORER_TX, USDC_ADDRESS, USDC_DECIMALS } from "../lib/config"
import { getBalances, getUsdcAllowance, isDeployed, publicClient, revokeUsdcAllowance, sendCalls, sendUsdc, signMessageWithPasskey, type Wallet } from "../lib/wallet"
import QRCode from "qrcode"
import { Alert, Button, Field, errorMessage, short } from "../ui"

type Activity = { at: number; label: string; txHash: string; amount?: string }
const activityKey = (address: string) => `swissquote-vault:activity:${address.toLowerCase()}`

export function Dashboard({ wallet, bankSession, onLostDevice }: { wallet: Wallet; bankSession: BankSession; onLostDevice: () => void }) {
  const { address } = wallet.session
  const [tab, setTab] = useState<"send" | "receive" | "dapps" | "security">("send")
  const [vetoBusy, setVetoBusy] = useState(false)
  const [vetoNote, setVetoNote] = useState<string | null>(null)
  const [balances, setBalances] = useState<{ usdc: string; eth: string } | null>(null)
  const [deployed, setDeployed] = useState<boolean | null>(null)
  const [activity, setActivity] = useState<Activity[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(activityKey(wallet.session.address)) ?? "[]")
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
      localStorage.setItem(activityKey(address), JSON.stringify(next))
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
            busy={vetoBusy}
            onClick={async () => {
              setVetoBusy(true)
              try {
                // Strong veto: this device proves it still holds the passkey by signing the veto (ERC-1271).
                const message = bank.cancelMessage(pendingRecovery.id)
                let signature: `0x${string}` | undefined
                try {
                  signature = await signMessageWithPasskey(wallet, message)
                } catch {
                  signature = undefined // fall back to the e-banking session
                }
                const r = await bank.cancelRecovery(pendingRecovery.id, { token: bankSession.token, message, signature })
                setVetoNote(r.vetoedBy === "passkey" ? "Recovery cancelled — veto signed with this phone’s passkey." : "Recovery cancelled.")
                setPendingRecovery(null)
                setTimeout(() => setVetoNote(null), 8000)
              } catch (e) {
                setVetoNote(`Could not cancel: ${errorMessage(e)}`)
              } finally {
                setVetoBusy(false)
              }
            }}
          >
            That’s not me — cancel recovery
          </Button>
        </Alert>
      )}
      {vetoNote && (
        <Alert kind="ok">
          <b>{vetoNote}</b>
          <span>Your funds never moved.</span>
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
        {(["send", "receive", "dapps", "security"] as const).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t === "send" ? "Send" : t === "receive" ? "Receive" : t === "dapps" ? "Apps" : "Security"}
          </button>
        ))}
      </div>

      {tab === "send" && <Send wallet={wallet} bankSession={bankSession} onSent={(a) => { addActivity(a); refresh() }} balance={balances?.usdc} />}
      {tab === "receive" && <Receive address={address} />}
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

function Send({ wallet, bankSession, onSent, balance }: { wallet: Wallet; bankSession: BankSession; onSent: (a: Activity) => void; balance?: string }) {
  const [otp, setOtp] = useState("")
  const [steppedUp, setSteppedUp] = useState(false)
  const [stepBusy, setStepBusy] = useState(false)
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
        <Button variant="ghost" onClick={() => { setStage("form"); setResult(null); setTo(""); setSteppedUp(false); setOtp("") }} block>
          Send another
        </Button>
      </div>
    )
  }

  if (stage === "review" || stage === "signing") {
    const needsStepUp = screening?.decision === "review" && !steppedUp
    const blocked = screening?.decision === "block" || simulation?.ok === false || needsStepUp
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
            {screening.checks.map((c) => {
              // The high-value check turns green once the client confirmed with their security code.
              const passed = c.passed || (steppedUp && c.name.startsWith("High-value"))
              const detail = passed && !c.passed ? "Confirmed with security code" : c.detail
              return (
                <div key={c.name}>
                  <span className={`mark ${passed ? "pass" : "fail"}`}>{passed ? "✓" : "✕"}</span>
                  <span>
                    {c.name}
                    <span className="muted"> — {detail}</span>
                  </span>
                </div>
              )
            })}
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
        {screening?.decision === "review" && !steppedUp && (
          <Alert kind="warn">
            <b>High-value transfer.</b>
            <span>Confirm with your Swissquote security code before signing (step-up authentication).</span>
            <div className="row">
              <input
                className="mono"
                style={{ font: "inherit", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 10 }}
                placeholder="Security code (demo: 000000)"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
              <Button
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
      <Field label="Amount (USDC)" value={amount} onChange={setAmount} type="number" hint="Above 1,000 USDC the app asks for your security code first." />
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
// Receive: address + QR code
// ---------------------------------------------------------------------------

function Receive({ address }: { address: Address }) {
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    QRCode.toDataURL(address, { margin: 1, width: 280, color: { dark: "#14213d", light: "#ffffff" } }).then(setQr).catch(() => {})
  }, [address])
  return (
    <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
      <h2>Receive USDC or ETH on Base</h2>
      {qr && <img src={qr} alt="QR code of your Vault address" width={240} height={240} style={{ borderRadius: 12 }} />}
      <span className="mono">{address}</span>
      <Button
        variant="ghost"
        onClick={() => navigator.clipboard.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}
      >
        {copied ? "Copied" : "Copy address"}
      </Button>
      <p className="muted">Transfers from your Swissquote account arrive here directly: the bank already knows this wallet is yours.</p>
    </div>
  )
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
      const { txHash } = await revokeUsdcAllowance(wallet, d.contracts[0])
      onSent({ at: Date.now(), label: `Revoked ${d.name}’s access to USDC`, txHash })
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
      const { txHash } = await sendCalls(wallet, [
        {
          to: USDC_ADDRESS,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [d.contracts[0], parseUnits("1", USDC_DECIMALS)] }),
        },
      ])
      setDone(txHash)
      onSent({ at: Date.now(), label: `Allowed ${d.name} to use 1 USDC`, txHash })
      await loadAllowances(dapps)
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
        {dapps.map((d) => {
          const allowed = Number(allowances[d.id] ?? 0)
          return (
            <div className="item" key={d.id}>
              <div>
                <div className="name">{d.name}</div>
                <div className="sub">
                  {d.category}
                  {allowed > 0 ? ` · connected, may use up to ${allowed} USDC` : ""}
                </div>
              </div>
              {allowed > 0 ? (
                <Button variant="ghost" busy={revoking === d.id} onClick={() => revoke(d)}>Revoke</Button>
              ) : (
                <Button variant="ghost" onClick={() => setConnecting(d)}>Connect</Button>
              )}
            </div>
          )
        })}
      </div>
      {err && !connecting && <Alert kind="bad">{err}</Alert>}
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
    } catch (e) {
      setProof({ state: "fail", detail: errorMessage(e) })
    }
  }

  return (
    <div className="card">
      <h2>Prove ownership to Swissquote</h2>
      <p className="muted">
        Swiss rules require Swissquote to verify that an external wallet belongs to its client. Vault proves it in one tap:
        the bank sends a challenge, your passkey signs it, and the bank checks the signature on-chain.
      </p>
      {proof.state === "ok" && <Alert kind="ok"><b>Ownership verified.</b><span>{proof.detail}</span></Alert>}
      {proof.state === "fail" && <Alert kind="bad">{proof.detail}</Alert>}
      <Button variant="primary" busy={proof.state === "busy"} onClick={proveOwnership} block>
        Sign ownership proof with passkey
      </Button>
      <hr style={{ border: 0, borderTop: "1px solid var(--line)", width: "100%" }} />
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
