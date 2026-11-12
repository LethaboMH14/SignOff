import { type IncomingMessage, type ServerResponse } from 'node:http';

/** Sent with every response. The page may load only its own script and style, and nothing may frame it. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
): void {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    ...extraHeaders,
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

export function sendEmpty(
  response: ServerResponse,
  status: number,
  extraHeaders: Readonly<Record<string, string>> = {},
): void {
  response.writeHead(status, { ...SECURITY_HEADERS, ...extraHeaders });
  response.end();
}

/** The request body as text, or null when it is larger than the limit. A body is read once, in full. */
export async function readBody(
  request: IncomingMessage,
  limitBytes: number,
): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, 'utf8');
    size += piece.length;
    if (size > limitBytes) {
      return null;
    }
    chunks.push(piece);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The value of one cookie from the request, or null. */
export function cookieOf(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return rest.join('=');
    }
  }
  return null;
}
