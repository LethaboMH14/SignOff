import { describe, expect, it } from 'vitest';

import { currenciesIn } from '../../src/extract/currency.js';
import { isoDatesIn } from '../../src/extract/dates.js';

describe('isoDatesIn', () => {
  it.each([
    ['2026-11-05', ['2026-11-05']],
    ['05/11/2026', ['2026-11-05']],
    ['05-11-2026', ['2026-11-05']],
    ['05.11.2026', ['2026-11-05']],
    ['5 November 2026', ['2026-11-05']],
    ['5th Nov. 2026', ['2026-11-05']],
    ['November 5, 2026', ['2026-11-05']],
    ['Sept 9 2026', ['2026-09-09']],
    ['29/02/2028', ['2028-02-29']],
    ['no date here', []],
    ['31/02/2026', []],
    ['29/02/2026', []],
    ['13/13/2026', []],
    ['5 Smarch 2026', []],
    ['Smarch 5, 2026', []],
    ['05/11/1899', []],
    ['05/11/2026 and 05/11/2026', ['2026-11-05', '2026-11-05']],
  ])('reads %j', (text, expected) => {
    expect(isoDatesIn(text)).toEqual(expected);
  });

  it('does not read a number that is part of a longer number', () => {
    expect(isoDatesIn('ref 105/11/2026')).toEqual([]);
    expect(isoDatesIn('12026-11-05')).toEqual([]);
  });
});

describe('currenciesIn', () => {
  it.each([
    ['Currency: ZAR', ['ZAR']],
    ['Total US$ 10.00', ['USD']],
    ['Total R 10.00', ['ZAR']],
    ['Total R10', ['ZAR']],
    ['Price €12', ['EUR']],
    ['Price £12', ['GBP']],
    ['USD and EUR', ['USD', 'EUR']],
    ['ZAR ZAR', ['ZAR']],
    ['AR 10 and BR 10', []],
    ['Total $10', []],
    ['nothing', []],
  ])('reads %j', (text, expected) => {
    expect(currenciesIn(text)).toEqual(expected);
  });
});
