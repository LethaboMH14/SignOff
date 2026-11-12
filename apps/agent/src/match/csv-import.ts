import { z } from 'zod';

import {
  parseMoneyText,
  type SupportedCurrency,
} from '../../../../packages/shared/src/money/minor-units.js';
import type {
  GoodsReceiptRecord,
  PurchaseOrderRecord,
} from '../../../../packages/shared/src/schemas/evidence.js';
import {
  CurrencyCode,
  IsoInstant,
  SupplierId,
} from '../../../../packages/shared/src/schemas/primitives.js';

import type { ScreenCandidate } from './fraud-screen.js';
import { SupplierMaster } from './supplier-master.js';

/**
 * Imports the buyer's four CSV exports (R3 section 3): suppliers, purchase orders, goods received and payment
 * history. This is the only path from the buyer's records into the agent, and it fails closed: any row that does not
 * validate stops the whole import with every error listed by file and line. No value is guessed or defaulted, except
 * the two stated defaults (a blank closed-status means open, a blank payee means none printed).
 *
 * Several goods-received rows for one purchase order are added together, so the receipt is cumulative. A partial
 * delivery therefore holds until the rest arrives, and an over-delivery is passed to the matcher as its own check.
 *
 * Not an integration: the buyer exports these files from its own system (see docs/DATA-IMPORT.md for the column
 * mapping, which is unverified against real exports).
 */

export interface CsvRow {
  readonly line: number;
  readonly cells: Readonly<Record<string, string>>;
}

export interface ParsedCsv {
  readonly headers: readonly string[];
  readonly rows: readonly CsvRow[];
}

export interface ImportError {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/** A small RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF, and an optional byte-order mark. */
export function parseCsv(text: string): { readonly rows: string[][] } {
  const input = text.startsWith('﻿') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (input.charAt(i + 1) === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input.charAt(i + 1) === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (quoted) {
    throw new Error('a quoted field is not closed');
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { rows: rows.filter((cells) => cells.some((cell) => cell.trim() !== '')) };
}

function headerKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** Parses the text and checks the header row names exactly the columns the file type needs, and no others. */
export function readTable(
  text: string,
  file: string,
  columns: readonly string[],
  errors: ImportError[],
): readonly CsvRow[] {
  const parsed = parseCsv(text);
  const [headerRow, ...dataRows] = parsed.rows;
  if (headerRow === undefined) {
    errors.push({ file, line: 1, message: 'the file is empty' });
    return [];
  }
  const headers = headerRow.map(headerKey);
  const missing = columns.filter((column) => !headers.includes(column));
  const unknown = headers.filter((header) => !columns.includes(header));
  if (missing.length > 0 || unknown.length > 0) {
    errors.push({
      file,
      line: 1,
      message: `columns must be ${columns.join(', ')}; missing [${missing.join(', ')}], unexpected [${unknown.join(', ')}]`,
    });
    return [];
  }
  return dataRows.map((cells, index) => {
    const named = Object.fromEntries(
      headers.map((header, column) => [header, (cells.at(column) ?? '').trim()]),
    );
    return { line: index + 2, cells: named };
  });
}

const SUPPLIER_COLUMNS = [
  'supplier_id',
  'legal_name',
  'enrolled_payee_as_printed',
  'status',
] as const;
const ORDER_COLUMNS = ['purchase_order_id', 'supplier_id', 'currency', 'amount', 'status'] as const;
const RECEIPT_COLUMNS = ['purchase_order_id', 'received_amount', 'received_at'] as const;
const HISTORY_COLUMNS = [
  'supplier_id',
  'invoice_number',
  'invoice_date',
  'currency',
  'amount',
  'purchase_order_id',
  'payee_account',
  'state',
] as const;

const SupplierRow = z.strictObject({
  supplier_id: SupplierId,
  legal_name: z.string().min(1).max(200),
  enrolled_payee_as_printed: z
    .string()
    .max(80)
    .transform((value) => (value === '' ? null : value)),
  status: z.enum(['approved', 'pending', 'suspended']),
});

const OrderRow = z.strictObject({
  purchase_order_id: z.string().min(1).max(64),
  supplier_id: SupplierId,
  currency: CurrencyCode,
  amount: z.string().min(1).max(40),
  status: z.enum(['open', 'closed', '']).transform((value) => (value === '' ? 'open' : value)),
});

const ReceiptRow = z.strictObject({
  purchase_order_id: z.string().min(1).max(64),
  received_amount: z.string().min(1).max(40),
  received_at: IsoInstant,
});

const HistoryRow = z.strictObject({
  supplier_id: SupplierId,
  invoice_number: z.string().min(1).max(64),
  invoice_date: z.iso.date(),
  currency: CurrencyCode,
  amount: z.string().min(1).max(40),
  purchase_order_id: z
    .string()
    .max(64)
    .transform((value) => (value === '' ? null : value)),
  payee_account: z
    .string()
    .max(80)
    .transform((value) => (value === '' ? null : value)),
  state: z.enum(['paid', 'open', 'void']),
});

export interface ImportedBook {
  readonly suppliers: readonly SupplierMaster[];
  readonly purchaseOrders: readonly PurchaseOrderRecord[];
  readonly goodsReceipts: readonly GoodsReceiptRecord[];
  readonly history: readonly ScreenCandidate[];
}

export type ImportResult =
  | { readonly ok: true; readonly book: ImportedBook }
  | { readonly ok: false; readonly errors: readonly ImportError[] };

export interface CsvFiles {
  readonly suppliers: string;
  readonly purchaseOrders: string;
  readonly goodsReceived: string;
  readonly paymentHistory: string;
}

function parseAmount(
  text: string,
  currency: SupportedCurrency,
  file: string,
  line: number,
  errors: ImportError[],
): number | null {
  const parsed = parseMoneyText(text, currency);
  if (!parsed.ok) {
    errors.push({ file, line, message: `amount "${text}": ${parsed.reason}` });
    return null;
  }
  return parsed.minor;
}

function currencyOf(code: string): SupportedCurrency | null {
  const parsed = CurrencyCode.safeParse(code);
  return parsed.success ? parsed.data : null;
}

/** Validates all four files. Errors from every file are returned together, so one run lists everything to fix. */
export function importBook(files: CsvFiles): ImportResult {
  const errors: ImportError[] = [];

  const supplierRows = readTable(files.suppliers, 'suppliers.csv', SUPPLIER_COLUMNS, errors);
  const suppliers: SupplierMaster[] = [];
  for (const row of supplierRows) {
    const parsed = SupplierRow.safeParse({ ...row.cells });
    if (!parsed.success) {
      errors.push({
        file: 'suppliers.csv',
        line: row.line,
        message: parsed.error.issues[0]?.message ?? 'invalid row',
      });
      continue;
    }
    suppliers.push({
      supplierId: parsed.data.supplier_id,
      legalName: parsed.data.legal_name,
      enrolledPayeeAsPrinted: parsed.data.enrolled_payee_as_printed,
      status: parsed.data.status,
    });
  }
  const supplierIds = new Set<string>();
  for (const supplier of suppliers) {
    if (supplierIds.has(supplier.supplierId)) {
      errors.push({
        file: 'suppliers.csv',
        line: 0,
        message: `supplier ${supplier.supplierId} appears twice`,
      });
    }
    supplierIds.add(supplier.supplierId);
  }

  const orderRows = readTable(files.purchaseOrders, 'purchase_orders.csv', ORDER_COLUMNS, errors);
  const orders = new Map<string, PurchaseOrderRecord>();
  for (const row of orderRows) {
    const parsed = OrderRow.safeParse({ ...row.cells });
    const currency = currencyOf(row.cells['currency'] ?? '');
    if (!parsed.success || currency === null) {
      errors.push({
        file: 'purchase_orders.csv',
        line: row.line,
        message: parsed.success
          ? 'unsupported currency'
          : (parsed.error.issues[0]?.message ?? 'invalid row'),
      });
      continue;
    }
    const amount = parseAmount(
      parsed.data.amount,
      currency,
      'purchase_orders.csv',
      row.line,
      errors,
    );
    if (amount === null || amount === 0) {
      if (amount === 0)
        errors.push({
          file: 'purchase_orders.csv',
          line: row.line,
          message: 'an order must be above zero',
        });
      continue;
    }
    if (orders.has(parsed.data.purchase_order_id)) {
      errors.push({
        file: 'purchase_orders.csv',
        line: row.line,
        message: `purchase order ${parsed.data.purchase_order_id} appears twice`,
      });
      continue;
    }
    orders.set(parsed.data.purchase_order_id, {
      purchaseOrderId: parsed.data.purchase_order_id,
      supplierId: parsed.data.supplier_id,
      currency,
      amountMinor: amount,
      status: parsed.data.status === 'closed' ? 'closed' : 'open',
    });
  }

  const receiptRows = readTable(files.goodsReceived, 'goods_received.csv', RECEIPT_COLUMNS, errors);
  const receiptTotals = new Map<
    string,
    { minor: number; at: string; currency: SupportedCurrency }
  >();
  for (const row of receiptRows) {
    const parsed = ReceiptRow.safeParse({ ...row.cells });
    if (!parsed.success) {
      errors.push({
        file: 'goods_received.csv',
        line: row.line,
        message: parsed.error.issues[0]?.message ?? 'invalid row',
      });
      continue;
    }
    const order = orders.get(parsed.data.purchase_order_id);
    if (order === undefined) {
      errors.push({
        file: 'goods_received.csv',
        line: row.line,
        message: `no purchase order ${parsed.data.purchase_order_id}`,
      });
      continue;
    }
    const minor = parseAmount(
      parsed.data.received_amount,
      order.currency,
      'goods_received.csv',
      row.line,
      errors,
    );
    if (minor === null) continue;
    const previous = receiptTotals.get(order.purchaseOrderId);
    receiptTotals.set(order.purchaseOrderId, {
      minor: (previous?.minor ?? 0) + minor,
      at:
        previous === undefined || parsed.data.received_at > previous.at
          ? parsed.data.received_at
          : previous.at,
      currency: order.currency,
    });
  }
  const goodsReceipts: GoodsReceiptRecord[] = [...receiptTotals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([purchaseOrderId, total]) => ({
      purchaseOrderId,
      receivedMinor: total.minor,
      receivedAt: total.at,
    }));

  const historyRows = readTable(
    files.paymentHistory,
    'payment_history.csv',
    HISTORY_COLUMNS,
    errors,
  );
  const history: ScreenCandidate[] = [];
  const invoiced = new Map<string, number>();
  for (const row of historyRows) {
    const parsed = HistoryRow.safeParse({ ...row.cells });
    const currency = currencyOf(row.cells['currency'] ?? '');
    if (!parsed.success || currency === null) {
      errors.push({
        file: 'payment_history.csv',
        line: row.line,
        message: parsed.success
          ? 'unsupported currency'
          : (parsed.error.issues[0]?.message ?? 'invalid row'),
      });
      continue;
    }
    if (parsed.data.state === 'void') continue;
    const amount = parseAmount(
      parsed.data.amount,
      currency,
      'payment_history.csv',
      row.line,
      errors,
    );
    if (amount === null) continue;
    history.push({
      // History rows come from the buyer's books, not from a file SignOff received, so there is no file fingerprint.
      fingerprint: '',
      supplierId: parsed.data.supplier_id,
      invoiceNumber: parsed.data.invoice_number,
      amountMinor: amount,
      payeeAccountAsPrinted: parsed.data.payee_account,
      invoiceDate: parsed.data.invoice_date,
    });
    if (parsed.data.purchase_order_id !== null) {
      invoiced.set(
        parsed.data.purchase_order_id,
        (invoiced.get(parsed.data.purchase_order_id) ?? 0) + amount,
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const purchaseOrders: PurchaseOrderRecord[] = [...orders.values()]
    .sort((a, b) =>
      a.purchaseOrderId < b.purchaseOrderId ? -1 : a.purchaseOrderId > b.purchaseOrderId ? 1 : 0,
    )
    .map((order) => ({ ...order, invoicedMinor: invoiced.get(order.purchaseOrderId) ?? 0 }));
  return { ok: true, book: { suppliers, purchaseOrders, goodsReceipts, history } };
}
