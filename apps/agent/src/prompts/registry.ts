import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The versioned prompt files. Each prompt is read from disk once, and its SHA-256 is computed over the exact bytes
 * sent to the model's system role. The hash is written into every decision-log entry, so a decision can be traced to
 * the exact wording that produced it. A prompt changed in place keeps its file name but gets a new hash, and the
 * version directory is the place to add v2 rather than edit v1 after a run has used it.
 */

export const PROMPT_VERSION = 'v1';

export const PROMPT_IDS = ['extractor', 'procurement', 'fraud', 'reason'] as const;
export type PromptId = (typeof PROMPT_IDS)[number];

export interface PromptFile {
  readonly id: PromptId;
  readonly version: typeof PROMPT_VERSION;
  readonly sha256: string;
  readonly text: string;
}

const PROMPT_DIR = fileURLToPath(new URL('../../prompts/v1/', import.meta.url));

const cache = new Map<PromptId, PromptFile>();

export function loadPrompt(id: PromptId): PromptFile {
  const cached = cache.get(id);
  if (cached !== undefined) {
    return cached;
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a fixed folder plus a name the code or the operator sets, never invoice text
  const text = readFileSync(`${PROMPT_DIR}${id}.md`, 'utf8');
  const prompt: PromptFile = {
    id,
    version: PROMPT_VERSION,
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    text,
  };
  cache.set(id, prompt);
  return prompt;
}

/** The hash map written into the decision log: prompt id to SHA-256 hex, sorted by id. */
export function promptHashes(): Readonly<Record<PromptId, string>> {
  const out: Partial<Record<PromptId, string>> = {};
  for (const id of [...PROMPT_IDS].sort()) {
    // eslint-disable-next-line security/detect-object-injection -- the key comes from a closed table or a checked union, never from input
    out[id] = loadPrompt(id).sha256;
  }
  return out as Readonly<Record<PromptId, string>>;
}

/** A fresh random id for one model call's delimiters. An attacker cannot guess it, so it cannot be closed early. */
export function newDelimiterId(): string {
  return randomBytes(12).toString('hex');
}
