import { describe, expect, it } from "vitest"
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Log } from "viem"
import { decideDeposit, depositsInLogs, travelRuleRecord } from "../server/deposits"

const VAULT = "0xf47c2936C39953118BFcED58A4852ff29447Cd9a"
const STRANGER = "0x1111111111111111111111111111111111111111"

describe("Travel Rule check on deposits to Swissquote", () => {
  it("credits a deposit from the client's own, ownership-verified Vault", () => {
    const d = decideDeposit({ from: VAULT.toLowerCase(), client: { walletAddress: VAULT, ownershipVerifiedAt: Date.now() } })
    expect(d.status).toBe("credited")
  })
  it("holds a deposit from the client's Vault until ownership is proven", () => {
    const d = decideDeposit({ from: VAULT, client: { walletAddress: VAULT } })
    expect(d.status).toBe("held")
  })
  it("holds a deposit from a wallet that isn't linked to the client", () => {
    const d = decideDeposit({ from: STRANGER, client: { walletAddress: VAULT, ownershipVerifiedAt: Date.now() } })
    expect(d.status).toBe("held")
  })
  it("holds everything when the client has no Vault on file", () => {
    expect(decideDeposit({ from: VAULT, client: {} }).status).toBe("held")
  })
  it("records originator and beneficiary information", () => {
    const r = travelRuleRecord({ clientId: "demo", clientName: "Demo", from: VAULT, amountUsdc: "5", txHash: "0xabc", ownershipVerifiedAt: 0 })
    expect(r.originatorWallet).toBe(VAULT)
    expect(r.walletType).toContain("Self-hosted")
    expect(r.beneficiary).toContain("Swissquote account")
  })
})

describe("reading a deposit from the chain", () => {
  const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
  const DEPOSIT = "0x5628455EcDcE1535532bA28fc6D9e2A5CfCFE112"
  const transferLog = (token: string, from: string, to: string, value: bigint) =>
    ({
      address: token,
      topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: from as `0x${string}`, to: to as `0x${string}` } }),
      data: encodeAbiParameters([{ type: "uint256" }], [value]),
      blockHash: "0x" + "0".repeat(64), blockNumber: 1n, logIndex: 0, transactionHash: "0x" + "1".repeat(64), transactionIndex: 0, removed: false,
    }) as unknown as Log

  it("finds the USDC sent from the Vault to Swissquote's deposit address", () => {
    const found = depositsInLogs([transferLog(USDC, VAULT, DEPOSIT, 5_000_000n)], USDC, DEPOSIT)
    expect(found).toEqual({ from: VAULT, amountUsdc: "5" })
  })
  it("ignores transfers of other tokens or to other addresses", () => {
    const logs = [transferLog(STRANGER, VAULT, DEPOSIT, 5_000_000n), transferLog(USDC, VAULT, STRANGER, 5_000_000n)]
    expect(depositsInLogs(logs, USDC, DEPOSIT)).toBeNull()
  })
})
