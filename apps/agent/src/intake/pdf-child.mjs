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

// pdf.js writes its warnings to the console. Stdout must carry only the result, so console output is dropped.
console.log = () => undefined;
console.info = () => undefined;
console.warn = () => undefined;
console.debug = () => undefined;

const { getDocument } = await import('pdfjs-dist/build/pdf.mjs');

const MAX_PAGES = 200;
const MAX_PAGE_CHARS = 200_000;

function finish(result) {
  process.stdout.write(JSON.stringify(result), () => {
    process.exit(0);
  });
}

function textOf(items) {
  let text = '';
  for (const item of items) {
    if (typeof item.str !== 'string') {
      continue;
    }
    text += item.str;
    text += item.hasEOL === true ? '\n' : ' ';
  }
  return text.slice(0, MAX_PAGE_CHARS);
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
    const pages = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(textOf(content.items));
    }
    finish({ ok: true, pages });
  }
} catch (error) {
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : '';
  finish({ ok: false, reason: name === 'PasswordException' ? 'ENCRYPTED' : 'UNREADABLE' });
}
