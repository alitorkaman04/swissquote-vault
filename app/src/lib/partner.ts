/**
 * Client for the (mocked) independent recovery partner - see server/partner.ts.
 * The partner is the client's way back in if Swissquote's services are permanently gone:
 * client backup key (60) + partner (40) reach the threshold; Swissquote + partner (80) never do.
 */
import type { Address, Hex } from "viem"
import { callService } from "./bank"
import { PARTNER_API_URL } from "./config"

const api = <T>(path: string, init?: RequestInit) => callService<T>(PARTNER_API_URL, "The recovery partner", path, init)
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) })

export type PartnerRecovery = {
  id: string
  walletAddress: Address
  newPasskeyName: string
  callData: Hex
  status: "pending" | "cancelled" | "ready" | "signed"
  createdAt: number
  unlockAt: number
  via: "partner"
  vetoedBy?: "passkey"
}

export const partner = {
  guardian: () => api<{ address: Address; name: string; delaySeconds: number }>("/guardian"),

  /** Onboarding: register the Vault, its public recovery addresses and the holder's identity reference. */
  register: (walletAddress: Address, holder: string, keys: { backupAddress: Address; swissquoteAddress: Address }) =>
    api<{ ok: true }>("/register", post({ walletAddress, holder, ...keys })),

  /** The public recovery addresses registered for a Vault (needed when Swissquote is gone). */
  vault: (walletAddress: Address) => api<{ backupAddress: Address; swissquoteAddress: Address }>(`/vault/${walletAddress}`),

  /** Ask for recovery: identity + the client's backup approval, verified by the partner against the chain. */
  requestRecovery: (body: { walletAddress: Address; holder: string; callData: Hex; newPasskeyName: string; backupApproval: Hex }) =>
    api<PartnerRecovery & { token: string }>("/recovery/request", post(body)),

  getRecovery: (id: string) => api<PartnerRecovery>(`/recovery/${id}`),
  pendingForWallet: (walletAddress: Address) => api<PartnerRecovery | null>(`/recovery/pending?walletAddress=${walletAddress}`),
  cancelRecovery: (id: string, message: string, signature: Hex) => api<PartnerRecovery>(`/recovery/${id}/cancel`, post({ message, signature })),
  signRecovery: (id: string, token: string) => api<{ signature: Hex }>(`/recovery/${id}/sign`, post({ token })),
}
