import { readFileSync } from 'node:fs';

import { SANCTIONS_SNAPSHOT, type SanctionsSnapshot } from './sanctions.js';

/**
 * Reads the OFAC SDN.CSV export into a snapshot, and loads a cached snapshot from disk.
 *
 * SDN.CSV has no header row. Columns used here: 0 = entry number, 1 = name, 2 = type, 3 = program.
 * Other columns (titles, vessel data, remarks) are ignored. Fields may be quoted; a quote inside a quoted
 * field is doubled. Rows whose name is "-0-" (empty in the export) are skipped.
 */

export const OFAC_SDN_URL = 'https://www.treasury.gov/ofac/downloads/sdn.csv';

/** Parses RFC 4180 style CSV into rows of fields. Pure. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
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
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error('CSV ends inside a quoted field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface SnapshotSource {
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  readonly sourceSha256: string;
}

/** Builds a validated snapshot from the SDN.CSV text. Throws if a row is too short to be an SDN row. */
export function snapshotFromSdnCsv(csv: string, source: SnapshotSource): SanctionsSnapshot {
  const entries = [];
  for (const [index, rawRow] of parseCsv(csv).entries()) {
    // The published file ends with a DOS end-of-file byte (0x1A) after the last CRLF. It is not a row.
    const row = rawRow.map((field) => field.replace(/\u001a/g, ''));
    if (row.every((field) => field.trim() === '')) continue;
    if (row.length < 4) throw new Error(`SDN row ${index + 1} has ${row.length} fields; expected at least 4`);
    const [entryNumber = '', rawName = '', type = '', program = ''] = row.map((field) => field.trim());
    if (rawName === '' || rawName === '-0-') continue;
    entries.push({ id: `OFAC-${entryNumber}`, name: rawName, type, program });
  }
  return SANCTIONS_SNAPSHOT.parse({ source: 'OFAC-SDN', ...source, entries });
}

/** Loads a cached snapshot. Returns null when the file is missing; throws when it exists but is not valid. */
export function loadSnapshot(path: string): SanctionsSnapshot | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return SANCTIONS_SNAPSHOT.parse(JSON.parse(raw));
}
