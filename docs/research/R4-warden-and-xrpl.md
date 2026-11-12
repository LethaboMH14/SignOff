# Research R4: Warden rules, co-signing and XRPL settlement

**Scope:** BUILD-BRIEF "XRPL spike", [docs/TRUST.md](../TRUST.md), ADR 0002 (plain two-signature core), and the code on `origin/feat/console-redesign` (Warden, `packages/xrpl`, `scripts/testnet`). Read-only research; no code changed.

**Status labels.** IMPLEMENTED = code exists on the feature branch. PROVEN-ON-LEDGER = a Testnet hash exists in [docs/logs/TEST-LOG.md](../logs/TEST-LOG.md) on `main`. UNIT-TESTED = covered by offline tests only (not run in this session). UNVERIFIED = not checked.

## 0. Limitations and method (read first)

- **Sources are search excerpts, not full page reads.** Web fetching failed in this session (the shell fetch returned a temp-file error; no direct page fetch was available). Every quoted span below is a quote from a WebSearch excerpt that names the URL. Before any claim goes to judges, re-open each URL and confirm the wording.
- **Several sources are archived mirrors** (`git.inftf.org/ARCHIVE/xrpl-dev-portal`, `mduo13.github.io`). They are marked as such. Current xrpl.org wording may differ.
- **Third-party sites conflict** on RLUSD issuer addresses, the multi-signing reserve (0.2 XRP vs 5 XRP in an archived tutorial), and permission delegation activation dates. These are flagged, not resolved.
- **Nothing here is a legal opinion.** Regulatory items are flagged for counsel.
- **Mainnet and Testnet behaviour is not interchangeable.** Testnet RLUSD has no value and its faucet limits are unverified.

## 1. XRPL multi-signing facts

| Fact | Source and quoted span | Status |
|---|---|---|
| A signer list holds 1 to 32 signers, weights up to 2^16-1, and quorum must be above zero and reachable | [xrpl.org multi-signing](https://xrpl.org/multi-signing.html) excerpt: "A signer list can hold 1 to 32 addresses, each with a weight. Individual weight values cannot exceed 2^16-1." and "The quorum must be above zero and no greater than the total of all weights" | Source excerpt |
| 2-of-3 is weight 1 each with quorum 2 | Same excerpt: "For a simple M-of-N setup, give each signer weight 1 and set the quorum to M." | Source excerpt |
| One signer list per account; setting a new list replaces it; quorum 0 deletes it | Same excerpt: "Each account can have only one list... Setting the quorum to 0 deletes the list" | Source excerpt |
| Ledger will not remove the last signing method | Same excerpt: "you cannot remove the last method of signing transactions from an account." | Source excerpt |
| Disabling the master key needs another signing method first | [Disable master key pair](https://xrpl.org/docs/tutorials/how-tos/manage-account-settings/disable-master-key-pair) excerpt: "Your account must have another way of authorizing transactions, either a regular key pair or a multi-signing list." | Source excerpt |
| The disable step is `asfDisableMaster` (value 4) and must be signed by the master key | Same page excerpt: "The disable step is an AccountSet transaction with the asfDisableMaster flag (value 4). Unlike most transactions, this one MUST be signed with the master key pair for the account." | Source excerpt |
| The master key can be re-enabled, although an SDK page says irreversible | Same page excerpt: "Re-enabling is possible. You send an AccountSet transaction with ClearFlag". An SDK page (simplexrpl) conflicts, so the official page is taken as authoritative | Conflict noted |
| The on-chain disable value in this repo is 4 | `packages/xrpl/src/constants.ts` line 31: `ASF_DISABLE_MASTER = 4`; line 35: `LSF_DISABLE_MASTER = 0x00100000` (feat/console-redesign) | IMPLEMENTED |
| Signed fee for a multisigned transaction: at least (N+1) times the reference cost | [xrpl.org multi-signing](https://xrpl.org/docs/concepts/accounts/multi-signing.md) excerpt: "the transaction cost (specified in the Fee field) must be at least (N+1) times the normal transaction cost, where N is the number of signatures". With a 10-drop reference, N=2 gives 30 drops. The repo passes `2` to autofill at the call site in `service.ts` (`autofill(paymentFor(terms), 2)`, around line 930); the port forwards it to xrpl.js `autofill` (`xrpl-port.ts` lines 226-230) | Source excerpt; code consistent |
| Multi-sign reserve | An official excerpt gives 0.2 XRP under the MultiSignReserve amendment; an archived tutorial says 5 XRP | UNVERIFIED (conflict) |
| How a multisigned transaction is assembled | Repo: each signer calls `wallet.sign(tx, true)` (`multisig.ts` line 4-6), blobs combined with `multisign()` (line 9-14), then checked for exactly the expected signers (line 25-33) | IMPLEMENTED, UNIT-TESTED |
| Two-signature payment proven on Testnet | [docs/logs/TEST-LOG.md](../logs/TEST-LOG.md) on `main`, T-059: "validated tesSUCCESS in ledger 22255596 on the first attempt; delivered amount 1 RLUSD from the expected issuer; two signers (Agent and Warden), empty single-signature key" with hash 3CCC034B2A36A8567625875B4C32B0AC5D3B1875696706ABA27858B1586265F9 | PROVEN-ON-LEDGER (1 RLUSD) |
| Sequence and tickets | [xrpl.org tickets](https://xrpl.org/tickets.html) excerpt: "Creating Tickets advances the account's normal sequence, while using one leaves it unchanged" and "Within an individual ledger, transactions that use Tickets execute after other transactions from the same sender." Limit: "up to 250 per account" | Source excerpt; repo does not use tickets |
| Ticket consumed only on consensus | Same excerpt: "sending a transaction uses up the Ticket if and only if the transaction is confirmed by consensus." XLS-13 is the standard (xls.xrpl.org XLS-0013) | Source excerpt |

**What the ledger can and cannot restrict.** The signer list only sets *weights and quorum for who may sign*. It does not restrict which transaction types the signers send together. Nothing in the sources above says a signer list can limit transaction types. The brief and ADR 0002 say the same (`BUILD-BRIEF.md` "This baseline does not let the ledger restrict which transaction types the two signers send together"). **Warden must refuse non-payments.** The repo does this: `apps/warden/src/payment.ts` line 61-67 refuses any `TransactionType !== 'Payment'`, and line 54 refuses `Paths`, `SendMax`, `DeliverMin`, `Memos`.

**Permission delegation status.** Not verified on Testnet. Search excerpts describe a corrected feature (`PermissionDelegationV1_1`) in xrpld 3.3.0 with activation dates that conflict (5 Oct, 8 Oct 2026 in different reports). Source: [a RippleX-linked news excerpt](https://en.coin-turk.com/xrp-permission-delegation-amendment-enters-final-activation-window-upgrade-set-for-october-5/) and [cryptodaily](https://cryptodaily.co.uk/2026/09/xrpl-permission-delegation-v1-1-activation-countdown). ADR 0002 already records that delegation is a stretch goal. **Do not claim delegation until the Testnet check in BUILD-BRIEF passes.** UNVERIFIED.

## 2. RLUSD specifics

| Fact | Source and quoted span | Status |
|---|---|---|
| Official RLUSD XRPL docs | [Ripple: RLUSD on the XRPL](https://docs.ripple.com/products/stablecoin/developer-resources/rlusd-on-the-xrpl) excerpt: "Once your trust line is set up, you can obtain Testnet RLUSD tokens by visiting the RLUSD faucet at https://tryrlusd.com/." | Source excerpt |
| Testnet issuer | Same page (excerpt): testnet issuer `rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV`. Repo: `packages/xrpl/src/constants.ts` line 19 `issuer: 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV'` | Matches |
| Mainnet issuer | Same excerpt lists `rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De` for mainnet. Third-party sites list other addresses; the excerpt warns to confirm on an explorer | UNVERIFIED (confirm on explorer) |
| Currency code, 40 hex | Ripple testnet examples use `524C555344000000000000000000000000000000` (ASCII "RLUSD" padded to 20 bytes). The search summary says this is the standard non-3-character form; the expansion itself is the model's understanding, not a source quote | Model inference, to confirm in docs |
| Trust lines | Ripple docs excerpt: users establish a trust line with the issuer to receive, hold and transfer the token | Source excerpt |
| Trust-line limit in repo | `constants.ts` line 42: `TRUST_LIMIT_RLUSD = '100000'` | IMPLEMENTED |
| Issuer flags seen on Testnet | `T-063` in main TEST-LOG: "DefaultRipple set; RequireAuth not set; GlobalFreeze not set; spending and supplier lines: balance 0, limit 100000, no freeze, no authorization requirement" (read-only check) | PROVEN-ON-LEDGER (flags, read-only) |
| Freeze and No Freeze | [xrpl.org freezes](https://xrpl.org/freezes.html) excerpt: "The issuer can still enact a Global Freeze, but cannot disable the Global Freeze" (archived mirror says the same). Individual freeze is a trust-line setting | Source excerpt (archived copy also) |
| Clawback | [XLS-0039](https://xls.xrpl.org/xls/XLS-0039-clawback.html) excerpt: "Issued tokens can be clawed back by an issuer if, and only if, lsfAllowTrustLineClawback is set." and clawback "requires the issuer to have an empty owner directory" | Source excerpt |
| Clawback can move frozen funds | xrpl.org clawing-back-tokens excerpt: clawback "can claw back funds even when those funds are frozen, because they operate directly between the issuer and holder." | Source excerpt |
| Deep freeze | [XLS-0077](https://xls.xrpl.org/xls/XLS-0077-deep-freeze.html) adds `tfSetDeepFreeze`/`tfClearDeepFreeze` on TrustSet | Source excerpt |
| Transfer fee | Not checked in this session | UNVERIFIED |
| Freeze, both chains, legal process | Press excerpts say RLUSD can be frozen or clawed back when Ripple is ordered to by law enforcement or courts. These are secondary sources | Secondary, UNVERIFIED |
| Repo freeze check | `apps/warden/src/checks.ts` lines 166-171: refuses on `issuerGlobalFreeze`, `frozenByIssuer`, `frozenByHolder` (IMPLEMENTED, UNIT-TESTED) | IMPLEMENTED |
| Faucet limit | Excerpt: "The search confirms that tryrlusd.com is the RLUSD testnet faucet, but it doesn't confirm the 10 RLUSD per day limit." The 10 RLUSD/day figure comes from the team brief and is UNVERIFIED | UNVERIFIED |
| Testnet vs mainnet | Ripple docs excerpt: Testnet RLUSD "holds no financial value, are intended for testing purposes only, and are not backed by real-world assets." | Source excerpt |
| Ripple compliance features | The search did not retrieve Ripple's primary compliance page. The freeze and clawback statements above are the only compliance-relevant excerpts | UNVERIFIED (gap) |

## 3. Reliable submission and edge cases

**Result classes.** [xrpl.org transaction results](https://xrpl.org/transaction-results.html) and the tec/tef/tem/ter pages excerpt:

- tec: "missed its goal but still destroyed the transaction cost, and this result is only final in a validated ledger."
- tef: "not applied to ledgers" but "a provisional tef result may still succeed or fail with a different code after being reapplied" (from the tef excerpt on [xrpl.org/tef-codes](https://xrpl.org/tef-codes.html)).
- tem: "final unless the rules for a valid transaction change."
- ter: "not been applied to the current ledger"; provisional.
- tesSUCCESS: "only final when the transaction appears in a validated ledger with the result code tesSUCCESS" ([xrpl.org consensus structure](https://xrpl.org/consensus-structure.html)).

**How the repo classifies them** (`packages/xrpl/src/results.ts` lines 11-23): `tesSUCCESS`/`terQUEUED` = accepted; `tec*` = applied-failure; `tef*`/`tem*` = rejected; `ter*`/`tel*` = deferred. IMPLEMENTED, UNIT-TESTED.

**Gap found.** `packages/xrpl/src/reliable.ts` lines 99-106: a submit result classed `rejected` is written to the journal as final, except `tefPAST_SEQ` and `tefALREADY`. Because the excerpt says a provisional tef "may still succeed" after reapplication, a `tef` reply is not fully final. Recommendation: on any `rejected` submit reply, reconcile the hash once against validated history before marking the journal `rejected` (SHOULD).

**Specific codes the team asked about.** The repo's offline fake ledger simulates `tecPATH_DRY`, `tecUNFUNDED_PAYMENT`, `tecNO_LINE` (`packages/xrpl/test/helpers/fake-ledger.ts` lines 304-373). Live Testnet proof does not cover them. The pages above give their meanings; `tec` means fee is spent and nothing moved. Reconcile logic maps any validated non-`tesSUCCESS` to `failed` (`reconcile.ts` lines 62-75). UNIT-TESTED only.

**Partial payments and delivered amount.** [xrpl.org partial payments](https://xrpl.org/partial-payments.html) excerpt: "The correct way to process incoming Payment transactions is to use the delivered_amount metadata field, not the Amount field." Archived text: "there is no minimum guaranteed amount that a partial payment actually delivers." Repo:
- Refuses any flag other than `tfFullyCanonicalSig` (`apps/warden/src/payment.ts` lines 104-110). A `tfPartialPayment` flag is therefore refused before signing (IMPLEMENTED, UNIT-TESTED; to confirm by reading the test).
- Settles only when the **delivered** amount matches (`reconcile.ts` lines 46-53, `deliveredMatches`). Unknown delivered amount is never a match (IMPLEMENTED, UNIT-TESTED).

**Destination tags.** [xrpl.org require destination tags](https://xrpl.org/require-destination-tags.html) excerpt: "a payment without a tag fails with tecDST_TAG_NEEDED". Repo: `payment.ts` lines 70-80 enforces the enrolled tag and refuses a tag when the payee has none. **Gap:** the pre-signing check (`checks.ts` `preSigningVerdict`, lines 144-183) does not read the payee's `lsfRequireDestTag`, so a payee that requires a tag but has none enrolled would fail at submission with `tecDST_TAG_NEEDED` rather than being held (SHOULD).

**Expiry, LastLedgerSequence and retries.** [Archived reliable-tx docs](https://git.inftf.org/ARCHIVE/xrpl-dev-portal/raw/commit/4bf117a3dbb58edbf60f40cb18a4b4e74b51f6ec/reliable_tx.html) excerpt: "Persist the transaction hash, LastLedgerSequence, and account sequence number before submitting". Also: "The XRP Ledger never includes a transaction in a ledger instance whose sequence number is higher than the transaction's LastLedgerSequence parameter." Repo:
- Persist before submit: `reliable.ts` lines 91-104 write `prepared` and `submitting` before `port.submit`. IMPLEMENTED, UNIT-TESTED.
- Expiry margin: `constants.ts` line 50, `LEDGER_SAFETY_MARGIN = 2`; `reconcile.ts` lines 76-79 declare "expired" only when a validated ledger exceeds LastLedgerSequence plus the margin. Stronger than the bare rule.
- Identical blob resent on retry: `reliable.ts` lines 117-122 ("The transaction is never rebuilt, so it cannot apply twice").

**Ledger gaps and validated versus provisional.** Excerpt from [xrpl.org consensus structure](https://xrpl.org/consensus-structure.html): "Results in a validated ledger are fixed, while provisional API results can change." The "no forks" framing is the model's inference from "only one of the candidate ledgers can be validated"; it is not a quoted claim. Ledger-gap verification (the archived doc says "Verify first that the ledger history is contiguous") is **not implemented** in the repo: UNVERIFIED gap.

**Node failover and duplicate submission.** Repo: `xrpl-port.ts` lines 281-303 tries allow-listed Testnet endpoints in order and refuses any endpoint not reporting the testnet network ID. Live T-056 proved failover on a simulated outage; T-055 proved reconciliation after dropped responses. Both use TST (test-issued), not RLUSD, and both are simulated outages (labelled as such in the TEST-LOG).

**Reorg risk.** Not a practical risk under the cited design: the consensus page says "only one can be validated" per index. The repo treats a validated outcome as final.

## 4. Warden design soundness

**Independence.** TRUST.md and BUILD-BRIEF require a separate deployment, identity and key for Warden. Code: `apps/warden/src/config.ts` lines 115-130 keeps the Warden seed in a separate keys file that only the Warden process reads. Current design is plaintext JSON (`wardenSeed` field, a family-seed regex). That is acceptable for the demo, not for production (see gaps).

**Key storage options (for later, not demo).**
- Google Cloud KMS: the [algorithms page](https://docs.cloud.google.com/kms/docs/algorithms) excerpt says the secp256k1 option is "ECDSA with a SHA-256 digest" under `ASYMMETRIC_SIGN` with API name `EC_SIGN_SECP256K1_SHA256`. The same page recommends P-256 as default. Cloud HSM can generate such a key in an HSM-protected form (per Google's Bitcoin custody page excerpt).
- AWS KMS: the key spec `ECC_SECG_P256K1` supports secp256k1 signing; the simpleXRPL tutorial says its adapter "keeps the private key inside KMS, and the SDK hands KMS a digest and assembles the signature" ([opensource.ripple.com simplexrpl AWS KMS signer](https://opensource.ripple.com/docs/simplexrpl/tutorials/implement-aws-kms-signer)).
- Both need a custom signer in place of `Wallet.sign`. Repo `multisig.ts` `signAsSigner` uses `wallet.sign` directly. Migration = swap the signer and check that the signature's public key derives the Warden address (UNVERIFIED on this stack).
- HSM: GCP Cloud HSM for the signing key is the "SHOULD for production" option; a Secret Manager secret holding the seed is weaker (the seed is readable in process memory).

**Why Warden verifies evidence itself.** The agent is an LLM. ADR 0001 and the brief say invoice contents are untrusted. The code follows this: `propose` re-checks the proposal schema (`service.ts` lines 318-330), payee is looked up by Warden (`supplierOrThrow`), and the ledger is read by Warden (`readPreSigning`). A trusted-agent design would let a hostile invoice set the payee.

**Pre-signing ledger read.** `service.ts` lines 404-470 (coSign): under the exclusive lock, Warden checks expiry, pause, payee unchanged, policy version, limits, asset, then calls `readPreSigning` and `preSigningVerdict`. Checks spending master disabled, no regular key, signer list matches, issuer global freeze, trust-line freezes, balance, destination line and receiving capacity (`checks.ts` 144-183). IMPLEMENTED, UNIT-TESTED.

**Gap in the pre-sign read.** The read is a snapshot. Between the read and the validated ledger, a freeze or a balance change can happen; Warden only re-checks at the next propose. The residual window is inherent to any pre-signing check and is what the expiry and reconcile logic catches after the fact. Document it as a residual risk, not a solved one.

**Atomic reservation and idempotency.**
- In-process serialisation: `service.ts` line 1090-1094 `exclusive()` is a promise chain. **This only holds for one process.** Two Warden replicas would each hold their own lock. Hosting is undecided (`docs/ENGINEERING.md` line 115 on feat/console-redesign). Demo must run one instance (MUST-FOR-DEMO).
- Reservation: `checks.ts` lines 59-75 (`dailyUsage`) counts unresolved and paid attempts. `service.ts` lines 881-884 allow at most one unresolved transfer per spending account (`ACCOUNT_BUSY`). Duplicate by payable: lines 843-849. Journal duplicate check: `priorAttemptOf` (lines 917-925).
- Persistence: `apps/warden/src/events.ts` lines 228-231 `writeFileSync` then `fsyncSync` per line. Good for crash safety on one disk.
- Idempotency sources: [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests) excerpt: "Stripe saves the status code and body of the first request made with a given idempotency key after endpoint execution begins." and "Stripe retains keys for at least 24 hours and can remove them after that." The repo's key is different: a journal keyed by obligation, which is stronger for money than an HTTP key.

**Limits and exposure.** `checks.ts` `limitVerdict` (per-payment, per-supplier, daily). Exposure is the spending account's actual balance plus the trust-line limit (100000, `constants.ts` line 42). The brief and TRUST.md say the trust-line limit is not a loss cap. Agree.

**Pause and STOP.** `service.ts` `setPaused` (defined just after `coSign`); `coSign` refuses when paused (around lines 412-417). Live pause proof: T-124 (per Gate E notes, `side-session-notes`), not re-verified here.

**The #45 class (co-signature exposed before final checks).** Code: `propose` returns only unsigned terms (`service.ts` lines 318-330, `toCoSign`), and the comment at the `encode(prepared)` call in `service.ts` `propose` says "The proposal must NEVER contain a Warden signature". `coSign` signs only after all checks (`service.ts` line 470-500: `finalizeAgentSignature` runs `signAsSigner` after `assertWardenPayment` and `assertSignedExactly`). Regression: T-134 per Gate E notes. Residual: the field is named `wardenBlob` but holds UNSIGNED terms (Gate E notes, flagged for rename).

**TOCTOU and replay.**
- TOCTOU: see pre-sign read above.
- Replay of a captured change request: `state.ts` line 91-93 `usedChangeNonces` prevents reuse.
- Replay of a payment: the blob is bound to `Sequence` and `LastLedgerSequence` (`payment.ts` lines 113-121 `BOUND_FIELDS`); a second blob with the same hash cannot apply twice (the ledger rule).

## 5. Real-world payout reality

**On and off ramps.** [Yellow Card API](https://yellowcard.io/api) excerpt: "Integrate seamless finance, powered by Stablecoins, into your business" (on- and off-ramps in 20 countries per the marketing copy). TechCabal ([2025-09-05](https://techcabal.com/2025/09/05/ripple-brings-its-rlusd-stablecoin-to-africa/)) reports RLUSD reaching Africa via Chipper Cash, VALR and Yellow Card. Fireblocks' Yellow Card page lists ZAR and ZMW fiat but names no RLUSD or XRP. **Conclusion:** Yellow Card is a candidate; whether it pays out RLUSD to ZAR bank accounts is **UNVERIFIED**. Ask Yellow Card directly.

**Yellow Card licensing.** [Financefeeds](https://financefeeds.com/yellow-card-secures-casp-license-in-south-africa-as-demand-for-stablecoins-grow/) excerpt: Yellow Card "secured a Crypto Asset Service Provider (CASP) license from the Financial Sector Conduct Authority (FSCA)". Secondary source.

**FX rates and cooling-off.** No rate source is cited in the repo. The console labels the rand rate "a placeholder from configuration" (`docs/logs/BUILD-LOG.md` line 238 on feat/console-redesign). Not researched here: candidate sources are the SARB published rates (UNVERIFIED) and the conversion provider's quote.

**Travel rule, South Africa.** [FIC Directive 9 of 2024](https://acts.co.za/news/blog/2025/05/fic-directive-9-2024-crypto-travel-rule) excerpt: Directive 9 applies to "accountable institutions registered for Item 22 of Schedule 1" and "transposes FATF Recommendation 16", with a "30 April 2025" effective date reported by most sources. Directive 9 excludes fiat transfers per one source (not confirmed against the text). Draft guidance: [acts.co.za March 2026](https://acts.co.za/news/blog/2026/03/fic-crypto-travel-rule-draft-guidance).

**Exchange control, South Africa (important).** [Werksmans via Polity, 2026-08-05](https://www.polity.org.za/article/south-africas-crypto-crackdown-draft-manual-brings-cross-border-crypto-asset-transactions-under-exchange-control-2026-08-05) excerpt: a draft Crypto Asset Manual for Cross-Border Activities (comments due 30 September 2026) would limit cross-border crypto to natural persons: "only natural persons may do cross-border crypto transactions, and resident companies and trusts are excluded." It also reports remittance caps of "R5,000 per transaction per day and R25,000 per month." A supplier is a company. **This may make an RLUSD cross-border payment to a South African company impossible or unlawful under the draft.** Needs counsel before any real pilot. Also see [Moonstone](https://www.moonstone.co.za/draft-manual-sets-out-proposed-cross-border-crypto-regime/).

**Zambia.** [Zambia Monitor](https://www.zambiamonitor.com/bank-of-zambia-calls-for-registration-of-cryptocurrency-service-providers/) excerpt: the Bank of Zambia required "all virtual asset and stablecoin service providers to register by March 27, 2026" under CB Circular No. 05/2026 (dated 10 March 2026). That deadline has passed. Whether the buyer or the agent entity must register, and whether any licence exists, is **UNVERIFIED**. Needs counsel.

**Travel rule, global.** [Mayer Brown on FATF June 2025](https://www.mayerbrown.com/en/insights/publications/2025/08/fatf-revises-aml-standards-for-certain-funds-transfers) excerpt: the revised Recommendation 16 applies to "payments or value transfers and related messages"; generally takes effect "at the end of 2030" and is implemented by jurisdictions. Guidance is pending. Secondary commentary is inconsistent; check FATF.

**Why the ZAR payout is labelled SIMULATED.** No licensed off-ramp is integrated, and the exchange-control and licensing answers above are open. Labelling it SIMULATED is the honest position, consistent with BUILD-BRIEF ("Any conversion or payment of ZAR to a supplier is labelled simulated").

**Idempotency for the payout step.** A payout provider call must carry an idempotency key, as in the [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests) pattern, and the unknown-outcome rule ("If you can't establish what happened, contact [the provider] before repeating the operation") applies.

## 6. What SignOff does today

Source: `origin/feat/console-redesign` (not `main`, which holds only the foundation, Gate A proof and CI).

| Area | Status | Evidence |
|---|---|---|
| Signer configuration (Agent 1, Warden 1, quorum 2, master disabled, no regular key, seed removed) | PROVEN-ON-LEDGER (TST) | T-052 (`packages/xrpl/src/signers.ts` lines 58-147); T-058 independent read-only check |
| Two-signature payment, test-issued token | PROVEN-ON-LEDGER | T-053, hash 06BB715FDC45B33A12BEA75553B7D4013E76D589B36284C6E38976FDD5D98E61 (main TEST-LOG) |
| Two-signature payment, **RLUSD** (1 RLUSD) | PROVEN-ON-LEDGER | main TEST-LOG T-059 (ledger 22255596, hash 3CCC034B2A36A8567625875B4C32B0AC5D3B1875696706ABA27858B1586265F9). 10 RLUSD run still open |
| Single-key rejections (Agent alone, Warden alone) | PROVEN-ON-LEDGER on TST | T-054: four refusals with `tefBAD_QUORUM` (payment and signer-list change, each key alone). **Not yet on RLUSD** |
| Response loss (reconcile by hash) | PROVEN-ON-LEDGER on TST, simulated outage | T-055 hash 2BE68325C41C8A5AD8A4DB4870A0C0A0D2B53ABCEB14F0708680D294F4C9838C |
| Endpoint failover | PROVEN-ON-LEDGER on TST, simulated outage | T-056 hash 6C7426519532359D66DE23E3A3F4AC64FD2F01004BEC2829F7925CD545558F55 |
| Account abandon and rebuild | PROVEN-ON-LEDGER on TST | T-057 with three hashes; T-058 check |
| Warden propose/coSign split, pre-sign read, pause | IMPLEMENTED, UNIT-TESTED (`apps/warden/src/service.ts`, `checks.ts`, `ledger-read.ts`) | Tests referenced in Gate E notes (T-124, T-134); **not run in this session** |
| Journal, persist-before-submit, expiry reconcile | IMPLEMENTED, UNIT-TESTED (`packages/xrpl/src/reliable.ts`, `reconcile.ts`) | Tests in `packages/xrpl/test/` (not run here) |
| Live Testnet pause and co-sign refusal | Gate E notes cite T-124 (live pause proof) | Not re-verified |
| Multi-replica safety | NOT IMPLEMENTED (single-process lock) | `service.ts` 1090 |
| Production key storage (KMS/HSM) | NOT IMPLEMENTED | `config.ts` 115-148 plaintext seed |
| Ledger-gap check, tickets, delegation | NOT IMPLEMENTED | none in code |
| ZAR payout | SIMULATED | BUILD-BRIEF, D-042 and S-020 in SECURITY-LOG |

**Documentation inconsistency (MUST fix).** `origin/feat/console-redesign` still says RLUSD is BLOCKED: `docs/ENGINEERING.md` line 47, `docs/ISSUES.md` line 32 (A3 "Doing (RLUSD run blocked, T-059)"), and TEST-LOG T-059 "BLOCKED". `main` TEST-LOG T-059 records PASS (1 RLUSD). The console docs must be updated before demo, or a judge reading the branch will see the proof as blocked.

## 7. Gaps and recommendations (ranked)

**MUST-FOR-DEMO**
1. **Update the stale BLOCKED docs** on the console branch (ENGINEERING.md 47, ISSUES.md 32, TEST-LOG T-059 and the security-log S-020 wording) to match the validated RLUSD result on main. Label it as 1 RLUSD; the 10 RLUSD run is open.
2. **Run single-key rejections on RLUSD** (T-054 was on TST only). Brief acceptance requires rejection with the Agent key alone and with the Warden key alone.
3. **Run one Warden instance** for the demo; the in-process lock is not safe across replicas. Record this as a limitation.
4. **Demonstrate the changed-payee hold and the lowered-limit hold** (brief acceptance). Pre-signing and payee checks exist; a live Testnet run of each is not in the TEST-LOG.
5. **Label the test token and the simulated ZAR payout** on every receipt (TEST-LOG and S-020 already do this for TST).

**SHOULD**
6. **Reconcile before marking a `tef`/`tem` submit as final** (`reliable.ts` 99-106). Cheap fix; one ledger lookup before the journal write.
7. **Read `lsfRequireDestTag` on the payee in the pre-sign check** (`checks.ts` `preSigningVerdict`), so a tag-required payee holds rather than fails on the ledger.
8. **Check `lsfRequireAuth` on the issuer and the destination's authorization** before signing. Not read in the current code; Testnet issuer shows RequireAuth not set (T-063), so it is a production-readiness item.
9. **Ledger-gap check** before any retry (archived reliable-tx guidance).
10. **Rename `wardenBlob`** to `unsignedWardenTerms` (Gate E notes).

**LATER**
11. **Production key storage**: move the Warden seed to a secp256k1 KMS or Cloud HSM signing key with a custom signer. Verify the derived address equals the registered Warden address before cutover.
12. **Permission delegation** (optional, per ADR 0002). Only after a Testnet check of `PermissionDelegationV1_1` status.
13. **Tickets** for concurrent payments across obligations. Current design uses one unresolved attempt per account, so tickets are not needed for the demo.
14. **Counsel review** of the SA exchange-control draft (a company cannot use the draft crypto cross-border route), the Zambia registration status, and the travel-rule position of the agent entity.
15. **Yellow Card or another off-ramp**: confirm RLUSD support and ZAR payout in writing before any pilot claim.

## 8. Sources

External (accessed 12 Nov 2026 via search excerpts; re-open before citing):

1. [xrpl.org multi-signing](https://xrpl.org/multi-signing.html)
2. [xrpl.org multi-signing concept](https://xrpl.org/docs/concepts/accounts/multi-signing.md)
3. [xrpl.org disable master key pair](https://xrpl.org/docs/tutorials/how-tos/manage-account-settings/disable-master-key-pair)
4. [xrpl.org SignerListSet](https://xrpl.org/signerlistset.html)
5. [xrpl.org SignerList ledger entry](https://xrpl.org/docs/references/protocol/ledger-data/ledger-entry-types/signerlist)
6. [xrpl.org transaction results](https://xrpl.org/transaction-results.html)
7. [xrpl.org tef codes](https://xrpl.org/tef-codes.html)
8. [xrpl.org tec codes](https://xrpl.org/tec-codes.html)
9. [xrpl.org consensus structure](https://xrpl.org/consensus-structure.html)
10. [xrpl.org consensus](https://www.xrpl.org/consensus.html)
11. [xrpl.org partial payments](https://xrpl.org/partial-payments.html)
12. [xrpl.org require destination tags](https://xrpl.org/require-destination-tags.html)
13. [xrpl.org tickets](https://xrpl.org/tickets.html) and [XLS-0013](https://xls.xrpl.org/xls/XLS-0013-tickets.html)
14. [xrpl.org freezes](https://xrpl.org/freezes.html)
15. [XLS-0039 clawback](https://xls.xrpl.org/xls/XLS-0039-clawback.html)
16. [XLS-0077 deep freeze](https://xls.xrpl.org/xls/XLS-0077-deep-freeze.html)
17. [Ripple: RLUSD on the XRPL](https://docs.ripple.com/products/stablecoin/developer-resources/rlusd-on-the-xrpl)
18. [Ripple RLUSD-Implementation settings](https://raw.githubusercontent.com/ripple/RLUSD-Implementation/main/doc/rlusd-xrpl-settings.md)
19. [Archived reliable transaction submission](https://git.inftf.org/ARCHIVE/xrpl-dev-portal/raw/commit/4bf117a3dbb58edbf60f40cb18a4b4e74b51f6ec/reliable_tx.html) (archived)
20. [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
21. [Google Cloud KMS algorithms](https://docs.cloud.google.com/kms/docs/algorithms)
22. [simpleXRPL AWS KMS signer](https://opensource.ripple.com/docs/simplexrpl/tutorials/implement-aws-kms-signer)
23. [Yellow Card API](https://yellowcard.io/api)
24. [TechCabal: RLUSD in Africa](https://techcabal.com/2025/09/05/ripple-brings-its-rlusd-stablecoin-to-africa/)
25. [Financefeeds: Yellow Card CASP licence](https://financefeeds.com/yellow-card-secures-casp-license-in-south-africa-as-demand-for-stablecoins-grow/)
26. [Mayer Brown: FATF Recommendation 16 revision](https://www.mayerbrown.com/en/insights/publications/2025/08/fatf-revises-aml-standards-for-certain-funds-transfers)
27. [acts.co.za: FIC Directive 9](https://acts.co.za/news/blog/2025/05/fic-directive-9-2024-crypto-travel-rule)
28. [acts.co.za: FIC draft guidance, March 2026](https://acts.co.za/news/blog/2026/03/fic-crypto-travel-rule-draft-guidance)
29. [Polity (Werksmans): SA draft crypto cross-border manual, 5 Aug 2026](https://www.polity.org.za/article/south-africas-crypto-crackdown-draft-manual-brings-cross-border-crypto-asset-transactions-under-exchange-control-2026-08-05)
30. [Moonstone: draft cross-border crypto regime](https://www.moonstone.co.za/draft-manual-sets-out-proposed-cross-border-crypto-regime/)
31. [Zambia Monitor: BoZ registration](https://www.zambiamonitor.com/bank-of-zambia-calls-for-registration-of-cryptocurrency-service-providers/)
32. [Permission delegation activation reports (cryptodaily)](https://cryptodaily.co.uk/2026/09/xrpl-permission-delegation-v1-1-activation-countdown) (secondary)

Internal (repo, `origin/feat/console-redesign` unless stated; `main` for TEST-LOG T-059):
- `packages/xrpl/src/multisig.ts`, `signers.ts`, `payments.ts`, `reliable.ts`, `reconcile.ts`, `results.ts`, `constants.ts`, `xrpl-port.ts`
- `apps/warden/src/service.ts`, `payment.ts`, `checks.ts`, `ledger-read.ts`, `config.ts`, `events.ts`, `state.ts`
- `scripts/testnet/gate-a.ts`
- `docs/TRUST.md`, `BUILD-BRIEF.md`, `docs/decisions/0002-plain-multisign-core.md`, `docs/logs/TEST-LOG.md` (main T-059; branch T-053 to T-058, T-063)

## Limitations and what I could not verify

- Web fetching of full pages failed; all external wording is from search excerpts. Re-read each URL before citing.
- Ripple's compliance-feature page, mainnet RLUSD issuer, and RLUSD transfer fee were not retrieved.
- The 10 RLUSD/day faucet limit is not verified.
- Permission delegation activation on Testnet is not verified.
- Multi-sign reserve (0.2 vs 5 XRP) conflicts between sources.
- Did not run the Warden or xrpl test suites in this session; "UNIT-TESTED" means the test file exists, not that it passed today.
- Live pause proof (T-124) and the 10 RLUSD run are cited from Gate E notes and the TEST-LOG; not re-verified on-ledger.
- Regulatory positions for South Africa and Zambia are from secondary sources and need counsel. Nothing here is legal advice.
- The model's own statements (currency-code expansion, "no forks" inference) are labelled as inference.
