import { CanvasUtil } from './core/file-storage/canvas-util';

/** Longest edge of stored preview JPEG (finer than list thumb for hover zoom). */
const PREVIEW_MAX_EDGE = 480;
const PREVIEW_JPEG_QUALITY = 0.82;
/** Capture scale cap before shrink — more pixels → sharper downsample. */
const CAPTURE_MAX_EDGE = 1600;

/**
 * Capture the map layer (#app-game-table) as a JPEG data URL.
 * Paints CSS background, token &lt;img&gt;s, and HTML text-notes (sticky / paper).
 * Panels / chat live outside this node, so they are not included.
 */
export async function captureMapPreviewDataUrl(): Promise<string> {
  const el = document.getElementById('app-game-table');
  if (!el) return '';

  try {
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    const scale = Math.min(1, CAPTURE_MAX_EDGE / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#2a241c';
    ctx.fillRect(0, 0, cw, ch);

    let paintedBg = false;
    for (const bgUrl of parseCssUrls(getComputedStyle(el).backgroundImage)) {
      try {
        const bg = await loadImage(bgUrl);
        drawCover(ctx, bg, cw, ch);
        paintedBg = true;
        break;
      } catch {
        /* try next layer / ignore tainted */
      }
    }
    // Fallback: largest ready <img> as cover when CSS bg failed (common for blob URLs mid-reload).
    if (!paintedBg) {
      const cover = pickLargestReadyImage(el);
      if (cover) {
        try {
          drawCover(ctx, cover, cw, ch);
        } catch { /* ignore */ }
      }
    }

    const rootRect = el.getBoundingClientRect();

    // Tokens / terrain images — skip note-internal imgs (drawn with the note paper).
    const imgs = el.querySelectorAll('img');
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i] as HTMLImageElement;
      if (img.closest('text-note')) continue;
      drawImgInRoot(ctx, img, rootRect, scale);
    }

    // Sticky / paper notes are HTML (bg + text), not <img>.
    await paintTextNotes(ctx, el, rootRect, scale);

    const raw = canvas.toDataURL('image/jpeg', 0.92);
    return await shrinkDataUrl(raw, PREVIEW_MAX_EDGE, PREVIEW_JPEG_QUALITY);
  } catch (e) {
    console.warn('[ScenePreset] map preview capture failed', e);
    return '';
  }
}

async function paintTextNotes(
  ctx: CanvasRenderingContext2D,
  root: HTMLElement,
  rootRect: DOMRect,
  scale: number,
) {
  const faces = root.querySelectorAll('text-note .upright-transform.is-front');
  for (let i = 0; i < faces.length; i++) {
    const face = faces[i] as HTMLElement;
    const r = face.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right < rootRect.left || r.left > rootRect.right) continue;
    if (r.bottom < rootRect.top || r.top > rootRect.bottom) continue;

    const x = (r.left - rootRect.left) * scale;
    const y = (r.top - rootRect.top) * scale;
    const rw = r.width * scale;
    const rh = r.height * scale;
    const cs = getComputedStyle(face);

    // Screen-space AABB (notes use 3D transforms; this matches the viewport preview).
    ctx.fillStyle = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
      ? cs.backgroundColor
      : '#ffe566';
    ctx.strokeStyle = cs.borderTopColor || '#999';
    ctx.lineWidth = Math.max(1, scale);
    roundRect(ctx, x, y, rw, rh, 2 * scale);
    ctx.fill();
    ctx.stroke();

    for (const bgUrl of parseCssUrls(cs.backgroundImage)) {
      try {
        const bg = await loadImage(bgUrl);
        ctx.save();
        roundRect(ctx, x, y, rw, rh, 2 * scale);
        ctx.clip();
        ctx.drawImage(bg, x, y, rw, rh);
        ctx.restore();
        break;
      } catch { /* ignore */ }
    }

    const titleEl = face.querySelector('.title') as HTMLElement | null;
    let textTop = y + 4 * scale;
    if (titleEl && titleEl.offsetParent !== null) {
      const tr = titleEl.getBoundingClientRect();
      const th = Math.max(14 * scale, tr.height * scale);
      const tcs = getComputedStyle(titleEl);
      ctx.fillStyle = tcs.backgroundColor || '#1e1e1e';
      ctx.fillRect(x, y, rw, th);
      ctx.fillStyle = tcs.color || '#f2f2f2';
      ctx.font = `600 ${Math.max(10, 12 * scale)}px sans-serif`;
      ctx.textBaseline = 'middle';
      const title = (titleEl.innerText || '').trim();
      if (title) {
        ctx.fillText(truncateToWidth(ctx, title, rw - 10 * scale), x + 5 * scale, y + th / 2);
      }
      textTop = y + th + 2 * scale;
    }

    const textEl = face.querySelector('.note-text') as HTMLElement | null;
    const body = (textEl?.innerText || (face.querySelector('textarea') as HTMLTextAreaElement | null)?.value || '').trim();
    if (body) {
      const tcs = textEl ? getComputedStyle(textEl) : cs;
      const fontPx = Math.max(9, parseFloat(tcs.fontSize) * scale || 11 * scale);
      ctx.fillStyle = tcs.color || '#444';
      ctx.font = `${fontPx}px Cambria, Georgia, serif`;
      ctx.textBaseline = 'top';
      const pad = 3 * scale;
      wrapFillText(ctx, body, x + pad, textTop, rw - pad * 2, y + rh - pad, fontPx * 1.25);
    }

    const noteImgs = face.querySelectorAll('img');
    for (let j = 0; j < noteImgs.length; j++) {
      drawImgInRoot(ctx, noteImgs[j] as HTMLImageElement, rootRect, scale, false);
    }
  }
}

function drawImgInRoot(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rootRect: DOMRect,
  scale: number,
  skipIfTiny = true,
) {
  if (!img.complete || img.naturalWidth < 1 || img.naturalHeight < 1) return;
  const r = img.getBoundingClientRect();
  if (skipIfTiny && (r.width < 2 || r.height < 2)) return;
  if (r.right < rootRect.left || r.left > rootRect.right) return;
  if (r.bottom < rootRect.top || r.top > rootRect.bottom) return;
  const x = (r.left - rootRect.left) * scale;
  const y = (r.top - rootRect.top) * scale;
  try {
    ctx.drawImage(img, x, y, r.width * scale, r.height * scale);
  } catch {
    /* tainted canvas — skip */
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, radius: number,
) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

function wrapFillText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  maxY: number,
  lineH: number,
) {
  const paragraphs = text.replace(/\r/g, '').split('\n');
  let cy = y;
  for (const para of paragraphs) {
    if (cy + lineH > maxY) break;
    const words = para.length ? para.split(/(\s+)/) : [''];
    let line = '';
    for (const word of words) {
      const trial = line + word;
      if (line && ctx.measureText(trial).width > maxW) {
        ctx.fillText(line, x, cy);
        cy += lineH;
        if (cy + lineH > maxY) return;
        line = word.trimStart();
      } else {
        line = trial;
      }
    }
    ctx.fillText(line, x, cy);
    cy += lineH;
  }
}

function parseCssUrls(value: string): string[] {
  if (!value || value === 'none') return [];
  const out: string[] = [];
  const re = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function pickLargestReadyImage(root: HTMLElement): HTMLImageElement | null {
  let best: HTMLImageElement | null = null;
  let bestArea = 0;
  const imgs = root.querySelectorAll('img');
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i] as HTMLImageElement;
    if (img.closest('text-note')) continue;
    if (!img.complete || img.naturalWidth < 8 || img.naturalHeight < 8) continue;
    const area = img.naturalWidth * img.naturalHeight;
    if (area > bestArea) {
      best = img;
      bestArea = area;
    }
  }
  return best;
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cw: number, ch: number) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (iw < 1 || ih < 1) return;
  const cover = Math.max(cw / iw, ch / ih);
  const dw = iw * cover;
  const dh = ih * cover;
  ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
}

async function shrinkDataUrl(dataUrl: string, maxEdge: number, quality: number): Promise<string> {
  if (!dataUrl) return '';
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (w < 1 || h < 1) return '';

  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0);

  if (tw !== w || th !== h) {
    CanvasUtil.resize(canvas, tw, th, true);
  }

  return canvas.toDataURL('image/jpeg', quality);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('preview image load failed'));
    img.src = src;
  });
}
