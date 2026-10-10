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
| Can Swissquote move funds alone? | **No.** Its guardian key has weight 40 of a 100 threshold and is bound on-chain to `doRecovery` only |
| Can Swissquote move funds **together with a partner**? | **No.** Swissquote 40 + partner 40 = 80 < 100: the validator contract refuses. The client's backup key (60) is required for every recovery |
| Contractual influence? | Terms must say Swissquote acts as a *recovery guardian on the client's instruction only*, and that it never initiates a recovery |

**The grey zone the challenge names: Swissquote plus a partner.** Many recovery designs (2-of-3 multisig, Shamir 2-of-3 with the bank and a partner) let the bank and a third party together restore or move the assets without the client. That shared control is the grey zone. Vault closes it **on-chain**: the weights (client backup 60, Swissquote 40, partner 40, threshold 100) mean the two institutions together reach only 80. No contract, court order or collusion between them can produce a valid recovery without the client's backup key. So there is no joint power of disposal to argue about.

**What remains:** a guardian can, *together with the client's backup key*, replace the passkey. Swissquote never holds that backup key, and recovery requires a client-initiated request, identity verification and a waiting period during which the client can veto. Our position is that this is a client-controlled recovery service, not power of disposal. Because FINMA looks at substance, this is the point to confirm with FINMA before launch.

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

## Travel Rule: when is Swissquote the sending institution?

Switzerland applies the FATF Travel Rule strictly: a supervised institution sending or receiving crypto must transmit or obtain originator and beneficiary information (Art. 10 AMLO-FINMA), and, because there is no counterpart institution for a self-hosted wallet, it may only transact with an **external wallet whose ownership by its own client has been verified** (FINMA Guidance 02/2019). Vault handles the three cases differently:

| Transfer | Is Swissquote the sending (or receiving) institution? | How Vault handles it |
| --- | --- | --- |
| Client's Swissquote account → client's own Vault (or back) | **Yes**: Swissquote executes it from its custody | The Vault is a self-hosted wallet of Swissquote's own client, **verified by construction**: created in a KYC'd session, address registered at creation, ERC-1271 ownership proof on demand (Security tab, verified on-chain). The check is automatic: no screenshots or test transactions |
| Client's Vault → a third party (person or exchange) | **No.** The client signs with their passkey and the transaction leaves the client's own account. Swissquote never holds the assets, has no key that could execute or block the transfer, and transmits nothing on the client's behalf. Paying the gas fee does not make it a party to the value transfer | Peer-to-peer, as with any self-hosted wallet. If the recipient is a VASP, that VASP sees an incoming transfer from a self-hosted wallet and may ask the sender for an ownership proof, which the Vault can sign with the passkey. Swissquote's sanctions screening still runs in the app as a client-protection service |
| Third party → client's Vault | **No**, Swissquote is not involved | Same as any self-hosted wallet. If the client later moves those funds into their Swissquote account, the first row applies |

**One point to confirm with FINMA:** whether sponsoring gas through a paymaster could be read as "participating" in a third-party transfer. Our reading is no, because the paymaster never holds or forwards client value and cannot change the transfer, but it belongs in the ruling request.

## Other regulatory points

| Topic | Position |
| --- | --- |
| **Sanctions** | Counterparty screening before signing (OFAC / SECO lists via a provider such as Chainalysis or Elliptic). Protects the client and Swissquote's sponsored gas from being used for sanctioned transfers |
| **Data protection (revFADP)** | Biometrics never leave the device (WebAuthn). Swissquote stores only the wallet address, the backup key's *public* address, and recovery logs |
| **Gas sponsorship** | Swissquote pays network fees in its own name for its clients' operations. No client funds pass through Swissquote |
| **EU clients** | MiCA's custody service covers providers that control client assets. Providers of non-custodial wallet software are outside MiCA's scope (MiCA, recital 83) |
| **Client information** | Clear risk disclosure: self-custody means the client is responsible for the passkey and backup, and Swissquote cannot reverse transactions |

## If Swissquote stops operating

The challenge asks how clients get their funds back if Swissquote's services are permanently gone. Legally and technically the answer is the same:

- **Nothing to unwind:** the assets were never in Swissquote's custody or bankruptcy estate. They sit in each client's own smart account.
- **Everyday use continues:** the passkey signs without any Swissquote server. The client pays their own gas, or uses any public paymaster.
- **Lost phone:** the client recovers with their backup kit and the **independent recovery partner** (60 + 40 = 100), contracted at onboarding. The partner is a separate, regulated Swiss entity (for example a trust company or notary) holding a guardian key in its own HSM and a copy of the client's identification under the client's consent, so it can re-verify identity without Swissquote. Demo: Security → "Switch Swissquote off" stops the mock bank process; the Vault keeps working and recovery goes through the partner.
- **Contract:** the partner agreement must survive Swissquote's insolvency, i.e. be concluded between the partner and the client (Swissquote only brokers it) and be prepaid for a multi-year term.

## What the client agreement must say

Because FINMA looks at substance and contracts, not only code, the Vault terms should state:

1. Swissquote **does not hold, control or have access to** the key that moves the client's assets, and cannot execute, block or reverse transactions.
2. Swissquote acts as a **recovery guardian on the client's instruction only**: it never initiates a recovery, signs only after identity verification and the waiting period, and the client may cancel any recovery from an existing device or replace Swissquote as guardian at any time.
3. The client is **responsible for the passkey and the backup kit**; loss of both means loss of access, as with any self-custody wallet.
4. Compliance checks in the app are **client-protection services**, not conditions on the client's ability to use their assets.
5. Gas sponsorship is a service Swissquote may limit or withdraw; the client can always pay gas themselves.
6. The **independent recovery partner** acts only on the client's instruction, only with the client's backup key, after its own identity check and waiting period; its contract is with the client and survives Swissquote.

## What to ask FINMA before launch

1. Confirmation that a recovery guardian bound to a single on-chain function, unable to sign transfers, whose key (weight 40) cannot reach the threshold even together with the partner's, is not power of disposal.
2. Acceptance of creation-in-KYC-session + ERC-1271 signed messages as "suitable technical means" under Guidance 02/2019.
3. Treatment under the future crypto-institution licence (if adopted) of a bank-operated non-custodial wallet.
4. Confirmation that Swissquote is not the sending institution for third-party transfers signed by the client from the Vault, including when Swissquote sponsors the gas.

## Sources

- [FINMA, Developments in FinTech (dossier)](https://www.finma.ch/en/documentation/dossier/dossier-fintech/entwicklungen-im-bereich-fintech/)
- [FINMA Guidance 02/2019, Payments on the blockchain (26 Aug 2019)](https://www.finma.ch/en/~/media/finma/dokumente/dokumentencenter/myfinma/4dokumentation/finma-aufsichtsmitteilungen/20190826-finma-aufsichtsmitteilung-02-2019.pdf)
- [Mondaq / Borel & Barbey, FINMA Guidance 01/2026 on the custody of crypto-based assets](https://www.mondaq.com/fin-tech/1731044/finma-has-published-guidance-012026-on-the-custody-of-crypto-based-assets)
- [MME, Provision of custody services for digital assets under Swiss law](https://www.mme.ch/en/magazine/articles/provision-of-custody-services-for-digital-assets-under-swiss-law)
- [Swiss Crypto Guide, Wallet providers & AMLA](https://www.swisscryptoguide.com/storage-provider/wallet-providers-amla/)
- [Goldblum, Travel rule Switzerland](https://goldblum.ch/knowledgebase/travel-rule-switzerland/)
- [Loyens & Loeff, FinIA amendments: new licences for payment and crypto institutions](https://www.loyensloeff.com/insights/news--events/news/swiss-federal-council-proposes-finia-amendments-new-licences-for-payment-and-crypto-institutions-to-replace-fintech-regime/)
- [Digital Policy Alert, consultation closed 6 Feb 2026](https://digitalpolicyalert.org/event/35126-federal-council-closes-consultation-on-amendment-to-financial-institutions-act-including-licensing-for-payment-instrument-institutions)
