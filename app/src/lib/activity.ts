/** Per-wallet activity log kept in localStorage (display only; the chain is the source of truth). */
export type Activity = { at: number; label: string; txHash: string; amount?: string; gas?: string }

export const activityKey = (address: string) => `swissquote-vault:activity:${address.toLowerCase()}`

export function readActivity(address: string): Activity[] {
  try {
    return JSON.parse(localStorage.getItem(activityKey(address)) ?? "[]")
  } catch {
    return []
  }
}

export function appendActivity(address: string, a: Activity) {
  const next = [a, ...readActivity(address)].slice(0, 20)
  try {
    localStorage.setItem(activityKey(address), JSON.stringify(next))
  } catch {
    /* ignore */
  }
  return next
}
