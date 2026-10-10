import { baseSepolia } from "viem/chains"
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants"

/**
 * Network + infrastructure configuration.
 *
 * Everything on-chain happens on Base Sepolia (Ethereum L2 testnet).
 * ZeroDev provides: bundler RPC (sends ERC-4337 user operations), a gas-sponsoring
 * paymaster (so clients never need ETH), and a passkey server (stores WebAuthn
 * public keys so a user can log in from any device by passkey name).
 */
export const CHAIN = baseSepolia

const PROJECT_ID = import.meta.env.VITE_ZERODEV_PROJECT_ID as string | undefined
if (!PROJECT_ID) {
  console.warn("VITE_ZERODEV_PROJECT_ID is missing - copy .env.example to .env and fill it in.")
}

export const ZERODEV_RPC_URL = `https://rpc.zerodev.app/api/v3/${PROJECT_ID}/chain/${CHAIN.id}`
export const PASSKEY_SERVER_URL = `https://passkeys.zerodev.app/api/v3/${PROJECT_ID}`

/**
 * Public Base Sepolia nodes for reading the chain (balances, simulation).
 * Free public nodes rate-limit, so we try several in order.
 */
export const PUBLIC_RPC_URLS = [
  "https://sepolia.base.org",
  "https://base-sepolia-rpc.publicnode.com",
  "https://base-sepolia.drpc.org",
]

export const ENTRY_POINT = getEntryPoint("0.7")
export const KERNEL_VERSION = KERNEL_V3_1

/** Circle's official test USDC on Base Sepolia (6 decimals). Faucet: https://faucet.circle.com */
export const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const
export const USDC_DECIMALS = 6

export const EXPLORER_TX = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`
export const EXPLORER_ADDRESS = (addr: string) => `https://sepolia.basescan.org/address/${addr}`

/** Mock Swissquote backend (guardian service). See server/ and docs/mocks.md */
export const BANK_API_URL = (import.meta.env.VITE_BANK_API_URL as string | undefined) ?? "http://localhost:8787"

/**
 * Recovery delay enforced by the Swissquote guardian service before it co-signs a recovery.
 * Production: 48 hours. Demo: a few seconds so judges can watch the whole flow.
 */
export const RECOVERY_DELAY_SECONDS = Number(import.meta.env.VITE_RECOVERY_DELAY_SECONDS ?? 30)

/** Transfers above this amount (in USDC) trigger the "high-value" compliance checks. */
export const HIGH_VALUE_THRESHOLD_USDC = Number(import.meta.env.VITE_HIGH_VALUE_THRESHOLD_USDC ?? 1000)
