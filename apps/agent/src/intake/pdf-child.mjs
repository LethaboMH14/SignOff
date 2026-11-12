// Text extraction for one PDF, run in its own process. The parent sends the PDF bytes on stdin and reads one JSON
// object from stdout. This process holds no secrets, reads no files and contains no network code. A malformed or
// hostile PDF can crash or stall this child only, and the parent enforces the time and output limits.

// The pdf.js build calls Uint8Array.prototype.toHex, which Node 24 does not provide. It is added here, in this child
// process only, and only when it is missing.
if (typeof Uint8Array.prototype.toHex !== 'function') {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    value() {
      return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString('hex');
    },
    configurable: true,
    writable: true,
  });
}

// The pdf.js build also calls Map.prototype.getOrInsertComputed (the newer upsert method), which Node 24 does not
// provide. The shim keeps the same meaning: the value is computed once, when the key is missing. It is added here only.
if (typeof Map.prototype.getOrInsertComputed !== 'function') {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    value(key, compute) {
      if (!this.has(key)) {
        this.set(key, compute(key));
      }
      return this.get(key);
    },
    configurable: true,
    writable: true,
  });
}

// pdf.js writes its warnings to the console. Stdout must carry only the result, so console output is dropped.
console.log = () => undefined;
console.info = () => undefined;
console.warn = () => undefined;
console.debug = () => undefined;

const { getDocument } = await import('pdfjs-dist/build/pdf.mjs');

const MAX_PAGES = 200;
const MAX_PAGE_CHARS = 200_000;
const MAX_ANNOTATION_CHARS = 200_000;
const MAX_ANNOTATIONS = 500;
const MAX_METADATA_FIELDS = 20;

function finish(result) {
  process.stdout.write(JSON.stringify(result), () => {
    process.exit(0);
  });
}

/**
 * The text of one page. A page longer than the limit is cut, and the cut is reported to the parent as truncated, so
 * the intake can hold the document. A cut is never silent.
 */
function textOf(items, state) {
  let text = '';
  for (const item of items) {
    if (typeof item.str !== 'string') {
      continue;
    }
    text += item.str;
    text += item.hasEOL === true ? '\n' : ' ';
  }
  if (text.length > MAX_PAGE_CHARS) {
    state.truncated = true;
  }
  return text.slice(0, MAX_PAGE_CHARS);
}

/**
 * Text a reader is not shown but a model would read: the note's contents, its author or title, alternative text and
 * form field values. pdf.js keeps contents and title as { str } objects, so both shapes are read.
 */
function annotationTexts(annotations, pageNumber, state) {
  const out = [];
  for (const annotation of annotations) {
    const values = [
      annotation.contentsObj?.str,
      annotation.titleObj?.str,
      annotation.alternativeText,
      annotation.fieldValue,
    ];
    for (const value of values) {
      const text = typeof value === 'string' ? value : '';
      if (text.length === 0) {
        continue;
      }
      if (state.annotationCount >= MAX_ANNOTATIONS) {
        state.truncated = true;
        return out;
      }
      state.annotationCount += 1;
      out.push({ page: pageNumber, text: text.slice(0, MAX_ANNOTATION_CHARS) });
      if (text.length > MAX_ANNOTATION_CHARS) {
        state.truncated = true;
      }
    }
  }
  return out;
}

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const data = new Uint8Array(Buffer.concat(chunks));

try {
  const document = await getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  if (document.numPages > MAX_PAGES) {
    finish({ ok: false, reason: 'TOO_MANY_PAGES' });
  } else {
    const state = { truncated: false, annotationCount: 0 };
    const pages = [];
    const annotations = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(textOf(content.items, state));
      const pageAnnotations = await page.getAnnotations();
      annotations.push(...annotationTexts(pageAnnotations, number, state));
    }
    // Document information fields (title, subject, keywords, author, creator) are model input too, so they are screened.
    const metadata = [];
    const meta = await document.getMetadata();
    const info = meta?.info ?? {};
    const fields = [info.Title, info.Subject, info.Keywords, info.Author, info.Creator];
    for (const value of fields) {
      if (metadata.length >= MAX_METADATA_FIELDS) {
        break;
      }
      if (typeof value === 'string' && value.length > 0) {
        metadata.push(value.slice(0, MAX_PAGE_CHARS));
      }
    }
    finish({ ok: true, pages, annotations, metadata, truncated: state.truncated });
  }
} catch (error) {
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : '';
  finish({ ok: false, reason: name === 'PasswordException' ? 'ENCRYPTED' : 'UNREADABLE' });
}
