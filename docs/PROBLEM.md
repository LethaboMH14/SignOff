# The problem

Researched 9 November 2026, qualified 10 November. Every figure carries a confidence rating.

- **Good:** read in, or directly summarised from, the publisher's own release.
- **Verify:** came from a secondary source. Do not quote it in the pitch or the video until the original has been read and this table updated.
- **Illustrative:** a single news case. It shows the pattern, not the scale.

No figure below measures South African invoice-redirection losses. Use them as evidence of the pattern and the trend, never as a market size.

## Statement

**Paying a supplier is the one finance step businesses will not automate, because a wrong payment is usually irreversible and the loss usually stays with the payer.**

Two things follow.

1. Today, the only defence is a person re-checking bank details by phone. That makes payment slow, and suppliers wait.
2. Tomorrow, businesses will let AI read invoices and pay. An AI that reads documents can be tricked by text hidden in a document, so automation adds a new way to be robbed.

SignOff addresses both: it removes the human click from routine payments and makes it impossible for the AI alone to move money.

## Evidence: the fraud

| Figure | Source | Confidence |
|---|---|---|
| Email payment fraud: US$3.05bn in reported US losses in 2025, up 10% from US$2.77bn | [FBI 2025 report, via McDonald Hopkins](https://www.mcdonaldhopkins.com/insights/news/the-sobering-truth-of-the-fbis-2025-internet-crime-complaint-center-report) | Good |
| 74% of organisations experienced it in 2025, up from 63% | [AFP 2026 survey, via Nacha](https://www.nacha.org/news/business-email-compromise-attempts-rose-sharply-2025-report-finds) (US respondents) | Good |
| Only 22% of victims recovered 75% or more of lost funds in 2024 | [AFP 2025, secondhand](https://www.adaptivesecurity.com/solutions/payment-fraud-prevention) | Verify |
| African cybercrime losses rose from US$192m to US$484m in 2025 | [INTERPOL 2026, via JURIST](https://www.jurist.org/news/2026/08/interpol-report-finds-ai-linked-to-over-half-of-cybercrime-in-africa/) | Good |
| AI is linked to more than half of cybercrime in Africa | [INTERPOL](https://www.interpol.int/en/News-and-Events/News/2026/INTERPOL-report-finds-AI-linked-to-more-than-half-of-cybercrime-in-Africa) | Good |
| 70% of African detections of this fraud were in South Africa | [INTERPOL 2026, secondhand](https://www.newkerala.com/news/a/south-africa-emerges-as-africas-prime-cybercrime-target-936.htm) | Verify in the INTERPOL PDF |
| South African cases rose 26% in 2024 | [SABRIC, secondhand](https://www.africa-legal.com/opinion/cybersecurity-awareness-month-the-ever-evolving-threat-of-cybercrime-in-south-africa/131037) | Verify |
| South African digital banking fraud: R2.4bn in 2025, up 29%; 110,074 incidents | [SABRIC 2025, via BusinessTech](https://businesstech.co.za/news/banking/872115/r2-4-billion-stolen-from-south-africans-over-r21800-per-person/) | Good as a figure, **but it does not measure invoice-redirection losses.** 88.6% of cases were banking-app fraud, mostly against individuals. Context only. |

## Evidence: who carries the loss in South Africa

| Finding | Source | Confidence |
|---|---|---|
| A court accepted that banks have no duty to match an account name to an account number | [Cliffe Dekker Hofmeyr, 2023](https://www.cliffedekkerhofmeyr.com/en/news/publications/2023/Practice/Dispute/dispute-resolution-alert-30-may-A-prudent-question-is-one-half-of-wisdom.html) | Read the judgment |
| The Supreme Court of Appeal overturned a R5.5m ruling that a law firm owed its payer a duty to protect her from email fraud | [Clyde & Co on ENS v Hawarden](https://connectedworld.clydeco.com/post/102jcpz/sca-affirms-limits-of-delictual-liability-and-principles-of-wrongfulness-in-bec-f) | Read the judgment. A late-2024 report said the payer had applied to the Constitutional Court; the outcome has not been checked. |
| Tshwane: about R12m redirected after a supplier's bank details were changed in the finance system | [IOL](https://ioltravel.co.za/pretoria-news/news/tshwane-millions-meant-for-service-provider-mistakenly-paid-fraudster-in-the-dock-afe540c6-8d71-4f7d-accf-4df2ef5b1489) | Illustrative, date unclear |
| Mogale City: about R9m paid after an email announced new supplier bank details, later recovered | [The Citizen](https://www.citizen.co.za/news/theres-no-missing-r9m-says-municipality) | Illustrative, date unclear |
| Gqeberha: about R633,630 paid into fraudsters' accounts between November 2024 and April 2025 | [IOL 2026, as cited by Pulsify](https://www.pulsify.tech/blog/invoice-fraud-prevention-software-south-africa/) | Verify |
| Rubicon, a South African solar wholesaler, warns customers about messages claiming its bank details changed | [Rubicon](https://www.rubicon.tech/) | Example of the risk |

## Evidence: slow payment

| Figure | Source | Confidence |
|---|---|---|
| 95,399 government invoices older than 30 days, worth R12.4bn, unpaid at the end of Q2 2025 | [National Treasury via Business Partners, Engineering News](https://www.engineeringnews.co.za/article/late-payment-crisis-detrimental-to-smes-business-partners-says-2026-03-11) | Good |
| Small businesses are each owed R99,800 in late payments and spend 89.5 hours a year chasing | [Xero, via Channelwise](https://channelwise.co.za/late-payments-drag-smes-down/) | Verify, undated |
| Bank cross-border transfers cost 3–7% and take 3–7 business days | Vendor blogs ([XTransfer](https://www.xtransfer.com/blog/bank-alternatives-cross-border-payments), [Duplo](https://tryduplo.com/blog/cross-border-payments-in-africa-the-complete-guide-to-international-payments-2026/)) | Verify. Written by companies selling alternatives. Do not quote. |

## Evidence: AI agents can be tricked

| Finding | Source |
|---|---|
| A leading model followed hidden instructions in documents 24% of the time | [InjecAgent, Zhan et al., 2024](https://consensus.app/papers/details/1f22a6682586514aaa8f32ad3e8a9fb5/?utm_source=claude_desktop) |
| Attack success as high as 84% across agent benchmarks | [Agent Security Bench, Zhang et al., 2024](https://consensus.app/papers/details/855f0332a1cf58df9cca7ce9354d7b88/?utm_source=claude_desktop) |
| Eight defences that rely on the model policing itself were each broken at over 50% | [Zhan et al., 2025](https://consensus.app/papers/details/cadf2fb6ff3b5d138c4b896604a4e7ba/?utm_source=claude_desktop) |
| Fixed rules enforced outside the model cut attack success from 25.8% to 4.2% in one small test | [Narisetty et al., 2026](https://consensus.app/papers/details/7b98505bdc975af984c4977a141aa034/?utm_source=claude_desktop) |

The last finding is SignOff's design principle: the model proposes, deterministic code and the ledger decide. The 2026 paper is a single small-scale result and says so itself.

## Gaps to be honest about

- **No rand total for this specific fraud.** We found no published South African figure for invoice-redirection losses. The R2.4bn is all digital banking fraud and must never be presented as this market.

## Safe to say on stage

- "Email payment fraud cost US businesses over three billion dollars last year, and three in four organisations were targeted." (FBI, AFP; US figures)
- "INTERPOL says African cybercrime losses more than doubled in a year and that AI is behind more than half of it."
- "South African courts have generally left the loss with whoever made the payment." (Say "generally"; cases depend on facts.)
- "Research shows AI agents can be hijacked by hidden text, and that self-policing defences fail."

Hold back until verified: the 70% South Africa share, the 26% rise, the 22% recovery rate, the Xero figures, and the cross-border fee ranges.
- **Export total unsourced.** We could not read the SARS trade tables. South Africa's exports to the rest of Africa need a figure from [SARS](https://www.sars.gov.za/wp-content/uploads/Dec5123/Media-Release-December-2025.pdf) before the market is sized.
- **No customer has confirmed the problem.** Everything above is desk research.
- **US figures are US figures.** The FBI and AFP numbers show the pattern, not the South African scale.
