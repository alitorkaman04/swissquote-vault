/**
 * Core wallet logic: passkey-controlled ERC-4337 smart account on Base Sepolia.
 *
 * Custody model (see docs/custody-model.md):
 *   - EVERYDAY signer  : the client's passkey (WebAuthn, P-256 key in the phone's secure enclave).
 *                        It is the account's "sudo" validator: it alone can move funds.
 *   - RECOVERY signers : a weighted validator (threshold 100) made of
 *                          (1) the client's backup key          (weight 60, held offline by the client)
 *                          (2) the Swissquote guardian key      (weight 40, held by the bank)
 *                          (3) an independent recovery partner  (weight 40, used if Swissquote is gone)
 *                        bound ON-CHAIN to exactly one action: `doRecovery(validator, data)`,
 *                        i.e. replacing the passkey. It can never transfer assets.
 *   Result: the client alone can transact; Swissquote alone - or Swissquote + partner (80) - can do
 *   nothing; the client's backup + one guardian can only re-install a new passkey, after a waiting period.
 */
import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  getValidatorPluginInstallModuleData,
  type KernelAccountClient,
} from "@zerodev/sdk"
import {
  PasskeyValidatorContractVersion,
  WebAuthnMode,
  deserializePasskeyValidator,
  toPasskeyValidator,
  toWebAuthnKey,
} from "@zerodev/passkey-validator"
import {
  createWeightedValidator,
  getRecoveryAction,
  getRecoveryFallbackActionInstallModuleData,
  toECDSASigner,
} from "@zerodev/weighted-validator"
import {
  type Address,
  type Hex,
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  fallback,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
} from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { WEIGHTED_VALIDATOR_VERSION, recoveryConfig } from "./onchainRecovery"
import {
  CHAIN,
  ENTRY_POINT,
  KERNEL_VERSION,
  PASSKEY_SERVER_URL,
  PUBLIC_RPC_URLS,
  USDC_ADDRESS,
  USDC_DECIMALS,
  ZERODEV_RPC_URL,
} from "./config"

export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: fallback(PUBLIC_RPC_URLS.map((url) => http(url, { retryCount: 2 }))),
})

export const PASSKEY_VALIDATOR_VERSION = PasskeyValidatorContractVersion.V0_0_3_PATCHED
export { WEIGHTED_VALIDATOR_VERSION, recoveryConfig }

/** What the app keeps in localStorage so the client doesn't re-enrol on every reload. */
export type WalletSession = {
  passkeyName: string
  address: Address
  /** Serialized passkey validator (public key material only - no secrets). */
  serializedPasskeyValidator: string
  backupAddress: Address
  bankGuardianAddress: Address
  /** Independent recovery partner (absent on Vaults created before it existed: legacy 2-of-2). */
  partnerAddress?: Address
}

export type Wallet = {
  session: WalletSession
  client: KernelAccountClient
}

const SESSION_KEY = "swissquote-vault:session"

export function loadSession(): WalletSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as WalletSession) : null
  } catch {
    return null
  }
}
export function saveSession(s: WalletSession) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s))
  } catch {
    /* private mode etc. */
  }
}
export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}

/** Gas sponsorship: Swissquote pays gas via the paymaster, so clients never hold ETH. */
function paymasterConfig() {
  const paymaster = createZeroDevPaymasterClient({ chain: CHAIN, transport: http(ZERODEV_RPC_URL) })
  return {
    getPaymasterData: (userOperation: Parameters<typeof paymaster.sponsorUserOperation>[0]["userOperation"]) =>
      paymaster.sponsorUserOperation({ userOperation }),
  }
}

/**
 * Step 1 of the lifecycle: CREATE.
 *  - registers a new passkey on this device (Face ID / Touch ID prompt),
 *  - generates the client's backup key (shown once, to be stored offline),
 *  - derives the smart-account address,
 *  - schedules installation of the recovery validator (bank + backup) on the first transaction.
 */
export async function createWallet(passkeyName: string, bankGuardianAddress: Address, partnerAddress?: Address) {
  const webAuthnKey = await toWebAuthnKey({
    passkeyName,
    passkeyServerUrl: PASSKEY_SERVER_URL,
    mode: WebAuthnMode.Register,
    passkeyServerHeaders: {},
  })
  const passkeyValidator = await toPasskeyValidator(publicClient, {
    webAuthnKey,
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
    validatorContractVersion: PASSKEY_VALIDATOR_VERSION,
  })

  // Client backup key: generated on the device, shown once, never sent to Swissquote.
  const backupPrivateKey = generatePrivateKey()
  const backupAddress = privateKeyToAccount(backupPrivateKey).address

  const { client, address } = await buildEverydayClient(
    passkeyValidator,
    bankGuardianAddress,
    backupAddress,
    backupPrivateKey,
    undefined,
    partnerAddress,
  )

  const session: WalletSession = {
    passkeyName,
    address,
    serializedPasskeyValidator: passkeyValidator.getSerializedData(),
    backupAddress,
    bankGuardianAddress,
    partnerAddress,
  }
  saveSession(session)
  return { wallet: { session, client } as Wallet, backupPrivateKey }
}

/** Step 2 of the lifecycle: AUTHENTICATE on a device that already has the passkey. */
export async function loginWallet(
  passkeyName: string,
  bankGuardianAddress: Address,
  knownAddress?: Address,
  onFile?: { backupAddress?: Address; partnerAddress?: Address },
) {
  const webAuthnKey = await toWebAuthnKey({
    passkeyName,
    passkeyServerUrl: PASSKEY_SERVER_URL,
    mode: WebAuthnMode.Login,
    passkeyServerHeaders: {},
  })
  const passkeyValidator = await toPasskeyValidator(publicClient, {
    webAuthnKey,
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
    validatorContractVersion: PASSKEY_VALIDATOR_VERSION,
  })
  const existing = loadSession()
  const backupAddress = onFile?.backupAddress ?? existing?.backupAddress
  const partnerAddress = onFile?.partnerAddress ?? existing?.partnerAddress
  const { client, address } = await buildEverydayClient(
    passkeyValidator,
    bankGuardianAddress,
    backupAddress,
    undefined,
    knownAddress ?? existing?.address,
    partnerAddress,
  )
  const session: WalletSession = {
    passkeyName,
    address,
    serializedPasskeyValidator: passkeyValidator.getSerializedData(),
    backupAddress: backupAddress ?? ("0x0000000000000000000000000000000000000000" as Address),
    bankGuardianAddress,
    partnerAddress,
  }
  saveSession(session)
  return { session, client } as Wallet
}

/** Silent resume from localStorage (no passkey prompt until the next signature). */
export async function resumeWallet(session: WalletSession): Promise<Wallet> {
  const passkeyValidator = await deserializePasskeyValidator(publicClient, {
    serializedData: session.serializedPasskeyValidator,
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
  })
  const { client } = await buildEverydayClient(
    passkeyValidator,
    session.bankGuardianAddress,
    session.backupAddress,
    undefined,
    session.address,
    session.partnerAddress,
  )
  return { session, client }
}

type PasskeyValidator = Awaited<ReturnType<typeof toPasskeyValidator>>

async function buildEverydayClient(
  passkeyValidator: PasskeyValidator,
  bankGuardianAddress: Address,
  backupAddress?: Address,
  backupPrivateKey?: Hex,
  knownAddress?: Address,
  partnerAddress?: Address,
) {
  // The recovery validator is installed lazily with the first sudo user operation
  // (ZeroDev "pluginMigrations"). We only need a signer object to build it; at
  // creation we have the backup key, later we use a throwaway key since the
  // migration data only contains the (public) config.
  const pluginMigrations = []
  if (backupAddress && backupAddress !== "0x0000000000000000000000000000000000000000") {
    const signer = await toECDSASigner({
      signer: privateKeyToAccount(backupPrivateKey ?? generatePrivateKey()),
    })
    const recoveryValidator = await createWeightedValidator(publicClient, {
      entryPoint: ENTRY_POINT,
      kernelVersion: KERNEL_VERSION,
      validatorContractVersion: WEIGHTED_VALIDATOR_VERSION,
      signer,
      config: recoveryConfig(bankGuardianAddress, backupAddress, partnerAddress),
    })
    pluginMigrations.push(
      await getValidatorPluginInstallModuleData({
        plugin: recoveryValidator,
        entryPoint: ENTRY_POINT,
        kernelVersion: KERNEL_VERSION,
        action: getRecoveryAction(ENTRY_POINT.version),
      }),
      getRecoveryFallbackActionInstallModuleData(ENTRY_POINT.version),
    )
  }

  const account = await createKernelAccount(publicClient, {
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
    plugins: { sudo: passkeyValidator },
    pluginMigrations,
    ...(knownAddress ? { address: knownAddress } : {}),
  })

  const client = createKernelAccountClient({
    account,
    chain: CHAIN,
    bundlerTransport: http(ZERODEV_RPC_URL),
    client: publicClient,
    paymaster: paymasterConfig(),
  })
  return { client: client as unknown as KernelAccountClient, address: account.address }
}

// ---------------------------------------------------------------------------
// Balances & transfers
// ---------------------------------------------------------------------------

export async function getBalances(address: Address) {
  const [eth, usdc] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
  ])
  return { eth: formatEther(eth), usdc: formatUnits(usdc, USDC_DECIMALS) }
}

/** Step 3 of the lifecycle: SIGN & SEND. Gasless - the paymaster sponsors the fee. */
export async function sendUsdc(wallet: Wallet, to: Address, amountUsdc: string) {
  const amount = parseUnits(amountUsdc, USDC_DECIMALS)
  const hash = await wallet.client.sendUserOperation({
    callData: await wallet.client.account!.encodeCalls([
      {
        to: USDC_ADDRESS,
        value: 0n,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }),
      },
    ]),
  })
  const receipt = await wallet.client.waitForUserOperationReceipt({ hash })
  return { userOpHash: hash, txHash: receipt.receipt.transactionHash, gasCostWei: receipt.actualGasCost }
}

export async function sendEth(wallet: Wallet, to: Address, amountEth: string) {
  const hash = await wallet.client.sendUserOperation({
    callData: await wallet.client.account!.encodeCalls([{ to, value: parseEther(amountEth), data: "0x" }]),
  })
  const receipt = await wallet.client.waitForUserOperationReceipt({ hash })
  return { userOpHash: hash, txHash: receipt.receipt.transactionHash, gasCostWei: receipt.actualGasCost }
}

/** Generic contract call (used for the approved-dApp flow). */
export async function sendCalls(wallet: Wallet, calls: { to: Address; value?: bigint; data?: Hex }[]) {
  const hash = await wallet.client.sendUserOperation({
    callData: await wallet.client.account!.encodeCalls(
      calls.map((c) => ({ to: c.to, value: c.value ?? 0n, data: c.data ?? "0x" })),
    ),
  })
  const receipt = await wallet.client.waitForUserOperationReceipt({ hash })
  return { userOpHash: hash, txHash: receipt.receipt.transactionHash, gasCostWei: receipt.actualGasCost }
}

/**
 * Activate a freshly created wallet: deploys the smart account AND installs the recovery
 * validator in one sponsored operation, so the wallet is recoverable from day one
 * (even if the client only ever receives funds). The call itself is a harmless 0-value
 * transfer to the bank's guardian address.
 */
export async function activateWallet(wallet: Wallet) {
  if (await isDeployed(wallet.session.address)) return null
  return sendCalls(wallet, [{ to: wallet.session.bankGuardianAddress, value: 0n, data: "0x" }])
}

/** Has the account been deployed (i.e. has it sent at least one operation)? */
export async function isDeployed(address: Address) {
  const code = await publicClient.getCode({ address })
  return !!code && code !== "0x"
}

/** Sign an arbitrary message with the passkey (ERC-1271). Used for the ownership proof and the recovery veto. */
export async function signMessageWithPasskey(wallet: Wallet, message: string): Promise<Hex> {
  return wallet.client.signMessage({ account: wallet.client.account!, message })
}

/** USDC allowance granted to a dApp contract (read from chain). */
export async function getUsdcAllowance(owner: Address, spender: Address) {
  const a = await publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "allowance", args: [owner, spender] })
  return formatUnits(a, USDC_DECIMALS)
}

/** Revoke a dApp's USDC allowance (approve 0). */
export async function revokeUsdcAllowance(wallet: Wallet, spender: Address) {
  return sendCalls(wallet, [
    { to: USDC_ADDRESS, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, 0n] }) },
  ])
}
