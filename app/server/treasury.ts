/**
 * Swissquote's on-chain treasury for the demo: the deposit address clients move USDC to, and the
 * account Swissquote withdraws from. It is an ERC-4337 smart account (ZeroDev Kernel v3.1) owned by a
 * key in the bank process's own storage (production: an HSM-backed custody wallet), so it needs no ETH:
 * the same paymaster sponsors its gas. Created lazily, because computing its address needs the chain.
 */
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator"
import { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient } from "@zerodev/sdk"
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants"
import { type Address, type Hex, type LocalAccount, encodeFunctionData, erc20Abi, formatUnits, http, parseUnits } from "viem"
import { CHAIN, ZERODEV_RPC_URL, publicClient } from "./guardian.js"

const ENTRY_POINT = getEntryPoint("0.7")

async function build(owner: LocalAccount, usdc: Address) {
  const validator = await signerToEcdsaValidator(publicClient, { signer: owner, entryPoint: ENTRY_POINT, kernelVersion: KERNEL_V3_1 })
  const account = await createKernelAccount(publicClient, {
    plugins: { sudo: validator },
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_V3_1,
  })
  const paymaster = createZeroDevPaymasterClient({ chain: CHAIN, transport: http(ZERODEV_RPC_URL) })
  const client = createKernelAccountClient({
    account,
    chain: CHAIN,
    bundlerTransport: http(ZERODEV_RPC_URL),
    client: publicClient,
    paymaster: { getPaymasterData: (userOperation) => paymaster.sponsorUserOperation({ userOperation }) },
  })
  return {
    address: account.address,
    async usdcBalance() {
      const raw = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })
      return formatUnits(raw, 6)
    },
    /** A real, sponsored USDC transfer out of the treasury. */
    async sendUsdc(to: Address, amountUsdc: string): Promise<Hex> {
      const hash = await client.sendUserOperation({
        callData: await account.encodeCalls([
          { to: usdc, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, parseUnits(amountUsdc, 6)] }) },
        ]),
      })
      const receipt = await client.waitForUserOperationReceipt({ hash })
      if (!receipt.success) throw new Error("the withdrawal user operation reverted")
      return receipt.receipt.transactionHash
    },
  }
}

export type Treasury = Awaited<ReturnType<typeof build>>

/** One treasury per process, created on first use (retried if the chain was unreachable). */
export function treasuryFor(owner: LocalAccount, usdc: Address) {
  let pending: Promise<Treasury> | null = null
  return () => {
    pending ??= build(owner, usdc).catch((e) => {
      pending = null
      throw e
    })
    return pending
  }
}
