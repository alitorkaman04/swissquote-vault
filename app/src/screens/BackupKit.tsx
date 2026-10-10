import { useState } from "react"
import type { Hex } from "viem"
import { activateWallet, type Wallet } from "../lib/wallet"
import { EXPLORER_TX } from "../lib/config"
import { Alert, Button, Icon, errorMessage, formatGas } from "../ui"
import { appendActivity } from "../lib/activity"

/**
 * Shown exactly once, right after creation. The backup key is the client's half of
 * the recovery pair. It is generated on the device and never sent anywhere.
 */
export function BackupKit({ wallet, backupPrivateKey, onDone }: { wallet: Wallet; backupPrivateKey: Hex; onDone: () => void }) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activating, setActivating] = useState(false)
  const [activation, setActivation] = useState<{ ok: boolean; detail: string; txHash?: string } | null>(null)

  async function activateAndOpen() {
    setActivating(true)
    try {
      const res = await activateWallet(wallet)
      if (res) appendActivity(wallet.session.address, { at: Date.now(), label: "Vault activated: account deployed, recovery installed", txHash: res.txHash, gas: formatGas(res.gasCostWei) })
      setActivation({ ok: true, detail: "Your Vault is live on the network and recoverable from now on.", txHash: res?.txHash })
      setTimeout(onDone, 1800)
    } catch (e) {
      // Not fatal: the account deploys (and recovery installs) with the first transfer instead.
      setActivation({ ok: false, detail: `Activation will happen with your first transfer instead. (${errorMessage(e)})` })
      setTimeout(onDone, 3500)
    } finally {
      setActivating(false)
    }
  }

  const kit = [
    "SWISSQUOTE VAULT — BACKUP KIT",
    "Keep this offline. Anyone with this key AND access to your Swissquote account can recover your Vault.",
    "",
    `Vault address : ${wallet.session.address}`,
    `Backup key    : ${backupPrivateKey}`,
    `Created       : ${new Date().toISOString()}`,
    "",
    "To recover on a new phone: sign in to Swissquote, choose 'I lost my phone', enter this backup key.",
    ...(wallet.session.partnerAddress
      ? [
          "",
          "If Swissquote is ever unreachable or gone: open Vault, choose 'Swissquote unreachable?',",
          "then 'Recover with the partner'. This kit plus the independent recovery partner restore access.",
          `Recovery partner key : ${wallet.session.partnerAddress} (independent of Swissquote)`,
        ]
      : []),
  ].join("\n")

  function download() {
    const blob = new Blob([kit], { type: "text/plain" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "swissquote-vault-backup-kit.txt"
    a.click()
    URL.revokeObjectURL(a.href)
  }
  async function copy() {
    await navigator.clipboard.writeText(backupPrivateKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const groups = backupPrivateKey.slice(2).match(/.{1,4}/g) ?? []

  return (
    <div className="screen">
      <div className="title">
        <span className="ico lg ok"><Icon name="check" size={28} stroke={2.4} /></span>
        <h1>Your Vault is created</h1>
        <p>One last step: save your backup key. If you lose this phone, the backup key plus your Swissquote login restore access. Neither works alone.</p>
      </div>
      <div className="kit">
        <span className="lbl">BACKUP KEY · SHOWN ONCE</span>
        <div className="k">
          0x {groups.join(" ")}
        </div>
        <p>Print it or store it in a password manager. Swissquote never sees it.{wallet.session.partnerAddress ? " With the independent partner, it also brings you back if Swissquote is ever gone." : ""}</p>
      </div>
      <div className="row">
        <Button variant="ghost" icon="external" onClick={download}>
          Download kit
        </Button>
        <Button variant="ghost" icon={copied ? "check" : "copy"} onClick={copy}>
          {copied ? "Copied" : "Copy key"}
        </Button>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I’ve stored my backup key somewhere Swissquote can’t see and I can’t lose.</span>
      </label>
      {activation && (
        <Alert kind={activation.ok ? "ok" : "warn"}>
          <span>{activation.detail}</span>
          {activation.txHash && (
            <a href={EXPLORER_TX(activation.txHash)} target="_blank" rel="noreferrer">View on Basescan</a>
          )}
        </Alert>
      )}
      <Button variant="primary" icon="faceid" disabled={!saved || !!activation} busy={activating} onClick={activateAndOpen} block>
        Activate my Vault
      </Button>
      <p className="hint center-text">One Face ID: deploys your Vault and turns on recovery. Gas paid by Swissquote.</p>
      <div className="footer-note">
        <Icon name="info" size={14} /> Production: a printed kit or a second passkey; the demo shows the raw key
      </div>
    </div>
  )
}
