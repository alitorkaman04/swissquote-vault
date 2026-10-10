/**
 * Steps 4 & 5 of the lifecycle: LOSE ACCESS and RECOVER.
 *
 * Scenario: the client's phone is gone. On a new device they:
 *   1. enrol a NEW passkey,
 *   2. log in to their Swissquote account (bank-grade identity check) and request recovery
 *      - or, if Swissquote is gone, go to the independent recovery partner instead,
 *   3. provide their backup key (from the printed/exported backup kit), checked against the registered backup key,
 *   4. the guardian (Swissquote or the partner) verifies the backup approval, notifies the
 *      old device, waits out the delay, then co-signs if nobody cancelled,
 *   5. the recovery user operation (backup + one guardian = threshold) replaces the passkey on-chain.
 *
 * The recovery validator is bound on-chain to the `doRecovery` action only, so even
 * with both recovery signatures it is impossible to move funds - only to swap the passkey.
 */
import { createKernelAccount } from "@zerodev/sdk"
import { PasskeyValidatorContractVersion, WebAuthnMode, toPasskeyValidator, toWebAuthnKey } from "@zerodev/passkey-validator"
import {
  createWeightedKernelAccountClient,
  createWeightedValidator,
  encodeSignatures,
  getRecoveryAction,
  toECDSASigner,
} from "@zerodev/weighted-validator"
import { type Address, type Hex, concatHex, encodeFunctionData, http, parseAbi } from "viem"
import { formatUserOperationRequest } from "viem/account-abstraction"
import { privateKeyToAccount } from "viem/accounts"
import { CHAIN, ENTRY_POINT, KERNEL_VERSION, PASSKEY_SERVER_URL, ZERODEV_RPC_URL } from "./config"
import { WEIGHTED_VALIDATOR_VERSION, publicClient, saveSession, type WalletSession } from "./wallet"
import {
  WEIGHTED_VALIDATOR_ADDRESS,
  approvalHash,
  configFromSetup,
  readRecoverySetup,
  type KnownKeys,
  type RecoverySetup,
} from "./onchainRecovery"
import { createZeroDevPaymasterClient } from "@zerodev/sdk"

export const RECOVERY_ABI = parseAbi(["function doRecovery(address _validator, bytes calldata _data)"])

/** 1. Enrol a new passkey on the new device and compute the on-chain data that installs it. */
export async function prepareNewPasskey(newPasskeyName: string) {
  const webAuthnKey = await toWebAuthnKey({
    passkeyName: newPasskeyName,
    passkeyServerUrl: PASSKEY_SERVER_URL,
    mode: WebAuthnMode.Register,
    passkeyServerHeaders: {},
  })
  const validator = await toPasskeyValidator(publicClient, {
    webAuthnKey,
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
    validatorContractVersion: PasskeyValidatorContractVersion.V0_0_3_PATCHED,
  })
  const enableData = await validator.getEnableData()
  const callData = encodeFunctionData({
    abi: RECOVERY_ABI,
    functionName: "doRecovery",
    args: [validator.address, enableData],
  })
  return { validator, callData, serialized: validator.getSerializedData() }
}

/**
 * Checks a backup key against the backup address registered at creation and the Vault's on-chain
 * recovery header, before anything is signed or sent. This is where an attacker with a stolen phone and inbox is refused:
 * neither holds the backup key, and no other key is accepted by the validator contract.
 */
export async function checkBackupKey(walletAddress: Address, backupPrivateKey: string, known: KnownKeys) {
  // Accept the bare key, the grouped key as printed on the kit, or the whole pasted kit text.
  const text = backupPrivateKey.trim()
  const fromKit = text.match(/Backup key\s*:\s*(0x[0-9a-fA-F]{64})/)?.[1]
  const compact = text.replace(/\s+/g, "").replace(/^0x/i, "")
  const key = fromKit ?? (/^[0-9a-fA-F]{64}$/.test(compact) ? `0x${compact}` : text)
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    return { ok: false as const, reason: "That doesn’t look like a backup key (0x + 64 hex characters)." }
  }
  const address = privateKeyToAccount(key as Hex).address
  if (address.toLowerCase() !== known.backup.toLowerCase()) {
    return {
      ok: false as const,
      refused: true,
      reason: `Refused. ${address.slice(0, 8)}… is not this Vault’s backup key, and the Vault’s recovery rules on Base Sepolia accept no other.`,
    }
  }
  const setup = await readRecoverySetup(publicClient, walletAddress, known)
  if (!setup) {
    return { ok: false as const, reason: "Recovery isn’t switched on for this Vault yet: it was never activated on-chain." }
  }
  return { ok: true as const, setup, address, key: key as Hex }
}

/** Builds a "recovery view" of the account for one recovery signer, using the on-chain config. */
export async function buildRecoveryClient(walletAddress: Address, setup: RecoverySetup, signerPrivateKey: Hex) {
  const signer = await toECDSASigner({ signer: privateKeyToAccount(signerPrivateKey) })
  const recoveryValidator = await createWeightedValidator(publicClient, {
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
    validatorContractVersion: WEIGHTED_VALIDATOR_VERSION,
    signer,
    config: configFromSetup(setup),
  })
  const account = await createKernelAccount(publicClient, {
    address: walletAddress,
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
    plugins: { regular: recoveryValidator, action: getRecoveryAction(ENTRY_POINT.version) },
  })
  const paymaster = createZeroDevPaymasterClient({ chain: CHAIN, transport: http(ZERODEV_RPC_URL) })
  return createWeightedKernelAccountClient({
    account,
    chain: CHAIN,
    bundlerTransport: http(ZERODEV_RPC_URL),
    client: publicClient,
    paymaster: {
      getPaymasterData: (userOperation) => paymaster.sponsorUserOperation({ userOperation }),
    },
  })
}

/** 3. The client signs the recovery with their backup key. */
export async function approveWithBackupKey(walletAddress: Address, setup: RecoverySetup, backupPrivateKey: Hex, callData: Hex) {
  const client = await buildRecoveryClient(walletAddress, setup, backupPrivateKey)
  const signature = await client.approveUserOperation({ callData, validatorContractVersion: WEIGHTED_VALIDATOR_VERSION })
  return { client, signature }
}

/**
 * 5. Submit the recovery once the backup approval and one guardian approval are in hand.
 *
 * The weighted validator expects: [approval_1, ..., approval_n, final signature over userOpHash].
 * We build that by hand instead of calling `sendUserOperationWithSignatures`, because in
 * @zerodev/weighted-validator 5.5.1 that helper drops the collected approvals when the weighted
 * validator is installed as a *regular* (non-sudo) validator - which is exactly our setup, since
 * the recovery signers must NOT be able to do anything except `doRecovery`.
 */
export async function submitRecovery(
  client: Awaited<ReturnType<typeof buildRecoveryClient>>,
  callData: Hex,
  approvals: Hex[],
) {
  const account = client.account
  const encodedApprovals = encodeSignatures([...approvals], true)

  // Stub signature (approvals + dummy final sig) so gas estimation and the paymaster see a realistic size.
  const stub = await account.getStubSignature({ callData, signature: encodedApprovals } as never)
  const userOperation = (await client.prepareUserOperation({ account, callData, signature: stub } as never)) as Record<
    string,
    unknown
  >

  // Final signature: the backup key signs the userOpHash, appended after the approvals.
  const signature = await account.signUserOperation({ ...userOperation, signature: encodedApprovals } as never)

  // Send exactly this user operation (no re-preparation, so the signed hash stays valid).
  const hash = (await client.request({
    method: "eth_sendUserOperation",
    params: [formatUserOperationRequest({ ...userOperation, signature } as never), account.entryPoint.address],
  } as never)) as Hex
  const receipt = await client.waitForUserOperationReceipt({ hash })
  if (!receipt.success) throw new Error(`Recovery user operation reverted (${receipt.reason ?? "no reason"})`)
  return { userOpHash: hash, txHash: receipt.receipt.transactionHash, gasCostWei: receipt.actualGasCost }
}

/** After recovery, persist the new passkey session so the new device is the everyday device. */
export function adoptRecoveredSession(
  previous: Pick<WalletSession, "address" | "backupAddress" | "bankGuardianAddress" | "partnerAddress">,
  newPasskeyName: string,
  serializedPasskeyValidator: string,
) {
  const session: WalletSession = {
    passkeyName: newPasskeyName,
    address: previous.address,
    serializedPasskeyValidator,
    backupAddress: previous.backupAddress,
    bankGuardianAddress: previous.bankGuardianAddress,
    partnerAddress: previous.partnerAddress,
  }
  saveSession(session)
  return session
}

/**
 * DEMO: the best an attacker with a stolen phone and inbox can produce - a well-formed approval
 * signed by a key they control. Used to show that Swissquote refuses to co-sign it.
 */
export async function attackerApproval(attackerKey: Hex, walletAddress: Address, callData: Hex) {
  const signature = await privateKeyToAccount(attackerKey).signTypedData({
    domain: { name: "WeightedValidator", version: "0.0.1", chainId: CHAIN.id, verifyingContract: WEIGHTED_VALIDATOR_ADDRESS },
    types: { Approve: [{ name: "callDataAndNonceHash", type: "bytes32" }] },
    primaryType: "Approve",
    message: { callDataAndNonceHash: approvalHash(walletAddress, callData, 0n) },
  })
  return concatHex(["0x00", signature])
}
