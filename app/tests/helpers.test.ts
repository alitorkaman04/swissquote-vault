import { describe, expect, it } from "vitest"
import { errorMessage, short, uniquePasskeyName } from "../src/ui"
import { recoveryConfig } from "../src/lib/wallet"

describe("ui helpers", () => {
  it("shortens addresses", () => {
    expect(short("0xCbF1aac42FB105bc57be2b0b21E5dba1cE6B33b6")).toBe("0xCbF1aa…33b6")
  })
  it("builds unique passkey names from client id and time", () => {
    expect(uniquePasskeyName("demo")).toMatch(/^demo-\d{4}-\d{6}$/)
  })
  it("extracts the useful parts of a nested network error", () => {
    const inner = Object.assign(new Error("HTTP request failed."), { status: 429, url: "https://rpc.example.com/x" })
    const outer = Object.assign(new Error("UserOperation failed\n\nlong viem details…"), { cause: inner, shortMessage: "UserOperation failed" })
    const m = errorMessage(outer)
    expect(m).toContain("UserOperation failed")
    expect(m).toContain("status 429")
    expect(m).toContain("rpc.example.com")
  })
})

describe("recovery validator config", () => {
  it("legacy Vaults (no partner) are a 2-of-2: bank 50 + backup 50, threshold 100", () => {
    const c = recoveryConfig("0x8422b6a2b2c7475ccf318575117A690b18e4b0C6", "0x1111111111111111111111111111111111111111")
    expect(c.threshold).toBe(100)
    expect(c.signers.map((s) => s.weight)).toEqual([50, 50])
    // neither party alone reaches the threshold
    expect(Math.max(...c.signers.map((s) => s.weight))).toBeLessThan(c.threshold)
  })
})

import { formatGas } from "../src/ui"
describe("formatGas", () => {
  it("formats small wei amounts readably", () => {
    expect(formatGas(2_100_000_000_000n)).toBe("0.0000021 ETH")
    expect(formatGas(0n)).toBe("0 ETH")
    expect(formatGas(undefined)).toBe("")
  })
})
