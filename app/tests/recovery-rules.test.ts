import { describe, expect, it } from "vitest"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { concatHex, type Address } from "viem"
import {
  RECOVERY_THRESHOLD,
  WEIGHTED_VALIDATOR_ADDRESS,
  approvalHash,
  canRecover,
  recoverApprovalSigner,
  recoveryConfig,
  type RecoverySetup,
} from "../src/lib/onchainRecovery"

const backup = privateKeyToAccount(generatePrivateKey())
const swissquote = privateKeyToAccount(generatePrivateKey())
const partner = privateKeyToAccount(generatePrivateKey())
const stranger = privateKeyToAccount(generatePrivateKey())

const config = recoveryConfig(swissquote.address, backup.address, partner.address)
const setup: RecoverySetup = {
  threshold: config.threshold,
  signers: config.signers.map((s) => ({ address: s.publicKey as Address, weight: s.weight })),
}

describe("recovery rules (what the validator contract enforces)", () => {
  it("installs backup 60 + Swissquote 40 + partner 40, threshold 100", () => {
    expect(config.threshold).toBe(RECOVERY_THRESHOLD)
    expect(config.signers.map((s) => s.weight)).toEqual([60, 40, 40])
  })
  it("lets the client recover with Swissquote", () => {
    expect(canRecover(setup, [backup.address, swissquote.address])).toBe(true)
  })
  it("lets the client recover WITHOUT Swissquote, through the partner", () => {
    expect(canRecover(setup, [backup.address, partner.address])).toBe(true)
  })
  it("never lets Swissquote and the partner recover without the client", () => {
    expect(canRecover(setup, [swissquote.address, partner.address])).toBe(false)
  })
  it("never lets any single key recover, even counted twice", () => {
    for (const k of [backup, swissquote, partner]) expect(canRecover(setup, [k.address, k.address])).toBe(false)
  })
  it("ignores keys that are not recovery keys (the thief's)", () => {
    expect(canRecover(setup, [stranger.address, swissquote.address, partner.address])).toBe(false)
  })
})

describe("backup approvals (what the guardians verify before co-signing)", () => {
  const wallet = "0xCbF1aac42FB105bc57be2b0b21E5dba1cE6B33b6" as Address
  const callData = "0xe884c286" as const
  const sign = (signer: typeof backup, nonce: bigint) =>
    signer.signTypedData({
      domain: { name: "WeightedValidator", version: "0.0.1", chainId: 84532, verifyingContract: WEIGHTED_VALIDATOR_ADDRESS },
      types: { Approve: [{ name: "callDataAndNonceHash", type: "bytes32" }] },
      primaryType: "Approve",
      message: { callDataAndNonceHash: approvalHash(wallet, callData, nonce) },
    })

  it("recovers the backup key from a genuine approval", async () => {
    const approval = concatHex(["0x00", await sign(backup, 7n)])
    const { signer, index } = await recoverApprovalSigner({ approval, wallet, callData, nonce: 7n, chainId: 84532 })
    expect(index).toBe(0)
    expect(signer).toBe(backup.address)
  })
  it("does not attribute an approval for another recovery (other nonce) to the backup key", async () => {
    const approval = concatHex(["0x00", await sign(backup, 7n)])
    const { signer } = await recoverApprovalSigner({ approval, wallet, callData, nonce: 8n, chainId: 84532 })
    expect(signer).not.toBe(backup.address)
  })
  it("rejects malformed approvals", async () => {
    await expect(recoverApprovalSigner({ approval: "0x1234", wallet, callData, nonce: 0n, chainId: 84532 })).rejects.toThrow()
  })
})
