# Email demo: an invoice arrives by email and is paid on Testnet

The audience watches a supplier email an invoice. SignOff reads it, checks it and pays it in Testnet RLUSD with two signatures. A second email then claims new bank details and is stopped. Everything here is fictional, and Testnet RLUSD has no real value.

## How it works

```
supplier's mailbox ──email + PDF──▶ SignOff's mailbox (Gmail)
                                          │  IMAP over TLS, every 4 seconds
                                          ▼
                                   mail watcher (own process; holds only the mailbox app password)
                                     · sender must be on the allow-list
                                     · Gmail's own Authentication-Results must say dmarc=pass
                                     · only real PDFs (checked by their first bytes), at most 3, at most 10 MB
                                     · file named from its hash, never from the sender's file name
                                     · the email body is never given to a model; a bank-detail claim in it is only reported
                                          │
                                          ▼
                                   agent inbox ──▶ screen ──▶ model reads fields ──▶ match ──▶ Warden ──▶ XRPL Testnet
```

The watcher reads only email that arrives after it starts, so an old unread email cannot be paid by surprise. Each email is marked as read once it is decided. Decisions go to `demo/mail-log.jsonl` in the local SignOff folder, without addresses, subjects or body text.

## One-time setup (about 10 minutes)

You need two email addresses:

| Role | Example | Notes |
|---|---|---|
| SignOff's mailbox | a new Gmail account such as `teamsonar.signoff@gmail.com` | Use a new account, not your personal one. The watcher can read this mailbox. |
| The supplier | your own Gmail, or a teammate's | This address goes on the allow-list. |

1. Create the SignOff Gmail account and sign in to it.
2. Turn on 2-Step Verification: Google Account, then Security, then 2-Step Verification. Google allows app passwords only with it on.
3. Create an app password at https://myaccount.google.com/apppasswords. Name it "SignOff demo". Google shows 16 letters once. Keep them private; do not paste them into chat, a slide or the repository.
4. In Gmail settings for that account, under "Forwarding and POP/IMAP", turn IMAP on if a switch is shown.
5. Add these lines to the `.env` file in the `SignOFF-demo-run` folder, which git ignores:

   ```
   SIGNOFF_MAIL_USER=teamsonar.signoff@gmail.com
   SIGNOFF_MAIL_PASSWORD=the 16 letters, without spaces
   SIGNOFF_MAIL_ALLOWED_SENDERS=your.own.address@gmail.com
   ```

   `SIGNOFF_MAIL_HOST` (default `imap.gmail.com`), `SIGNOFF_MAIL_PORT` (993) and `SIGNOFF_MAIL_AUTHSERV` (`mx.google.com`) are needed only for another provider.

6. Send one test email from the supplier address to the SignOff address with any small PDF attached, before the demo, to check delivery. It will be marked read and ignored if the watcher is not running. That is expected.

## Running it

In PowerShell, in `SignOFF-demo-run`:

```powershell
$env:LOCALAPPDATA = "C:\Users\Dell Latitude\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local"
npm run demo -- --zar 20.00 --email
```

The launcher starts the Warden, the agent, the console and the mail watcher. It prints the path of a ready invoice in the outbox, and the line `mail watcher running`. Leave the window open.

## The demo, step by step

| Step | You do | The audience sees |
|---|---|---|
| 1 | Open http://127.0.0.1:4180, sign in as the demo operator, open **Agent map** | An empty map, connected to the live log |
| 2 | On another tab, go to **Payment desk**. In "Send a test invoice", pick **By email (I send it)** and **Clean invoice**, then press **Prepare invoice**, then **Download the invoice PDF**. (Or use the PDF path the launcher printed.) | The panel names SignOff's mailbox |
| 3 | From the supplier's Gmail, on your phone or laptop, write to SignOff's mailbox, attach the PDF, and send | An ordinary email being sent |
| 4 | Switch to the Agent map | Within about 5 to 15 seconds: the token arrives at Intake, moves through the screen, extractor, verifier and matcher, then the Warden, the signer and the ledger, and ends at Paid |
| 5 | On the desk, open the invoice's receipt | The Testnet transaction, two signers, the explorer link |
| 6 | Prepare a second invoice, kind **Fraud: new bank details**, and email it the same way. For extra effect, write "Urgent: our bank details have changed, please pay today" in the email body | The token stops at the hold lane: Quarantined, with "The invoice says the bank details have changed." No model read it, and nothing was paid |

What to say at step 6: "The email asked us to pay a new account. SignOff ignores what an email says. A payout account can only change with the supplier's own key and a waiting period, and the Warden only pays the verified record."

## If something goes wrong

| What you see | Why | What to do |
|---|---|---|
| `SIGNOFF_MAIL_USER is not set` and nothing starts | The `.env` lines are missing | Add them (setup step 5) |
| The launcher waits at "the mail watcher" and then stops | Gmail refused the sign-in | Check the app password and that 2-Step Verification is on |
| The terminal shows `mail N: not accepted (SENDER_NOT_ALLOWED)` | The From address is not on the allow-list | Add it to `SIGNOFF_MAIL_ALLOWED_SENDERS` and restart |
| `not accepted (SENDER_NOT_AUTHENTICATED)` | Gmail did not record `dmarc=pass` for the sender | Send from a Gmail or Google Workspace address |
| `not accepted (NO_PDF_ATTACHMENT)` | No PDF, or a file that only looks like one | Attach the downloaded PDF itself |
| The token stops at Held, not Paid | The PDF was changed or re-saved, so its fingerprint no longer matches the order | Send the downloaded file unchanged |
| Nothing at all after a minute | The email was sent before the watcher started, so it is left alone. This includes a restart: the watcher skips anything that arrived before it began, by design | Send it again after `mail watcher running` appears |
| Nothing at all, and the watcher was running | Gmail put the email in SignOff's Spam folder. The watcher reads only the inbox (seen on 13 Nov: one of five test invoices went to Spam) | In SignOff's Gmail, open Spam, press "Not spam", then send a fresh copy. Before the demo, add a filter "from the supplier address: never send to Spam" |
| The token stops at Held with `OVER_LIMIT` | Earlier runs used up a daily limit. The demo sets USD 5.00 per payment and USD 20.00 per supplier per day and in total per day (raised from USD 5.00 on 13 Nov, T-264); each R20 invoice is about USD 1.20 | Wait for the next day, which starts at midnight South African time (22:00 UTC), or raise the daily limits in the local `warden-config.json` and restart. Nothing is paid while held |
| The Warden will not start: `a run.lock file is present` | An earlier run was stopped without a clean exit | Confirm no Warden is running, then rename `run.lock` in the local Warden folder |

## What is real and what is not

| Part | Status |
|---|---|
| Email delivery, Gmail's DMARC verdict, the IMAP watcher | Real |
| Supplier, buyer, invoice, order and goods receipt | Fictional |
| Model extraction, screen, Warden checks, two-signature payment | Real, on XRPL Testnet |
| RLUSD | Testnet RLUSD, no real value |
| Rand payout to a bank | Simulated |
