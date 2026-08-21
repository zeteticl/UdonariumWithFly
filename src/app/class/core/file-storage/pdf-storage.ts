import { EventSystem } from '../system';
import { ResettableTimeout } from '../system/util/resettable-timeout';
import { PdfFile, PdfFileContext, PdfState } from './pdf-file';

export type PdfCatalogItem = { readonly identifier: string, readonly state: number };

export class PdfStorage {
  private static _instance: PdfStorage;
  static get instance(): PdfStorage {
    if (!PdfStorage._instance) PdfStorage._instance = new PdfStorage();
    return PdfStorage._instance;
  }

  private lazyTimer: ResettableTimeout;
  private hash: { [identifier: string]: PdfFile } = {};

  get pdfs(): PdfFile[] {
    return Object.keys(this.hash).map(id => this.hash[id]);
  }

  private constructor() {
  }

  async addAsync(file: File, displayName?: string): Promise<PdfFile>
  async addAsync(blob: Blob, displayName?: string): Promise<PdfFile>
  async addAsync(arg: any, displayName?: string): Promise<PdfFile> {
    const pdf = await PdfFile.createAsync(arg, displayName);
    return this._add(pdf);
  }

  add(url: string): PdfFile
  add(pdf: PdfFile): PdfFile
  add(context: PdfFileContext): PdfFile
  add(arg: any): PdfFile {
    let pdf: PdfFile;
    if (typeof arg === 'string') {
      pdf = PdfFile.create(arg);
    } else if (arg instanceof PdfFile) {
      pdf = arg;
    } else {
      if (this.update(arg)) return this.hash[arg.identifier];
      pdf = PdfFile.create(arg);
    }
    return this._add(pdf);
  }

  private _add(pdf: PdfFile): PdfFile {
    if (PdfState.COMPLETE <= pdf.state) this.lazySynchronize(100);
    if (this.update(pdf)) return this.hash[pdf.identifier];
    this.hash[pdf.identifier] = pdf;
    return pdf;
  }

  private update(pdf: PdfFile): boolean
  private update(pdf: PdfFileContext): boolean
  private update(pdf: any): boolean {
    const updatePdf = this.hash[pdf.identifier];
    if (updatePdf) {
      updatePdf.apply(pdf instanceof PdfFile ? pdf.toContext() : pdf);
      return true;
    }
    return false;
  }

  delete(identifier: string): boolean {
    const pdf = this.hash[identifier];
    if (!pdf) return false;
    pdf.destroy();
    delete this.hash[identifier];
    return true;
  }

  get(identifier: string): PdfFile {
    return this.hash[identifier] || null;
  }

  synchronize(peer?: string) {
    if (this.lazyTimer) this.lazyTimer.stop();
    EventSystem.call('SYNCHRONIZE_PDF_LIST', this.getCatalog(), peer);
  }

  lazySynchronize(ms: number, peer?: string) {
    if (this.lazyTimer == null) this.lazyTimer = new ResettableTimeout(() => this.synchronize(peer), ms);
    this.lazyTimer.reset(ms);
  }

  getCatalog(): PdfCatalogItem[] {
    const catalog: PdfCatalogItem[] = [];
    for (const pdf of this.pdfs) {
      if (PdfState.COMPLETE <= pdf.state) {
        catalog.push({ identifier: pdf.identifier, state: pdf.state });
      }
    }
    return catalog;
  }
}
