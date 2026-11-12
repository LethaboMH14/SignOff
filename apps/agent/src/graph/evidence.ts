import type { GraphResult } from './run.js';

/**
 * The evidence graph for one payment decision: what the decision rests on, and what it contradicts. It is written as JSON
 * for the console ("Open evidence"). Nodes and edges are sorted by id, so the same run always produces the same JSON
 * (doctrine 5). Quote text is not kept here: a quote is named by its hash, because the verifier keeps hashes only.
 */

export type EvidenceKind =
  | 'invoice'
  | 'quote'
  | 'po'
  | 'grn'
  | 'supplier'
  | 'policy'
  | 'rule'
  | 'review'
  | 'judge'
  | 'warden'
  | 'ledger';

export interface EvidenceNode {
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly label: string;
  /** A hash that stands for the underlying record, when there is one. */
  readonly sha256: string | null;
}

export interface EvidenceEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: 'supports' | 'contradicts';
}

export interface EvidenceGraph {
  readonly schemaVersion: 1;
  readonly correlationId: string;
  readonly terminal: GraphResult['terminal'];
  readonly finalCode: string;
  readonly nodes: readonly EvidenceNode[];
  readonly edges: readonly EvidenceEdge[];
}

export function buildEvidenceGraph(
  result: GraphResult,
  policy: {
    readonly routePolicy: string;
    readonly judgePolicy: string;
    readonly policyVersion: string;
  },
): EvidenceGraph {
  const nodes = new Map<string, EvidenceNode>();
  const edges: EvidenceEdge[] = [];
  const add = (node: EvidenceNode): void => {
    nodes.set(node.id, node);
  };
  const link = (from: string, to: string, kind: EvidenceEdge['kind']): void => {
    edges.push({ from, to, kind });
  };

  const invoiceId = 'invoice';
  add({ id: invoiceId, kind: 'invoice', label: 'Invoice file', sha256: result.data.fingerprint });

  const verified = result.data.verified;
  if (verified !== null) {
    const fields: readonly [
      string,
      { readonly quoteSha256: string | null; readonly status: string },
    ][] = [
      ['supplierName', verified.supplierName],
      ['invoiceNumber', verified.invoiceNumber],
      ['invoiceDate', verified.invoiceDate],
      ['currency', verified.currency],
      ['total', verified.total],
      ['purchaseOrderNumber', verified.purchaseOrderNumber],
      ['payeeAccountAsPrinted', verified.payeeAccountAsPrinted],
    ];
    for (const [name, field] of fields) {
      if (field.quoteSha256 === null) {
        continue;
      }
      const id = `quote:${name}`;
      add({ id, kind: 'quote', label: `${name} (${field.status})`, sha256: field.quoteSha256 });
      link(id, invoiceId, field.status === 'EXACT' ? 'supports' : 'contradicts');
    }
  }

  if (result.data.match?.ok === true) {
    add({ id: 'po', kind: 'po', label: 'Purchase order matched', sha256: null });
    link('po', invoiceId, 'supports');
    for (const [index, hash] of result.data.match.recordSha256s.entries()) {
      const id = `record:${String(index)}`;
      add({ id, kind: 'supplier', label: `Buyer record ${String(index + 1)}`, sha256: hash });
      link(id, invoiceId, 'supports');
    }
  }
  if (result.data.match !== null && !result.data.match.ok) {
    add({
      id: 'match',
      kind: 'po',
      label: result.data.match.reasons.join('; ') || 'Match failed',
      sha256: null,
    });
    link('match', invoiceId, 'contradicts');
  }

  if (result.data.route !== null) {
    add({
      id: 'rule',
      kind: 'rule',
      label: `${result.data.route.ruleId} -> ${result.data.route.route}`,
      sha256: null,
    });
    link('rule', invoiceId, 'supports');
  }

  for (const outcome of [...result.data.outcomes].sort((a, b) => (a.role < b.role ? -1 : 1))) {
    const id = `review:${outcome.role}`;
    const verdict = outcome.reply === null ? outcome.status : outcome.reply.verdict;
    const reason = outcome.reply === null ? '' : `:${outcome.reply.reasonCode}`;
    add({
      id,
      kind: 'review',
      label: `${outcome.role} ${verdict}${reason}`,
      sha256: outcome.promptSha256,
    });
    link(id, invoiceId, verdict === 'PASS' ? 'supports' : 'contradicts');
  }

  add({
    id: 'policy',
    kind: 'policy',
    label: `${policy.routePolicy} / ${policy.judgePolicy} / ${policy.policyVersion}`,
    sha256: null,
  });
  if (result.decision !== null) {
    add({ id: 'judge', kind: 'judge', label: `judge: ${result.decision.kind}`, sha256: null });
    link('judge', invoiceId, result.decision.kind === 'ACCEPT' ? 'supports' : 'contradicts');
  }
  if (result.data.submitted !== null) {
    add({
      id: 'ledger',
      kind: 'ledger',
      label: 'Ledger transaction',
      sha256: result.data.submitted.ledgerHash,
    });
    link('ledger', invoiceId, 'supports');
  }

  return {
    schemaVersion: 1,
    correlationId: result.correlationId,
    terminal: result.terminal,
    finalCode: result.finalCode,
    nodes: [...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    edges: [...edges].sort((a, b) =>
      a.from + a.to + a.kind < b.from + b.to + b.kind
        ? -1
        : a.from + a.to + a.kind > b.from + b.to + b.kind
          ? 1
          : 0,
    ),
  };
}
