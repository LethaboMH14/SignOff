/**
 * The one text normalisation used everywhere the agent compares text: the document it sends to a model, the quotes it
 * checks, and the values it compares. Composed Unicode, and any run of white space becomes one space. Nothing else
 * changes, so a quote is found only when it really appears in the document.
 */
export function normaliseText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * The same normalisation, one line at a time, so line breaks survive. A model reads an invoice line by line, so the
 * text it is sent keeps its lines. Quotes are still checked with normaliseText, so a quote is found on any line.
 */
export function normaliseKeepingLines(text: string): string {
  return text
    .normalize('NFC')
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}
