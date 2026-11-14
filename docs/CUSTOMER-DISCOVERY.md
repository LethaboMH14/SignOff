# Customer discovery pack

Written 13 November 2026, the day of the deadline. **Nothing here has happened yet.** The messages are drafts that a team member sends from their own account; no one has been contacted. The Business score in the README stays "no customer validation" until a conversation is recorded in the [evidence log](#evidence-log) below.

[BUSINESS.md](BUSINESS.md) names the single fastest lift for the Business score: one recorded conversation with a credit controller or finance lead at a South African wholesaler. This pack is that conversation, ready to run.

## Today's plan (about three hours)

| When (SAST) | Who | What | Done when |
|---|---|---|---|
| Now | Sibusiso | Send message A to five people you already know who work in finance, accounts or credit control at a supplier or wholesaler (family, classmates, LinkedIn first-degree) | Five sent |
| Now | Lethabo | Send message B to two buyers outside South Africa, or to people who pay foreign suppliers | Two sent |
| Now | Either | Send message C to one RLUSD payout partner's partnerships address (Yellow Card, VALR or Chipper Cash) | One sent |
| As replies come | Whoever booked it | Run the 15-minute interview below, by phone or video | Notes written within the hour |
| Before 22:00 | Either | Fill the evidence log, anonymised, and update the README row "Customer problem, pricing, willingness to pay" | Row cites this file |

One honest conversation beats five polite ones. A "no" with a reason is evidence too.

## Message A: supplier finance (WhatsApp, LinkedIn or email)

> Hi [name], I'm building a payment safety tool for a hackathon that closes tonight. Could I ask you 15 minutes of questions about how your team handles customers who say your bank details have changed? I'm not selling anything. I want to know if the problem is real for you. I won't name you or your company. Any time before 21:00 works.

## Message B: buyer that pays foreign suppliers

> Hi [name], quick favour for a hackathon project due tonight. When you pay a supplier in another country, how do you check that the bank details on the invoice are really theirs? Could I ask you about that for 15 minutes today? No names will be used.

## Message C: payout partner (partnerships inbox)

> Subject: RLUSD-to-rand payout for supplier invoices (Ripple track project)
>
> Hello, we are Team Sonar, building SignOff in the Node Engine Ripple agentic finance track. An AI agent pays approved supplier invoices in RLUSD, co-signed by an independent rules service on the XRP Ledger. A South African supplier should receive rand, never crypto. We would like to understand your requirements for a business payout integration: due diligence, travel rule, minimums and pricing. Is there a person we could speak to after the event? Our working demo runs on XRPL Testnet only.

## The interview (15 minutes)

Ask about the past, not about our idea. Do not pitch until the last two minutes, if at all.

1. What is your role, and how many supplier or customer payments does your team handle in a month? (Rough number is fine.)
2. Tell me about the last time a customer or supplier said their bank details had changed. What did you do, step by step?
3. How long did that check take? Who was involved?
4. Has a payment ever gone to the wrong account, at your company or one you know? What happened, and was the money recovered?
5. What do you use today to check bank details: a phone call, a bank verification service (AVS), software like Eftsure, something else? What does it cost you?
6. What is the most annoying part of paying or being paid across a border?
7. If a payment could only go to bank details your supplier had confirmed in advance, and you never had to phone them again, what would that be worth to your team? (Listen for time, money or a name of a person who would sign off.)
8. Who in your company would decide to try something like that?
9. Can I follow up after the event? Is there someone else I should speak to?

Last two minutes, optional: show the public console's "Play a bank-detail change attack" replay and ask, "Does this match how it should work?"

## What to write down

Write notes, not a recording, unless the person agrees to a recording. Never write their name, company, phone or account details in this repository. Use a code such as P1, P2.

| Field | Example |
|---|---|
| Code | P1 |
| Role and company type | Credit controller, building supplies wholesaler, Gauteng |
| Payments a month | About 400 outgoing, 1,200 incoming |
| Last bank-detail change: what they did | Phoned the number on file, waited a day |
| Loss ever? | One near miss in 2025, caught by the bank |
| Current tool and cost | AVS through the bank; cost unknown |
| Value they put on it | "Would save a day a week for one clerk" |
| Who decides | Financial director |
| Quote (their words, under 25 words) | |
| Follow-up agreed? | Yes, 20 November |

## Scorecard

Count only what people said about their own past, not opinions about our idea.

| Signal | Strong | Weak |
|---|---|---|
| Problem | Describes a specific recent bank-detail change and the steps taken | "That could happen" |
| Cost | Names time, money or a loss | No figure at all |
| Current spend | Already pays for AVS, Eftsure or similar | Uses nothing and does not miss it |
| Buyer | Names who would decide | Does not know |
| Commitment | Agrees to a follow-up, an intro or a pilot | "Send me some info" |

## Evidence log

Fill one row per conversation. Keep it anonymised. Mark each as UNVERIFIED until a second team member has read the notes.

| Code | Date | Role | Strong signals | Weak signals | Next step | Checked by |
|---|---|---|---|---|---|---|
| (none yet) | | | | | | |

## Unit economics, as assumptions

Every figure here is an assumption carried from [BUSINESS.md](BUSINESS.md). Replace each with an interview answer when there is one.

| Input | Value | Source |
|---|---|---|
| Price per paying business | US$299 a month | Historical plan, assumption |
| Customers for US$10,000 a month | 34 | 10,000 ÷ 299 |
| Cost of one redirected payment | R630,000 to R12m | Cases in [PROBLEM.md](PROBLEM.md) |
| Clerk time on bank-detail checks | Unknown | Ask question 3 |
| Payout partner fee | Unknown | Message C |

The case to test in interviews: if one avoided loss is worth more than several years of subscription, the subscription is easy to justify, but only if the customer believes the loss could happen to them. Questions 2 and 4 test that belief.
