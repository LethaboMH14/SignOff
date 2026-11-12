import { describe, expect, it } from 'vitest';

import { classifyDocument } from '../../src/intake/classify.js';
import { formatHoldOf, imageSizeOf, sniffFormat } from '../../src/intake/sniff.js';

const bytes = (text: string): Uint8Array => Buffer.from(text, 'latin1');

describe('sniffFormat', () => {
  it('recognises each format from its signature, not its name', () => {
    expect(sniffFormat(bytes('%PDF-1.7 rest'))).toBe('PDF');
    expect(sniffFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe(
      'PNG',
    );
    expect(sniffFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe('JPEG');
    expect(sniffFormat(bytes('\0\0\0\u0018ftypheic\0\0'))).toBe('HEIC');
    expect(sniffFormat(bytes('PK\u0003\u0004....word/document.xml'))).toBe('DOCX');
    expect(sniffFormat(bytes('PK\u0003\u0004....xl/workbook.xml'))).toBe('XLSX');
    expect(sniffFormat(bytes('PK\u0003\u0004....readme.txt'))).toBe('ZIP');
    expect(
      sniffFormat(
        bytes(
          '<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>',
        ),
      ),
    ).toBe('UBL_XML');
    expect(sniffFormat(bytes('<?xml version="1.0"?><other/>'))).toBe('XML');
    expect(sniffFormat(bytes('plain words'))).toBe('UNKNOWN');
    expect(sniffFormat(new Uint8Array())).toBe('EMPTY');
  });
});

describe('formatHoldOf', () => {
  it('reads a PDF, PNG or JPEG only under its own extension', () => {
    expect(formatHoldOf('PDF', 'a.PDF')).toBeNull();
    expect(formatHoldOf('JPEG', 'scan.jpeg')).toBeNull();
    expect(formatHoldOf('PNG', 'scan.png')).toBeNull();
    expect(formatHoldOf('PNG', 'scan.pdf')).toBe('MIME_EXTENSION_MISMATCH');
    expect(formatHoldOf('PDF', 'noextension')).toBe('MIME_EXTENSION_MISMATCH');
  });

  it('holds the formats it recognises but does not parse, each with its own reason', () => {
    expect(formatHoldOf('HEIC', 'a.heic')).toBe('FORMAT_HEIC_NOT_PARSED');
    expect(formatHoldOf('DOCX', 'a.docx')).toBe('FORMAT_DOCX_NOT_PARSED');
    expect(formatHoldOf('XLSX', 'a.xlsx')).toBe('FORMAT_XLSX_NOT_PARSED');
    expect(formatHoldOf('UBL_XML', 'a.xml')).toBe('FORMAT_UBL_XML_NOT_PARSED');
    expect(formatHoldOf('ZIP', 'a.zip')).toBe('UNSUPPORTED_FILE_TYPE');
    expect(formatHoldOf('EMPTY', 'a.pdf')).toBe('EMPTY_FILE');
  });
});

describe('imageSizeOf', () => {
  it('reads the size from a PNG header', () => {
    const header = Buffer.alloc(24);
    header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    header.writeUInt32BE(1240, 16);
    header.writeUInt32BE(1754, 20);
    expect(imageSizeOf('PNG', header)).toEqual({ width: 1240, height: 1754 });
  });

  it('reads the size from the first start-of-frame of a JPEG, skipping other segments', () => {
    // SOI, an APP0 segment of 4 bytes of payload, then SOF0 with height 300 and width 200.
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08,
      0x01, 0x2c, 0x00, 0xc8, 0x03, 0x01,
    ]);
    expect(imageSizeOf('JPEG', jpeg)).toEqual({ width: 200, height: 300 });
  });

  it('returns null when the header is too short to give a size', () => {
    expect(imageSizeOf('PNG', new Uint8Array(10))).toBeNull();
    expect(imageSizeOf('JPEG', Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe('classifyDocument', () => {
  const zar = 'Currency: ZAR';
  const number = 'Invoice number: INV-TST-0100';

  it('accepts a ZAR invoice with one invoice number and no other holds', () => {
    expect(classifyDocument([`${number}\n${zar}\nTotal due: 1500.00`])).toEqual({
      documentClass: 'TAX_INVOICE',
      holds: [],
    });
  });

  it('holds a credit note, a pro-forma and a statement by their own reasons', () => {
    expect(classifyDocument([`Credit note for ${number}\n${zar}`]).holds).toEqual([
      'CLASS_CREDIT_NOTE',
    ]);
    expect(classifyDocument([`Pro forma invoice\n${number}\n${zar}`]).holds).toEqual([
      'CLASS_PRO_FORMA',
    ]);
    expect(classifyDocument([`Statement of account\n${zar}`]).holds).toEqual(['CLASS_STATEMENT']);
  });

  it('holds a document that says it is no invoice at all', () => {
    expect(classifyDocument(['Delivery note 77\nCurrency: ZAR']).holds).toEqual(['CLASS_UNKNOWN']);
  });

  it('holds a document in another currency, by code or by symbol', () => {
    expect(classifyDocument([`${number}\nCurrency: USD`]).holds).toEqual(['CURRENCY_NON_ZAR']);
    expect(classifyDocument([`${number}\nTotal: €150.00\n${zar}`]).holds).toEqual([
      'CURRENCY_NON_ZAR',
    ]);
  });

  it('holds an invoice that never states its currency', () => {
    expect(classifyDocument([number]).holds).toEqual(['CURRENCY_NOT_STATED']);
  });

  it('holds a file that carries more than one invoice number', () => {
    const holds = classifyDocument([`${number}\nInvoice number: INV-TST-0200\n${zar}`]).holds;
    expect(holds).toEqual(['MULTIPLE_INVOICE_NUMBERS']);
  });

  it('counts the same invoice number printed twice as one', () => {
    expect(classifyDocument([`${number}\n${number}\n${zar}`]).holds).toEqual([]);
  });
});
