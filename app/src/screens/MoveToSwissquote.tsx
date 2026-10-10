import { useCallback, useEffect, useState } from "react"
import type { Address } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { bank, type BankSession, type Deposit, type SwissquoteAccount } from "../lib/bank"
import { EXPLORER_TX } from "../lib/config"
import { sendUsdc, signMessageWithPasskey, type Wallet } from "../lib/wallet"
import type { Activity } from "../lib/activity"
import { Alert, Button, Field, Icon, errorMessage, formatAmount, formatGas, short } from "../ui"

/**
 * Move USDC from the Vault into the client's Swissquote account.
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
  preview?: { account: SwissquoteAccount; result?: Deposit }
}) {
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
          <h2>Move to Swissquote</h2>
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

        <div className="checks" aria-label="Travel Rule check">
          <span className="sub-head">Automatic Travel Rule check</span>
          <div className="c">
            <span className={ownVault ? "pass" : "fail"}><Icon name={ownVault ? "check" : "x"} size={18} stroke={2.2} /></span>
            <span>
              Sender is your own Vault
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
          hint={vaultBalance !== undefined ? `In your Vault: ${formatAmount(vaultBalance)} USDC` : undefined}
        />
        <Button variant="primary" icon="faceid" busy={busy === "move"} disabled={!verified || !account} onClick={move} block>
          Move with Face ID
        </Button>
        <p className="hint center-text">A real, gasless transfer to Swissquote’s deposit address. Swissquote credits it after the check.</p>
        <div className="chips">
          <button type="button" className="chip demo" onClick={tryForeignWallet} disabled={!!busy}>
            <Icon name="ban" size={14} /> Demo: deposit from a wallet that isn’t yours
          </button>
        </div>
        {err && <Alert kind="bad">{err}</Alert>}
      </section>

      {demo && (
        <Alert kind="warn">
          <b>Held for review</b>
          <span>
            A deposit from {short(demo.from, 6)} (simulated sender): {demo.reason}
          </span>
        </Alert>
      )}

      {result && (
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
