> Historical research from 5 November 2026. See [current build brief](../BUILD-BRIEF.md) for the agreed direction. Verify time-sensitive claims before use.

# Plan: Node Engine 2026: track, problem, solution, how to win
_Round 0, revised by Claude (Opus 5.5) after its own adversarial pass. **Not reviewed by GPT-6 Astra:** Codex hit its usage limit before Round 1 could run. See `PLAN-REVIEW-LOG.md`._

Sources and grades for every number are in `EVIDENCE.md`. Scores in section 2 are judgement, not measurement.

## Goal
Pick the track the user can win at Node Engine 2026 (final pitch Sat 14 Nov, Cape Town), state real problems with sourced figures for each track, propose a solution for each, and define the build, customer, demo and timeline for the chosen one. Reuse what the user learned from Agent-Guardian and APEX without breaking the rule "Pre-existing projects can't be submitted."

## 1. What the rubric actually rewards
Three judges, 30 points each: Product, Technical, Business. Two thirds of the score has nothing to do with blockchain depth. Ripple's judges also look at "meaningful use of the XRP Ledger and RLUSD."

The user's two prior builds went deep on Technical breadth (27 contracts, 14 screens, 8 agents) and had no named customer, no go-to-market and, in Guardian's case, a stubbed core: `validateTransaction` ends in `return (true, bytes32(0))`. Winning here needs the reverse: one value loop that truly works, a named customer and a product a CFO can use without explanation.

## 2. Track ranking
| Track | Known prize | Weighted score of 5 | Why |
|---|---|---|---|
| **Agentic Finance (Ripple)** | $2,500 + UDAX fast track | **4.30** | Literal MVP spec, direct fit with both prior builds, Ripple's docs name the gap |
| Mobile Money & P2P (Tether) | $1,500 + grant consideration | 2.90 | Real problem, but the challenge statement is not known until Fri 18:00 and prior builds do not transfer |
| Merchant & Machine (open) | Announced later | 2.40 | Big problem, but SA regulators are hostile to USD stablecoins at the till |
| Real-World Assets (open) | Announced later | 2.20 | Securities-law heavy, least leverage |

Weights: rubric ceiling 30, prior-build leverage 20, known prize and pathway 15, sponsor clarity 10, regulatory survival 15, buildable by 13 Nov 10. With weights perturbed and every score moved up to 1 point either way over 20,000 runs, `sim_track_top_rank_share` is 98.8% for Agentic Finance. This shows the ranking is not fragile to my weights. It is not evidence of winning. Known unknown: the number of teams per track.

Stress tests:
- Remove prior-build leverage, since code cannot be reused anyway: still 4.12 against 3.12.
- Count nothing but rubric ceiling and regulatory survival: **a tie at 3.50 with Mobile Money.** That is the one real alternative.
- Open-track cash could beat Track 1. If the remaining "up to" pool of $6,000 were split equally, `sim_` each open track gets $3,000. Track 1 still leads on the accelerator, the literal spec and prior knowledge. If open-track prizes land high and team counts low, re-check before the team lock.

One project, one track: "Your project must align with one of these tracks". Do not split effort.

## 3. Real problems and a solution for each track

### Track 1: Agentic Finance
**Problems**
1. CFOs know agents exist and will not let them touch money. 97% understand, 11% are testing (PYMNTS, US enterprise, 2025). Gartner expects over 40% of agentic projects to be canceled by end 2027, citing inadequate risk controls among the reasons.
2. The fraud an agent will face is the fraud CFOs fear most. AFP: 74% of organisations were affected by BEC in 2025 (US). INTERPOL calls BEC "the most financially damaging attack vector", reports cybercrime losses in Africa rising from USD 192m to USD 484m between 2024 and 2025, cites TrendAI data that "70 per cent of BEC detections originated in South Africa and 29 per cent from Nigeria", and says AI now writes these emails "with near-perfect fidelity". My inference: an AI that reads invoices becomes the next target.
3. African SMEs paying across borders lack safe, cheap tools. SME trade finance rejection runs 23-47% by region (2019). Letters of credit cost about 2-5% (West Africa). The gap is US$80-120bn a year.
4. Ripple's own docs state the product gap: "The XRP Ledger does not yet have a wallet product built for autonomous agents", and their Agent Wallet skill says "Multisig. Out of scope."

**Solution: SignOff (working name).** An AI accounts-payable agent for African importers that physically cannot move money alone. Details in section 4.

**Why this solution:** it answers "would your CFO sign off?" with a ledger rule rather than a promise, and it scores on all three rubric lines.

### Track 2: Mobile Money & P2P
**Problems**
1. Cross-border is a tiny slice of mobile money: $45bn of over $2tn, at most 2.25%. Sending $200 still costs 12.78% to Angola, 8.86% to Uganda, 8.13% to Zambia against a 3% target (World Bank, 2023).
2. 74.2% of 2.3bn accounts are not active monthly (GSMA).
3. Agents run out of float: a median 5 lost transactions a day, 14%, in Tanzania (Helix, old data).

**Solution: FloatSwap.** Mobile money agents swap float across networks and borders with USD₮-backed settlement. Check whether Tether expects its own wallet kit; not verified here.

**Why:** most teams will build another send-money app. Agent liquidity is the hidden bottleneck, it is B2B with a spread to earn, and end users never touch crypto, which also fits the draft SA Category One rule "the client never owns or takes possession of the crypto assets". Confirm against Tether's challenge on Friday.

### Track 3: Merchant & Machine Payments
**Problems**
1. Municipalities owed Eskom R120.26bn at 31 Jul 2026, about R2.17bn more each month, projected R358bn by FY2031. Eskom has begun moving municipalities onto bulk prepayment.
2. Cash is 56% of SA payments by count, and about R89bn a year of its cost falls on consumers.
3. SA regulators are unlikely to sanction USD stablecoins for domestic payments, so "USD stablecoin at the spaza" is a dead end there.

**Solution: Ringfence.** Split every prepaid electricity token sale at the point of vending into Eskom bulk, municipal and arrears shares, atomically, in a rand stablecoin. The meter tops up only when Eskom's share has settled.

**Why:** it hits the debt at source and is a true machine-payment case. Weakness: it needs a rand stablecoin and a municipal partner, so a pilot is far off.

### Track 4: Real-World Assets
**Problems**
1. 11m+ South Africans in about 800,000 stokvels save about R44-50bn a year (older estimates). FNB alone reported R13.3bn of stokvel deposits in Dec 2024, up 66%.
2. Africa's MSME finance gap is about $330bn, and solar is booming (23 GW from China, +53%). Whether solar projects lack finance is my assumption, not sourced.
3. Tokenised RWAs are about $31.4bn globally, with little African supply (unmeasured).

**Solution: Stokvel Solar.** A stokvel buys a tokenised, rand-denominated share of a named rooftop solar contract's receivables, and monthly cash flows land in the group's pot.

**Why:** it matches patient group savings with real cash flow and fits H.E.R. DAO's community. Weakness: FSCA treats crypto assets as financial products, so it needs a licensed manager, and collective-investment rules may apply.

## 4. The build: SignOff
**One line:** an AI agent pays your suppliers in RLUSD, and the XRP Ledger rejects anything it tries that lacks a second signature it does not hold.

**Thesis (from the user's own Guardian code):** "Every prior AI safety guardrail is probabilistic: an LLM judges an LLM." So the model only proposes. Deterministic code and the ledger decide.

### Accounts on Testnet
| Account | Holds | Who controls it |
|---|---|---|
| `RESERVE` | Main RLUSD | CFO only. The agent has no path to it. |
| `SPEND` | Working balance. The RLUSD trust line `LimitAmount` caps how much it can ever hold. | CFO. Grants one `DelegateSet` permission: `Payment`. |
| `CONTROL` | A little XRP, because the delegate pays every delegated transaction's fee | Signer list: `AGENT` weight 1, `WARDEN` weight 1, quorum 2. Master key disabled. |

### Why this is enforced on the ledger
| Rule | Enforced by | If attacked |
|---|---|---|
| No payment without both signatures | XRPL multi-sign quorum | Agent key stolen alone: rejected |
| Only `Payment` can be sent, never `SignerListSet`, `AccountSet`, `SetRegularKey` or `DelegateSet` | XRPL delegation; these types are non-delegable | Agent cannot grant itself more power |
| Maximum loss if both keys are stolen is the `SPEND` balance, RLUSD plus any spare XRP, because delegation cannot be limited by currency | XRPL balance and trust line limit | Bounded, computable. Keep spare XRP on `SPEND` near zero. |
| Instant off switch | CFO's `DelegateSet` revocation | Next attempt fails on the ledger |
| Destination, amount, velocity, invoice checks | `WARDEN`, an independent service with its own key and deployment | Agent cannot edit or bypass it |

Fallback if delegated multi-sign fails in the spike: put the signer list directly on `SPEND` with `AGENT` 1, `WARDEN` 1, `CFO` 2, quorum 2. This loses the transaction-type restriction, keeps everything else.

### WARDEN rules (deterministic, fail closed)
Transaction is `Payment` from `SPEND` via `CONTROL`, exact RLUSD amount, no partial-payment flag, no paths or `SendMax`. Destination and tag are on the CFO-signed vendor list, and past a cool-off period if new. Amount within per-transaction and per-vendor limits. Rolling 24h spend, read from validated ledger history rather than a private database, stays under the daily limit. `InvoiceID` is present and unused. Short `LastLedgerSequence`. One in-flight request per account, with a reservation until validated or expired, so concurrent calls cannot both pass the daily limit. N refusals in a window trips a circuit breaker and freezes the agent until the CFO re-enables it. If the ledger read fails, refuse.

**Warden is the only submitter.** It runs `simulate`, adds its signature and submits. It never hands a co-signed payment back to the agent, so the agent cannot hold a valid payment for later. Memos carry hashes only, never names or invoice content, because the ledger is public. Delegated transactions cannot queue (`telCAN_NOT_QUEUE`), so retry with a fresh `LastLedgerSequence`, never blindly. Agent and Warden keys must be plain key pairs, because nested multi-signing is not supported.

### The agent
Trigger: an inbox or folder watcher, so no human clicks. Reads the invoice. Extracts fields with literal source spans ("extract, don't infer"). Code does the three-way match against PO and goods received. Decides pay now, schedule, hold or escalate. Proposes via MCP tools (`propose_payment`, read-only queries) with `InvoiceID` = SHA-256 of the invoice, policy hash in a Memo, `SourceTag` 20260530. Assume the model can be compromised at all times. Ripple's Wallet skill refuses `Signers` arrays and OWS has no Windows build, so the signing flow is our own, in xrpl.js.

### Human operator console
A phone-first page for the CFO: today's feed in plain language (paid, held, blocked, why); limit controls; exception approval; a one-tap freeze that sends `DelegateSet`. The CFO signs policy changes with a key the agent never sees, and the policy hash is anchored on the ledger so changes are auditable. Run the design gate before any UI.

### The measuring instrument
An attack suite that runs real Testnet attempts: forged bank details, hidden prompt injection in a PDF, duplicate invoice, split payments to beat a limit, stolen agent key, stolen Warden key, both keys, rogue signer change, partial-payment flag trick, delivered-amount trick, plus legitimate invoices to catch false blocks. A scoreboard shows the result code or hash for each, computed by code. Synthetic data is labelled `sim_`. The README lists what it does not cover.

## 5. Customer and regulatory stance
**Do not name a South African company as the customer.** Draft SARB Manual p31: "Resident entities may not enter into crypto asset transactions deemed as import or export of capital". Not in force, but a Cape Town judge may know it.

**Target customer:** an importer or distributor outside the CMA paying 5-50 recurring cross-border suppliers, with a very small finance team. Suggested first vertical: solar and energy equipment (Nigeria, DRC, Zambia, Zimbabwe, Ghana), because of the Ember growth figures and because panels are 94% imported from China.

**Make RLUSD credible: pay through a rail, not straight to a factory.** A Shenzhen factory is unlikely to want RLUSD on XRPL. The agent pays a licensed partner that already supports RLUSD (Yellow Card, Chipper Cash), and the partner pays the supplier in local currency or USD. The vendor record holds the partner account plus a hash of the supplier's payout details, and any change to those details triggers a CFO hold, so bank-detail fraud is still caught. A live partner integration is not realistic by 13 Nov, so it appears as `sim_`.

**Run two customer searches at once. Lock the story Sunday night.** Same engine, different policy pack.
- **Story A, importer:** a solar or equipment importer outside the CMA. The most vivid demo. Harder to reach.
- **Story B, payments-company treasury:** a stablecoin-native remittance or payments firm whose analyst rebalances corridor balances by hand. It already holds stablecoins, so there is no asset objection. It matches "manage treasury" literally, and its people may be at W3Node in person. More abstract on stage.

Default to A. Switch to B if B is who says yes.

**No market is clean:** Kenya's central bank can block foreign stablecoins from listing; Nigeria's SEC rules are proposed, not final; Ghana's directives are pending; Mauritius treatment is undocumented. So the first country is wherever the first real design partner sits. Legal review is needed before any real money.

**Turn it into a product point:** a jurisdiction guard refuses SA-resident entities by default. In South Africa the buyer is the Authorised CASP instead, which must enforce R5,000 a day and R25,000 a month limits under Category One, the same engine with a different policy pack.

**Validation target by 13 Nov:** one named finance lead at a non-CMA business with a recorded interview and a written letter of intent; three or more other finance conversations; one chartered accountant reviewing the control matrix. Only the user can get these. Nothing is claimed until it exists.

**Go-to-market:** design partner first, then distribution through RLUSD's African partners (Yellow Card, Chipper Cash, VALR), then accountants as a channel. Pricing hypothesis: flat software pricing rather than a percentage of money moved, so the company stays non-custodial software and does not look like a money transmitter. This needs legal confirmation. `sim_`: $299 a month including a payment allowance, so 34 customers is about $10k MRR. The inputs are assumptions; replace them with partner data.

**Local infrastructure:** off-ramp to mobile money shown as `sim_` unless a sandbox works; accounting integration (Xero or Sage demo company) if time allows.

## 6. Demo (3-minute video and 5-minute pitch)
1. **It works.** Invoice arrives, nobody clicks, agent pays, explorer shows RLUSD settled.
2. **It gets attacked.** An AI-written invoice swaps the bank details and carries a hidden instruction. The judge presses "Compromise the agent". Warden refuses with a plain reason. The agent submits directly with its own key. The ledger rejects it. These `tef*` rejections never reach a ledger, so there is no explorer link for them; show the live response. Then show one that does: both keys stolen, trying to pay more than `SPEND` holds. That `tec*` failure sits on the ledger with a hash the judge can open. Say only result codes measured in the spike.
3. **The CFO decides.** Lower the limit from a phone; the next invoice is held. Tap freeze; the ledger stops the agent.
4. **Close:** "Would your CFO sign off? Here is a real finance lead's signature on the policy, on Testnet", only if that has really happened.

### The eight hard questions in the 3-minute Q&A
| Question | Answer |
|---|---|
| Is this legal in South Africa? | Under the draft Manual, not for a South African company, which is why our first customer is outside the CMA. Here, our buyer is the Authorised CASP. It is a draft, and we have not had legal review yet. |
| Why would a supplier take RLUSD? | They do not have to. The agent pays a licensed partner, and the supplier gets local currency or USD. |
| Why not just give a human an approve button? | Humans keep the limits and the exceptions. The agent clears the routine invoices. Measure the share with the partner. |
| Why not Privy or OWS? | OWS has no Windows build and is a local vault. **Privy not yet read: read it before pitching.** Either way we add the invoice logic, CFO console and a ledger-enforced second signature. |
| What if Warden is hacked? | Alone it cannot reach quorum. With the agent key too, loss stops at the `SPEND` balance, and the CFO can revoke. |
| What if the model is fooled? | We assume it will be. It only proposes. Code and the ledger decide. |
| What if the issuer freezes or claws back RLUSD? | The issuer has clawback enabled. We disclose it. It is a property of the asset. |
| Who pays if it goes wrong? | Today, the customer, within the limit they set. That limit is their maximum exposure. A first-loss bond is on the roadmap. |

## 7. What carries over from prior builds
Concepts only, rebuilt in a fresh repo with commits from today and a prior-work disclosure in the README.

| Keep the idea | From | Becomes |
|---|---|---|
| "An LLM judges an LLM" thesis, property DSL | Guardian | Deterministic Warden rules |
| Policy shape: per-tx, daily, weekly, allow-list, human approval | Guardian | Policy v1 |
| APPROVE, BLOCK, ESCALATE | Guardian | Pay, block, hold |
| Multi-model council | Guardian | Optional advisor that can only escalate, never approve |
| Vaccine registry | Guardian | Shared bad-payee list, later |
| Intent, dry-run, sign, attest | APEX | Propose, `simulate`, co-sign, record |
| Circuit breaker | APEX | Warden auto-freeze |
| LLM router and indexer | APEX | Provider fallback and audit feed |

**Drop:** ZK proofs, cross-chain, DAO, quantum, Solidity, limit auto-raising, hardcoded scores, demo data on a live dashboard.

## 8. Timeline (SAST)
| When | What |
|---|---|
| Fri 6 Nov | Create team (solo is allowed). Recruit from the 119 looking, prioritising product/design and someone tied to a non-CMA business. Confirm who will be in Woodstock on 14 Nov. Get the Ripple workshop recording. Ask Ripple: will the Testnet RLUSD issuer enable trust line locking? Does delegated multi-sign count as meaningful use? Attend the Tether session only as a check. **Team lock 23:59.** |
| Fri-Sat | Truth spike (below). Fresh public repo. First autonomous RLUSD payment. |
| Sat-Sun | Warden and agent loop. Customer conversations. Submit checkpoint Sunday night. |
| Mon 9 Nov | Checkpoint closes 17:00. Mentor slot in the evening. |
| Tue 10 | Design gate, CFO console, limit change and freeze live. |
| Wed 11 | Attack suite, audit view, deployments separated. |
| Thu 12 | Cape Town. Feature freeze. Video. **Submit a valid entry a day early.** |
| Fri 13 | Fix only. Final resubmit before 23:59. Rehearse. |
| Sat 14 | Pitch. Bring the video and a hotspot. |

**Truth spike, about an hour, needs `npm install xrpl`:** delegated multi-signed RLUSD `Payment` gets `tesSUCCESS`; agent-only signature fails; non-`Payment` by delegate fails; `DelegateSet` revocation stops the next attempt; RLUSD escrow fails as predicted; a payment beyond the trust line limit fails. Record result codes in the repo.

**Cut lines.** Must: the 3 MVP items, Warden, CFO console, attack panel, README with honest limits, video. Should: auditor script, CFO approval in a real wallet (Xaman). Could: everything in section 9.

## 9. Ambitious options
| Idea | Why it could win | Cost | Decision |
|---|---|---|---|
| **"Rob the agent" booth at W3Node, 12-13 Nov** | Real attendees try to prompt-inject a Testnet agent; pitch shows the real attempt count and RLUSD lost | Low once core works; needs rate limits and an LLM cost cap | **Do** |
| **CFO pre-signs exact large payments using Tickets; agent only chooses when** | Bank-detail fraud becomes irrelevant, because destination and amount are signed by the CFO; revoked by burning the Ticket; works with RLUSD, unlike escrow | Medium | **Do if ahead** |
| **Auditor mode:** a script proves from ledger data alone that each payment met the policy at that time | No trust in us required; strong with the Technical judge and CFOs | Low to medium | **Should** |
| **Policy packs:** SA Category One limits as code, sold to Authorised CASPs | A legal South African market for the same engine | Low to demo | **Do as a slide plus one config** |
| Early-payment discount engine: 2/10 net 30 is about 37.2% annualised | Control tool becomes a profit centre | Low | Could |
| Vendor credentials (XLS-70), shared fraud signals | Network-effect moat | Medium | Roadmap |
| Pay-per-call KYB via XRP Payment Channel | Shows the third limit type | Medium | Could |
| Yield on idle RLUSD via vaults | Ripple lists it | Blocked on Testnet today | Roadmap |
| First-loss "agent bond" | Answers "who pays if it fails?" | High | Roadmap |

## Key decisions & tradeoffs
1. **Agentic Finance over a less crowded track.** Accepts likely competition for the biggest known prize and accelerator route. Competition per track is unknown.
2. **Non-CMA customer** even though the user's network is South African. Harder to validate; survives legal questions.
3. **Delegated multi-sign as core** over plain multi-sign. More "meaningful use", new and less proven.
4. **RLUSD, no escrow** because of the issuer flag; ask Ripple anyway.
5. **Accounts-payable story first, corridor treasury as the switch** (Story A, Story B). A is easier to demo; B may be easier to name. Decided by who says yes by Sunday night.
6. **Solar and energy importer vertical**, an unvalidated hypothesis based on import growth.
7. **Fresh repo, concepts only.** Gives up working code to stay clean under the pre-existing rule.
8. **Model as proposer only.** Less "AI magic" on stage, more credible.
9. **Demo uses a "compromise" button**, because event rules say never share a private key, rather than publishing a Testnet key.

## Risks / open questions
- **Biggest risk: no named customer exists yet, which caps Business below 27.** Only the user can fix this.
- The partner rail is unvalidated: neither Yellow Card nor Chipper Cash has been contacted.
- **Codex is out until Nov 11, 7:57 PM**, so neither this plan nor the build gets a second model's review unless credits are added.
- Privy's policy features were not read (the page would not render) and may overlap with Warden.
- The user may be solo with other events running; Product polish is the likely weak spot.
- Whether delegated `Payment` works with a multi-signing delegate and RLUSD is untested.
- Testnet can reset or stall during the demo; need scripted re-provisioning, a recorded backup and possibly `xrpl-up`.
- Issuer can freeze or claw back RLUSD (`allowTrustLineClawback` is true). Disclose.
- CFO key compromise defeats everything; MVP does not solve it.
- A compromised or careless allow-listed vendor is not covered.
- Secondary-source regulatory reading; no counsel.

## Out of scope
Mainnet or real funds. Production legal opinion. Custody licensing. Any Solidity. Separate Track 2-4 builds.

