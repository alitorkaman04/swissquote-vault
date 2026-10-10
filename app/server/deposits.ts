/**
 * The Travel Rule check Swissquote applies to a crypto deposit from an external wallet.
 *
 * FINMA Guidance 02/2019: a Swiss bank may only receive crypto from (or send it to) an external
 * wallet after verifying that it belongs to its own client. Swissquote Vault makes that check
 * automatic: the Vault was created in the client's KYC'd session, and its ownership is proven by a
 * passkey-signed challenge verified on-chain (ERC-1271). Pure rules, unit-tested in tests/deposits.test.ts.
 */
import { type Address, type Log, erc20Abi, formatUnits, parseEventLogs } from "viem"

/** The USDC transfers into Swissquote's deposit address found in a transaction's logs. */
export function depositsInLogs(logs: Log[], usdc: Address, depositAddress: Address) {
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs }).filter(
    (l) => l.address.toLowerCase() === usdc.toLowerCase() && l.args.to.toLowerCase() === depositAddress.toLowerCase(),
  )
  if (transfers.length === 0) return null
  return {
    from: transfers[0].args.from,
    amountUsdc: formatUnits(transfers.reduce((sum, l) => sum + l.args.value, 0n), 6),
  }
}
export type DepositCheck = {
  /** The sending wallet, read from the USDC Transfer event on-chain. */
  from: string
  /** The client's Vault on file, and when its ownership was last proven (ms), if ever. */
  client: { walletAddress?: string; ownershipVerifiedAt?: number }
}

export type DepositDecision =
  | { status: "credited"; reason: string }
  | { status: "held"; reason: string; nextStep: string }

export function decideDeposit({ from, client }: DepositCheck): DepositDecision {
  const ownVault = !!client.walletAddress && client.walletAddress.toLowerCase() === from.toLowerCase()
  if (!ownVault) {
    return {
      status: "held",
      reason: "The sending wallet is not linked to this client, so its owner is unverified (Travel Rule).",
      nextStep: "Held for review: the client must prove ownership of that wallet before the funds are credited.",
    }
  }
  if (!client.ownershipVerifiedAt) {
    return {
      status: "held",
      reason: "This is the client's Vault, but its ownership has not been proven yet.",
      nextStep: "Sign the ownership proof with the passkey, then Swissquote credits the deposit automatically.",
    }
  }
  return {
    status: "credited",
    reason: "Sent from the client's own Vault, created in the KYC'd session and proven with a passkey signature verified on-chain.",
  }
}

/** The record Swissquote keeps for the deposit (originator and beneficiary information). */
export function travelRuleRecord(args: {
  clientId: string
  clientName: string
  from: string
  amountUsdc: string
  txHash: string
  ownershipVerifiedAt?: number
}) {
  return {
    originator: `${args.clientName} (client ${args.clientId})`,
    originatorWallet: args.from,
    walletType: "Self-hosted wallet (Swissquote Vault)",
    ownership: args.ownershipVerifiedAt
      ? `Verified on-chain (ERC-1271 passkey signature) ${new Date(args.ownershipVerifiedAt).toISOString()}`
      : "Not verified",
    beneficiary: `${args.clientName} (client ${args.clientId}), Swissquote account`,
    beneficiaryInstitution: "Swissquote Bank (mock)",
    amount: `${args.amountUsdc} USDC`,
    txHash: args.txHash,
  }
}
