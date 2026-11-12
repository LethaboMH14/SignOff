import { describe, expect, it } from 'vitest';

import { normaliseKeepingLines, normaliseText } from '../../src/text/normalise.js';

describe('normaliseText', () => {
  it('collapses white space, including non-breaking and thin spaces', () => {
    expect(normaliseText('  R 12 345,67 \n\t Total  ')).toBe('R 12 345,67 Total');
  });

  it('composes combining marks into one character', () => {
    expect(normaliseText('Café')).toBe('Café');
  });

  it('changes nothing else, so case and punctuation stay as printed', () => {
    expect(normaliseText('INV-TST-0100 (A)')).toBe('INV-TST-0100 (A)');
  });
});

describe('normaliseKeepingLines', () => {
  it('keeps line breaks and drops empty lines, while cleaning each line', () => {
    expect(normaliseKeepingLines('  Invoice  number:  INV-1 \r\n\r\n Total\tdue: 10.00 \r')).toBe(
      'Invoice number: INV-1\nTotal due: 10.00',
    );
  });

  it('composes combining marks, as normaliseText does', () => {
    expect(normaliseKeepingLines('Café')).toBe('Café');
  });
});
