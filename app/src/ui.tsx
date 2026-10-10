import { useState, type ReactNode } from "react"

// ---------------------------------------------------------------------------
// Icons: one small stroke set, 24px grid, currentColor
// ---------------------------------------------------------------------------

const PATHS: Record<string, ReactNode> = {
  send: <path d="M7 17 17 7M9 7h8v8" />,
  receive: <path d="M17 7 7 17M15 17H7V9" />,
  apps: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="2" />
      <rect x="13" y="4" width="7" height="7" rx="2" />
      <rect x="4" y="13" width="7" height="7" rx="2" />
      <rect x="13" y="13" width="7" height="7" rx="2" />
    </>
  ),
  shield: <path d="M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6l-7-3Z" />,
  shieldCheck: (
    <>
      <path d="M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8M16 7l2 2M14 9l1.5 1.5" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2.5" />
      <path d="M11 18h2" />
    </>
  ),
  bank: <path d="M4 10 12 5l8 5M5 10v8M9 10v8M15 10v8M19 10v8M3.5 20h17" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 2" />
    </>
  ),
  external: <path d="M14 5h5v5M19 5l-8 8M17 14v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4" />,
  alert: (
    <>
      <path d="M12 4 3 19h18L12 4Z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  recover: (
    <>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v4h4" />
    </>
  ),
  paste: (
    <>
      <rect x="6" y="5" width="12" height="15" rx="2.5" />
      <path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
    </>
  ),
  logout: <path d="M14 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2M10 12h10M17 9l3 3-3 3" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  faceid: (
    <>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9.5 15.5c1.4 1 3.6 1 5 0" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6 6 12 12" />
    </>
  ),
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
  fuel: (
    <>
      <path d="M5 20V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14M4 20h12M8 9h4" />
      <path d="M15 10h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3" />
    </>
  ),
}

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 20, stroke = 1.8 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export function Button({
  children,
  onClick,
  variant = "default",
  busy,
  disabled,
  block,
  small,
  icon,
  type = "button",
}: {
  children: ReactNode
  onClick?: () => void
  variant?: "default" | "primary" | "ghost" | "danger" | "quiet"
  busy?: boolean
  disabled?: boolean
  block?: boolean
  small?: boolean
  icon?: IconName
  type?: "button" | "submit"
}) {
  const cls = ["btn", variant !== "default" ? variant : "", block ? "block" : "", small ? "sm" : ""].filter(Boolean).join(" ")
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled || busy}>
      {busy ? <span className="spinner" /> : icon ? <Icon name={icon} size={small ? 16 : 18} /> : null}
      {children}
    </button>
  )
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
  autoFocus,
  textarea,
  suffix,
  big,
  action,
  mono,
  inputMode,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  hint?: ReactNode
  autoFocus?: boolean
  textarea?: boolean
  suffix?: ReactNode
  big?: boolean
  action?: ReactNode
  mono?: boolean
  inputMode?: "text" | "decimal" | "numeric"
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className={`input${big ? " big" : ""}`}>
        {textarea ? (
          <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} />
        ) : (
          <input
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoFocus={autoFocus}
            autoComplete="off"
            spellCheck={false}
            inputMode={inputMode}
            style={mono ? { fontFamily: "var(--mono)", fontSize: 14 } : undefined}
          />
        )}
        {suffix && <span className="suffix">{suffix}</span>}
        {action}
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

const ALERT_ICON: Record<"ok" | "warn" | "bad" | "info", IconName> = { ok: "check", warn: "alert", bad: "ban", info: "info" }

export function Alert({ kind, children }: { kind: "ok" | "warn" | "bad" | "info"; children: ReactNode }) {
  return (
    <div className={`alert ${kind}`} role={kind === "bad" ? "alert" : "status"}>
      <Icon name={ALERT_ICON[kind]} size={18} stroke={2} />
      <div className="body">{children}</div>
    </div>
  )
}

/** Copy-to-clipboard button that confirms with a check. */
export function CopyButton({ text, label = "Copy", small = true }: { text: string; label?: string; small?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      small={small}
      icon={copied ? "check" : "copy"}
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }
    >
      {copied ? "Copied" : label}
    </Button>
  )
}

/** An address split into groups of four for reading aloud / checking. */
export function AddressGroups({ address }: { address: string }) {
  const body = address.slice(2).match(/.{1,4}/g) ?? []
  return (
    <div className="addr-groups">
      <span>0x</span>{" "}
      {body.map((g, i) => (
        <span key={i}>{g} </span>
      ))}
    </div>
  )
}

/** "just now", "3 min ago", "2 h ago", else a date. */
export function relativeTime(at: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

export function formatAmount(v: string | number | undefined, digits = 2) {
  if (v === undefined || v === null || v === "") return "—"
  const n = Number(v)
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function short(addr: string, n = 6) {
  return addr ? `${addr.slice(0, n + 2)}…${addr.slice(-4)}` : ""
}

/**
 * Turn an error into one readable line, keeping the parts that say WHICH service failed and WHY.
 * viem errors carry `shortMessage`, `details`, `status` and `url` (on the error or its causes).
 */
export function errorMessage(e: unknown) {
  console.error(e)
  if (!(e instanceof Error)) return String(e)
  const parts: string[] = []
  let cur: unknown = e
  const seen = new Set<string>()
  for (let i = 0; cur && i < 6; i++) {
    const err = cur as { shortMessage?: string; message?: string; details?: string; status?: number; url?: string; cause?: unknown }
    const msg = err.shortMessage ?? err.message?.split("\n")[0]
    if (msg && !seen.has(msg)) {
      seen.add(msg)
      parts.push(msg)
    }
    if (err.status) parts.push(`status ${err.status}`)
    if (err.url) {
      try {
        parts.push(`at ${new URL(err.url).host}`)
      } catch {
        /* ignore */
      }
    }
    if (err.details && !seen.has(err.details)) {
      seen.add(err.details)
      parts.push(err.details)
    }
    cur = err.cause
  }
  return [...new Set(parts)].join(" · ").slice(0, 400)
}

/** A passkey name that is unique per device and moment, e.g. "demo-1010-120733" (month-day-hour-minute-second). */
export function uniquePasskeyName(clientId: string) {
  const d = new Date()
  const two = (n: number) => String(n).padStart(2, "0")
  return `${clientId}-${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`
}

/** "0.0000021 ETH" from wei, trimmed to the first significant digits. */
export function formatGas(wei: bigint | undefined) {
  if (wei === undefined) return ""
  const eth = Number(wei) / 1e18
  if (eth === 0) return "0 ETH"
  const digits = Math.max(2, -Math.floor(Math.log10(eth)) + 1)
  return `${eth.toFixed(Math.min(digits, 10))} ETH`
}
