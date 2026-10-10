/**
 * Client for the (mocked) Swissquote backend. See server/ and docs/mocks.md.
 *
 * In production this is Swissquote's existing e-banking identity layer + a small
 * "guardian service" holding one key share per client in an HSM. Here it is a local
 * Node process with a JSON file. The API shape is what matters for the architecture.
 */
import type { Address, Hex } from "viem"
import { BANK_API_URL } from "./config"

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BANK_API_URL}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Swissquote API ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export type BankSession = { clientId: string; name: string; token: string }

export const bank = {
  /** Simulated e-banking login (username + password + 2FA). */
  login: (clientId: string, password: string, otp: string) =>
    api<BankSession>("/auth/login", { method: "POST", body: JSON.stringify({ clientId, password, otp }) }),

  /** Public address of the bank's guardian key for this client. */
  guardian: () => api<{ address: Address }>("/guardian"),

  /** Link a freshly created wallet to the KYC'd client (ownership verification). */
  registerWallet: (token: string, body: { walletAddress: Address; backupAddress: Address; passkeyName: string }) =>
    api<{ ok: true }>("/wallet", { method: "POST", body: JSON.stringify({ token, ...body }) }),

  /** The wallet the bank has on file for this client (needed on a new device). */
  getWallet: (token: string) =>
    api<{ walletAddress: Address; backupAddress: Address; passkeyName: string } | null>(
      `/wallet?token=${encodeURIComponent(token)}`,
    ),

  /** Start a recovery: bank records it, notifies the old device, starts the delay. */
  requestRecovery: (token: string, body: { callData: Hex; newPasskeyName: string }) =>
    api<RecoveryRequest>("/recovery/request", { method: "POST", body: JSON.stringify({ token, ...body }) }),

  getRecovery: (id: string) => api<RecoveryRequest>(`/recovery/${id}`),

  /** Any recovery pending against this wallet (polled by the OLD device to show "Not you?"). */
  pendingForWallet: (walletAddress: Address) =>
    api<RecoveryRequest | null>(`/recovery/pending?walletAddress=${walletAddress}`),

  /** Old device vetoes the recovery (in production: signed by the old passkey). */
  cancelRecovery: (id: string) => api<RecoveryRequest>(`/recovery/${id}/cancel`, { method: "POST" }),

  /** After the delay, the bank co-signs the recovery user operation. */
  signRecovery: (id: string) => api<{ signature: Hex }>(`/recovery/${id}/sign`, { method: "POST" }),

  /** Compliance checks before a transfer (sanctions screening, limits). */
  screen: (body: { from: Address; to: Address; amountUsdc: string }) =>
    api<ScreeningResult>("/compliance/screen", { method: "POST", body: JSON.stringify(body) }),

  /** Approved dApp list. */
  dapps: () => api<ApprovedDapp[]>("/compliance/dapps"),
}

export type RecoveryRequest = {
  id: string
  clientId: string
  walletAddress: Address
  newPasskeyName: string
  callData: Hex
  status: "pending" | "cancelled" | "ready" | "signed"
  createdAt: number
  unlockAt: number
  bankSignature?: Hex
}

export type ScreeningResult = {
  decision: "allow" | "review" | "block"
  reasons: string[]
  checks: { name: string; passed: boolean; detail: string }[]
}

export type ApprovedDapp = {
  id: string
  name: string
  url: string
  category: string
  contracts: Address[]
  note: string
}
