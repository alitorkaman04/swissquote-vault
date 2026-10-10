import { useEffect, useState } from "react"
import type { Address, Hex } from "viem"
import { bank, type BankSession, type RecoveryRequest } from "../lib/bank"
import { EXPLORER_TX, RECOVERY_DELAY_SECONDS } from "../lib/config"
import { adoptRecoveredSession, approveWithBackupKey, prepareNewPasskey, submitRecovery, type buildRecoveryClient } from "../lib/recovery"
import type { WalletSession } from "../lib/wallet"
import { Alert, Button, Field, errorMessage, short } from "../ui"

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
  const [newName, setNewName] = useState(`${bankSession.clientId}-${new Date().toISOString().slice(0, 10)}-new`)
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
      const { signature: bankSignature } = await bank.signRecovery(request.id)
      const { txHash } = await submitRecovery(backupSig.client, prepared.callData, [backupSig.signature, bankSignature])
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

  return (
    <div className="screen">
      <div>
        <h1>Recover your Vault</h1>
        <p>
          Same Vault, same funds — only the passkey changes. Swissquote co-signs after a waiting period, and only
          together with your backup key.
        </p>
      </div>

      <div className="card flat">
        <span className="muted">Vault on file for {bankSession.clientId}</span>
        <span className="mono">{existing.walletAddress}</span>
      </div>

      <div className="steps">
        <div className={`step ${step > 1 ? "done" : "now"}`}><span className="n">1</span><span>Create a passkey on this phone</span></div>
        <div className={`step ${step > 2 ? "done" : step === 2 ? "now" : ""}`}><span className="n">2</span><span>Enter your backup key</span></div>
        <div className={`step ${step > 3 ? "done" : step === 3 ? "now" : ""}`}><span className="n">3</span><span>Swissquote waits, then co-signs</span></div>
        <div className={`step ${step > 3 ? "done" : ""}`}><span className="n">4</span><span>Passkey replaced on-chain</span></div>
      </div>

      {step === 1 && (
        <>
          <Field label="New passkey name" value={newName} onChange={setNewName} />
          <Button variant="primary" busy={busy} onClick={stepNewPasskey} block>
            Create passkey and request recovery
          </Button>
        </>
      )}

      {step === 2 && (
        <>
          <Alert kind="info">
            Swissquote has notified your other devices. The waiting period ({RECOVERY_DELAY_SECONDS}s in this demo, 48h in
            production) runs while you enter your backup key.
          </Alert>
          <Field label="Backup key" value={backupKey} onChange={setBackupKey} placeholder="0x…" textarea />
          <Button variant="primary" busy={busy} onClick={stepBackup} block>
            Sign with backup key
          </Button>
        </>
      )}

      {step === 3 && request && (
        <>
          {cancelled ? (
            <Alert kind="bad">
              <b>Recovery cancelled.</b> Your existing device vetoed it. If that wasn’t you, contact Swissquote — your funds
              never moved.
            </Alert>
          ) : ready ? (
            <Alert kind="ok">Waiting period over and nobody objected. Swissquote is ready to co-sign.</Alert>
          ) : (
            <>
              <div className="countdown">{secondsLeft}s</div>
              <p className="muted" style={{ textAlign: "center" }}>
                If the old phone was stolen, its holder would need your Face ID to cancel — they can’t. If it’s you on the
                old phone, you can cancel from there.
              </p>
            </>
          )}
          {!cancelled && (
            <Button variant="primary" busy={busy} disabled={!ready} onClick={stepFinish} block>
              Complete recovery
            </Button>
          )}
        </>
      )}

      {step === 4 && txHash && (
        <Alert kind="ok">
          <b>Recovered.</b> Your new passkey now controls {short(existing.walletAddress, 8)}.{" "}
          <a href={EXPLORER_TX(txHash)} target="_blank" rel="noreferrer">View the recovery transaction</a>
        </Alert>
      )}

      {err && <Alert kind="bad">{err}</Alert>}
      {step < 4 && (
        <Button variant="ghost" onClick={onBack} block>
          Back
        </Button>
      )}
    </div>
  )
}
