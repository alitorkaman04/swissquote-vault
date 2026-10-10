import { useCallback, useEffect, useState } from "react"
import type { Address } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { bank, type BankSession, type Deposit, type SwissquoteAccount, type Withdrawal } from "../lib/bank"
import { EXPLORER_TX } from "../lib/config"
import { sendUsdc, signMessageWithPasskey, type Wallet } from "../lib/wallet"
import type { Activity } from "../lib/activity"
import { Alert, Button, Field, Icon, errorMessage, formatAmount, formatGas, short } from "../ui"

/**
 * Move USDC between the Vault and the client's Swissquote account, both ways.
 *  - To Swissquote: a real transfer signed with the passkey; Swissquote reads it on-chain and credits it
 *    only if it came from the client's own Vault with proven ownership.
 *  - To the Vault: Swissquote sends real USDC from its treasury, but only to the client's own verified
 *    Vault (FINMA Guidance 02/2019: a bank may only send to or receive from a verified own wallet).
 * The transfer is real (gasless, signed with the passkey). Swissquote reads it on-chain and applies
 * the Travel Rule check automatically: credited only if it came from the client's own Vault with
 * proven ownership (FINMA Guidance 02/2019); anything else is held for review.
 */
export function MoveToSwissquote({
  wallet,
  bankSession,
  vaultBalance,
  onMoved,
  preview,
}: {
  wallet: Wallet
  bankSession: BankSession
  vaultBalance?: string
  onMoved: (a: Activity) => void
  /** Design preview only: show a finished state without network calls. */
  preview?: { account: SwissquoteAccount; result?: Deposit; withdrawal?: Withdrawal }
}) {
  const [dir, setDir] = useState<"in" | "out">(preview?.withdrawal ? "out" : "in")
  const [sent, setSent] = useState<Withdrawal | null>(preview?.withdrawal ?? null)
  const [refusal, setRefusal] = useState<{ to: Address; reason: string } | null>(null)
  const [account, setAccount] = useState<SwissquoteAccount | null>(preview?.account ?? null)
  const [amount, setAmount] = useState("1")
  const [busy, setBusy] = useState<"proof" | "move" | "demo" | null>(null)
  const [result, setResult] = useState<Deposit | null>(preview?.result ?? null)
  const [demo, setDemo] = useState<{ from: Address; reason: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (preview) return
    try {
      setAccount(await bank.account(bankSession.token))
    } catch (e) {
      setErr(errorMessage(e))
    }
  }, [bankSession.token, preview])
  useEffect(() => {
    load()
  }, [load])

  const ownVault = !!account?.walletAddress && account.walletAddress.toLowerCase() === wallet.session.address.toLowerCase()
  const verified = ownVault && !!account?.ownershipVerifiedAt

  async function proveOwnership() {
    setBusy("proof")
    setErr(null)
    try {
      const { nonce, message } = await bank.ownershipChallenge(bankSession.token)
      const signature = await signMessageWithPasskey(wallet, message)
      const res = await bank.ownershipVerify(bankSession.token, nonce, signature)
      if (!res.verified) throw new Error("The signature did not verify.")
      onMoved({ at: Date.now(), label: "Proved wallet ownership to Swissquote (verified on-chain)", txHash: "" })
      await load()
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function move() {
    if (!account) return
    setErr(null)
    setResult(null)
    if (!(Number(amount) > 0)) return setErr("Enter an amount.")
    if (vaultBalance !== undefined && Number(amount) > Number(vaultBalance)) return setErr("That’s more than your Vault holds.")
    setBusy("move")
    try {
      const { txHash, gasCostWei } = await sendUsdc(wallet, account.depositAddress, amount)
      const deposit = await bank.claimDeposit(bankSession.token, txHash)
      setResult(deposit)
      onMoved({
        at: Date.now(),
        label: deposit.status === "credited" ? "Moved to your Swissquote account" : "Sent to Swissquote (held for review)",
        txHash,
        amount: `−${amount} USDC`,
        gas: formatGas(gasCostWei),
      })
      await load()
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function withdraw() {
    if (!account) return
    setErr(null)
    setSent(null)
    if (!(Number(amount) > 0)) return setErr("Enter an amount.")
    setBusy("move")
    try {
      const w = await bank.withdraw(bankSession.token, amount)
      setSent(w)
      onMoved({ at: Date.now(), label: "Received from your Swissquote account", txHash: w.txHash, amount: `+${amount} USDC` })
      await load()
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function tryForeignDestination() {
    setBusy("demo")
    setErr(null)
    try {
      const to = privateKeyToAccount(generatePrivateKey()).address
      const d = await bank.checkWithdrawal(bankSession.token, to)
      setRefusal({ to, reason: d.ok ? "Allowed (unexpected)." : (d.reason ?? "Refused.") })
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function tryForeignWallet() {
    setBusy("demo")
    setErr(null)
    try {
      const from = privateKeyToAccount(generatePrivateKey()).address
      const d = await bank.checkSender(bankSession.token, from)
      setDemo({ from, reason: `${d.reason} ${d.nextStep ?? ""}`.trim() })
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>{dir === "in" ? "Move to Swissquote" : "Move to my Vault"}</h2>
          <span className="pill"><Icon name="bank" size={13} /> {bankSession.clientId}</span>
        </div>
        <div className="sq-account">
          <span className="section-label">
            Your Swissquote account <span className="mock-tag">MOCK LEDGER</span>
          </span>
          <div className="amt">
            {account ? formatAmount(account.balanceUsdc) : "—"}
            <small>USDC</small>
          </div>
        </div>

        <div className="seg" role="tablist" aria-label="Direction">
          <button role="tab" aria-selected={dir === "in"} className={dir === "in" ? "on" : ""} onClick={() => { setDir("in"); setErr(null) }}>
            Vault → Swissquote
          </button>
          <button role="tab" aria-selected={dir === "out"} className={dir === "out" ? "on" : ""} onClick={() => { setDir("out"); setErr(null) }}>
            Swissquote → Vault
          </button>
        </div>

        <div className="checks" aria-label="Travel Rule check">
          <span className="sub-head">Automatic Travel Rule check</span>
          <div className="c">
            <span className={ownVault ? "pass" : "fail"}><Icon name={ownVault ? "check" : "x"} size={18} stroke={2.2} /></span>
            <span>
              {dir === "in" ? "Sender is your own Vault" : "Destination is your own Vault"}
              <span className="d">Created in your KYC’d Swissquote session and linked to your client record.</span>
            </span>
          </div>
          <div className="c">
            <span className={verified ? "pass" : "fail"}><Icon name={verified ? "check" : "x"} size={18} stroke={2.2} /></span>
            <span>
              Ownership proven with your passkey
              <span className="d">
                {verified
                  ? `Signed challenge verified on-chain, ${new Date(account!.ownershipVerifiedAt!).toLocaleTimeString()}.`
                  : "One Face ID: you sign Swissquote’s challenge, the bank verifies it on-chain."}
              </span>
            </span>
          </div>
        </div>

        {!verified && ownVault && (
          <Button variant="ghost" icon="faceid" busy={busy === "proof"} onClick={proveOwnership} block>
            Prove ownership with Face ID
          </Button>
        )}

        <Field
          label="Amount"
          value={amount}
          onChange={setAmount}
          inputMode="decimal"
          suffix="USDC"
          big
          hint={
            dir === "in"
              ? vaultBalance !== undefined
                ? `In your Vault: ${formatAmount(vaultBalance)} USDC`
                : undefined
              : account?.treasuryUsdc != null
                ? `Testnet: Swissquote’s treasury holds ${formatAmount(account.treasuryUsdc)} real test USDC`
                : undefined
          }
        />
        {dir === "in" ? (
          <>
            <Button variant="primary" icon="faceid" busy={busy === "move"} disabled={!verified || !account} onClick={move} block>
              Move with Face ID
            </Button>
            <p className="hint center-text">A real, gasless transfer to Swissquote’s deposit address. Swissquote credits it after the check.</p>
            <div className="chips">
              <button type="button" className="chip demo" onClick={tryForeignWallet} disabled={!!busy}>
                <Icon name="ban" size={14} /> Demo: deposit from a wallet that isn’t yours
              </button>
            </div>
          </>
        ) : (
          <>
            <Button variant="primary" icon="bank" busy={busy === "move"} disabled={!verified || !account} onClick={withdraw} block>
              Send to my Vault
            </Button>
            <p className="hint center-text">Swissquote sends real USDC on-chain, only to your verified Vault. Gas paid by Swissquote.</p>
            <div className="chips">
              <button type="button" className="chip demo" onClick={tryForeignDestination} disabled={!!busy}>
                <Icon name="ban" size={14} /> Demo: send to a wallet that isn’t yours
              </button>
            </div>
          </>
        )}
        {err && <Alert kind="bad">{err}</Alert>}
      </section>

      {dir === "out" && refusal && (
        <Alert kind="bad">
          <b>Refused: nothing was sent</b>
          <span>
            To {short(refusal.to, 6)} (simulated destination): {refusal.reason}
          </span>
        </Alert>
      )}

      {dir === "out" && sent && (
        <section className="card">
          <div className="card-head">
            <h2>Sent to your Vault</h2>
            <span className="pill ok">{formatAmount(sent.amountUsdc)} USDC</span>
          </div>
          <p className="muted">Swissquote checked that the destination is your own Vault, with ownership proven, before sending.</p>
          <div className="list kv tr-record" aria-label="Travel Rule record">
            <span className="section-label">Travel Rule record kept by Swissquote</span>
            <div className="item"><span>Originator</span><span className="right">Your Swissquote account</span></div>
            <div className="item"><span>Beneficiary</span><span className="right">{sent.travelRule.beneficiary}</span></div>
            <div className="item"><span>Beneficiary wallet</span><span className="right mono">{short(sent.to, 6)}</span></div>
            <div className="item"><span>Wallet type</span><span className="right">Self-hosted (Vault)</span></div>
            <div className="item"><span>Ownership</span><span className="right">Verified on-chain (passkey)</span></div>
          </div>
          <a className="btn ghost block" href={EXPLORER_TX(sent.txHash)} target="_blank" rel="noreferrer">
            <Icon name="external" size={18} /> View the transfer on Basescan
          </a>
        </section>
      )}

      {dir === "in" && demo && (
        <Alert kind="warn">
          <b>Held for review</b>
          <span>
            A deposit from {short(demo.from, 6)} (simulated sender): {demo.reason}
          </span>
        </Alert>
      )}

      {dir === "in" && result && (
        <section className="card">
          <div className="card-head">
            <h2>{result.status === "credited" ? "Credited to your account" : "Held for review"}</h2>
            <span className={`pill ${result.status === "credited" ? "ok" : "warn"}`}>
              {formatAmount(result.amountUsdc)} USDC
            </span>
          </div>
          <p className="muted">{result.reason}</p>
          <div className="list kv tr-record" aria-label="Travel Rule record">
            <span className="section-label">Travel Rule record kept by Swissquote</span>
            <div className="item"><span>Originator</span><span className="right">{result.travelRule.originator}</span></div>
            <div className="item"><span>Originator wallet</span><span className="right mono">{short(result.travelRule.originatorWallet, 6)}</span></div>
            <div className="item"><span>Wallet type</span><span className="right">Self-hosted (Vault)</span></div>
            <div className="item"><span>Ownership</span><span className="right">{result.travelRule.ownership.startsWith("Verified") ? "Verified on-chain (passkey)" : "Not verified"}</span></div>
            <div className="item"><span>Beneficiary</span><span className="right">Your Swissquote account</span></div>
          </div>
          <a className="btn ghost block" href={EXPLORER_TX(result.txHash)} target="_blank" rel="noreferrer">
            <Icon name="external" size={18} /> View the transfer on Basescan
          </a>
        </section>
      )}
    </>
  )
}
