import { useEffect, useState } from "react"
import type { Address } from "viem"
import { Unreachable, bank, type BankSession } from "./lib/bank"
import { partner } from "./lib/partner"
import {
  createWallet,
  loadSession,
  loginWallet,
  resumeWallet,
  type Wallet,
  type WalletSession,
} from "./lib/wallet"
import { Alert, Button, Field, Icon, errorMessage, uniquePasskeyName } from "./ui"
import { Dashboard } from "./screens/Dashboard"
import { Recover } from "./screens/Recover"
import { BackupKit } from "./screens/BackupKit"
import { PartnerRecover } from "./screens/PartnerRecover"

type Screen =
  | { name: "boot" }
  | { name: "bank-login" }
  | { name: "onboard"; existing: { walletAddress: Address; passkeyName: string } | null }
  | { name: "backup-kit"; backupPrivateKey: `0x${string}` }
  | { name: "home"; offline?: boolean }
  | { name: "recover"; existing: { walletAddress: Address; passkeyName: string } }
  | { name: "swissquote-down" }
  | { name: "partner-recover"; knownAddress?: Address }

/** Stand-in session when Swissquote can't be reached: the Vault keeps working without it. */
const OFFLINE_SESSION: BankSession = { clientId: "offline", name: "Swissquote unreachable", token: "" }

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
        if (cancelled) return
        if (e instanceof Unreachable) setScreen({ name: "swissquote-down" })
        else setError(errorMessage(e))
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
    <div className="stage">
      <StageAside />
      <div className="phone">
      <header className="topbar">
        <div className="brand">
          <span className="mark" />
          <div>
            <div className="word">Vault</div>
            <span className="by">Self-custody · prototype for Swissquote</span>
          </div>
        </div>
        {bankSession && (
          <button className="who" onClick={signOut} title="Sign out">
            <span className="avatar">{bankSession.clientId.slice(0, 1)}</span>
            {bankSession.clientId}
            <Icon name="logout" size={15} />
          </button>
        )}
      </header>

      {error && (
        <div className="screen">
          <Alert kind="bad">
            <b>Can’t reach the Swissquote service.</b>
            <span>{error}</span>
            <span>Is the mock backend running? Start it with <code>npm run dev</code>.</span>
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
        <div className="screen center" style={{ alignItems: "center" }}>
          <span className="spinner" style={{ borderColor: "var(--line)", borderTopColor: "var(--ink)", width: 24, height: 24 }} />
          <p className="muted">Opening your Vault…</p>
        </div>
      )}

      {!error && screen.name === "bank-login" && (
        <BankLogin
          onLoggedIn={(s) => {
            sessionStorage.setItem(BANK_SESSION_KEY, JSON.stringify(s))
            setBankSession(s)
          }}
          onUnreachable={() => setScreen({ name: "swissquote-down" })}
        />
      )}

      {!error && screen.name === "swissquote-down" && (
        <SwissquoteDown
          hasLocalVault={!!loadSession()}
          onOpen={async () => {
            const local = loadSession()
            if (!local) return
            setWallet(await resumeWallet(local))
            setScreen({ name: "home", offline: true })
          }}
          onPartnerRecover={() => setScreen({ name: "partner-recover", knownAddress: loadSession()?.address })}
          onRetry={() => {
            setScreen({ name: "boot" })
            setBankSession((s) => (s ? { ...s } : null))
            if (!bankSession) setScreen({ name: "bank-login" })
          }}
        />
      )}

      {!error && screen.name === "partner-recover" && (
        <PartnerRecover
          knownAddress={screen.knownAddress}
          onRecovered={async (session: WalletSession) => {
            setWallet(await resumeWallet(session))
            setScreen({ name: "home", offline: true })
          }}
          onBack={() => setScreen({ name: "swissquote-down" })}
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

      {!error && screen.name === "home" && wallet && (bankSession || screen.offline) && (
        <Dashboard
          wallet={wallet}
          bankSession={screen.offline ? OFFLINE_SESSION : bankSession!}
          offline={screen.offline}
          onSwissquoteDown={() => setScreen({ name: "swissquote-down" })}
          onLostDevice={() => {
            // Simulates losing the phone: this device forgets the wallet session.
            // (The passkey itself still exists in the OS; use a private window for a true "new device".)
            localStorage.removeItem("swissquote-vault:session")
            setWallet(null)
            if (screen.offline) {
              setScreen({ name: "partner-recover", knownAddress: wallet.session.address })
              return
            }
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
    </div>
  )
}

/** Laptop-only side panel: explains the screen to whoever is watching the demo. */
export function StageAside() {
  return (
    <aside className="aside">
      <div className="mark-lg">
        <span className="mark" /> Swissquote Vault
      </div>
      <h2>Their keys. Their control. One tap from their bank.</h2>
      <p>A self-custody wallet Swissquote could launch: the client's Face ID is the key, Swissquote can only help recover a lost phone.</p>
      <div className="legend">
        <div className="legend-row">
          <span className="ico dark"><Icon name="phone" /></span>
          <div><b>Passkey on the phone</b>Full control. Signs every transfer. Never leaves the secure chip.</div>
        </div>
        <div className="legend-row">
          <span className="ico"><Icon name="key" /></span>
          <div><b>Client backup key</b>Recovery only. Held offline; Swissquote never sees it.</div>
        </div>
        <div className="legend-row">
          <span className="ico"><Icon name="bank" /></span>
          <div><b>Swissquote guardian</b>Recovery only, with the backup key, after an identity check and a waiting period the client can veto.</div>
        </div>
        <div className="legend-row">
          <span className="ico"><Icon name="partner" /></span>
          <div><b>Independent partner</b>The way back in if Swissquote is ever gone. Swissquote + partner can never act without the client.</div>
        </div>
      </div>
      <div className="realmock">
        <div><b>Real, on Base Sepolia</b>Passkeys · smart account · recovery rules · gasless transactions · simulation</div>
        <div><b><span className="mock-tag">MOCK</span> labelled in the app</b>Bank login & 2FA · guardian HSMs · partner’s ID check · sanctions & dApp lists</div>
      </div>
      <div className="meta">
        <span className="pill dot ok">Live on Base Sepolia</span>
        <span className="pill">Gas paid by Swissquote</span>
        <span className="pill">ERC-4337 · passkeys</span>
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------

export function BankLogin({ onLoggedIn, onUnreachable }: { onLoggedIn: (s: BankSession) => void; onUnreachable?: () => void }) {
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
      if (e instanceof Unreachable && onUnreachable) return onUnreachable()
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
      <div className="title">
        <span className="ico lg dark"><Icon name="bank" size={26} /></span>
        <h1>Sign in to Swissquote</h1>
        <p>Your Vault is linked to your bank account. Sign in the way you already do.</p>
      </div>
      <Field label="Client number" value={clientId} onChange={setClientId} autoFocus />
      <Field label="Password" value={password} onChange={setPassword} type="password" />
      <Field label="Security code" value={otp} onChange={setOtp} inputMode="numeric" />
      <div className="demo-note">
        <Icon name="info" size={16} />
        <span>
          <span className="mock-tag">MOCK</span> Demo bank: any client number, password <code>demo</code>, code <code>000000</code>
        </span>
      </div>
      {err && <Alert kind="bad">{err}</Alert>}
      <Button type="submit" variant="primary" busy={busy} block>
        Sign in
      </Button>
      {onUnreachable && (
        <button type="button" className="link-btn" onClick={onUnreachable}>
          Swissquote unreachable? Your Vault still works
        </button>
      )}
      <div className="footer-note">
        <Icon name="lock" size={14} /> Identity and 2FA are simulated in this prototype
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------

export function Onboard({
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
  onRecover: (e: { walletAddress: Address; passkeyName: string }) => void
}) {
  const [busy, setBusy] = useState<"create" | "login" | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const defaultName = uniquePasskeyName(bankSession.clientId)
  const [passkeyName, setPasskeyName] = useState(defaultName)

  async function create() {
    setBusy("create")
    setErr(null)
    try {
      // The independent recovery partner: a separate service with its own key (see docs/custody-model.md).
      const partnerInfo = await partner.guardian().catch(() => {
        throw new Error("The independent recovery partner isn’t reachable. Start all services with npm run dev.")
      })
      const { wallet, backupPrivateKey } = await createWallet(passkeyName.trim(), guardian, partnerInfo.address)
      await bank.registerWallet(bankSession.token, {
        walletAddress: wallet.session.address,
        backupAddress: wallet.session.backupAddress,
        partnerAddress: partnerInfo.address,
        passkeyName: wallet.session.passkeyName,
      })
      await partner.register(wallet.session.address, bankSession.clientId, {
        backupAddress: wallet.session.backupAddress,
        swissquoteAddress: guardian,
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
      // Carry the recovery addresses the bank has on file (public addresses only).
      const onFile = await bank.getWallet(bankSession.token)
      const w = await loginWallet(existing.passkeyName, guardian, existing.walletAddress, {
        backupAddress: onFile?.backupAddress,
        partnerAddress: onFile?.partnerAddress ?? undefined,
      })
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
    onRecover({ walletAddress: onFile.walletAddress, passkeyName: onFile.passkeyName })
  }

  if (existing) {
    return (
      <div className="screen">
        <div className="title">
          <span className="ico lg"><Icon name="faceid" size={28} /></span>
          <h1>Welcome back</h1>
          <p>Swissquote has a Vault on file for you, but this device isn’t set up yet.</p>
        </div>
        <div className="card flat">
          <span className="section-label">Your Vault</span>
          <span className="mono">{existing.walletAddress}</span>
        </div>
        {err && <Alert kind="bad">{err}</Alert>}
        <Button variant="primary" icon="faceid" busy={busy === "login"} onClick={login} block>
          Unlock with passkey
        </Button>
        <p className="hint center-text">
          Works if this device, or your iCloud / Google passkeys, still has “{existing.passkeyName}”.
        </p>
        <hr className="divider" />
        <Button variant="ghost" icon="recover" onClick={recover} block>
          I lost my phone — recover access
        </Button>
        <div className="footer-note">
          <Icon name="shield" size={14} /> Recovery needs your backup key and a waiting period
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="title">
        <span className="ico lg dark"><Icon name="faceid" size={28} /></span>
        <h1>Create your Vault</h1>
        <p>A crypto wallet only you control, one tap from your Swissquote account. No seed phrase: your Face ID is the key.</p>
      </div>
      <div className="feature-list">
        <div className="feature">
          <span className="ico"><Icon name="phone" /></span>
          <div><b>Your passkey is the key</b><span>Created in this phone’s secure chip. It never leaves it.</span></div>
        </div>
        <div className="feature">
          <span className="ico"><Icon name="key" /></span>
          <div><b>A backup only you hold</b><span>Lose the phone? Backup key + Swissquote login restore access — even if Swissquote is ever gone.</span></div>
        </div>
        <div className="feature">
          <span className="ico"><Icon name="fuel" /></span>
          <div><b>No gas tokens needed</b><span>Swissquote pays the network fees.</span></div>
        </div>
      </div>
      <details className="adv">
        <summary>Passkey name: {passkeyName} · change</summary>
        <Field label="Passkey name" value={passkeyName} onChange={setPasskeyName} hint="How this passkey shows up in your device’s passkey manager." />
      </details>
      {err && <Alert kind="bad">{err}</Alert>}
      <div className="bottom">
        <Button variant="primary" icon="faceid" busy={busy === "create"} onClick={create} block>
          Create with passkey
        </Button>
        <div className="footer-note">
          <Icon name="lock" size={14} /> Swissquote never sees your passkey or your backup key
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

/** Shown when Swissquote can't be reached. Self-custody means the Vault doesn't depend on it. */
export function SwissquoteDown({
  hasLocalVault,
  onOpen,
  onPartnerRecover,
  onRetry,
}: {
  hasLocalVault: boolean
  onOpen: () => Promise<void>
  onPartnerRecover: () => void
  onRetry: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="screen">
      <div className="title">
        <span className="ico lg" style={{ background: "var(--warn-bg)", color: "var(--warn)" }}>
          <Icon name="power" size={26} />
        </span>
        <h1>Swissquote is unreachable</h1>
        <p>Your Vault doesn’t depend on it. Your funds sit in your own account on the blockchain, and your passkey still signs.</p>
      </div>
      {hasLocalVault && (
        <Button
          variant="primary"
          icon="faceid"
          busy={busy}
          block
          onClick={async () => {
            setBusy(true)
            setErr(null)
            try {
              await onOpen()
            } catch (e) {
              setErr(errorMessage(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          Open my Vault without Swissquote
        </Button>
      )}
      <Button variant={hasLocalVault ? "ghost" : "primary"} icon="partner" onClick={onPartnerRecover} block>
        Lost your phone? Recover with the partner
      </Button>
      {err && <Alert kind="bad">{err}</Alert>}
      <div className="checks">
        <div className="c">
          <span className="pass"><Icon name="check" size={18} stroke={2.2} /></span>
          <span>Sign and send<span className="d">Your passkey works with any ERC-4337 bundler; no Swissquote server is involved.</span></span>
        </div>
        <div className="c">
          <span className="pass"><Icon name="check" size={18} stroke={2.2} /></span>
          <span>Recover a lost phone<span className="d">Backup key + the independent partner reach the on-chain threshold.</span></span>
        </div>
        <div className="c">
          <span className="have"><Icon name="alert" size={18} /></span>
          <span>What you lose<span className="d">Swissquote’s screening, limits and dApp list; in production also the gas sponsorship (the Vault then pays its own fees).</span></span>
        </div>
      </div>
      <Button variant="quiet" onClick={onRetry} block>
        Try Swissquote again
      </Button>
    </div>
  )
}
