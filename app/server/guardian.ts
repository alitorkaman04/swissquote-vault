/**
 * What a recovery guardian does, shared by the two guardian services:
 *   - server/index.ts   Swissquote's guardian (normal path)
 *   - server/partner.ts the independent recovery partner (if Swissquote is gone)
 * Each runs as its own process with its own key and its own storage; the client app never
 * holds either key.
 *
 * Before co-signing, a guardian checks: (1) the request is a `doRecovery` call, (2) the client's
 * approval is signed by the backup address registered at creation, for this Vault's current recovery
 * nonce, and (3) the Vault's on-chain recovery header (installed, number of keys, total weight) matches
 * the registered keys, and the approval plus its own weight reaches the threshold. Two guardians
 * together (40 + 40) are refused before anything reaches the chain.
 */
import { createKernelAccount } from "@zerodev/sdk"
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants"
import {
  createWeightedKernelAccountClient,
  createWeightedValidator,
  getRecoveryAction,
  toECDSASigner,
} from "@zerodev/weighted-validator"
import { type Address, type Hex, type LocalAccount, createPublicClient, decodeFunctionData, fallback, http, parseAbi } from "viem"
import { baseSepolia } from "viem/chains"
import {
  WEIGHTED_VALIDATOR_VERSION,
  canRecover,
  configFromSetup,
  readRecoverySetup,
  recoverApprovalSigner,
  recoveryNonce,
  signerIndex,
  weightOf,
  type KnownKeys,
} from "../src/lib/onchainRecovery.js"

export const CHAIN = baseSepolia
const ENTRY_POINT = getEntryPoint("0.7")
const PROJECT_ID = process.env.ZERODEV_PROJECT_ID ?? process.env.VITE_ZERODEV_PROJECT_ID
export const ZERODEV_RPC_URL = `https://rpc.zerodev.app/api/v3/${PROJECT_ID}/chain/${CHAIN.id}`
export const hasProjectId = Boolean(PROJECT_ID)

export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: fallback([
    http("https://sepolia.base.org", { retryCount: 2 }),
    http("https://base-sepolia-rpc.publicnode.com", { retryCount: 2 }),
    http("https://base-sepolia.drpc.org", { retryCount: 2 }),
    http("https://base-sepolia.gateway.tenderly.co", { retryCount: 2 }),
  ]),
})

const RECOVERY_ABI = parseAbi(["function doRecovery(address _validator, bytes calldata _data)"])

/** A guardian only ever co-signs `doRecovery` (the on-chain selector binding enforces this too). */
export function isDoRecovery(callData: unknown): callData is Hex {
  try {
    return decodeFunctionData({ abi: RECOVERY_ABI, data: callData as Hex }).functionName === "doRecovery"
  } catch {
    return false
  }
}

export class Refused extends Error {
  status = 403
}

async function setupFor(guardian: LocalAccount, wallet: Address, known: KnownKeys) {
  let setup
  try {
    setup = await readRecoverySetup(publicClient, wallet, known, { strict: true })
  } catch (e) {
    throw new Refused((e as Error).message)
  }
  if (!setup) throw new Refused("recovery is not installed on this Vault (never activated)")
  if (weightOf(setup, guardian.address) === 0) throw new Refused("this guardian is not a recovery key of this Vault")
  return setup
}

/** The Vault's recovery account, seen by one guardian. */
async function recoveryAccount(guardian: LocalAccount, wallet: Address, known: KnownKeys) {
  const setup = await setupFor(guardian, wallet, known)
  const validator = await createWeightedValidator(publicClient, {
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_V3_1,
    validatorContractVersion: WEIGHTED_VALIDATOR_VERSION,
    signer: await toECDSASigner({ signer: guardian }),
    config: configFromSetup(setup),
  })
  const account = await createKernelAccount(publicClient, {
    address: wallet,
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_V3_1,
    plugins: { regular: validator, action: getRecoveryAction(ENTRY_POINT.version) },
  })
  return { setup, account }
}

/**
 * Verifies the client's backup approval for this exact recovery. Throws `Refused` with a
 * plain-language reason when it doesn't come from the client's registered backup key.
 * `known` = the Vault's public recovery addresses on this guardian's file.
 */
export async function verifyClientApproval(guardian: LocalAccount, wallet: Address, callData: Hex, approval: unknown, known: KnownKeys) {
  if (typeof approval !== "string" || !/^0x[0-9a-fA-F]{132}$/.test(approval)) {
    throw new Refused("no valid backup-key approval attached: the client's backup key must approve this recovery first")
  }
  const setup = await setupFor(guardian, wallet, known)
  const nonce = await recoveryNonce(publicClient, wallet)
  const { index, signer } = await recoverApprovalSigner({ approval: approval as Hex, wallet, callData, nonce, chainId: CHAIN.id })
  if (signer.toLowerCase() !== known.backup.toLowerCase()) {
    console.log(`  approval check: recovered ${signer} with nonce ${nonce}; the backup key on file is ${known.backup}`)
    throw new Refused("the approval is not signed by this Vault's backup key")
  }
  // The contract finds the signer by this index: a mismatch would only fail later, on-chain.
  if (signerIndex(setup, signer) !== index) throw new Refused("approval signer index mismatch")
  if (!canRecover(setup, [signer, guardian.address])) {
    throw new Refused("the approving key plus this guardian don't reach the threshold: the client's backup key is required")
  }
  return { signer, setup }
}

/** The guardian's one cryptographic act: approve this recovery user operation with its key. */
export async function coSign(guardian: LocalAccount, wallet: Address, callData: Hex, known: KnownKeys): Promise<Hex> {
  const { account } = await recoveryAccount(guardian, wallet, known)
  const client = createWeightedKernelAccountClient({
    account,
    chain: CHAIN,
    bundlerTransport: http(ZERODEV_RPC_URL),
    client: publicClient,
  })
  return client.approveUserOperation({ callData, validatorContractVersion: WEIGHTED_VALIDATOR_VERSION })
}

/** A veto signed by the Vault itself (current passkey, ERC-1271), verified on-chain. */
export async function isSignedByVault(wallet: Address, message: string, signature: unknown) {
  if (typeof signature !== "string") return false
  try {
    return await publicClient.verifyMessage({ address: wallet, message, signature: signature as Hex })
  } catch (e) {
    console.warn("veto signature could not be verified:", (e as Error).message)
    return false
  }
}
