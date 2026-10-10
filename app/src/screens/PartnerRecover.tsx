import { useEffect, useState } from "react"
import { type Address, type Hex, isAddress } from "viem"
import { EXPLORER_TX } from "../lib/config"
import { partner, type PartnerRecovery } from "../lib/partner"
import { adoptRecoveredSession, approveWithBackupKey, checkBackupKey, prepareNewPasskey, submitRecovery } from "../lib/recovery"
import { weightOf } from "../lib/onchainRecovery"
import type { WalletSession } from "../lib/wallet"
import { appendActivity } from "../lib/activity"
import { Alert, Button, Countdown, Field, Icon, errorMessage, formatGas, short, uniquePasskeyName } from "../ui"

/**
 * Recovery when Swissquote's services are permanently gone.
 * Needs nothing from Swissquote: the backup kit (Vault address + backup key), the holder's identity
 * (checked by the independent partner) and a longer waiting period. On-chain: backup 60 + partner 40 = 100.
 */
export function PartnerRecover({
  knownAddress,
  onRecovered,
  onBack,
}: {
  knownAddress?: Address
  onRecovered: (s: WalletSession) => Promise<void>
  onBack: () => void
}) {
  const [step, setStep] = useState(1)
  const [vault, setVault] = useState<string>(knownAddress ?? "")
  const [backupKey, setBackupKey] = useState("")
  const [holder, setHolder] = useState("")
  const [info, setInfo] = useState<{ address: Address; name: string; delaySeconds: number } | null>(null)
  const [state, setState] = useState<{
    request: PartnerRecovery & { token: string }
    callData: Hex
    serialized: string
    newName: string
    backupApproval: Hex
    backupAddress: Address
    client: Awaited<ReturnType<typeof approveWithBackupKey>>["client"]
    otherGuardian?: Address
  } | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    partner.guardian().then(setInfo).catch((e) => setErr(errorMessage(e)))
  }, [])

  // Poll the partner while the waiting period runs (and to see a veto from the old device).
  useEffect(() => {
    if (!state || ["signed", "cancelled"].includes(state.request.status)) return
    const t = setInterval(() => {
      setNow(Date.now())
      partner
        .getRecovery(state.request.id)
        .then((r) => setState((s) => (s ? { ...s, request: { ...s.request, ...r } } : s)))
        .catch(() => {})
    }, 1000)
    return () => clearInterval(t)
  }, [state])

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

  async function pasteKit() {
    try {
      const text = await navigator.clipboard.readText()
      const addr = text.match(/Vault address\s*:\s*(0x[0-9a-fA-F]{40})/)?.[1]
      const key = text.match(/Backup key\s*:\s*(0x[0-9a-fA-F]{64})/)?.[1] ?? text.match(/0x[0-9a-fA-F]{64}/)?.[0]
      if (addr) setVault(addr)
      if (key) setBackupKey(key)
      if (!addr && !key) setErr("The clipboard doesn’t contain a backup kit.")
    } catch {
      setErr("Clipboard access was blocked: paste the fields by hand.")
    }
  }

  const start = () =>
    run(async () => {
      if (!info) throw new Error("The recovery partner is unreachable.")
      if (!isAddress(vault.trim())) throw new Error("Enter your Vault address (it’s on your backup kit).")
      const walletAddress = vault.trim() as Address
      if (!holder.trim()) throw new Error("Enter your client number for the identity check.")
      const check = await checkBackupKey(walletAddress, backupKey)
      if (!check.ok) throw new Error(check.reason)
      if (weightOf(check.setup, info.address) === 0) {
        throw new Error("This Vault has no independent partner: it was created before the partner existed. Recover with Swissquote instead.")
      }
      // New passkey on this device, then the backup key approves exactly this change.
      const newName = uniquePasskeyName(holder.trim())
      const p = await prepareNewPasskey(newName)
      const { client, signature } = await approveWithBackupKey(walletAddress, check.setup, check.key, p.callData)
      const request = await partner.requestRecovery({
        walletAddress,
        holder: holder.trim(),
        callData: p.callData,
        newPasskeyName: newName,
        backupApproval: signature,
      })
      const otherGuardian = check.setup.signers
        .map((s) => s.address)
        .find((a) => ![check.address, info.address].some((k) => k.toLowerCase() === a.toLowerCase()))
      setState({ request, callData: p.callData, serialized: p.serialized, newName, backupApproval: signature, backupAddress: check.address, client, otherGuardian })
      setStep(2)
    })

  const finish = () =>
    run(async () => {
      if (!state || !info) throw new Error("missing state")
      const { signature: partnerSignature } = await partner.signRecovery(state.request.id, state.request.token)
      const res = await submitRecovery(state.client, state.callData, [state.backupApproval, partnerSignature])
      const walletAddress = state.request.walletAddress
      appendActivity(walletAddress, {
        at: Date.now(),
        label: `Recovered without Swissquote: passkey replaced by “${state.newName}”`,
        txHash: res.txHash,
        gas: formatGas(res.gasCostWei),
      })
      setTxHash(res.txHash)
      setStep(3)
      const session = adoptRecoveredSession(
        {
          address: walletAddress,
          backupAddress: state.backupAddress,
          bankGuardianAddress: state.otherGuardian ?? info.address,
          partnerAddress: info.address,
        },
        state.newName,
        state.serialized,
      )
      await onRecovered(session)
    })

  const r = state?.request
  const secondsLeft = r ? Math.max(0, Math.ceil((r.unlockAt - now) / 1000)) : (info?.delaySeconds ?? 45)
  const total = r ? Math.max(1, Math.round((r.unlockAt - r.createdAt) / 1000)) : (info?.delaySeconds ?? 45)
  const cancelled = r?.status === "cancelled"
  const ready = r?.status === "ready" || r?.status === "signed"

  return (
    <div className="screen">
      <div className="title">
        <span className="ico lg signal"><Icon name="partner" size={26} /></span>
        <h1>Recover without Swissquote</h1>
        <p>
          If Swissquote is ever gone, your backup key and an independent recovery partner restore your Vault. The partner
          can’t act without your backup key — and neither can Swissquote, even together.
        </p>
      </div>

      <div className="checks" aria-label="Recovery rule on-chain">
        <div className="c">
          <span className="pass"><Icon name="check" size={18} stroke={2.2} /></span>
          <span>Your backup key 60 + partner 40 = 100<span className="d">Reaches the on-chain threshold: you get back in</span></span>
        </div>
        <div className="c">
          <span className="fail"><Icon name="x" size={18} stroke={2.2} /></span>
          <span>Swissquote 40 + partner 40 = 80<span className="d">Below the threshold: the institutions can never recover without you</span></span>
        </div>
      </div>

      {step === 1 && (
        <>
          <Field label="Vault address" value={vault} onChange={setVault} placeholder="0x… (on your backup kit)" mono />
          <Field label="Backup key" value={backupKey} onChange={setBackupKey} placeholder="0x… (from your backup kit)" textarea />
          <div className="chips">
            <button type="button" className="chip" onClick={pasteKit}>
              <Icon name="paste" size={14} /> Paste backup kit
            </button>
          </div>
          <Field label="Client number (identity check)" value={holder} onChange={setHolder} placeholder="as registered, e.g. demo" />
          <div className="demo-note">
            <Icon name="info" size={16} />
            <span>
              <span className="mock-tag">MOCK</span> The partner’s identity check is your client number here. Production: video
              identification against your KYC file, escrowed with the partner at onboarding.
            </span>
          </div>
          <Button variant="primary" icon="faceid" busy={busy} disabled={!info} onClick={start} block>
            Create passkey and ask the partner
          </Button>
        </>
      )}

      {step === 2 && r && (
        <>
          {cancelled ? (
            <Alert kind="bad">
              <b>Recovery cancelled</b>
              <span>The Vault’s current passkey vetoed it. Your funds never moved.</span>
            </Alert>
          ) : ready ? (
            <Alert kind="ok">
              <b>Waiting period over</b>
              <span>Identity and backup key verified, nobody objected. The partner is ready to co-sign.</span>
            </Alert>
          ) : (
            <>
              <Countdown secondsLeft={secondsLeft} total={total} label="partner waiting period" />
              <p className="hint center-text">
                <span className="mock-tag">MOCK</span> {total}s in this demo · 30 days in production. The partner has checked your identity and your backup key’s
                approval against the chain; your old devices can still cancel.
              </p>
            </>
          )}
          {!cancelled && (
            <Button variant="primary" icon="shieldCheck" busy={busy} disabled={!ready} onClick={finish} block>
              Complete recovery
            </Button>
          )}
        </>
      )}

      {step === 3 && txHash && state && (
        <Alert kind="ok">
          <b>Recovered — no Swissquote involved</b>
          <span>Your new passkey now controls {short(state.request.walletAddress, 8)}.</span>
          <a href={EXPLORER_TX(txHash)} target="_blank" rel="noreferrer">View the recovery transaction</a>
        </Alert>
      )}

      {err && <Alert kind="bad">{err}</Alert>}
      {step < 3 && (
        <Button variant="quiet" onClick={onBack} block>
          Back
        </Button>
      )}
      <div className="footer-note">
        <Icon name="info" size={14} /> {info ? info.name : "Independent recovery partner"} · separate service, own key
      </div>
    </div>
  )
}
