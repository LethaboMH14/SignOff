/**
 * The injection screen. An invoice is data, and a document can still carry text written to steer a model. This screen
 * finds that text before any model reads the document, and a flagged document is held without a model call.
 *
 * The screen is a fixed set of rules. It catches the patterns it names, and nothing more. Its measured coverage is
 * reported only on the labelled fixtures (see docs/AGENT-RELIABILITY.md), and it is not a claim about adaptive attackers.
 */

export type ScreenCode =
  'INSTRUCTION_LIKE_TEXT' | 'HIDDEN_CHARACTERS' | 'MARKUP_IN_TEXT' | 'PAYEE_CHANGE_CLAIM';

export interface ScreenFinding {
  readonly code: ScreenCode;
  /** The 1-based page where the text was found. The matched text itself is never recorded. */
  readonly page: number;
}

export interface ScreenResult {
  readonly flagged: boolean;
  readonly findings: readonly ScreenFinding[];
  /** The distinct codes that fired, in a fixed order, for the transition record. */
  readonly codes: readonly ScreenCode[];
}

/** Characters a reader does not see: zero-width and bidirectional controls, tag characters and other control codes. */
function isHiddenCode(code: number): boolean {
  return (
    code <= 0x08 ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0e && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x180e ||
    (code >= 0x200b && code <= 0x200d) ||
    code === 0x2060 ||
    code === 0xfeff ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    (code >= 0xe0000 && code <= 0xe007f)
  );
}

function hasHiddenCharacter(text: string): boolean {
  for (const character of text) {
    if (isHiddenCode(character.codePointAt(0) ?? -1)) {
      return true;
    }
  }
  return false;
}

interface Rule {
  readonly code: Exclude<ScreenCode, 'HIDDEN_CHARACTERS'>;
  readonly pattern: RegExp;
}

/** Matched against the page after compatibility normalisation, so full-width letters do not hide a phrase. */
const RULES: readonly Rule[] = [
  {
    code: 'INSTRUCTION_LIKE_TEXT',
    pattern:
      /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,60}\b(?:previous|prior|above|earlier|all|any|your|these|the|system|safety|rules?|instructions?|checks?|controls?|policy|policies)\b/i,
  },
  {
    code: 'INSTRUCTION_LIKE_TEXT',
    pattern: /\b(?:system|developer|hidden|secret)\s+(?:prompt|message|instructions?|note)s?\b/i,
  },
  { code: 'INSTRUCTION_LIKE_TEXT', pattern: /\bnew\s+instructions?\b/i },
  {
    code: 'INSTRUCTION_LIKE_TEXT',
    pattern: /\bwithout\s+(?:further|any|additional)\s+(?:review|checks?|verification|approval)\b/i,
  },
  {
    code: 'INSTRUCTION_LIKE_TEXT',
    pattern:
      /\b(?:approve|authori[sz]e|release)\b[^.\n]{0,20}\b(?:this|the)\s+(?:invoice|payment|bill)\b[^.\n]{0,20}\b(?:immediately|now|today|urgently|without)\b/i,
  },
  { code: 'INSTRUCTION_LIKE_TEXT', pattern: /\byou\s+are\s+now\b/i },
  { code: 'INSTRUCTION_LIKE_TEXT', pattern: /\bas\s+an?\s+ai\s+(?:model|assistant|agent)\b/i },
  {
    code: 'INSTRUCTION_LIKE_TEXT',
    pattern:
      /\b(?:approve|mark|flag|treat|record)\b[^.\n]{0,30}\b(?:this|the)\s+(?:invoice|payment|bill)\b[^.\n]{0,40}\b(?:approved|paid|verified|cleared)\b/i,
  },
  {
    code: 'INSTRUCTION_LIKE_TEXT',
    pattern: /\bdo\s+not\s+(?:verify|check|flag|hold|question|review)\b/i,
  },
  {
    code: 'INSTRUCTION_LIKE_TEXT',
    pattern: /<\|?\s*(?:im_start|im_end|system|assistant|user)\s*\|?>|\[\/?(?:inst|sys)\]/i,
  },
  {
    code: 'PAYEE_CHANGE_CLAIM',
    pattern:
      /\b(?:new|updated|changed|revised|alternative|different)\s+(?:bank|banking|account|payee|beneficiary|remittance)\s+(?:details|account|information|number|instructions)\b/i,
  },
  {
    code: 'PAYEE_CHANGE_CLAIM',
    pattern:
      /\b(?:pay|remit|transfer|send)\b[^.\n]{0,40}\b(?:to|into)\s+(?:new|this|the\s+new|the\s+following|updated)\s+(?:account|bank|details)\b/i,
  },
  {
    code: 'MARKUP_IN_TEXT',
    pattern:
      /<\s*\/?\s*(?:script|iframe|object|embed|svg|img)\b|javascript\s*:|data\s*:\s*text\/html/i,
  },
];

const CODE_ORDER: readonly ScreenCode[] = [
  'INSTRUCTION_LIKE_TEXT',
  'PAYEE_CHANGE_CLAIM',
  'HIDDEN_CHARACTERS',
  'MARKUP_IN_TEXT',
];

/** Screens every page. A page is flagged by any rule; the result says where and why, never what the text said. */
export function screenPages(pages: readonly string[]): ScreenResult {
  const findings: ScreenFinding[] = [];
  pages.forEach((raw, index) => {
    const page = index + 1;
    if (hasHiddenCharacter(raw)) {
      findings.push({ code: 'HIDDEN_CHARACTERS', page });
    }
    const readable = raw.normalize('NFKC');
    for (const rule of RULES) {
      if (rule.pattern.test(readable)) {
        findings.push({ code: rule.code, page });
      }
    }
  });
  const codes = CODE_ORDER.filter((code) => findings.some((finding) => finding.code === code));
  return { flagged: findings.length > 0, findings, codes };
}
