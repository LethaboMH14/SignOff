// One layout, three renderers. A page is a list of runs in PDF points (A4: 595 x 842, origin
// top-left). The text PDF draws runs with PDFKit; the scanned and phone-photo forms draw the same
// runs as SVG and rasterise them. A single source keeps the four forms of one invoice identical in
// content, so only the presentation differs.
import { formatAmount, formatDate } from './money.js';
import type { GoodsReceivedNote, Invoice, PurchaseOrder, Supplier, Buyer } from './model.js';

export const PAGE_WIDTH = 595;
export const PAGE_HEIGHT = 842;

export type Run =
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      size: number;
      bold?: boolean;
      color?: string;
      align?: 'left' | 'right';
    }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number };

const INK = '#1d1d1f';
const MUTED = '#55575c';
const RULE = '#9aa0a6';
const HEAD_FILL = '#e9ecef';

function text(
  x: number,
  y: number,
  value: string,
  size = 9,
  extra: Partial<Extract<Run, { kind: 'text' }>> = {},
): Run {
  return { kind: 'text', x, y, text: value, size, color: INK, ...extra };
}

function sumLines(lines: { amountMinor: number }[]): number {
  return lines.reduce((total, line) => total + line.amountMinor, 0);
}

export function layoutInvoice(invoice: Invoice, supplier: Supplier, buyer: Buyer): Run[] {
  const runs: Run[] = [];
  const style = invoice.amountStyle;
  const money = (minor: number): string => formatAmount(minor, style, invoice.currency);
  const isCredit = invoice.docType === 'CREDIT_NOTE';
  const title = isCredit ? 'CREDIT NOTE' : 'TAX INVOICE';

  // Supplier block (top left).
  runs.push(text(40, 48, supplier.name, 15, { bold: true }));
  runs.push(text(40, 66, supplier.address, 9, { color: MUTED }));
  runs.push(text(40, 79, `VAT registration no: ${supplier.vatNumber}`, 9));
  runs.push(text(40, 92, `Email: accounts@${supplier.domain}`, 9, { color: MUTED }));
  runs.push(
    text(40, 105, `Bank: ${supplier.bank.bankName}  Branch: ${supplier.bank.branchCode}`, 9),
  );
  runs.push(
    text(40, 118, `Account: ${invoice.payeeAccount}  Holder: ${supplier.bank.accountHolder}`, 9),
  );

  // Document title and reference block (top right).
  runs.push(text(555, 48, title, 18, { bold: true, align: 'right' }));
  runs.push(text(555, 72, `Invoice no: ${invoice.invoiceNumber}`, 9, { align: 'right' }));
  runs.push(
    text(555, 86, `Date: ${formatDate(invoice.invoiceDate, invoice.dateStyle)}`, 9, {
      align: 'right',
    }),
  );
  runs.push(text(555, 100, `Purchase order: ${invoice.poNumber}`, 9, { align: 'right' }));
  runs.push(text(555, 114, `Currency: ${invoice.currency}`, 9, { align: 'right' }));

  // Buyer block: a full tax invoice carries it, an abridged one does not.
  if (invoice.buyer !== null) {
    runs.push(text(40, 150, 'Bill to', 9, { bold: true }));
    runs.push(text(40, 164, buyer.name, 9));
    runs.push(text(40, 177, `VAT registration no: ${invoice.buyer.vatNumber}`, 9));
    runs.push(text(40, 190, invoice.buyer.address, 9, { color: MUTED }));
  }

  // Line table.
  const tableTop = 226;
  runs.push({ kind: 'rect', x: 40, y: tableTop, w: 515, h: 18, fill: HEAD_FILL });
  runs.push(text(46, tableTop + 12, 'Description', 9, { bold: true }));
  runs.push(text(340, tableTop + 12, 'Qty', 9, { bold: true, align: 'right' }));
  runs.push(text(430, tableTop + 12, 'Unit price', 9, { bold: true, align: 'right' }));
  runs.push(text(549, tableTop + 12, 'Amount', 9, { bold: true, align: 'right' }));
  let y = tableTop + 18;
  for (const line of invoice.lines) {
    y += 20;
    runs.push(text(46, y, line.description, 9));
    runs.push(text(340, y, String(line.qty), 9, { align: 'right' }));
    runs.push(text(430, y, money(line.unitMinor), 9, { align: 'right' }));
    runs.push(text(549, y, money(line.amountMinor), 9, { align: 'right' }));
    runs.push({ kind: 'line', x1: 40, y1: y + 6, x2: 555, y2: y + 6, color: RULE, width: 0.4 });
  }

  // Totals. The subtotal is checked against the lines in the test suite, not here.
  const subtotal = sumLines(invoice.lines);
  const totalsTop = y + 30;
  runs.push(text(430, totalsTop, 'Subtotal', 9, { align: 'right' }));
  runs.push(text(549, totalsTop, money(subtotal), 9, { align: 'right' }));
  if (invoice.currency === 'ZAR') {
    runs.push(text(430, totalsTop + 14, 'VAT 15%', 9, { align: 'right' }));
    runs.push(text(549, totalsTop + 14, money(invoice.vatMinor), 9, { align: 'right' }));
  } else {
    runs.push(text(430, totalsTop + 14, 'VAT (not applicable)', 9, { align: 'right' }));
    runs.push(text(549, totalsTop + 14, money(0), 9, { align: 'right' }));
  }
  runs.push({
    kind: 'line',
    x1: 380,
    y1: totalsTop + 22,
    x2: 555,
    y2: totalsTop + 22,
    color: RULE,
    width: 0.8,
  });
  runs.push(
    text(430, totalsTop + 38, isCredit ? 'Total credit (incl. VAT)' : 'Total (incl. VAT)', 10, {
      bold: true,
      align: 'right',
    }),
  );
  runs.push(
    text(549, totalsTop + 38, money(invoice.totalMinor), 10, { bold: true, align: 'right' }),
  );

  // Payment and footer.
  runs.push(text(40, 640, 'Payment', 9, { bold: true }));
  runs.push(
    text(40, 654, `Please pay into ${supplier.bank.bankName}, account ${invoice.payeeAccount}.`, 9),
  );
  runs.push(
    text(40, 667, `Quote invoice number ${invoice.invoiceNumber} as the reference.`, 9, {
      color: MUTED,
    }),
  );
  runs.push(
    text(
      40,
      800,
      'Terms: 30 days from statement. Goods remain our property until paid in full.',
      7,
      { color: MUTED },
    ),
  );

  if (invoice.hiddenText !== null) {
    // White on white: invisible to a reader, present in the text layer.
    runs.push(text(40, 760, invoice.hiddenText, 6, { color: '#ffffff' }));
  }

  return runs;
}

export function layoutPurchaseOrder(
  po: PurchaseOrder,
  supplier: Supplier,
  buyer: Buyer,
  style: 'space-comma' | 'comma-dot',
): Run[] {
  const runs: Run[] = [];
  const money = (minor: number): string => formatAmount(minor, style, 'ZAR');
  runs.push(text(40, 48, 'PURCHASE ORDER', 16, { bold: true }));
  runs.push(text(40, 70, `PO number: ${po.poNumber}`, 10));
  runs.push(text(40, 84, `Issued: ${formatDate(po.issuedDate, 'long')}`, 10));
  runs.push(text(40, 110, 'Buyer', 9, { bold: true }));
  runs.push(text(40, 124, `${buyer.name}  VAT no ${buyer.vatNumber}`, 9));
  runs.push(text(300, 110, 'Supplier', 9, { bold: true }));
  runs.push(text(300, 124, `${supplier.name}  VAT no ${supplier.vatNumber}`, 9));
  let y = 170;
  runs.push({ kind: 'rect', x: 40, y, w: 515, h: 18, fill: HEAD_FILL });
  runs.push(text(46, y + 12, 'Description', 9, { bold: true }));
  runs.push(text(340, y + 12, 'Qty', 9, { bold: true, align: 'right' }));
  runs.push(text(549, y + 12, 'Amount (excl. VAT)', 9, { bold: true, align: 'right' }));
  for (const line of po.lines) {
    y += 20;
    runs.push(text(46, y, line.description, 9));
    runs.push(text(340, y, String(line.qty), 9, { align: 'right' }));
    runs.push(text(549, y, money(line.amountMinor), 9, { align: 'right' }));
  }
  runs.push(text(430, y + 30, 'Total (excl. VAT)', 9, { bold: true, align: 'right' }));
  runs.push(text(549, y + 30, money(po.totalMinor), 9, { bold: true, align: 'right' }));
  return runs;
}

export function layoutGoodsReceivedNote(
  grn: GoodsReceivedNote,
  supplier: Supplier,
  buyer: Buyer,
): Run[] {
  const runs: Run[] = [];
  runs.push(text(40, 48, 'GOODS RECEIVED NOTE', 16, { bold: true }));
  runs.push(text(40, 70, `GRN number: ${grn.grnNumber}`, 10));
  runs.push(text(40, 84, `PO reference: ${grn.poNumber}`, 10));
  runs.push(text(40, 98, `Received: ${formatDate(grn.receivedDate, 'long')}`, 10));
  runs.push(text(40, 124, `Received at ${buyer.name}`, 9));
  runs.push(text(40, 138, `From ${supplier.name}`, 9));
  let y = 170;
  runs.push({ kind: 'rect', x: 40, y, w: 515, h: 18, fill: HEAD_FILL });
  runs.push(text(46, y + 12, 'Description', 9, { bold: true }));
  runs.push(text(549, y + 12, 'Qty received', 9, { bold: true, align: 'right' }));
  for (const line of grn.lines) {
    y += 20;
    runs.push(text(46, y, line.description, 9));
    runs.push(text(549, y, String(line.qtyReceived), 9, { align: 'right' }));
  }
  runs.push(
    text(
      40,
      y + 40,
      'Received in good order unless noted. Signed by stores clerk (fictional).',
      8,
      { color: MUTED },
    ),
  );
  return runs;
}

/** Escapes text for SVG and XML. Used by the rasteriser so amounts and names survive intact. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function runsToSvg(runs: Run[]): string {
  const parts: string[] = [];
  for (const run of runs) {
    if (run.kind === 'text') {
      const anchor = run.align === 'right' ? 'end' : 'start';
      const weight = run.bold ? ' font-weight="bold"' : '';
      parts.push(
        `<text x="${String(run.x)}" y="${String(run.y)}" font-family="Helvetica, Arial, sans-serif" font-size="${String(run.size)}"${weight} fill="${run.color ?? INK}" text-anchor="${anchor}">${escapeXml(run.text)}</text>`,
      );
    } else if (run.kind === 'rect') {
      parts.push(
        `<rect x="${String(run.x)}" y="${String(run.y)}" width="${String(run.w)}" height="${String(run.h)}" fill="${run.fill}"/>`,
      );
    } else {
      parts.push(
        `<line x1="${String(run.x1)}" y1="${String(run.y1)}" x2="${String(run.x2)}" y2="${String(run.y2)}" stroke="${run.color}" stroke-width="${String(run.width)}"/>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(PAGE_WIDTH)}" height="${String(PAGE_HEIGHT)}" viewBox="0 0 ${String(PAGE_WIDTH)} ${String(PAGE_HEIGHT)}"><rect width="${String(PAGE_WIDTH)}" height="${String(PAGE_HEIGHT)}" fill="#ffffff"/>${parts.join('')}</svg>`;
}
