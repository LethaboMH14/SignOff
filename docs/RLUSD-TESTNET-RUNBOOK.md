# RLUSD Testnet runbook: money, invoice sizes, re-provisioning and the demo

This runbook is for the XRP Ledger **Testnet only**. Testnet RLUSD and XRP have no value. Every command below reads or
writes the local registry, journal and Warden folders under `%LOCALAPPDATA%\SignOff\testnet` (outside the repository).
No command prints a seed, a secret or a full account address. Ledger facts are cited by TEST-LOG id.

## 1. What the spending account can really pay (read this first)

Invoices are in rand (ZAR). The ledger pays RLUSD, which the Warden treats as 1 USD. The agent converts the rand amount
to USD at a **live** USD/ZAR rate (Frankfurter, ECB reference rates) before it proposes the payment, and holds the
invoice if the rate cannot be read live (`apps/agent/src/workflow/fx-convert.ts`). At the rate read on 12 November 2026
(16.715), a R4 800 invoice needs about **287 RLUSD**. The spending account holds about **1.6 RLUSD** after the demo
(TEST-LOG T-171), so demo invoices are sized to what is really held: R16 to R50 (about 0.96 to 3.0 RLUSD).

| Quantity | Value | Source |
|---|---|---|
| Spending account RLUSD, before the demo | 2.00 (then 2.78 after the DEX top-up) | `npm run testnet:funds -- status`, T-167 and T-168 |
| Spending account RLUSD, after the first real run | 1.58 | T-171 |
| RLUSD on the Testnet DEX (sell side), all prices | about 4.4 to 5.0, most of it above 20 XRP per RLUSD | T-167 and T-172 |
| Cheapest RLUSD on the DEX | about 13 XRP per RLUSD, in lots under 0.3 RLUSD | T-167 |

The faucet route (tryrlusd) needs a wallet connection that the build session could not make, so it is not used. The
Testnet DEX is thin and its price moves between two reads of the same minute (TEST-LOG T-168). A purchase is therefore
sized from a fresh book read, under a price cap, and refused when the book cannot fill it.

## 2. Check balances and the DEX (read only, no transaction)

```bash
npm run testnet:funds -- status
```

It prints the validated ledger index, the RLUSD issuer's account flags, the spending, reserve and supplier balances,
and the sell-side depth. Use it before any demo to size invoices.

## 3. Buy RLUSD on the Testnet DEX from the reserve's XRP

A dry run first. Nothing is sent without `--confirm`:

```bash
npm run testnet:funds -- buy --rlusd 0.78 --max-xrp-per-rlusd 20
```

With `--confirm`, the reserve places one immediate-or-cancel offer (XRP for RLUSD, price capped), waits for the
validated result, measures the RLUSD it received from the balance change, and sends exactly that amount to the
spending account:

```bash
npm run testnet:funds -- buy --rlusd 0.78 --max-xrp-per-rlusd 20 --confirm
```

An offer that does not fill returns `tecKILLED`; nothing is sent to the spending account in that case.

## 4. Provision and re-provision the Testnet accounts

Run these in order. Each step is idempotent unless noted.

1. `npm run testnet:provision`: creates the six accounts (spending, reserve, supplier, agent, warden, issuer), sets the
   issuer's DefaultRipple, sets the trust lines and tops up the test token. It connects to the first Testnet endpoint
   that answers and falls back to the second (`packages/xrpl/src/constants.ts`).
2. `npm run testnet:signers`: sets the two-key signer list (Agent 1, Warden 1, quorum 2), disables the master key and
   removes the master seed from the registry. Run once per spending account.
3. Fund RLUSD with section 3, then check it with section 2.
4. `npm run demo:prepare`: writes the demo invoice, the buyer records, the Warden's configuration, keys and callers, and
   the agent's identity. It refuses to overwrite an existing Warden folder.
5. `npm run demo`: starts the Warden, the agent and the console as three processes (section 6).

**Testnet reset or a new spending account.** If the spending account is lost, its RLUSD is gone with it on the ledger.
Run `npm run testnet:rebuild -- --confirm`: it abandons the spending account, funds a new one from the reserve,
gives it the trust lines, configures its signers and refunds the old account above its reserve (TEST-LOG T-057, Gate A).
The Warden then needs the new spending address in `warden-config.json` (`spendingAddress`), and `npm run demo:prepare`
must be re-run from an empty Warden folder, because the Warden keeps a journal of paid attempts.

**Faucet limits.** The XRP faucet (`fundWallet`) is used only by `testnet:provision` for new accounts. Its daily limit
is not known from this build and is **not verified**. Re-provisioning a whole set of accounts in one day may fail; wait
and retry, and use the reserve's XRP for everything else.

## 5. The RLUSD issuer, read on the live Testnet ledger

Read on 12 November 2026 at ledger 22271756 with `npm run testnet:funds -- status` (TEST-LOG T-174):

- Issuer `rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV`: `lsfDefaultRipple`, `lsfRequireDestTag`, `lsfDisallowXRP`,
  `lsfDisableMaster`.
- **Not set:** `lsfRequireAuth`, and **`lsfAllowTrustLineLocking`**.

So the issuer does not require trust-line authorization, and it does not allow trust-line locking. The documents must not
claim an RLUSD escrow path on this issuer. The payee (supplier) account has no flags set, so no destination tag is
needed for the demo payee. The Warden now holds any payment whose payee or issuer requires authorization, or whose payee
requires a destination tag that is not enrolled (`apps/warden/src/checks.ts`).

## 6. The demo: one command, three processes

```bash
npm run demo -- --zar 16.00
```

It does this, in order, and fails loudly at the first problem with nothing half-started:

1. Refuses if `GROQ_API_KEY` is not set (environment or `.env`), if the registry or the agent and Warden seeds are
   missing, or if the demo is not prepared.
2. Refuses if a Warden already answers on port 8789. Removes stale `run.lock` folders only when no Warden answers.
3. Starts the **Warden** (`apps/warden`) with no agent or console variables, and waits for `/v1/health` to report ready.
4. Reads the live USD/ZAR rate, writes a new fictional rand invoice with a unique number into the inbox, and adds its
   records to the agent's and the Warden's buyer evidence (the Warden's record is in USD, at that rate).
5. Checks that the Warden's policy version equals the agent's, then starts the **agent** with only its own identity
   (`SIGNOFF_AGENT_ID`, `SIGNOFF_AGENT_SECRET`, `SIGNOFF_AGENT_SEED`) and its provider key.
6. Starts the **console** with only its own variables (the Warden address, the agent log, the token issuer and a
   read-only operator principal), and waits for `/api/health`.
7. Waits up to five minutes for the agent's decision on the new invoice and prints it, then keeps the three processes
   running until Ctrl+C.

Limits, stated before anyone asks: the agent's `.env` loading still reads every key in the repository's `.env`, so the
agent process can see the other provider keys; the console receives no agent secret; a model reply that is cut off or
rate-limited is a `MODEL_CALL_FAILED` hold, with no retry (Lane A); the run uses one live rate, read at start-up.

## 7. Verify a payment without the agent or the Warden

```bash
npm run demo:verify -- <64-character transaction hash>
```

It reads the transaction from the Testnet and prints whether it is validated, its result, the ledger index, the
delivered RLUSD and its issuer, the number of signers, and the explorer link. The explorer is
`https://testnet.xrpl.org/transactions/<hash>`.

## 8. What the demo does not prove

- The supplier enrolment uses the simulated identity check (`identity.ts`), and its cooling-off is **0 hours** in the
  demo config. A real bank-change call-back and a cooling-off in days are not exercised.
- The Warden does not re-read the live rate. It checks the USD amount against the USD buyer record, which the demo
  prepares from the same day's rate. Independent FX checking in the Warden is not built.
- Two signers only: the agent and the Warden. No KMS or HSM.
- Testnet money only. No licensed payout, no bank verification and no sanctions screen are involved.
