import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

type PdfjsModule = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfjsModule> | null = null;
let workerReady = false;

async function ensurePdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist');
  }
  const pdfjs = await pdfjsPromise;
  if (!workerReady) {
    // Bundled via angular.json assets from node_modules/pdfjs-dist/build.
    pdfjs.GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.min.mjs';
    workerReady = true;
  }
  return pdfjs;
}

const docCache = new Map<string, Promise<PDFDocumentProxy>>();

/** One active render per canvas — PDF.js forbids overlapping render() on the same canvas. */
const activeCanvasRender = new WeakMap<HTMLCanvasElement, RenderTask>();
const canvasRenderSerial = new WeakMap<HTMLCanvasElement, number>();

function isRenderCancelled(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = String((err as { name?: string }).name || '');
  const msg = String((err as { message?: string }).message || '');
  return name === 'RenderingCancelledException'
    || name === 'AbortException'
    || /cancel/i.test(msg);
}

async function cancelActiveCanvasRender(canvas: HTMLCanvasElement): Promise<void> {
  const prev = activeCanvasRender.get(canvas);
  if (!prev) return;
  activeCanvasRender.delete(canvas);
  try {
    prev.cancel();
  } catch { /* already finished */ }
  try {
    await prev.promise;
  } catch {
    // Cancelled or interrupted — expected when flipping pages quickly.
  }
}

export async function loadPdfDocument(url: string, cacheKey?: string): Promise<PDFDocumentProxy> {
  const pdfjs = await ensurePdfjs();
  const key = cacheKey || url;
  let pending = docCache.get(key);
  if (!pending) {
    pending = pdfjs.getDocument({ url, withCredentials: false }).promise;
    docCache.set(key, pending);
    pending.catch(() => docCache.delete(key));
  }
  return pending;
}

/**
 * Render one PDF page onto canvas.
 * Returns null when a newer render superseded this call (rapid page flips).
 */
export async function renderPdfPage(
  canvas: HTMLCanvasElement,
  url: string,
  pageNumber: number,
  cacheKey?: string,
  maxWidthPx = 800
): Promise<{ pageCount: number; page: number } | null> {
  const serial = (canvasRenderSerial.get(canvas) || 0) + 1;
  canvasRenderSerial.set(canvas, serial);

  // Must finish/cancel the previous task before touching this canvas again.
  await cancelActiveCanvasRender(canvas);
  if (canvasRenderSerial.get(canvas) !== serial) return null;

  const doc = await loadPdfDocument(url, cacheKey);
  if (canvasRenderSerial.get(canvas) !== serial) return null;

  const pageCount = Math.max(1, doc.numPages | 0);
  // Clamp only — never wrap (e.g. last+1 must stay on last, not become 1).
  let page = Math.floor(Number(pageNumber));
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (page > pageCount) page = pageCount;
  const pdfPage: PDFPageProxy = await doc.getPage(page);
  if (canvasRenderSerial.get(canvas) !== serial) return null;

  const unscaled = pdfPage.getViewport({ scale: 1 });
  // Allow sharp tabletop / retina renders (old cap of 2 made small notes unreadable).
  const scale = Math.min(4, maxWidthPx / Math.max(1, unscaled.width));
  const viewport = pdfPage.getViewport({ scale });
  const context = canvas.getContext('2d');
  if (!context) return { pageCount, page };
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const task = pdfPage.render({ canvasContext: context, viewport });
  activeCanvasRender.set(canvas, task);
  try {
    await task.promise;
  } catch (err) {
    if (isRenderCancelled(err)) return null;
    throw err;
  } finally {
    if (activeCanvasRender.get(canvas) === task) {
      activeCanvasRender.delete(canvas);
    }
  }

  if (canvasRenderSerial.get(canvas) !== serial) return null;
  return { pageCount, page };
}

export function evictPdfDocument(cacheKey: string) {
  docCache.delete(cacheKey);
}
