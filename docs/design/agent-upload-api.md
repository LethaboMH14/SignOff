# Agent upload API (for the console, lane E)

Status: **handler built and tested; not yet started by the agent command.** `createUploadServer` in
[`apps/agent/src/intake/upload.ts`](../../apps/agent/src/intake/upload.ts) is the agent-side handler. The `agent run`
command does not start it yet. Whoever wires it (lane E or the operator) passes the inbox folder and a token, and chooses
the port. The default listen address is `127.0.0.1`.

## What it does

The console sends one invoice file. The agent writes it into the inbox under the name the console gives it, and the
normal watcher reads it from there. The file therefore gets exactly the same checks as a file dropped in the folder:
stable-write guard, seen-check, MIME and extension sniffing, size limit, the PDF or OCR reader, the document classifier,
the injection screen, and the rest of the workflow. The upload handler does not parse the file itself.

The handler checks only what belongs to the request: the bearer token, the file name, emptiness, and size. It refuses to
overwrite an existing name.

## Request

```http
POST /v1/invoices HTTP/1.1
Host: 127.0.0.1:<port>
Authorization: Bearer <token>
X-File-Name: INV-TST-0100.pdf
Content-Type: application/octet-stream

<the raw file bytes>
```

| Part | Rule |
|---|---|
| Method | `POST` only. Anything else gets 405. |
| Path | `/v1/invoices` only. Anything else gets 404. |
| `Authorization` | `Bearer <token>`. The token is compared in constant time. It must be at least 32 characters, or the service refuses to start. |
| `X-File-Name` | Letters, digits, `.`, `_` and `-`. It starts with a letter or digit, has no `..`, and is at most 120 characters. No path separators. A name that does not match is refused, not rewritten. |
| Body | The raw file. At most 10 MiB, and not empty. The file's type is not trusted from the name; the intake sniffs the bytes. |

The token is checked before the body is read, so an unauthenticated caller cannot make the service buffer a file.

## Responses

| Status | Body | Meaning |
|---|---|---|
| 202 | `{"accepted":true,"fileName":"…","bytes":n,"sha256":"…"}` | The file is in the inbox. The watcher reads it on a later poll, once its size and modification time have held across two polls. The verdict is not in this response. |
| 400 | `{"accepted":false,"reason":"UNSAFE_FILE_NAME"}` or `EMPTY_FILE` | The request was malformed. Nothing was written. |
| 401 | `{"accepted":false,"reason":"UNAUTHORIZED"}` | The token is missing or wrong. Nothing was read or written. |
| 404 | `{"accepted":false,"reason":"NOT_FOUND"}` | Wrong path. |
| 405 | `{"accepted":false,"reason":"METHOD_NOT_ALLOWED"}` | Not a `POST`. |
| 409 | `{"accepted":false,"reason":"NAME_EXISTS"}` | A file with that name is already in the inbox. The original is untouched. |
| 413 | `{"accepted":false,"reason":"FILE_TOO_LARGE"}` | Over 10 MiB. |
| 500 | `{"accepted":false,"reason":"WRITE_FAILED"}` | The inbox could not be written. |

A 202 means "accepted into the inbox", not "accepted as an invoice". The invoice's outcome is the agent's transition log
state (`QUARANTINED`, `HELD`, `EXTRACTED` and so on) and its reason code. Lane E should show that state, not the 202.

## Reason codes the console may show

Held files carry a reason from the intake. These are the codes the console can receive, with the plain meaning:

| Code | Meaning |
|---|---|
| `UNSUPPORTED_FILE_TYPE` | Not a PDF, PNG or JPEG. |
| `MIME_EXTENSION_MISMATCH` | The bytes are a PDF, PNG or JPEG, but the name says otherwise. |
| `FORMAT_HEIC_NOT_PARSED`, `FORMAT_DOCX_NOT_PARSED`, `FORMAT_XLSX_NOT_PARSED`, `FORMAT_UBL_XML_NOT_PARSED` | Recognised, not parsed by this agent. Send a PDF or a photo instead. |
| `EMPTY_FILE`, `FILE_TOO_LARGE` | Empty, or over the limit. |
| `PDF_UNREADABLE`, `PDF_ENCRYPTED`, `PDF_TOO_MANY_PAGES`, `PDF_EXTRACTION_FAILED`, `PDF_TEXT_TRUNCATED` | The PDF could not be read in full. `PDF_TEXT_TRUNCATED` means the parser cut text at its limit, so the invoice is held rather than read partly. |
| `NO_TEXT_LAYER` | A PDF with no text. Image-only PDF pages are **not** read yet (see the limits below). |
| `OCR_LOW_CONFIDENCE`, `OCR_NO_TEXT`, `OCR_IMAGE_UNREADABLE`, `OCR_IMAGE_TOO_LARGE` | A photographed or scanned page that OCR could not read with confidence. |
| `OCR_LANGUAGE_DATA_MISSING`, `OCR_LANGUAGE_DATA_MISMATCH`, `OCR_FAILED` | The OCR engine is not ready. This is an operator fault, not a fault in the invoice. |
| `CLASS_CREDIT_NOTE`, `CLASS_PRO_FORMA`, `CLASS_STATEMENT`, `CLASS_UNKNOWN` | Not a tax invoice. |
| `CURRENCY_NON_ZAR`, `CURRENCY_NOT_STATED` | Not stated as ZAR. |
| `MULTIPLE_INVOICE_NUMBERS` | More than one invoice number in the file. |
| `SCAN_AMOUNT_DISAGREES`, `SCAN_AMOUNT_NOT_FOUND` | A scanned invoice whose total the second reading does not confirm. |

The screen (injection) codes arrive on the `QUARANTINED` state with `INSTRUCTION_LIKE_TEXT`, `PAYEE_CHANGE_CLAIM`,
`HIDDEN_CHARACTERS` or `MARKUP_IN_TEXT`. The matched text is never recorded.

## Limits, stated plainly

- The handler is not authenticated per user. It trusts whoever holds the token. The token is a shared secret between the
  console and the agent, and it must come from the operator's configuration, never from the repository.
- Listen on `127.0.0.1` unless the operator has a reason to do otherwise.
- Image-only PDF pages (a scan saved as a PDF) are held as `NO_TEXT_LAYER`. Rendering PDF pages to images is not built.
  Upload a PNG or JPEG of the page instead.
- OCR is measured on rendered fixture pages only. Real scanner and phone-photo error rates are not measured.
