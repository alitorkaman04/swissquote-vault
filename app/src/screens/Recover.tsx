import { useEffect, useState } from "react"
import type { Address, Hex } from "viem"
import { generatePrivateKey } from "viem/accounts"
import { bank, type BankSession, type RecoveryRequest } from "../lib/bank"
import { EXPLORER_TX, RECOVERY_DELAY_SECONDS } from "../lib/config"
import {
  adoptRecoveredSession,
  approveWithBackupKey,
  attackerApproval,
  checkBackupKey,
  prepareNewPasskey,
  submitRecovery,
  type buildRecoveryClient,
} from "../lib/recovery"
import type { RecoverySetup } from "../lib/onchainRecovery"
import type { WalletSession } from "../lib/wallet"
import { Alert, Button, Countdown, Field, Icon, errorMessage, formatGas, short, uniquePasskeyName } from "../ui"
import { appendActivity } from "../lib/activity"

/**
 * Lost-phone recovery, as the client experiences it on a NEW device:
 *   1. new passkey            (this device)
 *   2. request to Swissquote  (bank verifies identity, notifies old devices, starts the delay)
 *   3. backup key signature   (checked against the Vault's recovery keys ON-CHAIN first)
 *   4. bank signature         (after the delay, unless the old device cancelled; the bank
 *                              verifies the backup approval before it co-signs)
 * Includes a demo of the bonus scenario: an attacker with the stolen phone and email inbox
 * is refused, both by the on-chain key check and by Swissquote.
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
  existing: { walletAddress: Address; passkeyName: string }
  onRecovered: (s: WalletSession) => Promise<void>
  onBack: () => void
}) {
  const [step, setStep] = useState(1)
  const [newName, setNewName] = useState(uniquePasskeyName(bankSession.clientId))
  const [prepared, setPrepared] = useState<{ callData: Hex; serialized: string } | null>(null)
  const [request, setRequest] = useState<RecoveryRequest | null>(null)
  const [backupKey, setBackupKey] = useState("")
  const [backupSig, setBackupSig] = useState<{
    client: Awaited<ReturnType<typeof buildRecoveryClient>>
    signature: Hex
    setup: RecoverySetup
    backupAddress: Address
  } | null>(null)
  const [attack, setAttack] = useState<{ chain: string; bank: string } | null>(null)
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
      setAttack(null)
      // Checked against the Vault's recovery keys on-chain before anything is signed.
      const check = await checkBackupKey(existing.walletAddress, backupKey)
      if (!check.ok) throw new Error(check.reason)
      const res = await approveWithBackupKey(existing.walletAddress, check.setup, check.key, prepared.callData)
      setBackupSig({ ...res, setup: check.setup, backupAddress: check.address })
      setStep(3)
    })

  /**
   * Bonus demo: the attacker has the phone and the email inbox (so they could reset the e-banking
   * password and get this far). They don't have the backup key - so they try a key of their own.
   */
  const tryAsAttacker = () =>
    run(async () => {
      if (!prepared || !request) throw new Error("start the recovery first")
      const attackerKey = generatePrivateKey()
      const chainCheck = await checkBackupKey(existing.walletAddress, attackerKey)
      let bankAnswer: string
      try {
        await bank.signRecovery(request.id, bankSession.token, await attackerApproval(attackerKey, existing.walletAddress, prepared.callData))
        bankAnswer = "Swissquote accepted it (unexpected)"
      } catch (e) {
        bankAnswer = errorMessage(e)
      }
      setAttack({ chain: chainCheck.ok ? "Accepted (unexpected)" : chainCheck.reason, bank: bankAnswer })
    })

  const stepFinish = () =>
    run(async () => {
      if (!request || !backupSig || !prepared) throw new Error("missing state")
      const { signature: bankSignature } = await bank.signRecovery(request.id, bankSession.token, backupSig.signature)
      const { txHash, gasCostWei } = await submitRecovery(backupSig.client, prepared.callData, [backupSig.signature, bankSignature])
      appendActivity(existing.walletAddress, { at: Date.now(), label: `Recovered: passkey replaced by “${newName.trim()}”`, txHash, gas: formatGas(gasCostWei) })
      setTxHash(txHash)
      setStep(4)
      await bank.completeRecovery(request.id, txHash).catch(() => {})
      const partnerAddress = backupSig.setup.signers
        .map((x) => x.address)
        .find((a) => ![backupSig.backupAddress, guardian].some((k) => k.toLowerCase() === a.toLowerCase()))
      const session = adoptRecoveredSession(
        { address: existing.walletAddress, backupAddress: backupSig.backupAddress, bankGuardianAddress: guardian, partnerAddress },
        newName.trim(),
        prepared.serialized,
      )
      await onRecovered(session)
    })

  const secondsLeft = request ? Math.max(0, Math.ceil((request.unlockAt - now) / 1000)) : RECOVERY_DELAY_SECONDS
  const cancelled = request?.status === "cancelled"
  const ready = request?.status === "ready" || request?.status === "signed"

  const total = request ? Math.max(1, Math.round((request.unlockAt - request.createdAt) / 1000)) : RECOVERY_DELAY_SECONDS

  const steps = [
    { t: "Create a passkey on this phone", d: "Face ID makes the new key" },
    { t: "Sign with your backup key", d: "Checked on-chain: only your key counts" },
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
          <div className="chips">
            <button type="button" className="chip demo" onClick={tryAsAttacker} disabled={busy}>
              <Icon name="ban" size={14} /> Demo: try as a thief with the phone + email
            </button>
          </div>
          {attack && <AttackerRefused chain={attack.chain} bank={attack.bank} />}
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
              <Countdown secondsLeft={secondsLeft} total={total} />
              <p className="hint center-text">
                <span className="mock-tag">MOCK</span> Delay enforced by the mock Swissquote guardian. Your old devices can cancel during this time. A thief holding your old phone would need your Face ID or
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

/** What an attacker holding the stolen phone and the email inbox gets: refused twice, nothing moved. */
export function AttackerRefused({ chain, bank: bankAnswer }: { chain: string; bank?: string }) {
  return (
    <section className="card attack" aria-live="polite">
      <div className="card-head">
        <h2>Attacker refused</h2>
        <span className="pill bad">Stolen phone + email</span>
      </div>
      <div className="checks">
        <span className="sub-head">What the thief has</span>
        <div className="c">
          <span className="have"><Icon name="phone" size={18} /></span>
          <span>Your phone<span className="d">Locked: without your Face ID the passkey signs nothing.</span></span>
        </div>
        <div className="c">
          <span className="have"><Icon name="info" size={18} /></span>
          <span>Your email inbox<span className="d">Enough to reset an e-banking password and reach this screen.</span></span>
        </div>
        <span className="sub-head">What stops them</span>
        <div className="c">
          <span className="fail"><Icon name="x" size={18} stroke={2.2} /></span>
          <span>Backup key, checked against the chain<span className="d">{chain}</span></span>
        </div>
        {bankAnswer && (
          <div className="c">
            <span className="fail"><Icon name="x" size={18} stroke={2.2} /></span>
            <span>Swissquote’s co-signature<span className="d">{bankAnswer}</span></span>
          </div>
        )}
        <div className="c">
          <span className="fail"><Icon name="x" size={18} stroke={2.2} /></span>
          <span>Time<span className="d">Even a real request waits 48 h while your e-banking and other devices are alerted and can cancel.</span></span>
        </div>
      </div>
      <Alert kind="ok">Nothing reached the blockchain. Your funds never moved.</Alert>
    </section>
  )
}
