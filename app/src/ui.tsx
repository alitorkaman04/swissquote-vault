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

export function errorMessage(e: unknown) {
  if (e instanceof Error) {
    // viem errors are very long; keep the first line
    return e.message.split("\n")[0]
  }
  return String(e)
}
