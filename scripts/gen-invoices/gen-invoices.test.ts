// Tests for the fictional invoice generator. Three things must hold: the arithmetic and SARS rules
// are exact, the supplier split is disjoint, and regenerating gives identical bytes (doctrine 5).
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCorpus, sarsRequirementOk } from './model.js';
import { generate } from './generate.js';
import { sha256Hex } from './prng.js';
import {
  ABRIDGED_MAX_MINOR,
  FULL_INVOICE_ABOVE_MINOR,
  formatAmount,
  formatDate,
  vatMinor,
} from './money.js';

// One dev supplier and one held-out supplier: every category and form, in about a minute.
const SUBSET = ['SUP-GEN-001', 'SUP-GEN-009'] as const;

interface LabelFile {
  path: string;
  sha256: string;
  bytes: number;
  split: 'dev' | 'heldout';
  supplierId: string;
  category: string;
  expected: { decision: string; reason: string | null };
}

describe('arithmetic and SARS rules (full corpus, no rendering)', () => {
  const corpus = buildCorpus();

  it('every ZAR invoice has exact integer VAT at 15%, and subtotal + VAT = total', () => {
    for (const invoice of corpus.invoices) {
      if (invoice.currency !== 'ZAR') continue;
      const lineSum = invoice.lines.reduce((sum, line) => sum + line.amountMinor, 0);
      expect(lineSum, invoice.id).toBe(invoice.subtotalMinor);
      expect(invoice.subtotalMinor % 20, invoice.id).toBe(0);
      expect(invoice.vatMinor, invoice.id).toBe(vatMinor(invoice.subtotalMinor));
      expect(invoice.subtotalMinor + invoice.vatMinor, invoice.id).toBe(invoice.totalMinor);
    }
  });

  it('clean invoices follow the SARS threshold: full above R5 000, abridged at or below', () => {
    const clean = corpus.invoices.filter(
      (i) => i.category === 'clean-full' || i.category === 'clean-abridged',
    );
    expect(clean.length).toBeGreaterThan(0);
    for (const invoice of clean) {
      expect(sarsRequirementOk(invoice), invoice.id).toBe(true);
      if (invoice.category === 'clean-full') {
        expect(invoice.totalMinor, invoice.id).toBeGreaterThan(FULL_INVOICE_ABOVE_MINOR);
        expect(invoice.docType, invoice.id).toBe('TAX_INVOICE_FULL');
        expect(invoice.buyer, invoice.id).not.toBeNull();
      } else {
        expect(invoice.totalMinor, invoice.id).toBeLessThanOrEqual(ABRIDGED_MAX_MINOR);
        expect(invoice.docType, invoice.id).toBe('TAX_INVOICE_ABRIDGED');
        expect(invoice.buyer, invoice.id).toBeNull();
      }
    }
  });

  it('split-under-limit pairs are each at or under R5 000 and together exceed it', () => {
    const splits = corpus.invoices.filter((i) => i.category === 'split-under-limit');
    const bySupplier = new Map<string, typeof splits>();
    for (const invoice of splits) {
      bySupplier.set(invoice.supplierId, [...(bySupplier.get(invoice.supplierId) ?? []), invoice]);
    }
    expect(bySupplier.size).toBe(corpus.suppliers.length);
    for (const pair of bySupplier.values()) {
      expect(pair).toHaveLength(2);
      for (const invoice of pair)
        expect(invoice.totalMinor, invoice.id).toBeLessThanOrEqual(ABRIDGED_MAX_MINOR);
      const [first, second] = pair;
      if (!first || !second) throw new Error('split pair incomplete');
      expect(first.totalMinor + second.totalMinor).toBeGreaterThan(FULL_INVOICE_ABOVE_MINOR);
      expect(first.invoiceDate).toBe(second.invoiceDate);
    }
  });

  it('keeps every supplier in exactly one split, and both splits are populated', () => {
    const dev = corpus.suppliers.filter((s) => s.split === 'dev').map((s) => s.id);
    const heldout = corpus.suppliers.filter((s) => s.split === 'heldout').map((s) => s.id);
    expect(dev.length).toBeGreaterThan(0);
    expect(heldout.length).toBeGreaterThan(0);
    expect(dev.filter((id) => heldout.includes(id))).toEqual([]);
    for (const invoice of corpus.invoices) {
      const supplier = corpus.suppliers.find((s) => s.id === invoice.supplierId);
      expect(invoice.split, invoice.id).toBe(supplier?.split);
    }
  });

  it('formats amounts in both house styles and dates day-first', () => {
    expect(formatAmount(1234567, 'space-comma', 'ZAR')).toBe('R 12 345,67');
    expect(formatAmount(1234567, 'comma-dot', 'ZAR')).toBe('R12,345.67');
    expect(formatAmount(500, 'comma-dot', 'USD')).toBe('USD 5.00');
    expect(formatDate('2026-10-03', 'slash')).toBe('03/10/2026');
    expect(formatDate('2026-10-03', 'long')).toBe('3 October 2026');
  });

  it('marks every fraud category as HOLD with a reason, and every clean one as ELIGIBLE', () => {
    for (const invoice of corpus.invoices) {
      if (invoice.category.startsWith('clean-')) {
        expect(invoice.decision, invoice.id).toBe('ELIGIBLE');
        expect(invoice.reason, invoice.id).toBeNull();
      } else {
        expect(invoice.decision, invoice.id).toBe('HOLD');
        expect(invoice.reason, invoice.id).not.toBeNull();
      }
    }
  });
});

describe('regeneration is deterministic (renders real files, subset of suppliers)', () => {
  let first: string;
  let second: string;
  let firstLabels: string;
  let secondLabels: string;

  beforeAll(async () => {
    first = await mkdtemp(path.join(os.tmpdir(), 'gen-invoices-a-'));
    second = await mkdtemp(path.join(os.tmpdir(), 'gen-invoices-b-'));
    await generate(first, { supplierIds: SUBSET });
    await generate(second, { supplierIds: SUBSET });
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    firstLabels = await readFile(path.join(first, 'labels.json'), 'utf8');
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    secondLabels = await readFile(path.join(second, 'labels.json'), 'utf8');
  }, 900_000);

  afterAll(async () => {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  });

  it('writes identical labels.json on both runs', () => {
    expect(secondLabels).toBe(firstLabels);
  });

  it('writes identical bytes for every file, and labels match the files on disk', async () => {
    const labels = JSON.parse(firstLabels) as { files: LabelFile[] };
    expect(labels.files.length).toBeGreaterThan(0);
    const splits = new Set(labels.files.map((f) => f.split));
    expect(splits).toEqual(new Set(['dev', 'heldout']));
    for (const entry of labels.files) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const onDisk = await readFile(path.join(first, entry.path));
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const again = await readFile(path.join(second, entry.path));
      expect(sha256Hex(again), entry.path).toBe(sha256Hex(onDisk));
      expect(sha256Hex(onDisk), entry.path).toBe(entry.sha256);
      expect(onDisk.length, entry.path).toBe(entry.bytes);
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      expect((await stat(path.join(first, entry.path))).size).toBeGreaterThan(0);
    }
  }, 900_000);

  it('keeps each supplier inside one split folder', () => {
    const labels = JSON.parse(firstLabels) as { files: LabelFile[] };
    for (const entry of labels.files) {
      const folder = entry.path.split('/')[0];
      expect(folder, entry.path).toBe(entry.split);
    }
  });
});
