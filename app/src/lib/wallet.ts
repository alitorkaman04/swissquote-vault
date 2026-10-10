/**
 * Core wallet logic: passkey-controlled ERC-4337 smart account on Base Sepolia.
 *
 * Custody model (see docs/custody-model.md):
 *   - EVERYDAY signer  : the client's passkey (WebAuthn, P-256 key in the phone's secure enclave).
 *                        It is the account's "sudo" validator: it alone can move funds.
 *   - RECOVERY signers : a 2-of-2 weighted validator made of
 *                          (1) the Swissquote guardian key  (weight 50, held by the bank)
 *                          (2) the client's backup key       (weight 50, held by the client)
 *                        bound ON-CHAIN to exactly one action: `doRecovery(validator, data)`,
 *                        i.e. replacing the passkey. It can never transfer assets.
 *   Result: the client alone can transact; the bank alone can do nothing; bank + client backup
 *   together can only re-install a new passkey (after the bank's delay + notification period).
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
  WeightedValidatorContractVersion,
  createWeightedValidator,
  getRecoveryAction,
  getRecoveryFallbackActionInstallModuleData,
  toECDSASigner,
  type WeightedValidatorConfig,
} from "@zerodev/weighted-validator"
import {
  type Address,
  type Hex,
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
} from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import {
  CHAIN,
  ENTRY_POINT,
  KERNEL_VERSION,
  PASSKEY_SERVER_URL,
  USDC_ADDRESS,
  USDC_DECIMALS,
  ZERODEV_RPC_URL,
} from "./config"

export const publicClient = createPublicClient({ chain: CHAIN, transport: http() })

export const PASSKEY_VALIDATOR_VERSION = PasskeyValidatorContractVersion.V0_0_3_PATCHED
export const WEIGHTED_VALIDATOR_VERSION = WeightedValidatorContractVersion.V0_0_2_PATCHED

/** What the app keeps in localStorage so the client doesn't re-enrol on every reload. */
export type WalletSession = {
  passkeyName: string
  address: Address
  /** Serialized passkey validator (public key material only - no secrets). */
  serializedPasskeyValidator: string
  backupAddress: Address
  bankGuardianAddress: Address
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

/** The recovery (guardian) validator config: bank 50 + client backup 50, threshold 100. */
export function recoveryConfig(bankGuardianAddress: Address, backupAddress: Address): WeightedValidatorConfig {
  return {
    threshold: 100,
    signers: [
      { publicKey: bankGuardianAddress, weight: 50 },
      { publicKey: backupAddress, weight: 50 },
    ],
    delay: 0, // the waiting period is enforced by the Swissquote guardian service (see docs)
  }
}

/**
 * Step 1 of the lifecycle: CREATE.
 *  - registers a new passkey on this device (Face ID / Touch ID prompt),
 *  - generates the client's backup key (shown once, to be stored offline),
 *  - derives the smart-account address,
 *  - schedules installation of the recovery validator (bank + backup) on the first transaction.
 */
export async function createWallet(passkeyName: string, bankGuardianAddress: Address) {
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
  )

  const session: WalletSession = {
    passkeyName,
    address,
    serializedPasskeyValidator: passkeyValidator.getSerializedData(),
    backupAddress,
    bankGuardianAddress,
  }
  saveSession(session)
  return { wallet: { session, client } as Wallet, backupPrivateKey }
}

/** Step 2 of the lifecycle: AUTHENTICATE on a device that already has the passkey. */
export async function loginWallet(passkeyName: string, bankGuardianAddress: Address, knownAddress?: Address) {
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
  const backupAddress = existing?.backupAddress
  const { client, address } = await buildEverydayClient(
    passkeyValidator,
    bankGuardianAddress,
    backupAddress,
    undefined,
    knownAddress ?? existing?.address,
  )
  const session: WalletSession = {
    passkeyName,
    address,
    serializedPasskeyValidator: passkeyValidator.getSerializedData(),
    backupAddress: backupAddress ?? ("0x0000000000000000000000000000000000000000" as Address),
    bankGuardianAddress,
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
      config: recoveryConfig(bankGuardianAddress, backupAddress),
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
  return { userOpHash: hash, txHash: receipt.receipt.transactionHash }
}

export async function sendEth(wallet: Wallet, to: Address, amountEth: string) {
  const hash = await wallet.client.sendUserOperation({
    callData: await wallet.client.account!.encodeCalls([{ to, value: parseEther(amountEth), data: "0x" }]),
  })
  const receipt = await wallet.client.waitForUserOperationReceipt({ hash })
  return { userOpHash: hash, txHash: receipt.receipt.transactionHash }
}

/** Generic contract call (used for the approved-dApp flow). */
export async function sendCalls(wallet: Wallet, calls: { to: Address; value?: bigint; data?: Hex }[]) {
  const hash = await wallet.client.sendUserOperation({
    callData: await wallet.client.account!.encodeCalls(
      calls.map((c) => ({ to: c.to, value: c.value ?? 0n, data: c.data ?? "0x" })),
    ),
  })
  const receipt = await wallet.client.waitForUserOperationReceipt({ hash })
  return { userOpHash: hash, txHash: receipt.receipt.transactionHash }
}

/** Has the account been deployed (i.e. has it sent at least one operation)? */
export async function isDeployed(address: Address) {
  const code = await publicClient.getCode({ address })
  return !!code && code !== "0x"
}
