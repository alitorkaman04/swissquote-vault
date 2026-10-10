/**
 * Pre-signature compliance checks (pure logic, unit-tested).
 *
 * Production would call a screening provider (Chainalysis / Elliptic) against OFAC + SECO
 * lists and read the client's real 24h volume. The decision rules below are what matter.
 */
import { type Address, isAddress } from "viem"

export type Decision = "allow" | "review" | "block"

export type ScreeningResult = {
  decision: Decision
  reasons: string[]
  checks: { name: string; passed: boolean; detail: string }[]
}

export type CompliancePolicy = {
  sanctioned: readonly Address[]
  dailyLimitUsdc: number
  highValueUsdc: number
}

export const DEFAULT_POLICY: CompliancePolicy = {
  // Demo "sanctioned" counterparty - use it in the pitch.
  sanctioned: ["0x000000000000000000000000000000000000bad1"],
  dailyLimitUsdc: 25_000,
  highValueUsdc: Number(process.env.VITE_HIGH_VALUE_THRESHOLD_USDC ?? 1000),
}

export function screenTransfer(
  { from, to, amountUsdc }: { from: string; to: string; amountUsdc: string | number },
  policy: CompliancePolicy = DEFAULT_POLICY,
): ScreeningResult {
  const amount = Number(amountUsdc ?? 0)
  const toLower = String(to ?? "").toLowerCase()
  const sanctions = !policy.sanctioned.map((a) => a.toLowerCase()).includes(toLower)
  const format = isAddress(String(to)) && toLower !== String(from ?? "").toLowerCase()
  const limit = Number.isFinite(amount) && amount > 0 && amount <= policy.dailyLimitUsdc
  const highValue = amount <= policy.highValueUsdc

  const checks = [
    { name: "Sanctions screening (OFAC / SECO lists)", passed: sanctions, detail: "Counterparty address checked against sanctions lists" },
    { name: "Address format", passed: format, detail: "Valid address, not self-transfer" },
    { name: `Daily limit (${policy.dailyLimitUsdc.toLocaleString("en-US")} USDC)`, passed: limit, detail: "Cumulative 24h outgoing volume" },
    {
      name: `High-value check (> ${policy.highValueUsdc.toLocaleString("en-US")} USDC)`,
      passed: highValue,
      detail: highValue ? "Below threshold" : "Requires e-banking confirmation (step-up authentication)",
    },
  ]

  let decision: Decision = "allow"
  const reasons: string[] = []
  if (!sanctions) {
    decision = "block"
    reasons.push("Counterparty appears on a sanctions list")
  }
  if (!format) {
    decision = "block"
    reasons.push("Invalid counterparty")
  }
  if (!limit) {
    decision = "block"
    reasons.push(amount > policy.dailyLimitUsdc ? "Exceeds daily limit" : "Invalid amount")
  }
  if (decision === "allow" && !highValue) {
    decision = "review"
    reasons.push("High-value transfer: confirm in e-banking before signing")
  }
  return { decision, reasons, checks }
}
