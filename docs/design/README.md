# Operator console: design screens

Four views from [BUILD-BRIEF.md](../../BUILD-BRIEF.md) (Operator experience), built against **invented fixture data** on `apps/console/web/demo.html`. Nothing here is live: no server, no Warden, no ledger, and no money moved. Every value (invoice numbers, supplier codes, the hash and the ledger link) is a placeholder.

| Screen | At 1440 | At 375 |
|---|---|---|
| 1 Payment desk: states and plain reasons | [desk-1440.png](screenshots/desk-1440.png) | [desk-375.png](screenshots/desk-375.png) |
| 2 Changed-payout hold: evidence path stops at the payout destination | [hold-1440.png](screenshots/hold-1440.png) | [hold-375.png](screenshots/hold-375.png) |
| 3 Operator limits: a lower limit applies at once; a raise needs a second operator | [limits-1440.png](screenshots/limits-1440.png) | [limits-375.png](screenshots/limits-375.png) |
| 4 Ledger receipt: explorer link, delivered amount, SIMULATED ZAR payout | [receipt-1440.png](screenshots/receipt-1440.png) | [receipt-375.png](screenshots/receipt-375.png) |

Run the demo with `npm run dev -w @signoff/console`, then open `/demo.html#desk`, `#hold`, `#limits` or `#receipt`.

The 375 captures were taken in headless Chrome, whose minimum window width clips the right edge. The 375 layout was checked in the browser by measurement, not by these images. Keyboard walk, reduced-motion display and motion timing are not yet verified (TEST-LOG T-137).
