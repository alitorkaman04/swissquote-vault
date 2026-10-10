/**
 * Client for the (mocked) Swissquote backend. See server/ and docs/mocks.md.
 *
 * In production this is Swissquote's existing e-banking identity layer + a small
 * "guardian service" holding one key share per client in an HSM. Here it is a local
 * Node process with a JSON file. The API shape is what matters for the architecture.
 */
import type { Address, Hex } from "viem"
import { BANK_API_URL } from "./config"

/** Thrown when the Swissquote service can't be reached at all (down, offline, or gone for good). */
export class Unreachable extends Error {}

export async function callService<T>(base: string, label: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${base}${path}`, { headers: { "content-type": "application/json" }, ...init })
  } catch {
    throw new Unreachable(`${label} is unreachable.`)
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `${label} error ${res.status}`)
  }
  return res.json() as Promise<T>
}

const api = <T>(path: string, init?: RequestInit) => callService<T>(BANK_API_URL, "Swissquote", path, init)

export type BankSession = { clientId: string; name: string; token: string }

export const bank = {
  /** Simulated e-banking login (username + password + 2FA). */
  login: (clientId: string, password: string, otp: string) =>
    api<BankSession>("/auth/login", { method: "POST", body: JSON.stringify({ clientId, password, otp }) }),

  /** Public address of the bank's guardian key for this client. */
  guardian: () => api<{ address: Address }>("/guardian"),

  /** Link a freshly created wallet to the KYC'd client (ownership verification). */
  registerWallet: (
    token: string,
    body: { walletAddress: Address; backupAddress: Address; partnerAddress?: Address; passkeyName: string },
  ) =>
    api<{ ok: true }>("/wallet", { method: "POST", body: JSON.stringify({ token, ...body }) }),

  /** The wallet the bank has on file for this client (needed on a new device). */
  getWallet: (token: string) =>
    api<{
      walletAddress: Address
      backupAddress: Address
      partnerAddress: Address | null
      passkeyName: string
      recoveredAt: number | null
    } | null>(
      `/wallet?token=${encodeURIComponent(token)}`,
    ),

  /** Start a recovery: bank records it, notifies the old device, starts the delay. */
  requestRecovery: (token: string, body: { callData: Hex; newPasskeyName: string }) =>
    api<RecoveryRequest>("/recovery/request", { method: "POST", body: JSON.stringify({ token, ...body }) }),

  getRecovery: (id: string) => api<RecoveryRequest>(`/recovery/${id}`),

  /** Any recovery pending against this wallet (polled by the OLD device to show "Not you?"). */
  pendingForWallet: (walletAddress: Address) =>
    api<RecoveryRequest | null>(`/recovery/pending?walletAddress=${walletAddress}`),

  /** Old device vetoes the recovery. Strong path: signed by the current passkey; fallback: e-banking session. */
  cancelRecovery: (id: string, body: { token: string; message?: string; signature?: Hex }) =>
    api<RecoveryRequest>(`/recovery/${id}/cancel`, { method: "POST", body: JSON.stringify(body) }),
  cancelMessage: (id: string) => `Cancel Vault recovery ${id}`,

  /** Step-up authentication for high-value transfers (mock 2FA). */
  stepUp: (token: string, otp: string) =>
    api<{ ok: true; until: number }>("/auth/stepup", { method: "POST", body: JSON.stringify({ token, otp }) }),

  /** Wallet ownership proof: bank challenge -> passkey signs (ERC-1271) -> bank verifies on-chain. */
  ownershipChallenge: (token: string) =>
    api<{ nonce: string; message: string }>("/ownership/challenge", { method: "POST", body: JSON.stringify({ token }) }),
  ownershipVerify: (token: string, nonce: string, signature: Hex) =>
    api<{ verified: boolean; walletAddress: Address; verifiedAt: number }>("/ownership/verify", {
      method: "POST",
      body: JSON.stringify({ token, nonce, signature }),
    }),

  /**
   * After the delay, the bank co-signs the recovery user operation - but only after verifying,
   * against the chain, that the client's backup key approved exactly this recovery.
   */
  signRecovery: (id: string, token: string, backupApproval: Hex) =>
    api<{ signature: Hex }>(`/recovery/${id}/sign`, { method: "POST", body: JSON.stringify({ token, backupApproval }) }),

  /** DEMO ONLY (localhost): stops the mock Swissquote process to show the Vault works without it. */
  demoShutdown: () => api<{ ok: true }>("/demo/shutdown", { method: "POST" }),

  /** New device reports the on-chain recovery; the new passkey becomes the one on file. */
  completeRecovery: (id: string, txHash: string) =>
    api<{ ok: true }>(`/recovery/${id}/complete`, { method: "POST", body: JSON.stringify({ txHash }) }),

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
  vetoedBy?: "passkey" | "identity"
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
