import type { ReactNode } from "react"

export function Button({
  children,
  onClick,
  variant = "default",
  busy,
  disabled,
  block,
  type = "button",
}: {
  children: ReactNode
  onClick?: () => void
  variant?: "default" | "primary" | "ghost" | "danger"
  busy?: boolean
  disabled?: boolean
  block?: boolean
  type?: "button" | "submit"
}) {
  const cls = ["btn", variant !== "default" ? variant : "", block ? "block" : ""].filter(Boolean).join(" ")
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled || busy}>
      {busy && <span className="spinner" />}
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
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  hint?: string
  autoFocus?: boolean
  textarea?: boolean
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {textarea ? (
        <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
        />
      )}
      {hint && <span className="muted">{hint}</span>}
    </div>
  )
}

export function Alert({ kind, children }: { kind: "ok" | "warn" | "bad" | "info"; children: ReactNode }) {
  return <div className={`alert ${kind}`}>{children}</div>
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

/** A passkey name that is unique per device and moment, e.g. "demo-1010-1207" (month-day-hour-minute). */
export function uniquePasskeyName(clientId: string) {
  const d = new Date()
  const two = (n: number) => String(n).padStart(2, "0")
  return `${clientId}-${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`
}
