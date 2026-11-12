// Minimal typings for the subset of PDFKit 0.20.2 used by render.ts. PDFKit ships no types for
// this version; declaring only what we call keeps the surface small and checked.
declare module 'pdfkit' {
  interface PDFDocumentOptions {
    size?: string;
    margin?: number;
    autoFirstPage?: boolean;
    info?: Record<string, string | Date>;
  }

  class PDFDocument {
    constructor(options?: PDFDocumentOptions);
    on(event: 'data', listener: (chunk: Buffer) => void): this;
    on(event: 'end' | 'finish', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    save(): this;
    restore(): this;
    rect(x: number, y: number, w: number, h: number): this;
    fill(color: string): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    lineWidth(width: number): this;
    strokeColor(color: string): this;
    stroke(): this;
    font(name: string): this;
    fontSize(size: number): this;
    fillColor(color: string): this;
    widthOfString(text: string): number;
    text(
      text: string,
      x: number,
      y: number,
      options?: { lineBreak?: boolean; width?: number },
    ): this;
    image(
      source: Buffer,
      x: number,
      y: number,
      options?: { width?: number; height?: number },
    ): this;
    end(): void;
  }

  export default PDFDocument;
}
