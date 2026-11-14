import { isoDatesIn } from '../extract/dates.js';
import type { ModelClient, ModelRequest, ModelReply } from '../model/types.js';

import { BASELINE_REPLY_NAME } from './baseline.js';

/**
 * A rule-based stand-in for a language model. It reads the labelled layout with fixed rules, and it is labelled
 * SIMULATED wherever its results appear. It is not a model, and a run with it measures the agent's checks and the
 * harness, never any model's ability to read an invoice. Live results need a provider key (see main.ts).
 *
 * It answers the two prompts the harness sends: the extraction (with quotes) and the single-prompt baseline. Its
 * baseline is written to decide as a single prompt with no checks would: it approves when the core fields are present,
 * and it does not look at the purchase order, the printed account or the wording of the document.
 */

export const SIMULATED_EXTRACTOR_LABEL = 'simulated:rule-based-extractor';
export const SIMULATED_BASELINE_LABEL = 'simulated:rule-based-baseline';

interface Read {
  readonly lines: readonly string[];
  readonly nonce: string;
}

function documentOf(request: ModelRequest): Read {
  const user = request.messages.find((message) => message.role === 'user')?.content ?? '';
  const nonce = /===BEGIN INVOICE TEXT ([0-9a-f]{24})===/.exec(user)?.[1] ?? '';
  const body =
    user
      .split(`===BEGIN INVOICE TEXT ${nonce}===`)[1]
      ?.split(`===END INVOICE TEXT ${nonce}===`)[0] ?? '';
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^--- page \d+ ---$/.test(line));
  return { lines, nonce };
}

function lineMatching(
  lines: readonly string[],
  pattern: RegExp,
): { readonly line: string; readonly match: RegExpExecArray } | null {
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match !== null) {
      return { line, match };
    }
  }
  return null;
}

interface Readings {
  readonly supplierName: { value: string; quote: string } | null;
  readonly invoiceNumber: { value: string; quote: string } | null;
  readonly invoiceDate: { value: string; quote: string } | null;
  readonly currency: { value: string; quote: string } | null;
  readonly totalAsPrinted: { value: string; quote: string } | null;
  readonly purchaseOrderNumber: { value: string; quote: string } | null;
  readonly payeeAccountAsPrinted: { value: string; quote: string } | null;
}

/** Reads the labelled layout. Every value comes with the whole line it was read from, so its quote is verbatim. */
export function readLayout(lines: readonly string[]): Readings {
  const first = lines[0];
  const pick = (pattern: RegExp, map: (text: string) => string | null = (text) => text) => {
    const found = lineMatching(lines, pattern);
    const value = found === null ? null : map(found.match[1] ?? '');
    return found === null || value === null || value.length === 0
      ? null
      : { value, quote: found.line };
  };
  return {
    supplierName: first === undefined ? null : { value: first, quote: first },
    invoiceNumber: pick(/^(?:Invoice number|Inv\. no\.):?\s+(\S+)$/),
    invoiceDate: pick(/^Invoice date:\s*(.+)$/, (text) => isoDatesIn(text)[0] ?? null),
    currency: pick(/^Currency:\s*(ZAR|US\$)$/, (text) => (text === 'US$' ? 'USD' : text)),
    totalAsPrinted: pick(/^Total due:\s*(.+)$/, (text) =>
      text.replace(/^(?:US\$|R|ZAR|USD)\s*/, '').trim(),
    ),
    purchaseOrderNumber: pick(/^PO number:\s*(\S+)$/),
    payeeAccountAsPrinted: pick(/^Bank account:\s*(\S+)$/),
  };
}

function extractionReply(readings: Readings): string {
  return JSON.stringify({
    schemaVersion: 1,
    supplierName: readings.supplierName,
    invoiceNumber: readings.invoiceNumber,
    invoiceDate: readings.invoiceDate,
    currency: readings.currency,
    totalAsPrinted: readings.totalAsPrinted,
    purchaseOrderNumber: readings.purchaseOrderNumber,
    payeeAccountAsPrinted: readings.payeeAccountAsPrinted,
  });
}

function baselineReply(readings: Readings): string {
  const value = (field: { value: string } | null): string | null => field?.value ?? null;
  const core =
    readings.supplierName !== null &&
    readings.invoiceNumber !== null &&
    readings.invoiceDate !== null &&
    readings.currency !== null &&
    readings.totalAsPrinted !== null;
  return JSON.stringify({
    decision: core ? 'ELIGIBLE' : 'HOLD',
    supplierName: value(readings.supplierName),
    invoiceNumber: value(readings.invoiceNumber),
    invoiceDate: value(readings.invoiceDate),
    currency: value(readings.currency),
    totalAsPrinted: value(readings.totalAsPrinted),
    purchaseOrderNumber: value(readings.purchaseOrderNumber),
    payeeAccountAsPrinted: value(readings.payeeAccountAsPrinted),
  });
}

/** The stand-in for a model. It is deterministic: the same document always gets the same reply. */
export function simulatedModel(kind: 'extractor' | 'baseline'): ModelClient {
  const label = kind === 'extractor' ? SIMULATED_EXTRACTOR_LABEL : SIMULATED_BASELINE_LABEL;
  return {
    label,
    complete(request: ModelRequest): Promise<ModelReply> {
      const readings = readLayout(documentOf(request).lines);
      const isBaseline = request.replySchema?.name === BASELINE_REPLY_NAME;
      const text = isBaseline ? baselineReply(readings) : extractionReply(readings);
      return Promise.resolve({ text });
    },
  };
}
