import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

/**
 * Runs the PDF text extractor in a child process, with a time limit, an output limit and no inherited environment.
 * The child's answer is untrusted output from a parser, so it is validated before anything uses it.
 */

const DEFAULT_CHILD_SCRIPT = fileURLToPath(new URL('./pdf-child.mjs', import.meta.url));
const CHILD_HEAP_MB = 256;

export const PDF_TIMEOUT_MS = 20_000;
export const MAX_CHILD_OUTPUT_BYTES = 4 * 1024 * 1024;

export type PdfFailure = 'ENCRYPTED' | 'UNREADABLE' | 'TOO_MANY_PAGES' | 'EXTRACTION_FAILED';

/** Text a reader does not see as page text but a model would read: annotations and document information. */
export interface PdfExtras {
  /** Annotation contents, alternative text and field values, each with the 1-based page it sits on. */
  readonly annotations: readonly { readonly page: number; readonly text: string }[];
  readonly metadata: readonly string[];
}

export type PdfTextResult =
  | {
      readonly ok: true;
      readonly pages: readonly string[];
      readonly extras: PdfExtras;
      /** True when the parser cut a page, an annotation or the output at its limit. The document is then held. */
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly reason: PdfFailure };

const FAILED: PdfTextResult = { ok: false, reason: 'EXTRACTION_FAILED' };

const ChildAnswer = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    pages: z.array(z.string().max(200_000)).min(1).max(200),
    annotations: z
      .array(
        z.strictObject({ page: z.number().int().min(1).max(200), text: z.string().max(200_000) }),
      )
      .max(500),
    metadata: z.array(z.string().max(200_000)).max(20),
    truncated: z.boolean(),
  }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum(['ENCRYPTED', 'UNREADABLE', 'TOO_MANY_PAGES']),
  }),
]);

export interface PdfTextOptions {
  readonly timeoutMs?: number;
  /** Replaces the extractor script. Tests use it to check the limits. */
  readonly script?: string;
}

export function extractPdfText(
  bytes: Uint8Array,
  options: PdfTextOptions = {},
): Promise<PdfTextResult> {
  return new Promise<PdfTextResult>((resolve) => {
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${String(CHILD_HEAP_MB)}`, options.script ?? DEFAULT_CHILD_SCRIPT],
      { env: {}, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
    );
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    let timer: NodeJS.Timeout | undefined = undefined;

    const finish = (result: PdfTextResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolve(result);
    };

    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(FAILED);
    }, options.timeoutMs ?? PDF_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_CHILD_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(FAILED);
        return;
      }
      chunks.push(chunk);
    });
    child.on('error', () => {
      finish(FAILED);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        finish(FAILED);
        return;
      }
      finish(parseAnswer(Buffer.concat(chunks).toString('utf8')));
    });
    // The child may exit before it reads its input. The close handler reports that, so the error is not fatal here.
    child.stdin.on('error', () => undefined);
    child.stdin.end(Buffer.from(bytes));
  });
}

function parseAnswer(text: string): PdfTextResult {
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    return FAILED;
  }
  const answer = ChildAnswer.safeParse(json);
  if (!answer.success) {
    return FAILED;
  }
  if (!answer.data.ok) {
    return { ok: false, reason: answer.data.reason };
  }
  return {
    ok: true,
    pages: answer.data.pages,
    extras: { annotations: answer.data.annotations, metadata: answer.data.metadata },
    truncated: answer.data.truncated,
  };
}
