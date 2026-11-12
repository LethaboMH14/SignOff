/* eslint-disable security/detect-non-literal-fs-filename -- writes only into the operator's configured inbox, under a name that passed isSafeFileName and resolves directly inside that folder */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { renameSync, writeFileSync, mkdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { MAX_INVOICE_BYTES } from './intake.js';

/**
 * The console upload. A signed-in operator's console sends one invoice file to the agent; the agent writes it into the
 * inbox, and the same watcher, with the same checks, reads it from there. The handler does the checks that belong to
 * the request (who is sending, the file name, the size, emptiness) and never parses the content itself, so a file
 * cannot skip a check by arriving by upload.
 *
 * The HTTP contract is documented for the console in docs/design/agent-upload-api.md.
 */

export const UPLOAD_PATH = '/v1/invoices';
/** The header that names the file. It is read as request.headers['x-file-name'] (Node lower-cases header names). */
export const UPLOAD_NAME_HEADER = 'x-file-name';
const MIN_TOKEN_LENGTH = 32;
const MAX_NAME_LENGTH = 120;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type UploadRefusal =
  | 'UNAUTHORIZED'
  | 'UNSAFE_FILE_NAME'
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'NAME_EXISTS'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'WRITE_FAILED';

export interface UploadAccepted {
  readonly accepted: true;
  /** The name the file has in the inbox. The intake reads it on the next poll. */
  readonly fileName: string;
  readonly bytes: number;
  /** SHA-256 of the bytes. The intake fingerprints the same bytes on its own read. */
  readonly sha256: string;
}

export interface UploadRefused {
  readonly accepted: false;
  readonly reason: UploadRefusal;
  readonly status: number;
}

export type UploadResult = UploadAccepted | UploadRefused;

/**
 * A safe inbox file name: letters, digits, dots, underscores and hyphens, starting with a letter or digit, no path
 * separators, and no "..". Anything else is refused rather than rewritten, so the console learns about it.
 */
export function isSafeFileName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_NAME_LENGTH &&
    NAME_PATTERN.test(name) &&
    !name.includes('..')
  );
}

/** Compares two secrets in constant time. Both are hashed first, so their lengths do not leak. */
function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** True when the Authorization header carries the configured bearer token. */
export function isAuthorised(config: UploadConfig, authorization: string | undefined): boolean {
  const presented = /^Bearer (.+)$/.exec(authorization ?? '')?.[1] ?? '';
  return presented.length > 0 && sameSecret(presented, config.token);
}

export interface UploadConfig {
  readonly inboxDir: string;
  /** The bearer token the console presents. It must be at least 32 characters; a shorter one stops the service. */
  readonly token: string;
}

export function checkUploadConfig(config: UploadConfig): void {
  if (config.token.length < MIN_TOKEN_LENGTH) {
    throw new RangeError(
      `the upload token must be at least ${String(MIN_TOKEN_LENGTH)} characters`,
    );
  }
}

/**
 * Accepts or refuses one upload. The bytes are written into the inbox under a name the operator's console chose, only
 * if that name is safe and not already taken. The write is atomic: the file appears in the inbox only when it is whole.
 */
export function acceptUpload(
  config: UploadConfig,
  request: { readonly authorization: string | undefined; readonly fileName: string | undefined },
  bytes: Uint8Array,
): UploadResult {
  const refuse = (reason: UploadRefusal, status: number): UploadRefused => ({
    accepted: false,
    reason,
    status,
  });
  if (!isAuthorised(config, request.authorization)) {
    return refuse('UNAUTHORIZED', 401);
  }
  if (request.fileName === undefined || !isSafeFileName(request.fileName)) {
    return refuse('UNSAFE_FILE_NAME', 400);
  }
  if (bytes.length === 0) {
    return refuse('EMPTY_FILE', 400);
  }
  if (bytes.length > MAX_INVOICE_BYTES) {
    return refuse('FILE_TOO_LARGE', 413);
  }

  const inbox = resolve(config.inboxDir);
  const target = resolve(inbox, request.fileName);
  // The resolved target must sit directly in the inbox. A name that resolves elsewhere is refused.
  if (target !== join(inbox, request.fileName)) {
    return refuse('UNSAFE_FILE_NAME', 400);
  }
  try {
    lstatSync(target);
    return refuse('NAME_EXISTS', 409);
  } catch {
    // The name is free. The write below creates it.
  }
  const partial = join(inbox, `.upload-${randomBytes(12).toString('hex')}.part`);
  try {
    mkdirSync(inbox, { recursive: true });
    writeFileSync(partial, bytes, { flag: 'wx' });
    renameSync(partial, target);
  } catch {
    return refuse('WRITE_FAILED', 500);
  }
  return {
    accepted: true,
    fileName: request.fileName,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** Reads a request body up to the size limit. A longer body is refused without being kept. */
function readBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        request.resume();
        resolveBody(null);
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolveBody(total > limit ? null : Buffer.concat(chunks));
    });
    request.on('error', rejectBody);
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(`${JSON.stringify(body)}\n`);
}

/**
 * The HTTP service for the console. It listens on the address it is given, which the agent sets to 127.0.0.1 unless the
 * operator says otherwise. One route accepts one file per request.
 */
export function createUploadServer(config: UploadConfig): Server {
  checkUploadConfig(config);
  return createServer((request, response) => {
    void handle(request, response, config);
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  config: UploadConfig,
): Promise<void> {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (path !== UPLOAD_PATH) {
    send(response, 404, { accepted: false, reason: 'NOT_FOUND' });
    return;
  }
  if (request.method !== 'POST') {
    send(response, 405, { accepted: false, reason: 'METHOD_NOT_ALLOWED' });
    return;
  }
  // The token is checked before the body is read, so an unauthorised caller cannot make the service buffer a file.
  if (!isAuthorised(config, request.headers.authorization)) {
    send(response, 401, { accepted: false, reason: 'UNAUTHORIZED' });
    return;
  }
  const body = await readBody(request, MAX_INVOICE_BYTES);
  if (body === null) {
    send(response, 413, { accepted: false, reason: 'FILE_TOO_LARGE' });
    return;
  }
  const header = request.headers['x-file-name'];
  const result = acceptUpload(
    config,
    {
      authorization: request.headers.authorization,
      fileName: typeof header === 'string' ? header : undefined,
    },
    body,
  );
  if (result.accepted) {
    send(response, 202, result);
    return;
  }
  send(response, result.status, { accepted: false, reason: result.reason });
}
