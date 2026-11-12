// Writes the whole fictional corpus: every invoice in every form, POs and GRNs, the supplier master,
// and labels.json with the expected outcome of each file. Same code, same bytes, every run.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCorpus, type Corpus, type Form, type Invoice, type Split } from './model.js';
import { layoutGoodsReceivedNote, layoutInvoice, layoutPurchaseOrder } from './layout.js';
import { renderPhoto, renderScanPdf, renderTextPdf, renderDocumentPdf } from './render.js';
import { sha256Hex } from './prng.js';
import { ABRIDGED_MAX_MINOR, FULL_INVOICE_ABOVE_MINOR } from './money.js';

export const GENERATOR_VERSION = '1.0.0';
export const LIBRARY_VERSIONS = { pdfkit: '0.20.2', sharp: '0.35.5' } as const;
export const NOTICE =
  'FICTIONAL TEST DATA. No real supplier, buyer, bank account, VAT number, invoice or person is represented.';

export interface LabelEntry {
  id: string;
  split: Split;
  supplierId: string;
  category: Invoice['category'];
  form: Form | 'document';
  path: string;
  sha256: string;
  bytes: number;
  expected: {
    decision: 'ELIGIBLE' | 'HOLD';
    reason: string | null;
    documentType: Invoice['docType'];
    fields: {
      supplierName: string;
      supplierVatNumber: string;
      senderDomain: string;
      invoiceNumber: string;
      invoiceDate: string;
      currency: 'ZAR' | 'USD';
      subtotalMinor: number;
      vatMinor: number;
      totalMinor: number;
      purchaseOrderNumber: string;
      goodsReceivedNoteNumber: string | null;
      payeeAccountAsPrinted: string;
      buyerVatNumber: string | null;
    };
  };
  relatedIds: string[];
  explanation: string;
}

export interface GenerationResult {
  outDir: string;
  invoices: number;
  files: number;
  byForm: Record<string, number>;
  byCategory: Record<string, number>;
  bySplit: Record<Split, number>;
  documents: number;
}

function extensionOf(form: Form): string {
  switch (form) {
    case 'text_pdf':
    case 'scan_pdf':
      return 'pdf';
    case 'photo_png':
      return 'png';
    case 'photo_jpg':
      return 'jpg';
  }
}

/** Writes one output file. Paths come from the output folder and the fixed corpus, never from input. */
async function writeOut(file: string, content: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(file, content);
}

/** Counts into a Map, so the key is never used as an object index. */
function bump<K>(counts: Map<K, number>, key: K): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function toRecord<K extends string>(counts: Map<K, number>): Record<string, number> {
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function supplierOf(corpus: Corpus, id: string) {
  const supplier = corpus.suppliers.find((candidate) => candidate.id === id);
  if (!supplier) throw new Error(`unknown supplier ${id}`);
  return supplier;
}

/** Renders one invoice form to bytes. The seed includes the form, so each form is its own stream. */
async function renderInvoiceForm(corpus: Corpus, invoice: Invoice, form: Form): Promise<Buffer> {
  const supplier = supplierOf(corpus, invoice.supplierId);
  const runs = layoutInvoice(invoice, supplier, corpus.buyer);
  const seed = `${invoice.id}/${invoice.bytesSalt}/${form}`;
  const info = {
    title: invoice.invoiceNumber,
    creator: `scan-${invoice.bytesSalt}`,
    subject: invoice.metadataText ?? '',
    keywords: invoice.metadataText ?? '',
  };
  if (form === 'text_pdf') return renderTextPdf(runs, info);
  if (form === 'scan_pdf') return renderScanPdf(runs, info, seed);
  if (form === 'photo_png') return renderPhoto(runs, 'png', seed);
  return renderPhoto(runs, 'jpg', seed);
}

function labelFor(
  corpus: Corpus,
  invoice: Invoice,
  form: Form,
  relPath: string,
  bytes: Buffer,
): LabelEntry {
  const supplier = supplierOf(corpus, invoice.supplierId);
  return {
    id: invoice.id,
    split: invoice.split,
    supplierId: invoice.supplierId,
    category: invoice.category,
    form,
    path: relPath,
    sha256: sha256Hex(bytes),
    bytes: bytes.length,
    expected: {
      decision: invoice.decision,
      reason: invoice.reason,
      documentType: invoice.docType,
      fields: {
        supplierName: supplier.name,
        supplierVatNumber: supplier.vatNumber,
        senderDomain: invoice.senderDomain,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        currency: invoice.currency,
        subtotalMinor: invoice.subtotalMinor,
        vatMinor: invoice.vatMinor,
        totalMinor: invoice.totalMinor,
        purchaseOrderNumber: invoice.poNumber,
        goodsReceivedNoteNumber: invoice.grnNumber,
        payeeAccountAsPrinted: invoice.payeeAccount,
        buyerVatNumber: invoice.buyer?.vatNumber ?? null,
      },
    },
    relatedIds: [...invoice.relatedIds],
    explanation: invoice.explanation,
  };
}

/**
 * Generates the corpus into outDir. outDir is cleared first, so no stale file survives a change.
 * Only pass a dedicated folder: everything inside it is replaced.
 */
export interface GenerateOptions {
  /** Restrict to these suppliers. The CLI writes everyone; the determinism test writes a subset. */
  supplierIds?: readonly string[];
}

export async function generate(
  outDir: string,
  options: GenerateOptions = {},
): Promise<{ result: GenerationResult; labels: object }> {
  const full = buildCorpus();
  const keep = options.supplierIds ? new Set(options.supplierIds) : null;
  const corpus: Corpus = keep
    ? {
        ...full,
        suppliers: full.suppliers.filter((s) => keep.has(s.id)),
        invoices: full.invoices.filter((i) => keep.has(i.supplierId)),
        purchaseOrders: full.purchaseOrders.filter((p) => keep.has(p.supplierId)),
        goodsReceivedNotes: full.goodsReceivedNotes.filter((g) => keep.has(g.supplierId)),
      }
    : full;
  await rm(outDir, { recursive: true, force: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(outDir, { recursive: true });

  const labelEntries: LabelEntry[] = [];
  const byForm = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const bySplit = new Map<Split, number>();
  let documents = 0;

  for (const invoice of corpus.invoices) {
    for (const form of invoice.forms) {
      const bytes = await renderInvoiceForm(corpus, invoice, form);
      const relPath = `${invoice.split}/invoices/${invoice.id}.${form}.${extensionOf(form)}`;
      // Paths are built from the fixed corpus and the output folder, never from input files.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await mkdir(path.join(outDir, invoice.split, 'invoices'), { recursive: true });
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await writeFile(path.join(outDir, relPath), bytes);
      labelEntries.push(labelFor(corpus, invoice, form, relPath, bytes));
      bump(byForm, form);
      bump(byCategory, invoice.category);
      bump(bySplit, invoice.split);
    }
  }

  for (const po of corpus.purchaseOrders) {
    const supplier = supplierOf(corpus, po.supplierId);
    const bytes = await renderDocumentPdf(
      layoutPurchaseOrder(po, supplier, corpus.buyer, 'space-comma'),
      {
        title: po.poNumber,
        creator: 'purchase-order',
      },
    );
    const relPath = `${supplier.split}/documents/${po.poNumber}.pdf`;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await mkdir(path.join(outDir, supplier.split, 'documents'), { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await writeFile(path.join(outDir, relPath), bytes);
    documents += 1;
  }

  for (const grn of corpus.goodsReceivedNotes) {
    const supplier = supplierOf(corpus, grn.supplierId);
    const bytes = await renderDocumentPdf(layoutGoodsReceivedNote(grn, supplier, corpus.buyer), {
      title: grn.grnNumber,
      creator: 'goods-received-note',
    });
    const relPath = `${supplier.split}/documents/${grn.grnNumber}.pdf`;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await mkdir(path.join(outDir, supplier.split, 'documents'), { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await writeFile(path.join(outDir, relPath), bytes);
    documents += 1;
  }

  labelEntries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const splitOf = (supplierId: string): Split => supplierOf(corpus, supplierId).split;
  const suppliers = corpus.suppliers.map((supplier) => ({
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    vatNumber: supplier.vatNumber,
    domain: supplier.domain,
    address: supplier.address,
    bank: supplier.bank,
    split: supplier.split,
  }));
  const split = {
    dev: suppliers.filter((s) => s.split === 'dev').map((s) => s.id),
    heldout: suppliers.filter((s) => s.split === 'heldout').map((s) => s.id),
  };
  const labels = {
    notice: NOTICE,
    generator: {
      version: GENERATOR_VERSION,
      libraries: LIBRARY_VERSIONS,
      seed: 'per-file, FNV-1a of the file id',
    },
    limits: [
      'Phone photos use an affine skew, not a true perspective transform.',
      'Scanned and photo forms are rasterised with the system sans-serif font; bytes are reproducible on one machine, not guaranteed across operating systems.',
      'Bank accounts, VAT numbers and names are invented. VAT numbers are not checked against SARS.',
      'SARS field list follows docs/research R1, whose s20(4) statutory text was not read.',
    ],
    thresholds: {
      fullInvoiceAboveMinor: FULL_INVOICE_ABOVE_MINOR,
      abridgedMaxMinor: ABRIDGED_MAX_MINOR,
    },
    split,
    suppliers,
    buyer: corpus.buyer,
    files: labelEntries,
  };
  await writeOut(
    path.join(outDir, 'supplier-master.json'),
    `${JSON.stringify(suppliers, null, 2)}
`,
  );
  await writeOut(
    path.join(outDir, 'labels.json'),
    `${JSON.stringify(labels, null, 2)}
`,
  );

  // Kept for the caller's sanity checks: every supplier is in exactly one split.
  for (const invoice of corpus.invoices) {
    if (splitOf(invoice.supplierId) !== invoice.split)
      throw new Error(`split mismatch for ${invoice.id}`);
  }

  return {
    result: {
      outDir,
      invoices: corpus.invoices.length,
      files: labelEntries.length,
      byForm: toRecord(byForm),
      byCategory: toRecord(byCategory),
      bySplit: { dev: bySplit.get('dev') ?? 0, heldout: bySplit.get('heldout') ?? 0 },
      documents,
    },
    labels,
  };
}
