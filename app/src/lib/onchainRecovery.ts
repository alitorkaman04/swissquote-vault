/**
 * The recovery rules, read from and checked against the blockchain.
 *
 * Pure module (viem only, no browser APIs): used by the app AND by the two guardian
 * services (server/index.ts = Swissquote, server/partner.ts = independent partner),
 * so all three agree on one source of truth: the weighted validator's storage on-chain.
 *
 * Recovery keys of a new Vault (threshold 100):
 *   client backup key      60   always required (60 < 100 alone)
 *   Swissquote guardian    40   normal path: backup + Swissquote = 100
 *   independent partner    40   if Swissquote is gone: backup + partner = 100
 *   Swissquote + partner = 80 < 100  -> they can NEVER recover without the client.
 * Vaults created before the partner existed use the legacy 2-of-2 (backup 50 + Swissquote 50).
 */
import {
  type Address,
  type Hex,
  type Client,
  concatHex,
  encodeAbiParameters,
  getAddress,
  hexToNumber,
  keccak256,
  parseAbi,
  parseAbiParameters,
  recoverTypedDataAddress,
  sliceHex,
} from "viem"
import { readContract } from "viem/actions"
import { entryPoint07Address } from "viem/account-abstraction"
import { WeightedValidatorContractVersion, getValidatorAddress, type WeightedValidatorConfig } from "@zerodev/weighted-validator"

export const WEIGHTED_VALIDATOR_VERSION = WeightedValidatorContractVersion.V0_0_2_PATCHED
export const WEIGHTED_VALIDATOR_ADDRESS = getValidatorAddress("0.7", WEIGHTED_VALIDATOR_VERSION)

export const RECOVERY_THRESHOLD = 100
export const WEIGHTS = { backup: 60, swissquote: 40, partner: 40 } as const
export const LEGACY_WEIGHTS = { backup: 50, swissquote: 50 } as const

/** Recovery config installed on a new Vault. Without a partner: the legacy 2-of-2. */
export function recoveryConfig(swissquote: Address, backup: Address, partner?: Address): WeightedValidatorConfig {
  const signers = partner
    ? [
        { publicKey: backup, weight: WEIGHTS.backup },
        { publicKey: swissquote, weight: WEIGHTS.swissquote },
        { publicKey: partner, weight: WEIGHTS.partner },
      ]
    : [
        { publicKey: backup, weight: LEGACY_WEIGHTS.backup },
        { publicKey: swissquote, weight: LEGACY_WEIGHTS.swissquote },
      ]
  // The waiting period is enforced by the guardian services before they co-sign (see docs/custody-model.md).
  return { threshold: RECOVERY_THRESHOLD, signers, delay: 0 }
}

export type RecoverySetup = {
  threshold: number
  signers: { address: Address; weight: number }[]
}

/** Can this set of recovery keys reach the threshold? Each key counts once (as on-chain). */
export function canRecover(setup: RecoverySetup, keys: Address[]): boolean {
  const unique = new Set(keys.map((k) => k.toLowerCase()))
  const total = setup.signers.filter((s) => unique.has(s.address.toLowerCase())).reduce((sum, s) => sum + s.weight, 0)
  return total >= setup.threshold
}

export function weightOf(setup: RecoverySetup, key: Address): number {
  return setup.signers.find((s) => s.address.toLowerCase() === key.toLowerCase())?.weight ?? 0
}

export function configFromSetup(setup: RecoverySetup): WeightedValidatorConfig {
  return {
    threshold: setup.threshold,
    signers: setup.signers.map((s) => ({ publicKey: s.address, weight: s.weight })),
    delay: 0,
  }
}

const WEIGHTED_ABI = parseAbi([
  "function weightedStorage(address kernel) view returns (uint24 totalWeight, uint24 threshold, uint48 delay, uint32 guardianLength)",
])

/** The public recovery addresses on file for a Vault (registered at creation; never secrets). */
export type KnownKeys = { backup: Address; swissquote: Address; partner?: Address | null }

/**
 * The Vault's recovery keys and weights. The validator's header is read from the chain (is recovery
 * installed? how many keys, what total weight?) and must match the public addresses registered at
 * creation. Returns null when recovery is not installed yet (the Vault was never activated).
 * Note: the validator's per-guardian getter doesn't decode with the SDK's published ABI, so the keys
 * themselves come from the registration; the contract still enforces them on every recovery.
 */
export async function readRecoverySetup(client: Client, wallet: Address, known: KnownKeys): Promise<RecoverySetup | null> {
  let header: { total: number; threshold: number; count: number } | null = null
  try {
    const [total, threshold, , count] = await readContract(client, {
      address: WEIGHTED_VALIDATOR_ADDRESS,
      abi: WEIGHTED_ABI,
      functionName: "weightedStorage",
      args: [wallet],
    })
    header = { total: Number(total), threshold: Number(threshold), count: Number(count) }
  } catch (e) {
    console.warn("could not read the recovery header; using the registered configuration", e)
  }
  if (header && (header.threshold === 0 || header.count === 0)) return null
  const withPartner = header ? header.count === 3 : Boolean(known.partner)
  if (withPartner && !known.partner) throw new Error("this Vault has a recovery partner, but its address is not on file")
  const config = withPartner ? recoveryConfig(known.swissquote, known.backup, known.partner!) : recoveryConfig(known.swissquote, known.backup)
  const total = config.signers.reduce((sum, s) => sum + s.weight, 0)
  if (header && (header.total !== total || header.threshold !== config.threshold || header.count !== config.signers.length)) {
    throw new Error("the recovery configuration on-chain doesn't match the keys on file for this Vault")
  }
  return { threshold: config.threshold, signers: config.signers.map((x) => ({ address: getAddress(x.publicKey as Address), weight: x.weight })) }
}

/** A signer's index as the weighted validator numbers them (addresses sorted descending, as the SDK does). */
export function signerIndex(setup: RecoverySetup, key: Address): number {
  const sorted = setup.signers.map((x) => x.address.toLowerCase()).sort((a, b) => (a < b ? 1 : -1))
  return sorted.indexOf(key.toLowerCase())
}

const ENTRY_POINT_ABI = parseAbi(["function getNonce(address sender, uint192 key) view returns (uint256)"])

/**
 * The nonce of the Vault's recovery lane, read directly from the EntryPoint. Kernel v3 nonce key =
 * mode (0x00 default) | validator type (0x01 secondary) | validator address | 2-byte key (0).
 * Computed explicitly so a flaky RPC read can't switch the SDK into "enable" mode and change it.
 */
export async function recoveryNonce(client: Client, wallet: Address): Promise<bigint> {
  const key = BigInt(concatHex(["0x00", "0x01", WEIGHTED_VALIDATOR_ADDRESS, "0x0000"]))
  return readContract(client, { address: entryPoint07Address, abi: ENTRY_POINT_ABI, functionName: "getNonce", args: [wallet, key] })
}

/** The hash every recovery approval signs: binds it to this Vault, this exact call and this nonce. */
export function approvalHash(wallet: Address, callData: Hex, nonce: bigint): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters("address, bytes, uint256"), [wallet, callData, nonce]))
}

/**
 * Who signed a recovery approval? Format (ZeroDev weighted validator): 1-byte signer index +
 * a 65-byte EIP-712 signature over Approve(callDataAndNonceHash).
 */
export async function recoverApprovalSigner(args: {
  approval: Hex
  wallet: Address
  callData: Hex
  nonce: bigint
  chainId: number
}): Promise<{ index: number; signer: Address }> {
  if (!/^0x[0-9a-fA-F]{132}$/.test(args.approval)) throw new Error("malformed approval")
  const index = hexToNumber(sliceHex(args.approval, 0, 1))
  const signer = await recoverTypedDataAddress({
    domain: { name: "WeightedValidator", version: "0.0.1", chainId: args.chainId, verifyingContract: WEIGHTED_VALIDATOR_ADDRESS },
    types: { Approve: [{ name: "callDataAndNonceHash", type: "bytes32" }] },
    primaryType: "Approve",
    message: { callDataAndNonceHash: approvalHash(args.wallet, args.callData, args.nonce) },
    signature: sliceHex(args.approval, 1),
  })
  return { index, signer }
}
