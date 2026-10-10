import { useState } from "react"
import type { Hex } from "viem"
import type { Wallet } from "../lib/wallet"
import { Button } from "../ui"

/**
 * Shown exactly once, right after creation. The backup key is the client's half of
 * the recovery pair. It is generated on the device and never sent anywhere.
 */
export function BackupKit({ wallet, backupPrivateKey, onDone }: { wallet: Wallet; backupPrivateKey: Hex; onDone: () => void }) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  const kit = [
    "SWISSQUOTE VAULT — BACKUP KIT",
    "Keep this offline. Anyone with this key AND access to your Swissquote account can recover your Vault.",
    "",
    `Vault address : ${wallet.session.address}`,
    `Backup key    : ${backupPrivateKey}`,
    `Created       : ${new Date().toISOString()}`,
    "",
    "To recover on a new phone: sign in to Swissquote, choose 'I lost my phone', enter this backup key.",
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

  return (
    <div className="screen">
      <div>
        <h1>Save your backup kit</h1>
        <p>
          If you lose this phone, your backup key plus your Swissquote login restore access. Neither works alone.
        </p>
      </div>
      <div className="kit">
        <h2>Backup key</h2>
        <p>Shown once. Print it or store it in a password manager.</p>
        <div className="mono" style={{ marginTop: 10 }}>
          {backupPrivateKey}
        </div>
      </div>
      <div className="row">
        <Button variant="ghost" onClick={download}>
          Download kit
        </Button>
        <Button variant="ghost" onClick={copy}>
          {copied ? "Copied" : "Copy key"}
        </Button>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I’ve stored my backup key somewhere Swissquote can’t see and I can’t lose.</span>
      </label>
      <Button variant="primary" disabled={!saved} onClick={onDone} block>
        Open my Vault
      </Button>
      <div className="footer-note">
        Production: the kit is a printed sheet or a second passkey on another device; the demo shows the raw key.
      </div>
    </div>
  )
}
