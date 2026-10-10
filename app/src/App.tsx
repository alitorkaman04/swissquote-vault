import { useEffect, useState } from "react"
import type { Address } from "viem"
import { bank, type BankSession } from "./lib/bank"
import {
  createWallet,
  loadSession,
  loginWallet,
  resumeWallet,
  type Wallet,
  type WalletSession,
} from "./lib/wallet"
import { Alert, Button, Field, errorMessage, uniquePasskeyName } from "./ui"
import { Dashboard } from "./screens/Dashboard"
import { Recover } from "./screens/Recover"
import { BackupKit } from "./screens/BackupKit"

type Screen =
  | { name: "boot" }
  | { name: "bank-login" }
  | { name: "onboard"; existing: { walletAddress: Address; passkeyName: string } | null }
  | { name: "backup-kit"; backupPrivateKey: `0x${string}` }
  | { name: "home" }
  | { name: "recover"; existing: { walletAddress: Address; backupAddress: Address; passkeyName: string } }

const BANK_SESSION_KEY = "swissquote-vault:bank-session"

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "boot" })
  const [bankSession, setBankSession] = useState<BankSession | null>(() => {
    try {
      const raw = sessionStorage.getItem(BANK_SESSION_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [guardian, setGuardian] = useState<Address | null>(null)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Boot: figure out where this device stands.
  useEffect(() => {
    if (!bankSession) {
      setScreen({ name: "bank-login" })
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const [{ address: guardianAddress }, onFile] = await Promise.all([bank.guardian(), bank.getWallet(bankSession.token)])
        if (cancelled) return
        setGuardian(guardianAddress)
        const local = loadSession()
        if (local && onFile && local.address.toLowerCase() === onFile.walletAddress.toLowerCase()) {
          const w = await resumeWallet(local)
          if (cancelled) return
          setWallet(w)
          setScreen({ name: "home" })
        } else if (onFile) {
          setScreen({ name: "onboard", existing: { walletAddress: onFile.walletAddress, passkeyName: onFile.passkeyName } })
        } else {
          setScreen({ name: "onboard", existing: null })
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bankSession])

  function signOut() {
    sessionStorage.removeItem(BANK_SESSION_KEY)
    setBankSession(null)
    setWallet(null)
  }

  return (
    <div className="phone">
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          Vault <small>self-custody · prototype for Swissquote</small>
        </div>
        {bankSession && (
          <button className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={signOut}>
            {bankSession.clientId} · sign out
          </button>
        )}
      </header>

      {error && (
        <div className="screen">
          <Alert kind="bad">
            {error}
            <span className="muted">
              Is the Swissquote mock backend running? Start it with <code>npm run dev</code>.
            </span>
          </Alert>
          <Button
            variant="ghost"
            onClick={() => {
              setError(null)
              setBankSession((s) => (s ? { ...s } : null))
            }}
          >
            Retry
          </Button>
        </div>
      )}

      {!error && screen.name === "boot" && (
        <div className="screen">
          <p className="muted">Loading…</p>
        </div>
      )}

      {!error && screen.name === "bank-login" && (
        <BankLogin
          onLoggedIn={(s) => {
            sessionStorage.setItem(BANK_SESSION_KEY, JSON.stringify(s))
            setBankSession(s)
          }}
        />
      )}

      {!error && screen.name === "onboard" && guardian && bankSession && (
        <Onboard
          bankSession={bankSession}
          guardian={guardian}
          existing={screen.existing}
          onCreated={(w, backupPrivateKey) => {
            setWallet(w)
            setScreen({ name: "backup-kit", backupPrivateKey })
          }}
          onLoggedIn={(w) => {
            setWallet(w)
            setScreen({ name: "home" })
          }}
          onRecover={(existing) => setScreen({ name: "recover", existing })}
        />
      )}

      {!error && screen.name === "backup-kit" && wallet && (
        <BackupKit wallet={wallet} backupPrivateKey={screen.backupPrivateKey} onDone={() => setScreen({ name: "home" })} />
      )}

      {!error && screen.name === "home" && wallet && bankSession && (
        <Dashboard
          wallet={wallet}
          bankSession={bankSession}
          onLostDevice={() => {
            // Simulates losing the phone: this device forgets the wallet session.
            // (The passkey itself still exists in the OS; use a private window for a true "new device".)
            localStorage.removeItem("swissquote-vault:session")
            setWallet(null)
            setScreen({
              name: "onboard",
              existing: { walletAddress: wallet.session.address, passkeyName: wallet.session.passkeyName },
            })
          }}
        />
      )}

      {!error && screen.name === "recover" && bankSession && guardian && (
        <Recover
          bankSession={bankSession}
          guardian={guardian}
          existing={screen.existing}
          onRecovered={async (session: WalletSession) => {
            const w = await resumeWallet(session)
            setWallet(w)
            setScreen({ name: "home" })
          }}
          onBack={() =>
            setScreen({
              name: "onboard",
              existing: { walletAddress: screen.existing.walletAddress, passkeyName: screen.existing.passkeyName },
            })
          }
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function BankLogin({ onLoggedIn }: { onLoggedIn: (s: BankSession) => void }) {
  const [clientId, setClientId] = useState("demo")
  const [password, setPassword] = useState("demo")
  const [otp, setOtp] = useState("000000")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      onLoggedIn(await bank.login(clientId.trim(), password, otp))
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="screen"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div>
        <h1>Sign in to Swissquote</h1>
        <p>Your Vault is linked to your bank account. Sign in the way you already do.</p>
      </div>
      <Field label="Client number" value={clientId} onChange={setClientId} autoFocus />
      <Field label="Password" value={password} onChange={setPassword} type="password" />
      <Field label="Security code (2FA)" value={otp} onChange={setOtp} hint="Demo backend: password “demo”, code “000000”" />
      {err && <Alert kind="bad">{err}</Alert>}
      <Button type="submit" variant="primary" busy={busy} block>
        Sign in
      </Button>
      <div className="footer-note">Identity and 2FA are simulated. See docs/mocks.md.</div>
    </form>
  )
}

// ---------------------------------------------------------------------------

function Onboard({
  bankSession,
  guardian,
  existing,
  onCreated,
  onLoggedIn,
  onRecover,
}: {
  bankSession: BankSession
  guardian: Address
  existing: { walletAddress: Address; passkeyName: string } | null
  onCreated: (w: Wallet, backupPrivateKey: `0x${string}`) => void
  onLoggedIn: (w: Wallet) => void
  onRecover: (e: { walletAddress: Address; backupAddress: Address; passkeyName: string }) => void
}) {
  const [busy, setBusy] = useState<"create" | "login" | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const defaultName = uniquePasskeyName(bankSession.clientId)
  const [passkeyName, setPasskeyName] = useState(defaultName)

  async function create() {
    setBusy("create")
    setErr(null)
    try {
      const { wallet, backupPrivateKey } = await createWallet(passkeyName.trim(), guardian)
      await bank.registerWallet(bankSession.token, {
        walletAddress: wallet.session.address,
        backupAddress: wallet.session.backupAddress,
        passkeyName: wallet.session.passkeyName,
      })
      onCreated(wallet, backupPrivateKey)
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function login() {
    if (!existing) return
    setBusy("login")
    setErr(null)
    try {
      const w = await loginWallet(existing.passkeyName, guardian, existing.walletAddress)
      // Make sure we carry the backup address the bank has on file.
      const onFile = await bank.getWallet(bankSession.token)
      if (onFile) {
        w.session.backupAddress = onFile.backupAddress
        localStorage.setItem("swissquote-vault:session", JSON.stringify(w.session))
      }
      onLoggedIn(w)
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function recover() {
    const onFile = await bank.getWallet(bankSession.token)
    if (!onFile) return
    onRecover({ walletAddress: onFile.walletAddress, backupAddress: onFile.backupAddress, passkeyName: onFile.passkeyName })
  }

  if (existing) {
    return (
      <div className="screen">
        <div>
          <h1>Welcome back</h1>
          <p>Swissquote has a Vault on file for you, but this device isn’t set up yet.</p>
        </div>
        <div className="card flat">
          <span className="muted">Your Vault</span>
          <span className="mono">{existing.walletAddress}</span>
        </div>
        {err && <Alert kind="bad">{err}</Alert>}
        <Button variant="primary" busy={busy === "login"} onClick={login} block>
          Unlock with passkey
        </Button>
        <p className="muted">Works if this device (or your iCloud / Google passkeys) still has the passkey “{existing.passkeyName}”.</p>
        <Button variant="ghost" onClick={recover} block>
          I lost my phone — recover access
        </Button>
        <div className="footer-note">Recovery needs your backup key and a waiting period. Swissquote cannot do it alone.</div>
      </div>
    )
  }

  return (
    <div className="screen">
      <div>
        <h1>Create your Vault</h1>
        <p>
          A crypto wallet only you control, one tap from your Swissquote account. Your key is a passkey: it lives in
          this phone’s secure chip and never leaves it.
        </p>
      </div>
      <div className="steps">
        <div className="step">
          <span className="n">1</span>
          <span>Create a passkey (Face ID / Touch ID)</span>
        </div>
        <div className="step">
          <span className="n">2</span>
          <span>Save your backup kit somewhere safe</span>
        </div>
        <div className="step">
          <span className="n">3</span>
          <span>Start using it — no gas tokens needed</span>
        </div>
      </div>
      <Field label="Passkey name" value={passkeyName} onChange={setPasskeyName} hint="How this passkey shows up in your device's passkey manager." />
      {err && <Alert kind="bad">{err}</Alert>}
      <Button variant="primary" busy={busy === "create"} onClick={create} block>
        Create with passkey
      </Button>
      <div className="footer-note">Swissquote never sees your passkey or your backup key.</div>
    </div>
  )
}
