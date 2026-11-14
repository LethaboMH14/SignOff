import { describe, expect, it } from 'vitest';

import { BASELINE_REPLY_NAME } from '../../src/eval/baseline.js';
import { describeRate, rateOf, wilsonInterval } from '../../src/eval/metrics.js';
import {
  readLayout,
  simulatedModel,
  SIMULATED_BASELINE_LABEL,
  SIMULATED_EXTRACTOR_LABEL,
} from '../../src/eval/simulated-model.js';
import type { ModelRequest } from '../../src/model/types.js';

describe('wilsonInterval', () => {
  it('matches the published values for a small sample', () => {
    const none = wilsonInterval(0, 10);
    expect(none.low).toBeCloseTo(0, 6);
    expect(none.high).toBeCloseTo(0.2775, 3);
    const half = wilsonInterval(5, 10);
    expect(half.low).toBeCloseTo(0.2366, 3);
    expect(half.high).toBeCloseTo(0.7634, 3);
  });

  it('keeps the interval inside zero and one, and wide when the sample is small', () => {
    const all = wilsonInterval(30, 30);
    expect(all.high).toBeCloseTo(1, 6);
    expect(all.low).toBeGreaterThan(0.88);
    expect(wilsonInterval(1, 1000).high).toBeLessThan(0.01);
  });

  it('returns the whole range when there are no cases', () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe('rateOf and describeRate', () => {
  it('reports the count, the denominator and the interval', () => {
    const rate = rateOf(0, 16);
    expect(rate).toMatchObject({ count: 0, n: 16, rate: 0 });
    expect(describeRate(rate)).toBe('0/16 = 0.0% (95% CI 0.0% to 19.4%)');
  });

  it('reports a rate with no cases without dividing by zero', () => {
    const rate = rateOf(0, 0);
    expect(rate).toEqual({ count: 0, n: 0, rate: null, low: null, high: null });
    expect(describeRate(rate)).toBe('0/0 (no cases)');
  });
});

function request(schema: string | null, user: string): ModelRequest {
  return {
    messages: [
      { role: 'system', content: 'rules' },
      { role: 'user', content: user },
    ],
    maxTokens: 100,
    replySchema: schema === null ? null : { name: schema, schema: {} },
  };
}

const NONCE = 'a1b2c3d4e5f60718293a4b5c';
const DOCUMENT = [
  `===BEGIN INVOICE TEXT ${NONCE}===`,
  '--- page 1 ---',
  'Lumen Test Supplies (Pty) Ltd',
  'Invoice number: INV-TST-0100',
  'Invoice date: 2 October 2026',
  'Currency: US$',
  'Total due: US$ 1,250.00',
  'PO number: PO-TST-0100',
  'Bank account: FICT-ACC-1001',
  `===END INVOICE TEXT ${NONCE}===`,
].join('\n');

describe('readLayout', () => {
  it('reads each labelled line, quoting the whole line it came from', () => {
    const readings = readLayout(DOCUMENT.split('\n').slice(2, -1));
    expect(readings.supplierName).toEqual({
      value: 'Lumen Test Supplies (Pty) Ltd',
      quote: 'Lumen Test Supplies (Pty) Ltd',
    });
    expect(readings.invoiceNumber?.value).toBe('INV-TST-0100');
    expect(readings.invoiceDate?.value).toBe('2026-10-02');
    expect(readings.currency).toEqual({ value: 'USD', quote: 'Currency: US$' });
    expect(readings.totalAsPrinted).toEqual({
      value: '1,250.00',
      quote: 'Total due: US$ 1,250.00',
    });
    expect(readings.purchaseOrderNumber?.value).toBe('PO-TST-0100');
    expect(readings.payeeAccountAsPrinted?.value).toBe('FICT-ACC-1001');
  });

  it('gives null for a line that is absent, and for a date it cannot read', () => {
    const readings = readLayout(['Supplier', 'Invoice date: someday soon', 'Currency: EUR']);
    expect(readings.invoiceNumber).toBeNull();
    expect(readings.invoiceDate).toBeNull();
    expect(readings.currency).toBeNull();
    expect(readings.totalAsPrinted).toBeNull();
  });

  it('gives no supplier name for an empty document', () => {
    expect(readLayout([]).supplierName).toBeNull();
  });
});

describe('simulatedModel', () => {
  it('labels itself as a stand-in, never as a model', () => {
    expect(simulatedModel('extractor').label).toBe(SIMULATED_EXTRACTOR_LABEL);
    expect(simulatedModel('baseline').label).toBe(SIMULATED_BASELINE_LABEL);
    expect(SIMULATED_EXTRACTOR_LABEL).toMatch(/^simulated:/);
  });

  it('answers the extraction with quotes, and the baseline with a decision', async () => {
    const extraction = await simulatedModel('extractor').complete(
      request('invoice_extraction', DOCUMENT),
    );
    const parsed = JSON.parse(extraction.text) as Record<string, unknown>;
    expect(parsed['invoiceNumber']).toEqual({
      value: 'INV-TST-0100',
      quote: 'Invoice number: INV-TST-0100',
    });

    const baseline = await simulatedModel('baseline').complete(
      request(BASELINE_REPLY_NAME, DOCUMENT),
    );
    expect(JSON.parse(baseline.text)).toMatchObject({ decision: 'ELIGIBLE', currency: 'USD' });
  });

  it('holds in the baseline when a core field is absent', async () => {
    const partial = DOCUMENT.replace('Invoice number: INV-TST-0100\n', '');
    const baseline = await simulatedModel('baseline').complete(
      request(BASELINE_REPLY_NAME, partial),
    );
    expect(JSON.parse(baseline.text)).toMatchObject({ decision: 'HOLD', invoiceNumber: null });
  });

  it('reads an empty document as nothing, without failing', async () => {
    const reply = await simulatedModel('extractor').complete(request(null, 'no markers at all'));
    expect(JSON.parse(reply.text)).toMatchObject({ schemaVersion: 1, supplierName: null });
  });
});
