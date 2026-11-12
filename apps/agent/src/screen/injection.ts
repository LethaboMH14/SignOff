/**
 * The injection screen. An invoice is data, and a document can still carry text written to steer a model. This screen
 * finds that text before any model reads the document, and a flagged document is held without a model call.
 *
 * The screen is a fixed set of rules. It catches the patterns it names, and nothing more. Its measured coverage is
 * reported only on the labelled fixtures (see docs/AGENT-RELIABILITY.md), and it is not a claim about adaptive attackers.
 */

export type ScreenCode =
  'INSTRUCTION_LIKE_TEXT' | 'HIDDEN_CHARACTERS' | 'MARKUP_IN_TEXT' | 'PAYEE_CHANGE_CLAIM';

/** Where a piece of text came from. Every source is screened, because a model reads all of them. */
export type ScreenSource = 'page' | 'ocr' | 'annotation' | 'metadata';

export interface ScreenFinding {
  readonly code: ScreenCode;
  /** The 1-based page where the text was found; 0 for document information, which is not on a page. */
  readonly page: number;
  readonly source: ScreenSource;
}

export interface ScreenResult {
  readonly flagged: boolean;
  readonly findings: readonly ScreenFinding[];
  /** The distinct codes that fired, in a fixed order, for the transition record. */
  readonly codes: readonly ScreenCode[];
}

/** The text of one document, from every source the intake read. */
export interface ScreenInput {
  readonly pages: readonly string[];
  /** Whether the pages came from a text layer or from OCR. */
  readonly method: 'text-layer' | 'ocr';
  readonly annotations: readonly { readonly page: number; readonly text: string }[];
  readonly metadata: readonly string[];
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
  // Afrikaans. South African suppliers print invoices in Afrikaans, so the same steering is screened in that language.
  // Each pattern is a plain phrase rule, as the English ones are; coverage is measured on the labelled phrases.
  {
    code: 'INSTRUCTION_LIKE_TEXT',
    pattern:
      /\b(?:ignoreer|negeer|verontagsaam|vergeet)\b[^.\n]{0,60}\b(?:vorige|alle|enige|jou|hierdie|reëls|instruksies|kontroles|beleid)\b/i,
  },
  {
    code: 'INSTRUCTION_LIKE_TEXT',
    pattern: /\bmoenie\s+(?:verifieer|nagaan|kontroleer|vlag|hou)\b/i,
  },
  {
    code: 'INSTRUCTION_LIKE_TEXT',
    pattern: /\bsonder\s+(?:verdere|enige)\s+(?:kontrole|goedkeuring|verifikasie|hersiening)\b/i,
  },
  {
    code: 'INSTRUCTION_LIKE_TEXT',
    pattern:
      /\b(?:keur|aanvaar|goedkeur)\b[^.\n]{0,30}\b(?:hierdie|die)\s+(?:faktuur|betaling)\b[^.\n]{0,30}\b(?:onmiddellik|nou|sonder)\b/i,
  },
  {
    code: 'PAYEE_CHANGE_CLAIM',
    pattern:
      /\bnuwe\s+(?:bankbesonderhede|rekeningbesonderhede|rekeningnommer|betaalbesonderhede)\b/i,
  },
  // French. The same rules for French-language invoices and for steering written in French.
  {
    code: 'INSTRUCTION_LIKE_TEXT',
    pattern:
      /\b(?:ignorez|ignore|oubliez|négligez)\b[^.\n]{0,60}\b(?:précédent(?:e|es|s)?|toutes?\s+les|toutes|ces|vos|règles?|instructions?|contrôles?|vérifications?)\b/i,
  },
  {
    code: 'INSTRUCTION_LIKE_TEXT',
    pattern: /\bne\s+(?:vérifiez|contrôlez|signalez|bloquez)\s+pas\b/i,
  },
  {
    code: 'INSTRUCTION_LIKE_TEXT',
    pattern: /\bsans\s+(?:vérification|contrôle|approbation)\s+(?:supplémentaire|préalable)s?\b/i,
  },
  {
    code: 'INSTRUCTION_LIKE_TEXT',
    pattern:
      /\b(?:approuvez|validez|autorisez)\b[^.\n]{0,30}\b(?:cette|la)\s+(?:facture|paiement)\b[^.\n]{0,30}\b(?:immédiatement|maintenant|sans)\b/i,
  },
  {
    code: 'PAYEE_CHANGE_CLAIM',
    pattern:
      /\b(?:nouvelles?|nouveaux?|modifiées?)\s+(?:coordonnées\s+bancaires|coordonnées|RIB|IBAN|compte\s+bancaire)\b/i,
  },
];

const CODE_ORDER: readonly ScreenCode[] = [
  'INSTRUCTION_LIKE_TEXT',
  'PAYEE_CHANGE_CLAIM',
  'HIDDEN_CHARACTERS',
  'MARKUP_IN_TEXT',
];

/** Screens one piece of text. A rule that fires is recorded with where the text came from, never with the text itself. */
function screenText(
  raw: string,
  page: number,
  source: ScreenSource,
  findings: ScreenFinding[],
): void {
  // One finding per code and source on a page, however many rules of that code fired.
  const codes = new Set<ScreenCode>();
  if (hasHiddenCharacter(raw)) {
    codes.add('HIDDEN_CHARACTERS');
  }
  const readable = raw.normalize('NFKC');
  for (const rule of RULES) {
    if (rule.pattern.test(readable)) {
      codes.add(rule.code);
    }
  }
  for (const code of CODE_ORDER) {
    if (codes.has(code)) {
      findings.push({ code, page, source });
    }
  }
}

function resultOf(findings: readonly ScreenFinding[]): ScreenResult {
  const codes = CODE_ORDER.filter((code) => findings.some((finding) => finding.code === code));
  return { flagged: findings.length > 0, findings, codes };
}

/**
 * Screens every source of one document: its pages (from a text layer or from OCR), its annotations and its document
 * information. A document is flagged by any rule on any source. A model reads all of these, so none is skipped.
 */
export function screenDocument(input: ScreenInput): ScreenResult {
  const findings: ScreenFinding[] = [];
  const pageSource: ScreenSource = input.method === 'ocr' ? 'ocr' : 'page';
  input.pages.forEach((text, index) => {
    screenText(text, index + 1, pageSource, findings);
  });
  for (const annotation of input.annotations) {
    screenText(annotation.text, annotation.page, 'annotation', findings);
  }
  for (const field of input.metadata) {
    screenText(field, 0, 'metadata', findings);
  }
  return resultOf(findings);
}

/** Screens page text alone. Kept for callers that hold only pages; the workflow uses screenDocument. */
export function screenPages(pages: readonly string[]): ScreenResult {
  return screenDocument({ pages, method: 'text-layer', annotations: [], metadata: [] });
}
