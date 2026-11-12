/**
 * The console's invoice upload (Lane E item 7). The console does not parse the file. It reads the raw bytes from a signed-in
 * operator, and forwards them to the agent's upload endpoint (lane B, `apps/agent/src/intake/upload.ts`, contract in
 * `docs/design/agent-upload-api.md`) with the agent's bearer token. The agent's own checks then decide the outcome.
 * With no agent configured the route answers 501 with the reason; it never fakes an upload.
 */
import { type IncomingMessage } from 'node:http';

export const CONSOLE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const AGENT_TIMEOUT_MS = 15_000;

export interface AgentUploadConfig {
  /** The agent's upload URL, for example http://127.0.0.1:8090/v1/invoices. */
  readonly url: string;
  /** The bearer token, read from a secret file at start-up. Never logged, never sent to the browser. */
  readonly token: string;
}

export interface ForwardedReply {
  readonly status: number;
  readonly body: unknown;
}

/** Reads the raw request body, or null when it is larger than the limit. */
export async function readRawBody(request: IncomingMessage, limitBytes: number): Promise<Buffer | null> {
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
  return Buffer.concat(chunks);
}

/**
 * Sends the bytes to the agent and returns its status and body unchanged. A timeout, a network failure or a non-JSON reply
 * becomes a 502 with a plain sentence, so the console never shows a fake success.
 */
export async function forwardUpload(
  config: AgentUploadConfig,
  fileName: string,
  bytes: Uint8Array,
  fetchImpl: typeof fetch = fetch,
): Promise<ForwardedReply> {
  try {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.token}`,
        'x-file-name': fileName,
        'content-type': 'application/octet-stream',
      },
      body: new Blob([new Uint8Array(bytes)]),
      signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
    });
    const text = await response.text();
    try {
      return { status: response.status, body: JSON.parse(text) as unknown };
    } catch {
      return { status: 502, body: { error: 'the agent replied in a form the console does not read' } };
    }
  } catch {
    return { status: 502, body: { error: 'the agent did not answer the upload' } };
  }
}
