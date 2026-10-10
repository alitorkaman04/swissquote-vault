import { describe, expect, it } from "vitest"
import { screenTransfer, type CompliancePolicy } from "../server/compliance"

const policy: CompliancePolicy = {
  sanctioned: ["0x000000000000000000000000000000000000bad1"],
  dailyLimitUsdc: 25_000,
  highValueUsdc: 1_000,
}
const me = "0xCbF1aac42FB105bc57be2b0b21E5dba1cE6B33b6"
const friend = "0x8422b6a2b2c7475ccf318575117A690b18e4b0C6"

describe("pre-signature compliance", () => {
  it("allows an ordinary transfer", () => {
    const r = screenTransfer({ from: me, to: friend, amountUsdc: "5" }, policy)
    expect(r.decision).toBe("allow")
    expect(r.checks.every((c) => c.passed)).toBe(true)
  })

  it("blocks a sanctioned counterparty, case-insensitively", () => {
    const r = screenTransfer({ from: me, to: "0x000000000000000000000000000000000000BAD1", amountUsdc: "1" }, policy)
    expect(r.decision).toBe("block")
    expect(r.reasons).toContain("Counterparty appears on a sanctions list")
  })

  it("blocks invalid addresses and self-transfers", () => {
    expect(screenTransfer({ from: me, to: "hello", amountUsdc: "1" }, policy).decision).toBe("block")
    expect(screenTransfer({ from: me, to: me.toLowerCase(), amountUsdc: "1" }, policy).decision).toBe("block")
  })

  it("blocks above the daily limit and zero/negative amounts", () => {
    expect(screenTransfer({ from: me, to: friend, amountUsdc: "25001" }, policy).decision).toBe("block")
    expect(screenTransfer({ from: me, to: friend, amountUsdc: "0" }, policy).decision).toBe("block")
    expect(screenTransfer({ from: me, to: friend, amountUsdc: "-3" }, policy).decision).toBe("block")
  })

  it("requires step-up (review) above the high-value threshold but under the limit", () => {
    const r = screenTransfer({ from: me, to: friend, amountUsdc: "1500" }, policy)
    expect(r.decision).toBe("review")
    expect(r.checks.find((c) => c.name.startsWith("High-value"))?.passed).toBe(false)
  })

  it("a block always wins over review", () => {
    const r = screenTransfer({ from: me, to: "0x000000000000000000000000000000000000bad1", amountUsdc: "5000" }, policy)
    expect(r.decision).toBe("block")
  })
})
