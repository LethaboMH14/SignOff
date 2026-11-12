import { describe, expect, it } from 'vitest';

import { characterErrorRate } from '../../src/text/cer.js';
import {
  estimateSkewDegrees,
  greyFromRgba,
  otsuThreshold,
  prepareGrey,
  rotateGrey,
  type GreyImage,
} from '../../src/text/preprocess.js';
import { minorOf, scanAmountHold, totalsInText } from '../../src/text/scan-amount.js';

/** A page of horizontal bars, like printed lines, with a clear skew when it is turned. */
function barsPage(): GreyImage {
  const width = 600;
  const height = 800;
  const data = new Uint8Array(width * height).fill(255);
  for (let y = 100; y < 700; y += 20) {
    for (let dy = 0; dy < 6; dy += 1) {
      for (let x = 60; x < 540; x += 1) data[(y + dy) * width + x] = 0;
    }
  }
  return { width, height, data };
}

describe('otsuThreshold', () => {
  it('separates ink from paper on a two-level page', () => {
    const data = new Uint8Array(100).fill(250);
    data.fill(20, 0, 30);
    const level = otsuThreshold(data);
    expect(level).toBeGreaterThanOrEqual(20);
    expect(level).toBeLessThan(250);
  });
});

describe('estimateSkewDegrees and rotateGrey', () => {
  const page = barsPage();
  const threshold = otsuThreshold(page.data);

  it('finds no skew on a straight page', () => {
    expect(estimateSkewDegrees(page, threshold)).toBe(0);
  });

  it.each([1.5, -1.5, 3, -3])('finds a turn of %s degrees and corrects it to zero', (degrees) => {
    const turned = rotateGrey(page, degrees);
    const found = estimateSkewDegrees(turned, otsuThreshold(turned.data));
    expect(found).toBeCloseTo(degrees, 6);
    const fixed = rotateGrey(turned, -found);
    expect(estimateSkewDegrees(fixed, otsuThreshold(fixed.data))).toBe(0);
  });

  it('keeps the page size and fills the corners with paper', () => {
    const turned = rotateGrey(page, 2);
    expect(turned.width).toBe(page.width);
    expect(turned.height).toBe(page.height);
    expect(turned.data[0]).toBe(255);
  });

  it('returns the same image for a zero turn', () => {
    expect(rotateGrey(page, 0).data).toEqual(page.data);
  });

  it('gives the same answer on every run (determinism)', () => {
    const turned = rotateGrey(page, 2.25);
    const first = estimateSkewDegrees(turned, otsuThreshold(turned.data));
    expect(estimateSkewDegrees(turned, otsuThreshold(turned.data))).toBe(first);
  });
});

describe('prepareGrey and greyFromRgba', () => {
  it('reports the correction it applied', () => {
    const turned = rotateGrey(barsPage(), 1.5);
    const prepared = prepareGrey(turned);
    expect(prepared.correctedDegrees).toBeCloseTo(1.5, 6);
    expect(prepared.image.width).toBe(turned.width);
  });

  it('computes Rec. 601 luma from RGBA', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    expect(Array.from(greyFromRgba(rgba, 3, 1).data)).toEqual([76, 150, 29]);
  });
});

describe('characterErrorRate', () => {
  it('is zero for identical text, ignoring white space', () => {
    expect(characterErrorRate('Total due:  1500.00', 'Total due:\n1500.00')).toBe(0);
  });

  it('counts each substitution, insertion and deletion once', () => {
    expect(characterErrorRate('abcd', 'abxd')).toBe(0.25);
    expect(characterErrorRate('abcd', 'abcde')).toBe(0.25);
    expect(characterErrorRate('abcd', 'abd')).toBe(0.25);
  });
});

describe('scan amount (the second reading)', () => {
  it('reads labelled totals in minor units, with a comma or a point as the decimal mark', () => {
    expect(totalsInText('Total due: 1234.50')).toEqual([123450]);
    expect(totalsInText('TOTAL DUE R 1 234,50')).toEqual([123450]);
    expect(totalsInText('Grand total: 12,345.67')).toEqual([1234567]);
  });

  it('does not read a subtotal or an amount excluding VAT as the total', () => {
    expect(totalsInText('Subtotal: 1000.00\nVAT: 150.00\nTotal due: 1150.00')).toEqual([115000]);
    expect(totalsInText('Total excl VAT: 1000.00')).toEqual([]);
  });

  it('converts only a printed amount with a two-digit decimal part', () => {
    expect(minorOf('1234')).toBeNull();
    expect(minorOf('0.05')).toBe(5);
  });

  it('confirms an exact match and holds a difference of one cent', () => {
    expect(scanAmountHold('Total due: 1234.50', 123450)).toBeNull();
    expect(scanAmountHold('Total due: 1234.50', 123451)).toBe('SCAN_AMOUNT_DISAGREES');
  });

  it('holds when no labelled total can be read at all', () => {
    expect(scanAmountHold('Invoice number: INV-TST-0100', 123450)).toBe('SCAN_AMOUNT_NOT_FOUND');
  });
});
