# Swissquote Vault

A self-custody crypto wallet that Swissquote could realistically launch for its clients:
**their keys, their control — one step away from their Swissquote account.**

Built in 24 hours at the BSA EPFL Hackathon (10–11 October 2026), Swissquote Wallet track.

## The idea in one paragraph

Today a Swissquote client who wants self-custody has to withdraw to MetaMask and leave the bank.
Swissquote Vault is a smart-contract wallet (ERC-4337) on an Ethereum L2 where the everyday signer
is a **passkey** living in the secure enclave of the client's phone (Face ID / Touch ID to sign).
Recovery uses a **2-of-3 guardian model**: the client's passkey, a Swissquote guardian tied to the
client's KYC'd bank account, and a client-held backup. Swissquote alone can never move funds, so the
bank is not a custodian; the client alone can transact. Losing a phone is recoverable; stealing a
phone is not profitable, because recovery requires a bank-grade identity check **plus** a time delay
with a one-tap cancel on the old device.

## Repo layout

| Folder | What lives there |
| --- | --- |
| `app/` | The wallet prototype (web app, runs on testnet) |
| `docs/` | Architecture, threat model, custody model, Swiss legal notes, business case, pitch |

## Status

Work in progress — see commit history.

## Team

Ali Torkaman and team · BSA EPFL Hackathon 2026
