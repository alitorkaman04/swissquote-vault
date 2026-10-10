import { useEffect, useState } from "react"
import type { Address, Hex } from "viem"
import { bank, type BankSession, type RecoveryRequest } from "../lib/bank"
import { EXPLORER_TX, RECOVERY_DELAY_SECONDS } from "../lib/config"
import { adoptRecoveredSession, approveWithBackupKey, prepareNewPasskey, submitRecovery, type buildRecoveryClient } from "../lib/recovery"
import type { WalletSession } from "../lib/wallet"
import { Alert, Button, Field, Icon, errorMessage, formatGas, short, uniquePasskeyName } from "../ui"
import { appendActivity } from "../lib/activity"

/**
 * Lost-phone recovery, as the client experiences it on a NEW device:
 *   1. new passkey            (this device)
 *   2. request to Swissquote  (bank verifies identity, notifies old devices, starts the delay)
 *   3. backup key signature   (client's half of the recovery pair)
 *   4. bank signature         (after the delay, unless the old device cancelled)
 *   5. on-chain: passkey replaced, same Vault address, same funds
 */
export function Recover({
  bankSession,
  guardian,
  existing,
  onRecovered,
  onBack,
}: {
  bankSession: BankSession
  guardian: Address
  existing: { walletAddress: Address; backupAddress: Address; passkeyName: string }
  onRecovered: (s: WalletSession) => Promise<void>
  onBack: () => void
}) {
  const [step, setStep] = useState(1)
  const [newName, setNewName] = useState(uniquePasskeyName(bankSession.clientId))
  const [prepared, setPrepared] = useState<{ callData: Hex; serialized: string } | null>(null)
  const [request, setRequest] = useState<RecoveryRequest | null>(null)
  const [backupKey, setBackupKey] = useState("")
  const [backupSig, setBackupSig] = useState<{ client: Awaited<ReturnType<typeof buildRecoveryClient>>; signature: Hex } | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  // Poll the bank for the request status (delay elapsed? cancelled by the old device?)
  useEffect(() => {
    if (!request || ["signed", "cancelled"].includes(request.status)) return
    const t = setInterval(() => {
      setNow(Date.now())
      bank.getRecovery(request.id).then(setRequest).catch(() => {})
    }, 1000)
    return () => clearInterval(t)
  }, [request])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const stepNewPasskey = () =>
    run(async () => {
      const p = await prepareNewPasskey(newName.trim())
      setPrepared({ callData: p.callData, serialized: p.serialized })
      const r = await bank.requestRecovery(bankSession.token, { callData: p.callData, newPasskeyName: newName.trim() })
      setRequest(r)
      setStep(2)
    })

  const stepBackup = () =>
    run(async () => {
      if (!prepared) throw new Error("no prepared passkey")
      const key = backupKey.trim() as Hex
      if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("That doesn’t look like a backup key (0x + 64 hex characters).")
      const res = await approveWithBackupKey(existing.walletAddress, guardian, existing.backupAddress, key, prepared.callData)
      setBackupSig(res)
      setStep(3)
    })

  const stepFinish = () =>
    run(async () => {
      if (!request || !backupSig || !prepared) throw new Error("missing state")
      const { signature: bankSignature } = await bank.signRecovery(request.id, bankSession.token)
      const { txHash, gasCostWei } = await submitRecovery(backupSig.client, prepared.callData, [backupSig.signature, bankSignature])
      appendActivity(existing.walletAddress, { at: Date.now(), label: `Recovered: passkey replaced by “${newName.trim()}”`, txHash, gas: formatGas(gasCostWei) })
      setTxHash(txHash)
      setStep(4)
      await bank.completeRecovery(request.id, txHash).catch(() => {})
      const session = adoptRecoveredSession(
        { address: existing.walletAddress, backupAddress: existing.backupAddress, bankGuardianAddress: guardian },
        newName.trim(),
        prepared.serialized,
      )
      await onRecovered(session)
    })

  const secondsLeft = request ? Math.max(0, Math.ceil((request.unlockAt - now) / 1000)) : RECOVERY_DELAY_SECONDS
  const cancelled = request?.status === "cancelled"
  const ready = request?.status === "ready" || request?.status === "signed"

  const total = request ? Math.max(1, Math.round((request.unlockAt - request.createdAt) / 1000)) : RECOVERY_DELAY_SECONDS
  const progress = 1 - secondsLeft / total
  const R = 64
  const C = 2 * Math.PI * R

  const steps = [
    { t: "Create a passkey on this phone", d: "Face ID makes the new key" },
    { t: "Sign with your backup key", d: "Your half of the recovery pair" },
    { t: "Swissquote waits, then co-signs", d: `${RECOVERY_DELAY_SECONDS}s in this demo · 48 h in production` },
    { t: "Passkey replaced on-chain", d: "Same address, same funds" },
  ]

  return (
    <div className="screen">
      <div className="title">
        <span className="ico lg signal"><Icon name="recover" size={26} /></span>
        <h1>Recover your Vault</h1>
        <p>Same Vault, same funds — only the passkey changes. Swissquote co-signs after a waiting period, and only together with your backup key.</p>
      </div>

      <div className="card flat" style={{ gap: 6 }}>
        <span className="section-label">Vault on file for {bankSession.clientId}</span>
        <span className="mono">{existing.walletAddress}</span>
      </div>

      <div className="stepper">
        {steps.map((st, i) => {
          const n = i + 1
          const cls = step > n || (n === 4 && step === 4) ? "done" : step === n ? "now" : ""
          return (
            <div className={`s ${cls}`} key={n}>
              <span className="n">{cls === "done" ? <Icon name="check" size={15} stroke={2.6} /> : n}</span>
              <span className="t">
                {st.t}
                <small>{st.d}</small>
              </span>
            </div>
          )
        })}
      </div>

      {step === 1 && (
        <>
          <details className="adv">
            <summary>New passkey name: {newName} · change</summary>
            <Field label="New passkey name" value={newName} onChange={setNewName} />
          </details>
          <Button variant="primary" icon="faceid" busy={busy} onClick={stepNewPasskey} block>
            Create passkey and request recovery
          </Button>
        </>
      )}

      {step === 2 && (
        <>
          <Alert kind="info">
            Swissquote has alerted your other devices. The waiting period runs while you enter your backup key.
          </Alert>
          <Field label="Backup key" value={backupKey} onChange={setBackupKey} placeholder="0x… (from your backup kit)" textarea />
          <Button variant="primary" icon="key" busy={busy} onClick={stepBackup} block>
            Sign with backup key
          </Button>
        </>
      )}

      {step === 3 && request && (
        <>
          {cancelled ? (
            <Alert kind="bad">
              <b>Recovery cancelled</b>
              <span>Your existing device vetoed it. If that wasn’t you, contact Swissquote — your funds never moved.</span>
            </Alert>
          ) : ready ? (
            <Alert kind="ok">
              <b>Waiting period over</b>
              <span>Nobody objected. Swissquote is ready to co-sign.</span>
            </Alert>
          ) : (
            <>
              <div className="countdown" role="timer" aria-label={`${secondsLeft} seconds left`}>
                <svg width="148" height="148" viewBox="0 0 148 148" aria-hidden="true">
                  <circle cx="74" cy="74" r={R} fill="none" stroke="var(--line)" strokeWidth="8" />
                  <circle
                    cx="74"
                    cy="74"
                    r={R}
                    fill="none"
                    stroke="var(--signal)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={C}
                    strokeDashoffset={C * (1 - progress)}
                    style={{ transition: "stroke-dashoffset 1s linear" }}
                  />
                </svg>
                <div className="num">
                  {secondsLeft}s<small>waiting period</small>
                </div>
              </div>
              <p className="hint center-text">
                Your old devices can cancel during this time. A thief holding your old phone would need your Face ID or
                your e-banking login to cancel — they have neither.
              </p>
            </>
          )}
          {!cancelled && (
            <Button variant="primary" icon="shieldCheck" busy={busy} disabled={!ready} onClick={stepFinish} block>
              Complete recovery
            </Button>
          )}
        </>
      )}

      {step === 4 && txHash && (
        <Alert kind="ok">
          <b>Recovered</b>
          <span>Your new passkey now controls {short(existing.walletAddress, 8)}.</span>
          <a href={EXPLORER_TX(txHash)} target="_blank" rel="noreferrer">View the recovery transaction</a>
        </Alert>
      )}

      {err && <Alert kind="bad">{err}</Alert>}
      {step < 4 && (
        <Button variant="quiet" onClick={onBack} block>
          Back
        </Button>
      )}
    </div>
  )
}
