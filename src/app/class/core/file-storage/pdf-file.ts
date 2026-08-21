import { FileReaderUtil } from './file-reader-util';

export enum PdfState {
  NULL = 0,
  COMPLETE = 2,
  URL = 1000,
}

export interface PdfFileContext {
  identifier: string;
  name: string;
  type: string;
  blob: Blob;
  url: string;
}

export class PdfFile {
  private context: PdfFileContext = {
    identifier: '',
    name: '',
    blob: null,
    type: '',
    url: ''
  };

  get identifier(): string { return this.context.identifier; }
  get name(): string { return this.context.name; }
  get blob(): Blob { return this.context.blob; }
  get url(): string { return this.context.url; }
  get state(): PdfState {
    if (!this.url && !this.blob) return PdfState.NULL;
    if (this.url && !this.blob) return PdfState.URL;
    return PdfState.COMPLETE;
  }

  private constructor() { }

  static createEmpty(identifier: string): PdfFile {
    const pdf = new PdfFile();
    pdf.context.identifier = identifier;
    return pdf;
  }

  static create(url: string): PdfFile
  static create(context: PdfFileContext): PdfFile
  static create(arg: any): PdfFile {
    if (typeof arg === 'string') {
      const pdf = new PdfFile();
      pdf.context.identifier = arg;
      pdf.context.name = arg;
      pdf.context.url = arg;
      return pdf;
    }
    const pdf = new PdfFile();
    pdf.apply(arg);
    return pdf;
  }

  static async createAsync(file: File, displayName?: string): Promise<PdfFile>
  static async createAsync(blob: Blob, displayName?: string): Promise<PdfFile>
  static async createAsync(arg: any, displayName?: string): Promise<PdfFile> {
    if (arg instanceof File) {
      return PdfFile._createAsync(arg, displayName != null ? displayName : arg.name);
    }
    if (arg instanceof Blob) {
      return PdfFile._createAsync(arg, displayName);
    }
  }

  private static async _createAsync(blob: Blob, name?: string): Promise<PdfFile> {
    const arrayBuffer = await FileReaderUtil.readAsArrayBufferAsync(blob);
    const pdf = new PdfFile();
    pdf.context.identifier = await FileReaderUtil.calcSHA256Async(arrayBuffer);
    let display = (name || '').trim();
    if (display && /\.[a-z0-9]{1,8}$/i.test(display)) {
      display = display.replace(/\.[^.]+$/, '') || display;
    }
    pdf.context.name = display;
    pdf.context.blob = new Blob([arrayBuffer], { type: blob.type || 'application/pdf' });
    pdf.context.type = pdf.context.blob.type;
    pdf.context.url = window.URL.createObjectURL(pdf.context.blob);
    if (!pdf.context.name) pdf.context.name = pdf.context.identifier;
    return pdf;
  }

  destroy() {
    if (this.state !== PdfState.URL && this.context.url) {
      window.URL.revokeObjectURL(this.context.url);
    }
  }

  apply(context: PdfFileContext) {
    if (!this.context.identifier && context.identifier) this.context.identifier = context.identifier;
    if (!this.context.name && context.name) this.context.name = context.name;
    if (!this.context.blob && context.blob) this.context.blob = context.blob;
    if (!this.context.type && context.type) this.context.type = context.type;
    if (!this.context.url && context.url) this.context.url = context.url;
    if (this.state !== PdfState.URL && this.context.blob && !this.context.url) {
      this.context.url = window.URL.createObjectURL(this.context.blob);
    }
  }

  toContext(): PdfFileContext {
    return {
      identifier: this.context.identifier,
      name: this.context.name,
      blob: this.context.blob,
      type: this.context.type,
      url: this.context.url
    };
  }
}
