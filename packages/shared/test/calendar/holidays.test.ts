import { describe, expect, it } from 'vitest';

import {
  CALENDAR_SOURCE_FIXTURE,
  CALENDAR_SOURCE_LIVE,
  fixtureHolidayCalendar,
  loadHolidayCalendar,
  NAGER_BASE_URL,
} from '../../src/calendar/holidays.js';
import { fetchStub, hangingFetch, jsonResponse } from '../helpers/fetch-stub.js';

describe('fixture holiday calendar', () => {
  it('holds 2026 holidays for ZA and ZM, with fixture provenance', () => {
    const calendar = fixtureHolidayCalendar();
    expect(calendar.sourceKind).toBe('fixture');
    expect(calendar.source).toBe(CALENDAR_SOURCE_FIXTURE);
    expect(calendar.fallbackReason).toBeNull();
    expect(calendar.countries.ZA.years).toEqual([2026]);
    expect(calendar.countries.ZA.dates.has('2026-09-24')).toBe(true);
    expect(calendar.countries.ZA.dates.has('2026-12-16')).toBe(true);
    expect(calendar.countries.ZM.dates.has('2026-05-25')).toBe(true);
    expect(calendar.countries.ZM.dates.has('2026-09-24')).toBe(false);
  });

  it('is the default from loadHolidayCalendar, with no network request', async () => {
    const stub = fetchStub(() => Promise.reject(new TypeError('must not be called')));
    const calendar = await loadHolidayCalendar({ fetchImpl: stub.fetch });
    expect(calendar.sourceKind).toBe('fixture');
    expect(stub.calls).toEqual([]);
  });
});

describe('live holiday calendar', () => {
  it('requests Nager.Date for ZA and ZM in 2026 and labels the source live', async () => {
    const stub = fetchStub((url) =>
      Promise.resolve(
        jsonResponse(
          url.endsWith('/ZA')
            ? [{ date: '2026-09-24', name: 'Heritage Day' }]
            : [{ date: '2026-05-25', name: 'African Freedom Day' }],
        ),
      ),
    );
    const calendar = await loadHolidayCalendar({ mode: 'live', fetchImpl: stub.fetch });
    expect(stub.calls).toEqual([`${NAGER_BASE_URL}/2026/ZA`, `${NAGER_BASE_URL}/2026/ZM`]);
    expect(calendar.sourceKind).toBe('live');
    expect(calendar.source).toBe(CALENDAR_SOURCE_LIVE);
    expect(calendar.fallbackReason).toBeNull();
    expect(calendar.countries.ZA.dates.has('2026-09-24')).toBe(true);
    expect(calendar.countries.ZA.dates.has('2026-05-25')).toBe(false);
    expect(calendar.countries.ZM.dates.has('2026-05-25')).toBe(true);
  });

  it('falls back to the fixture, labelled, when one country request fails', async () => {
    const stub = fetchStub((url) =>
      Promise.resolve(url.endsWith('/ZM') ? jsonResponse({}, 500) : jsonResponse([])),
    );
    const calendar = await loadHolidayCalendar({ mode: 'live', fetchImpl: stub.fetch });
    expect(calendar.sourceKind).toBe('fixture');
    expect(calendar.fallbackReason).toBe('live request failed (HTTP 500); fixture used');
    expect(calendar.source).toContain('FALLBACK');
    expect(calendar.countries.ZA.dates.has('2026-09-24')).toBe(true);
  });

  it('falls back on an unexpected response shape', async () => {
    const stub = fetchStub(() => Promise.resolve(jsonResponse({ not: 'a list' })));
    const calendar = await loadHolidayCalendar({ mode: 'live', fetchImpl: stub.fetch });
    expect(calendar.fallbackReason).toBe(
      'live request failed (unexpected response shape); fixture used',
    );
  });

  it('falls back on a network error', async () => {
    const stub = fetchStub(() => Promise.reject(new TypeError('fetch failed')));
    const calendar = await loadHolidayCalendar({ mode: 'live', fetchImpl: stub.fetch });
    expect(calendar.fallbackReason).toBe(
      'live request failed (network request failed); fixture used',
    );
  });

  it('falls back on a timeout', async () => {
    const calendar = await loadHolidayCalendar({
      mode: 'live',
      fetchImpl: hangingFetch(),
      timeoutMs: 1,
    });
    expect(calendar.fallbackReason).toBe('live request failed (timed out); fixture used');
  });

  it('falls back on a body that is not JSON', async () => {
    const stub = fetchStub(() => Promise.resolve(new Response('<html>', { status: 200 })));
    const calendar = await loadHolidayCalendar({ mode: 'live', fetchImpl: stub.fetch });
    expect(calendar.fallbackReason).toBe(
      'live request failed (response was not JSON); fixture used',
    );
  });
});
