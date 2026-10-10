# Swiss legal feasibility

> Hackathon analysis, not legal advice. The conclusion should be confirmed with FINMA (for example through a ruling request) before launch.

## The question that decides everything: is Swissquote a custodian?

Swiss practice draws the line at **power of disposal**: who can actually or legally move the client's assets.

- FINMA describes custody wallet providers as those who *"store and manage clients' private keys"* and thereby have power of disposal. Clients of non-custodial providers *"have sole access to their private keys"*, so those providers *"have neither a legal nor actual power of disposal over the third-party assets"* and *"are not subject to the AMLA"* for that activity. [FINMA, Developments in FinTech]
- The test is not only technical: FINMA practice also asks whether the provider can *"influence transactions from a commercial or legal point of view"*, so the contracts must match the architecture. [MME, Custody services for digital assets under Swiss law]
- Practitioners treat a multisig provider *"whose signature is required to execute the transaction"* as custodial. [Swiss Crypto Guide, Wallet providers & AMLA]

### How Vault is designed to sit on the non-custodial side

| Test | Vault |
| --- | --- |
| Does Swissquote store or manage the key that moves funds? | **No.** The passkey lives in the client's secure enclave; Swissquote never sees it |
| Is Swissquote's signature required to execute a transaction? | **No.** Transfers are signed by the passkey alone. This is the key difference from a 2-of-3 multisig where the bank co-signs payments |
| Can Swissquote block or reverse a transaction? | **No.** Compliance checks run before signing in Swissquote's app, but the client's account doesn't need Swissquote to transact |
| Can Swissquote move funds alone? | **No.** Its guardian key is half of a 2-of-2 recovery key, bound on-chain to `doRecovery` only |
| Contractual influence? | Terms must say Swissquote acts as a *recovery guardian on the client's instruction only*, and that it never initiates a recovery |

**Honest grey zone:** the recovery guardian can, *together with the client's backup key*, replace the passkey. Swissquote never holds that backup key, and recovery requires a client-initiated request, identity verification and a waiting period during which the client can veto. Our position is that this is a client-controlled recovery service, not power of disposal. Because FINMA looks at substance, this is the point to confirm with FINMA before launch.

### Why being non-custodial matters even for a bank

Swissquote already holds a banking licence, so this is not about avoiding a licence. It is about what the product costs and risks:

- **Custody duties:** custodied crypto must be held so it's segregable in bankruptcy (individually or in collective custody with clear client shares), and FINMA Guidance 01/2026 (12 January 2026) tightens expectations on custody and sub-custody. [Mondaq / Borel & Barbey on FINMA Guidance 01/2026]
- **Balance sheet and liability:** Vault assets sit in the client's own on-chain account, not with Swissquote. There is nothing to segregate, nothing in Swissquote's bankruptcy estate, and no custody liability if a client loses both their phone and their backup.
- **Upcoming rules:** the Federal Council's draft amendment to the Financial Institutions Act (consultation 22 Oct 2025 to 6 Feb 2026) introduces a new crypto-institution licence for *custody* and trading of crypto-based assets. A non-custodial wallet stays outside the custody limb of that draft. [Loyens & Loeff; Digital Policy Alert]

## Wallet ownership verification (AML)

When a Swissquote client moves crypto between their Swissquote account and an external wallet, FINMA Guidance 02/2019 *"Payments on the blockchain"* (26 Aug 2019) says such transfers are only permitted if the client's *"ownership of the external wallet"* is *"proven using suitable technical means."* Article 10 AMLO-FINMA allows no exception for unregulated wallet providers. [FINMA Guidance 02/2019]

Today that means screenshots, test transactions or signed messages for each external address. Vault solves it **by construction**:

1. **Created inside a KYC'd session.** The wallet is generated after e-banking login and 2FA, and its address is registered to the client record at creation (`POST /wallet` in the prototype). The link between person and wallet exists from block zero.
2. **Cryptographic proof on demand.** The smart account implements ERC-1271, so the client's passkey can sign a Swissquote challenge message at any time. This is the "signed message" method practitioners cite as acceptable proof of private-key control. [Goldblum, Travel rule Switzerland] **Demo:** Security tab → "Sign ownership proof with passkey": the bank issues a nonce challenge, the passkey signs it, the bank verifies the signature against the wallet address on-chain and records the verification.
3. **Recovery keeps the link.** After recovery the address does not change, so Swissquote's ownership record stays valid, unlike a client who creates a new MetaMask after losing a seed phrase.

**Travel rule:** transfers between a client's Swissquote account and their own Vault are first-party transfers to a verified wallet. Third-party transfers from the Vault are peer-to-peer, as with any self-hosted wallet. Swissquote's screening in the app is a client-protection service on top, not an obligation it relies on.

## Other regulatory points

| Topic | Position |
| --- | --- |
| **Sanctions** | Counterparty screening before signing (OFAC / SECO lists via a provider such as Chainalysis or Elliptic). Protects the client and Swissquote's sponsored gas from being used for sanctioned transfers |
| **Data protection (revFADP)** | Biometrics never leave the device (WebAuthn). Swissquote stores only the wallet address, the backup key's *public* address, and recovery logs |
| **Gas sponsorship** | Swissquote pays network fees in its own name for its clients' operations. No client funds pass through Swissquote |
| **EU clients** | MiCA's custody service covers providers that control client assets. Providers of non-custodial wallet software are outside MiCA's scope (MiCA, recital 83) |
| **Client information** | Clear risk disclosure: self-custody means the client is responsible for the passkey and backup, and Swissquote cannot reverse transactions |

## What the client agreement must say

Because FINMA looks at substance and contracts, not only code, the Vault terms should state:

1. Swissquote **does not hold, control or have access to** the key that moves the client's assets, and cannot execute, block or reverse transactions.
2. Swissquote acts as a **recovery guardian on the client's instruction only**: it never initiates a recovery, signs only after identity verification and the waiting period, and the client may cancel any recovery from an existing device or replace Swissquote as guardian at any time.
3. The client is **responsible for the passkey and the backup kit**; loss of both means loss of access, as with any self-custody wallet.
4. Compliance checks in the app are **client-protection services**, not conditions on the client's ability to use their assets.
5. Gas sponsorship is a service Swissquote may limit or withdraw; the client can always pay gas themselves.

## What to ask FINMA before launch

1. Confirmation that a recovery guardian bound to a single on-chain function, unable to sign transfers, holding half of a 2-of-2 recovery key, is not power of disposal.
2. Acceptance of creation-in-KYC-session + ERC-1271 signed messages as "suitable technical means" under Guidance 02/2019.
3. Treatment under the future crypto-institution licence (if adopted) of a bank-operated non-custodial wallet.

## Sources

- [FINMA, Developments in FinTech (dossier)](https://www.finma.ch/en/documentation/dossier/dossier-fintech/entwicklungen-im-bereich-fintech/)
- [FINMA Guidance 02/2019, Payments on the blockchain (26 Aug 2019)](https://www.finma.ch/en/~/media/finma/dokumente/dokumentencenter/myfinma/4dokumentation/finma-aufsichtsmitteilungen/20190826-finma-aufsichtsmitteilung-02-2019.pdf)
- [Mondaq / Borel & Barbey, FINMA Guidance 01/2026 on the custody of crypto-based assets](https://www.mondaq.com/fin-tech/1731044/finma-has-published-guidance-012026-on-the-custody-of-crypto-based-assets)
- [MME, Provision of custody services for digital assets under Swiss law](https://www.mme.ch/en/magazine/articles/provision-of-custody-services-for-digital-assets-under-swiss-law)
- [Swiss Crypto Guide, Wallet providers & AMLA](https://www.swisscryptoguide.com/storage-provider/wallet-providers-amla/)
- [Goldblum, Travel rule Switzerland](https://goldblum.ch/knowledgebase/travel-rule-switzerland/)
- [Loyens & Loeff, FinIA amendments: new licences for payment and crypto institutions](https://www.loyensloeff.com/insights/news--events/news/swiss-federal-council-proposes-finia-amendments-new-licences-for-payment-and-crypto-institutions-to-replace-fintech-regime/)
- [Digital Policy Alert, consultation closed 6 Feb 2026](https://digitalpolicyalert.org/event/35126-federal-council-closes-consultation-on-amendment-to-financial-institutions-act-including-licensing-for-payment-instrument-institutions)
