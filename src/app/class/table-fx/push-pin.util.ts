/** Shared push-pin helpers for clue-board tokens / notes. */

export type TokenFrameStyle = 'none' | 'polaroid' | 'photo' | 'card';
export type PaperStyle = 'none' | 'a4' | 'sticky';

export const TOKEN_FRAME_STYLES: TokenFrameStyle[] = ['none', 'polaroid', 'photo', 'card'];
export const PAPER_STYLES: PaperStyle[] = ['none', 'a4', 'sticky'];

/** Deterministic angle in [-25, 25] from an identifier string. */
export function pinAngleFromId(id: string): number {
  let h = 0;
  const s = id || 'pin';
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 51) - 25);
}

export function randomPinAngle(): number {
  return Math.round((Math.random() * 50 - 25) * 10) / 10;
}

/** Default CSS box for `.push-pin` (must stay in sync with clue-board.css). */
/**
 * tipX/tipY = yarn join under pin head (`.push-pin-tip` at 50% / 50%).
 * Pin CSS rotates around needle plant (50% / 88%) — see pinTipLocal.
 * Default left/top match clue-board `.push-pin` (-4, -20).
 */
export const PIN_BOX = { left: -4, top: -20, width: 30, height: 38, tipX: 0.5, tipY: 0.5 };
/** Must match `.push-pin { transform-origin }` in clue-board.css */
const PIN_ROTATE_ORIGIN = { x: 0.5, y: 0.88 };

/**
 * Random pin offset along the host top edge (corkboard look).
 * `hostWidthPx` = image-box / paper width in CSS pixels.
 */
export function randomPinOffset(hostWidthPx: number): { left: number; top: number } {
  const w = Math.max(PIN_BOX.width, hostWidthPx || 50);
  const minLeft = PIN_BOX.left;
  // Keep most of the pin head over the host (tip near the top edge).
  const maxLeft = Math.max(minLeft, Math.round(w - PIN_BOX.width * 0.55));
  const left = Math.round(minLeft + Math.random() * (maxLeft - minLeft));
  // Slight vertical jitter on the outer frame / top edge (2px higher than before).
  const top = Math.round(-28 + Math.random() * 8); // -28 .. -16
  return { left, top };
}

/** Oblique pin styles used in-game (random pick). */
export const PUSH_PIN_ACTIVE_STYLES = [2, 3, 6, 7] as const;
export type PushPinActiveStyleId = typeof PUSH_PIN_ACTIVE_STYLES[number];

const PIN_ANGLED_DIR = './assets/images/clue-board/pins/angled/';

export function pushPinStyleUrl(styleId: number): string {
  const id = isActivePushPinStyle(styleId) ? styleId : 3;
  return `${PIN_ANGLED_DIR}style-${id}.png`;
}

export function isActivePushPinStyle(style: number | null | undefined): style is PushPinActiveStyleId {
  return !!style && (PUSH_PIN_ACTIVE_STYLES as readonly number[]).includes(style);
}

/** Random style from the active pool {2, 3, 6, 7}. */
export function randomPushPinStyle(): PushPinActiveStyleId {
  const pool = PUSH_PIN_ACTIVE_STYLES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Deterministic pool pick (for legacy style=0 without re-rolling every frame). */
export function pushPinStyleFromId(id: string): PushPinActiveStyleId {
  let h = 0;
  const s = id || 'pin';
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  const pool = PUSH_PIN_ACTIVE_STYLES;
  return pool[Math.abs(h) % pool.length];
}

export function normalizePushPinStyle(
  style: number | null | undefined,
  hostId?: string,
): PushPinActiveStyleId {
  if (isActivePushPinStyle(style)) return style;
  return pushPinStyleFromId(hostId || '');
}

/**
 * Oblique pin asset. Fine tilt still applied via CSS rotate(pushPinAngle).
 * `color` is ignored (kept for call-site compat); art is chosen by styleId.
 */
export function pushPinAssetUrl(
  _color: string,
  _angleDeg?: number,
  styleId?: number,
  hostId?: string,
): string {
  return pushPinStyleUrl(normalizePushPinStyle(styleId, hostId));
}

/** A4 portrait aspect (width / height in grid units → height = width * √2). */
export function a4HeightForWidth(width: number): number {
  return Math.round(width * Math.SQRT2 * 100) / 100;
}

export interface PinHost {
  pushPin: boolean;
  pushPinAngle: number;
  pushPinStyle?: number;
  pushPinLeft?: number;
  pushPinTop?: number;
  /** 2D token frame id — chrome margin shifts the pin's CSS containing block. */
  tokenFrame?: string;
  location: { x: number; y: number };
  rotate?: number;
}

/**
 * Polaroid/photo/card use content-box + negative margin so the print stays on the
 * footprint while padding grows outward. Absolute `.push-pin` is positioned against
 * the padding edge (= footprint + this offset).
 */
export function framePinOriginOffset(tokenFrame?: string): { x: number; y: number } {
  switch (tokenFrame) {
    case 'polaroid': return { x: -7, y: -7 }; // pad 7 + border 1, margin -8
    case 'photo': return { x: -8, y: -8 };    // pad 8 + border 1, margin -9
    case 'card': return { x: -7, y: -7 };     // pad 7 + border 2, margin -9
    default: return { x: 0, y: 0 };
  }
}

/** Tip of the CSS pin relative to the host image-box / paper content top-left. */
function pinTipLocal(host?: PinHost): { x: number; y: number } {
  const left = (host && typeof host.pushPinLeft === 'number') ? host.pushPinLeft : PIN_BOX.left;
  const top = (host && typeof host.pushPinTop === 'number') ? host.pushPinTop : PIN_BOX.top;
  let x = left + PIN_BOX.width * PIN_BOX.tipX;
  let y = top + PIN_BOX.height * PIN_BOX.tipY;
  const frame = framePinOriginOffset(host?.tokenFrame);
  x += frame.x;
  y += frame.y;
  // Match CSS: transform-origin 50% 88%, then rotate(pushPinAngle).
  const angle = host?.pushPinAngle || 0;
  if (angle) {
    const ox = frame.x + left + PIN_BOX.width * PIN_ROTATE_ORIGIN.x;
    const oy = frame.y + top + PIN_BOX.height * PIN_ROTATE_ORIGIN.y;
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = x - ox;
    const dy = y - oy;
    x = ox + dx * cos - dy * sin;
    y = oy + dx * sin + dy * cos;
  }
  return { x, y };
}

/**
 * Token-style host: location is the top-left of the footprint.
 * Includes frame chrome offset + pin tilt (matches on-screen thumbtack).
 */
export function pinAnchorPx(
  host: PinHost,
  widthPx: number,
  heightPx: number,
): { x: number; y: number } {
  const tip = pinTipLocal(host);
  return rotateAround(
    host.location.x + widthPx / 2,
    host.location.y + heightPx / 2,
    host.location.x + tip.x,
    host.location.y + tip.y,
    host.rotate || 0,
  );
}

export interface TokenCenterHost {
  location: { x: number; y: number };
  posZ?: number;
  altitude?: number;
  height?: number;
  size?: number;
  /** Degrees; used to shift the yarn anchor slightly behind the footprint. */
  rotate?: number;
}

/**
 * Standing token art height in px.
 * When `height` > 0 matches game-character `characterImageHeight`; otherwise footprint size.
 */
export function tokenVisualHeightPx(
  host: { height?: number; size?: number },
  gridSize = 50,
): number {
  const h = Number(host.height);
  if (Number.isFinite(h) && h > 0) return h * gridSize;
  const size = Number(host.size);
  const s = Number.isFinite(size) && size > 0 ? size : 1;
  return s * gridSize;
}

/**
 * 3D yarn anchor: slightly behind footprint center, Z near token-height bottom
 * with a small lift so the rope clears the floor.
 */
export function tokenCenterAnchorPx(
  host: TokenCenterHost,
  footprintPx: number,
  visualHeightPx: number,
  gridSize = 50,
): { x: number; y: number; z: number } {
  const alt = (typeof host.altitude === 'number' ? host.altitude : 0) * gridSize;
  const tall = visualHeightPx > 0 ? visualHeightPx : footprintPx;
  const lift = Math.max(gridSize * 0.16, tall * 0.08);
  const cx = host.location.x + footprintPx / 2;
  const cy = host.location.y + footprintPx / 2;
  // Local +Y = behind the token; negative = slightly in front. Rotate with facing.
  const back = footprintPx * -0.02;
  const rad = ((host.rotate || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: cx - back * sin,
    y: cy + back * cos,
    z: (host.posZ || 0) + alt + lift,
  };
}

/**
 * TextNote geometry: movable origin is the bottom-center of the paper
 * (content uses translateX(-50%), face hinged at bottom:0).
 * Table Y grows downward, so the title/top edge is at location.y - height.
 * Fallback tip matches `.push-pin` on the paper face.
 */
export function notePinAnchorPx(
  host: PinHost,
  widthPx: number,
  heightPx: number,
): { x: number; y: number } {
  const tip = pinTipLocal(host);
  const lx = -widthPx / 2 + tip.x;
  const ly = -heightPx + tip.y;
  return rotateAround(
    host.location.x,
    host.location.y,
    host.location.x + lx,
    host.location.y + ly,
    host.rotate || 0,
  );
}

function rotateAround(
  cx: number,
  cy: number,
  x: number,
  y: number,
  deg: number,
): { x: number; y: number } {
  const rot = (deg * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const dx = x - cx;
  const dy = y - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

/** Quadratic Bezier path approximating a sagging string (catenary look). */
export function stringPathD(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sag = 0.22,
): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dist = Math.hypot(x2 - x1, y2 - y1) || 1;
  const drop = dist * Math.max(0.05, Math.min(0.55, sag));
  return `M ${x1} ${y1} Q ${mx} ${my + drop} ${x2} ${y2}`;
}

/**
 * CSS 3D beam from (x1,y1,z1) → (x2,y2,z2) so each yarn end keeps its own height.
 * Element is a thin bar with transform-origin at the left (start) center.
 */
export function stringBeamStyle3d(
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  color = '#c62828',
): Record<string, string> {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  const lenXY = Math.hypot(dx, dy) || 0.001;
  const len = Math.hypot(dx, dy, dz) || 0.001;
  const rotZ = (Math.atan2(dy, dx) * 180) / Math.PI;
  // After rotateZ, local +X lies on the table along the rope; pitch into +Z.
  const rotY = (-Math.atan2(dz, lenXY) * 180) / Math.PI;
  return {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${len}px`,
    height: '2.2px',
    background: color,
    'transform-origin': '0 50%',
    transform: `translate3d(${x1}px, ${y1}px, ${z1}px) rotateZ(${rotZ}deg) rotateY(${rotY}deg)`,
  };
}
