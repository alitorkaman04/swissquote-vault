/**
 * Steps 4 & 5 of the lifecycle: LOSE ACCESS and RECOVER.
 *
 * Scenario: the client's phone is gone. On a new device they:
 *   1. enrol a NEW passkey,
 *   2. log in to their Swissquote account (bank-grade identity check) and request recovery,
 *   3. provide their backup key (from the printed/exported backup kit),
 *   4. the Swissquote guardian service notifies the old device, waits out the delay,
 *      then co-signs if nobody cancelled,
 *   5. the 2-of-2 recovery user operation replaces the passkey on-chain.
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
import { type Address, type Hex, encodeFunctionData, http, parseAbi } from "viem"
import { formatUserOperationRequest } from "viem/account-abstraction"
import { privateKeyToAccount } from "viem/accounts"
import { CHAIN, ENTRY_POINT, KERNEL_VERSION, PASSKEY_SERVER_URL, ZERODEV_RPC_URL } from "./config"
import { WEIGHTED_VALIDATOR_VERSION, publicClient, recoveryConfig, saveSession, type WalletSession } from "./wallet"
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

/** Builds a "recovery view" of the account for one of the two guardians. */
export async function buildRecoveryClient(
  walletAddress: Address,
  bankGuardianAddress: Address,
  backupAddress: Address,
  signerPrivateKey: Hex,
) {
  const signer = await toECDSASigner({ signer: privateKeyToAccount(signerPrivateKey) })
  const recoveryValidator = await createWeightedValidator(publicClient, {
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
    validatorContractVersion: WEIGHTED_VALIDATOR_VERSION,
    signer,
    config: recoveryConfig(bankGuardianAddress, backupAddress),
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
export async function approveWithBackupKey(
  walletAddress: Address,
  bankGuardianAddress: Address,
  backupAddress: Address,
  backupPrivateKey: Hex,
  callData: Hex,
) {
  const client = await buildRecoveryClient(walletAddress, bankGuardianAddress, backupAddress, backupPrivateKey)
  const signature = await client.approveUserOperation({ callData, validatorContractVersion: WEIGHTED_VALIDATOR_VERSION })
  return { client, signature }
}

/**
 * 5. Submit the recovery once both approvals are in hand.
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
  const userOperation = await client.prepareUserOperation({ account, callData, signature: stub } as never)

  // Final signature: the backup key signs the userOpHash, appended after the approvals.
  const signature = await account.signUserOperation({ ...userOperation, signature: encodedApprovals } as never)

  // Send exactly this user operation (no re-preparation, so the signed hash stays valid).
  const hash = (await client.request({
    method: "eth_sendUserOperation",
    params: [formatUserOperationRequest({ ...userOperation, signature } as never), account.entryPoint.address],
  } as never)) as Hex
  const receipt = await client.waitForUserOperationReceipt({ hash })
  if (!receipt.success) throw new Error(`Recovery user operation reverted (${receipt.reason ?? "no reason"})`)
  return { userOpHash: hash, txHash: receipt.receipt.transactionHash }
}

/** After recovery, persist the new passkey session so the new device is the everyday device. */
export function adoptRecoveredSession(
  previous: Pick<WalletSession, "address" | "backupAddress" | "bankGuardianAddress">,
  newPasskeyName: string,
  serializedPasskeyValidator: string,
) {
  const session: WalletSession = {
    passkeyName: newPasskeyName,
    address: previous.address,
    serializedPasskeyValidator,
    backupAddress: previous.backupAddress,
    bankGuardianAddress: previous.bankGuardianAddress,
  }
  saveSession(session)
  return session
}
