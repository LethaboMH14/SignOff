# For judges: where SignOff stands against the criteria

Written 13 November 2026 for judging on 14 November. Every row links evidence. States follow rule R-1: *Live on
Testnet*, *Simulated*, *Planned*, *Not claimed*. Testnet RLUSD has no real value; invoices, suppliers and buyers are
fictional; the rand payout to a supplier is simulated.

## Check it yourself in five minutes

| What | How | Expect |
|---|---|---|
| The tests | `npm ci && npm run check` | 143 test files, 1,628 tests pass, build succeeds |
| The attacks | `npm run attack` | 26 of 26 attack cases held, refused or rejected as expected |
| The judge check (offline, no keys) | `npm run judge:check` | 3 pass, 0 fail |
| A paid invoice on the public ledger | Open [E1BA2278…4A5E](https://testnet.xrpl.org/transactions/E1BA22785622CBC3FAAEB2236BC4AA782128B8CDA80D412823DAEE1E1A104A5E) | Validated RLUSD payment, two signers, co-signed by the hosted Warden |
| The 10 RLUSD run | [821333EB…0728](https://testnet.xrpl.org/transactions/821333EBE1DBC5BAE93DDC2BE6872908A62EF7F1617C823A19305E0DF76A0728) | 10 RLUSD, two signers |
| The hosted Warden | https://warden-production-4f0fcb91.up.railway.app/v1/health | `"ready":true`; every other route needs a signed request |
| The console (simulated replay) | https://signoff-console-simulated.vercel.app (sign-in) | "Play a clean invoice" and "Play a bank-detail change attack" |

## Track requirements (Ripple, Agentic Finance)

| Requirement | Met? | Evidence |
|---|---|---|
| An autonomous transaction on XRPL Testnet | **Yes, live** | An emailed invoice paid with no click, about 21 s from sending (T-264); hosted-Warden payment (T-268) |
| Limits enforced outside the agent's control | **Yes, live** | The Warden held a payment `OVER_LIMIT` (T-264) and an uncredentialed supplier `SUPPLIER_CREDENTIAL_MISSING` (T-266); each key alone is refused by the ledger, `tefBAD_QUORUM` (T-054, re-run 13 Nov) |
| A human operator can set or change limits | **Yes**, in software and on the local config | Console limits and pause (T-095, T-104); the operator raised the daily limit on 13 Nov (T-264). The two-person rule for increases needs two operator accounts |
| "Powered by MCPs" (track description) | **No** | The agent calls the Warden's signed HTTP API. An MCP interface was designed and not built ([SOLUTION.md](SOLUTION.md)) |

## Product design (33%): user experience, interface, usability, flow, accessibility, polish

| Strength | Evidence |
|---|---|
| A finance desk with a queue, invoices, and a Warden and limits tab; a receipt with explorer link and delivered amount | T-258, T-098 to T-105 |
| The Agent map shows each invoice moving through the agents live; a fraud attempt stops visibly at the hold lane | T-259, T-262 |
| Plain-language reasons on every hold ("the invoice says the bank details have changed") | Console tests; T-265 |
| Keyboard and accessibility scan; reduced motion respected | T-107, T-109 |
| Labels on everything simulated | README status table |

**Gaps:** phone-width browser check and the live receipt are UNVERIFIED (T-108, T-133); no usability test with a real
finance clerk.

## Technical UX (34%): code quality, architecture, functionality, deployment, performance, reliability

| Strength | Evidence |
|---|---|
| Two independent keys; the ledger refuses either alone | T-052, T-054, re-run 13 Nov ([RELEASE-CHECKS](RELEASE-CHECKS.md)) |
| Warden on its own host (Railway), the agent elsewhere | T-268, [HOSTED-WARDEN.md](HOSTED-WARDEN.md) |
| A fixed workflow, not a free-roaming agent; at most 3 model calls; every field quotes its source | [AGENT-RELIABILITY.md](AGENT-RELIABILITY.md) |
| Prompt-injection screen before any model reads a document or email; a real fraud email quarantined in 9 ms with no model call | T-265 |
| Reliable submission: hash persisted before submit, validated result and delivered amount before "paid" | [SERVICE-LEVELS.md](SERVICE-LEVELS.md) |
| 1,628 automated tests, 90% coverage, CI on every push, pinned actions, 0 dependency vulnerabilities, secret scan on every commit | [RELEASE-CHECKS](RELEASE-CHECKS.md) |
| Measured against a single-prompt baseline: 2 of 40 should-hold cases pass the agent stage, against 32 of 40 for the baseline (fixture mode, 62 cases) | [EVALUATION.md](EVALUATION.md) |

**Gaps:** live models failed their call on 20 to 22 of 30 cases (held, never paid; P7); the Warden key is on a volume,
not in a key service (P2); no MCP interface.

## Business and market fit (33%): African problem, solution fit, target user, viability, go-to-market, local infrastructure

| Point | Figure | Source and confidence |
|---|---|---|
| African cybercrime losses | US$484m in 2025, up from US$192m; AI linked to more than half | INTERPOL 2026 ([via JURIST](https://www.jurist.org/news/2026/08/interpol-report-finds-ai-linked-to-over-half-of-cybercrime-in-africa/)); good |
| South Africa and business email compromise | 70% of African BEC detections originated in South Africa | TrendAI data in the INTERPOL report ([IOL](https://iol.co.za/mercury/news/2026-08-06-sa-is-africas-cybercrime-epicentre/)); vendor data, say "TrendAI data in the INTERPOL report" |
| How common the attack is | 74% of organisations hit by BEC in 2025; 76% by payments fraud | AFP 2026 survey, US respondents ([AFP](https://www.financialprofessionals.org/publications-data-tools/reports/survey-research-economic-data/Details/payments-fraud)); good |
| Recovery | 22% of victims recovered 75% or more of lost funds (2024) | AFP 2025 ([AFP press](https://www.financialprofessionals.org/about/learn-more/press-releases/Details/survey-79-percent-of-organizations-were-victims-of-attempted-or-actual-payments-fraud-activity-in-2024)); good |
| Today's invoice cycle | 9 to 11 days on average, 3.1 days best in class; US$9 to 11 per invoice | Ardent Partners 2025, via [Corpay](https://www.corpay.com/en-IE/resources/blog/ap-team-productivity-benchmarks) and [WEX](https://www.wexinc.com/resources/blog/what-does-it-cost-to-process-an-invoice-ap-benchmarks-every-finance-team-should-know/); secondary, global |
| SignOff's cycle | **About 21 s** from email to validated payment; about 11 s through the hosted Warden | T-264, T-268; measured, Testnet |
| Bank transfers to Africa | About 25% fully credited within an hour, a further 52% within 24 hours | Swift data 2021 to 2025 ([Finextra](https://www.finextra.com/blogposting/27731/accelerating-africa-the-power-of-global-standards-to-transform-cross-border-payments)); good |
| Cost of sending money to Sub-Saharan Africa | 8.46% on average, the highest of any region (remittances, indicative only) | World Bank, Q3 2025 ([African Exponent](https://www.africanexponent.com/chart-of-the-day-sending-200-home-to-sub-saharan-africa-costs-8-46-percent/)); secondary |
| Stablecoins in the region | About 43% of Sub-Saharan Africa's crypto volume | Chainalysis 2025 ([Cointelegraph](https://cointelegraph.com/news/currency-devaluation-drives-stablecoin-adoption-sub-saharan-africa)); secondary |
| Intra-African trade | US$213.8bn in 2025, up 5.5% | Afreximbank ([Arise](https://www.arise.tv/intra-african-trade-rises-5-5-to-213-8bn-in-2025-says-afreximbank/)); secondary |
| Local rails | RLUSD distributed in Africa by Yellow Card, VALR and Chipper Cash; Absa offers Ripple-powered custody in South Africa | [TechCabal](https://techcabal.com/2025/09/05/ripple-brings-its-rlusd-stablecoin-to-africa/), [Ripple](https://ripple.com/ripple-press/ripple-expands-global-custody-footprint-into-africa-with-absa-bank/) |

Target user, go-to-market and pricing are in [BUSINESS.md](BUSINESS.md) and [STRATEGY.md](STRATEGY.md).

**Gaps:** no customer interview yet; no payout partner contacted; South African cross-border crypto rules are being
redrafted; savings are not claimed.

## Honest self-assessment

| Criterion | Where it is strongest | What would raise it most |
|---|---|---|
| Product design | Live map, plain hold reasons, labelled simulation | A phone-width check and one finance clerk using it |
| Technical UX | Ledger-enforced two keys, separate hosting, attack suite, 1,628 tests | An MCP interface; the live model error rate fixed |
| Business fit | Sourced African fraud and payment figures; measured speed | One recorded customer conversation |
