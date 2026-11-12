/* eslint-disable security/detect-non-literal-fs-filename -- the tests create their own folders */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256OfBytes } from '../../../../packages/shared/src/node.js';
import { MAX_INVOICE_BYTES, scanOnce, type IntakeOutcome } from '../../src/intake/intake.js';
import {
  acceptUpload,
  checkUploadConfig,
  createUploadServer,
  isSafeFileName,
  UPLOAD_NAME_HEADER,
  UPLOAD_PATH,
  type UploadConfig,
} from '../../src/intake/upload.js';
import { writeTextPdf } from '../../tools/lib/pdf-writer.js';

const TOKEN = 'a'.repeat(40);
let inbox = '';
let config: UploadConfig;

beforeEach(() => {
  inbox = mkdtempSync(join(tmpdir(), 'signoff-upload-'));
  config = { inboxDir: inbox, token: TOKEN };
});

afterEach(() => {
  rmSync(inbox, { recursive: true, force: true });
});

const auth = `Bearer ${TOKEN}`;
const pdf = writeTextPdf([['Invoice number: INV-TST-0100', 'Total due: 1500.00', 'Currency: ZAR']]);

describe('isSafeFileName', () => {
  it('accepts plain names', () => {
    expect(isSafeFileName('INV-TST-0100.pdf')).toBe(true);
    expect(isSafeFileName('scan_2026-11-12_1.png')).toBe(true);
  });

  it('refuses paths, traversal, hidden names, control characters and long names', () => {
    for (const name of [
      '../x.pdf',
      '..\\x.pdf',
      'a/b.pdf',
      'C:x.pdf',
      '.hidden.pdf',
      'a..b.pdf',
      'x\u0000.pdf',
      'a'.repeat(121),
    ]) {
      expect(isSafeFileName(name), name).toBe(false);
    }
  });
});

describe('acceptUpload', () => {
  it('refuses a request without the token, or with the wrong one, and writes nothing', () => {
    expect(
      acceptUpload(config, { authorization: undefined, fileName: 'a.pdf' }, pdf),
    ).toMatchObject({
      accepted: false,
      reason: 'UNAUTHORIZED',
      status: 401,
    });
    expect(
      acceptUpload(config, { authorization: `Bearer ${'b'.repeat(40)}`, fileName: 'a.pdf' }, pdf),
    ).toMatchObject({
      reason: 'UNAUTHORIZED',
    });
    expect(readdirSync(inbox)).toEqual([]);
  });

  it('refuses an unsafe name with 400 and writes nothing', () => {
    expect(
      acceptUpload(config, { authorization: auth, fileName: '../escape.pdf' }, pdf),
    ).toMatchObject({
      reason: 'UNSAFE_FILE_NAME',
      status: 400,
    });
    expect(acceptUpload(config, { authorization: auth, fileName: undefined }, pdf)).toMatchObject({
      reason: 'UNSAFE_FILE_NAME',
    });
    expect(readdirSync(inbox)).toEqual([]);
  });

  it('refuses an empty file and a file over the size limit', () => {
    expect(
      acceptUpload(config, { authorization: auth, fileName: 'a.pdf' }, new Uint8Array()),
    ).toMatchObject({
      reason: 'EMPTY_FILE',
      status: 400,
    });
    const huge = new Uint8Array(MAX_INVOICE_BYTES + 1);
    expect(acceptUpload(config, { authorization: auth, fileName: 'a.pdf' }, huge)).toMatchObject({
      reason: 'FILE_TOO_LARGE',
      status: 413,
    });
  });

  it('writes the file whole into the inbox and leaves no partial file behind', () => {
    const result = acceptUpload(config, { authorization: auth, fileName: 'INV-TST-0100.pdf' }, pdf);
    expect(result).toEqual({
      accepted: true,
      fileName: 'INV-TST-0100.pdf',
      bytes: pdf.length,
      sha256: sha256OfBytes(pdf),
    });
    expect(readFileSync(join(inbox, 'INV-TST-0100.pdf')).equals(pdf)).toBe(true);
    expect(readdirSync(inbox)).toEqual(['INV-TST-0100.pdf']);
  });

  it('never overwrites a name that is already in the inbox', () => {
    acceptUpload(config, { authorization: auth, fileName: 'a.pdf' }, pdf);
    const other = Buffer.from('a different file');
    expect(acceptUpload(config, { authorization: auth, fileName: 'a.pdf' }, other)).toMatchObject({
      reason: 'NAME_EXISTS',
      status: 409,
    });
    expect(readFileSync(join(inbox, 'a.pdf')).equals(pdf)).toBe(true);
  });

  it('hands the file to the same watcher, which reads it through the same checks', async () => {
    acceptUpload(config, { authorization: auth, fileName: 'upload.pdf' }, pdf);
    const handled: IntakeOutcome[] = [];
    const seen = new Set<string>();
    const stability = new Map<string, string>();
    const options = {
      dir: inbox,
      seen,
      stability,
      onOutcome: (_key: string, _path: string, outcome: IntakeOutcome) => {
        handled.push(outcome);
        return Promise.resolve();
      },
    };
    await scanOnce(options);
    await scanOnce(options);
    expect(handled).toHaveLength(1);
    expect(handled[0]).toMatchObject({ kind: 'text-pdf', fingerprint: sha256OfBytes(pdf) });
  });

  it('refuses a token shorter than 32 characters when the service starts', () => {
    expect(() => {
      checkUploadConfig({ inboxDir: inbox, token: 'short' });
    }).toThrow(RangeError);
  });
});

describe('the upload HTTP service', () => {
  let server: ReturnType<typeof createUploadServer>;
  let base = '';

  beforeEach(async () => {
    server = createUploadServer(config);
    await new Promise<void>((resolveListen) => {
      server.listen(0, '127.0.0.1', () => {
        resolveListen();
      });
    });
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    base = `http://127.0.0.1:${String(port)}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolveClose) => {
      server.close(() => {
        resolveClose();
      });
    });
  });

  it('accepts one file per POST with the token and the name header, and answers 202', async () => {
    const response = await fetch(`${base}${UPLOAD_PATH}`, {
      method: 'POST',
      headers: { authorization: auth, [UPLOAD_NAME_HEADER]: 'http-upload.pdf' },
      body: pdf,
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      accepted: true,
      fileName: 'http-upload.pdf',
      bytes: pdf.length,
    });
    expect(readFileSync(join(inbox, 'http-upload.pdf')).equals(pdf)).toBe(true);
  });

  it('answers 401 without reading the body when the token is missing', async () => {
    const response = await fetch(`${base}${UPLOAD_PATH}`, {
      method: 'POST',
      headers: { [UPLOAD_NAME_HEADER]: 'nope.pdf' },
      body: pdf,
    });
    expect(response.status).toBe(401);
    expect(readdirSync(inbox)).toEqual([]);
  });

  it('answers 405 to a GET and 404 to any other path', async () => {
    expect(
      (await fetch(`${base}${UPLOAD_PATH}`, { headers: { authorization: auth } })).status,
    ).toBe(405);
    expect(
      (await fetch(`${base}/v1/other`, { method: 'POST', headers: { authorization: auth } }))
        .status,
    ).toBe(404);
  });

  it('answers 400 for an unsafe file name', async () => {
    const response = await fetch(`${base}${UPLOAD_PATH}`, {
      method: 'POST',
      headers: { authorization: auth, [UPLOAD_NAME_HEADER]: '../../escape.pdf' },
      body: pdf,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ accepted: false, reason: 'UNSAFE_FILE_NAME' });
  });
});
