import type { RoleContext } from '../context/types.js';
import { normaliseText } from '../text/normalise.js';
import { SOURCE_ITEM, type ReviewReply } from '../swarm/schemas.js';

/**
 * Checks each evidence quote of a reviewer against the context item it names. A quote that is not in that item, or that
 * names an item the reviewer was not given, is unverified. Comparison uses the same normalisation as the verifier, so
 * line breaks and spacing do not decide the result, but words and digits do.
 */

export function unverifiedQuotes(reply: ReviewReply, context: RoleContext): string[] {
  const byId = new Map(context.items.map((item) => [item.id, item] as const));
  const problems: string[] = [];
  reply.evidence.forEach((evidence, index) => {
    const itemId = SOURCE_ITEM[evidence.source];
    const item = itemId === undefined ? undefined : byId.get(itemId);
    if (item === undefined) {
      problems.push(`evidence.${String(index)}: source_not_in_context`);
      return;
    }
    if (!normaliseText(item.text).includes(normaliseText(evidence.quote))) {
      problems.push(`evidence.${String(index)}: quote_not_in_source`);
    }
  });
  return problems;
}
