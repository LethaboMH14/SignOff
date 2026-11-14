# FX quote and business-day calendar

Two small pure modules in `packages/shared`, added for the receipt (D4) and the supplier payout-change cooling-off (B9). Both have a fixture mode, which is the default and is offline, and a live mode, which is opt-in. Every rand figure this code produces is labelled **SIMULATED** (rule R-3). Nothing here moves money, and nothing here is a bank rate.

| Module | Path | Purpose |
|---|---|---|
| Receipt quote | [`packages/shared/src/fx/`](../packages/shared/src/fx/) | Converts a delivered RLUSD amount in cents into a SIMULATED rand payout at a dated USD-to-ZAR rate |
| Business-day calendar | [`packages/shared/src/calendar/`](../packages/shared/src/calendar/) | Adds N business days to a timestamp for ZA (and ZM), skipping weekends and public holidays |
| Demo | `npm run fx:demo` ([`scripts/fx-demo.ts`](../scripts/fx-demo.ts)) | Prints a receipt block for 1 and 10 RLUSD, and a cooling-off table that crosses a weekend and a South African public holiday |
| Tests | [`packages/shared/test/fx/`](../packages/shared/test/fx/), [`packages/shared/test/calendar/`](../packages/shared/test/calendar/) | Known answers, rounding ties, rate and holiday parsing, live-mode fallbacks |

Neither module is exported from the platform-neutral entry point (`packages/shared/src/index.ts`). Import them by path, as the demo does. They use no Node built-ins, so they could be bundled for a browser later.

## Sources and what was verified

Each external API was called once with a real request on 2026-11-12, before the parser was written. The results below are what came back.

### Frankfurter (rates, no key): https://frankfurter.dev

- Request: `GET https://api.frankfurter.dev/v1/latest?base=USD&symbols=ZAR`
  Response: `{"amount":1.0,"base":"USD","date":"2026-11-11","rates":{"ZAR":16.5639}}`, HTTP 200.
- Request: `GET https://api.frankfurter.dev/v1/2026-11-10?base=USD&symbols=ZAR`
  Response: `{"amount":1.0,"base":"USD","date":"2026-11-10","rates":{"ZAR":16.3957}}`, HTTP 200. This response is the committed fixture: [`packages/shared/src/fx/fixtures/frankfurter-usd-zar-2026-11-10.json`](../packages/shared/src/fx/fixtures/frankfurter-usd-zar-2026-11-10.json).
- **ZAR is covered.** It appears in `GET /v1/currencies`, and the rate responses above carry it.
- **ZMW is NOT covered.** `GET /v1/currencies` lists USD and ZAR among the currencies checked, with no ZMW, and `GET /v1/latest?base=USD&symbols=ZMW` returns HTTP 404 with `{"message":"not found"}`. The module supports USD to ZAR only. A Zambian kwacha rate needs another source, and none is wired.
- Frankfurter publishes ECB reference rates. They are not a rate a payment would settle at, and the module does not claim they are.

### Nager.Date (public holidays, no key): https://date.nager.at

- Request: `GET https://date.nager.at/api/v3/AvailableCountries` lists 204 countries, including **ZA (South Africa)** and **ZM (Zambia)**.
- Request: `GET https://date.nager.at/api/v3/PublicHolidays/2026/ZA` returned 13 holidays, HTTP 200. Request: `.../2026/ZM` returned 16 holidays, HTTP 200.
- The fixture is [`packages/shared/src/calendar/fixtures/public-holidays-2026.json`](../packages/shared/src/calendar/fixtures/public-holidays-2026.json). It holds the 2026 lists for both countries, as returned.
- Coverage is **2026 only**. The fixture and live mode both cover that year. Any other year throws `CalendarCoverageError`.
- ZA's list includes the one-off 4 November 2026 Election Day, because Nager reports it as a public holiday. Check it against the official gazette before relying on it.

## What is simulated

- **The receipt rand figure is SIMULATED.** The rate is a fixed capture from the public API, the RLUSD-to-USD step is an assumption, and no market price for RLUSD is applied. The receipt must keep the label.
- **RLUSD is treated as 1 USD.** This is stated on every quote as `assumption`. A real RLUSD price would need its own source, which is not in the repository.
- **The cooling-off length in the demo is illustrative** (3 business days). The Warden's real setting is in hours (see below).
- **Holiday data is a 2026 capture.** It is not a legal calendar.

## How the rate is chosen (fixture by default)

`resolveUsdZarRate({ mode })` in [`fx/rates.ts`](../packages/shared/src/fx/rates.ts):

1. `mode` defaults to `fixture`. The committed capture is returned. No request is made.
2. `mode: 'live'` makes one request to the Frankfurter URL above, with a 5-second limit (`timeoutMs`).
3. A network error, a timeout, a non-200 status, a body that is not JSON, an unexpected shape, or a rate with more than six decimal places **all fall back to the fixture**. The result says so: `sourceKind: 'fixture'`, `fallbackReason` names the cause, and `source` contains `FALLBACK`. The fallback is never silent.

`loadHolidayCalendar({ mode })` in [`calendar/holidays.ts`](../packages/shared/src/calendar/holidays.ts) works the same way for Nager.Date. If either country's request fails, the whole calendar falls back to the fixture.

## Money maths

- Amounts are integer cents. RLUSD is 2 decimal places, and the module reuses `assertMinorUnits` from `money/minor-units.ts`.
- The rate is plain decimal text of at most six places, parsed into an exact integer scaled by 10^6. Exponents, signs, spaces, zero and extra decimals are refused, never rounded.
- The rand payout is `round_half_up(cents x rate)`, computed with BigInt. Examples checked in tests:
  - 1 RLUSD (100 cents) at 16.3957: 1639.57 rand cents rounds to 1640, so **R16.40**.
  - 10 RLUSD (1000 cents) at 16.3957: 16395.7 rounds to 16396, so **R163.96**.
  - 1,000,000 cents at 16.123456: exactly **R161,234.56**.

## Business days (B9)

`addBusinessDays(start, n, country, calendar)`:

- Times are read in local time at a fixed UTC+2 offset. South Africa and Zambia both use that offset all year, with no daylight saving.
- Counting starts the day after the start. Saturdays, Sundays and holidays are skipped. A start on a holiday counts from the next working day.
- The result keeps the start's local time of day. `n = 0` returns a copy of the start.
- Holidays come from a passed-in `HolidayCalendar`. The function never reads a file or the network.
- A date in a year with no holiday data throws `CalendarCoverageError`. The caller must hold the change, not guess (rule R-8).

Worked example from the demo: start Wednesday 23 September 2026, 10:00 SAST, plus 3 business days. Thursday 24 September is Heritage Day and is skipped. The business days are Friday 25, Monday 28 and Tuesday 29, so the end is **Tuesday 29 September 10:00 SAST**. Plain day counting would give Saturday 26 September.

## Where the B9 cooling-off is computed today, and where to plug this in

**Not edited in this change.** The cooling-off is in `apps/warden`, which another session owns, and `service.ts` is off-limits for this work.

- [`apps/warden/src/service.ts:764`](../apps/warden/src/service.ts): `coolingOffUntil: new Date(now.getTime() + this.deps.config.coolingOffMs).toISOString()` in `approveChange`.
- [`apps/warden/src/config.ts:40`, `:99`](../apps/warden/src/config.ts): the setting is `coolingOffHours` (0 to 720), converted to `coolingOffMs` as hours times 3,600,000.
- [`apps/warden/src/service.ts:1071`](../apps/warden/src/service.ts): `Date.parse(change.coolingOffUntil) <= now` decides when a change takes effect. It compares timestamps, so it needs no change.

**Correction to the brief.** The existing code does not use calendar-day arithmetic. It adds a fixed number of hours, so it does not skip weekends or holidays at all. The plug-in is therefore a change of rule, not a substitution.

To switch to business days, a later change to `service.ts` would:

1. Add a setting such as `coolingOffBusinessDays` to `config.ts`, and a `holidays` dependency loaded with `loadHolidayCalendar`.
2. Replace line 764 with `addBusinessDays(now, config.coolingOffBusinessDays, config.calendarCountry, holidays).toISOString()`.
3. Treat a `CalendarCoverageError` as a refusal of the approval (fail closed).

The receipt (D4) would follow the same pattern. `apps/console/src/server/receipt.ts` has `randOf` (around line 90), which uses a placeholder rate from `ReceiptConfig`. It would call `resolveUsdZarRate()` and `quoteRlusdPayoutInZar()` instead. Neither file was edited here.

## Limits

- Live mode is tested only with stubbed responses. The one real request for each API is recorded above, from 2026-11-12. The repository's tests make no network calls.
- ZMW has no rate source.
- Holidays cover 2026. A 2027 date fails closed.
- The quote is for the receipt. It is not a settlement, a promise of a rand payout or a bank rate.
- Nothing in this change is connected to a live Testnet payment or to a real rand account.
