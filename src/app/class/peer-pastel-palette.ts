/**
 * Mid-tone player colors for first-time assignment.
 * Tuned for chat/nickname text on light backgrounds and cursor name badges (white text).
 * 18 hues × 3 variants = 54.
 */
export const PEER_PASTEL_PALETTE: readonly string[] = buildPeerColorPalette();

function buildPeerColorPalette(): string[] {
  // Skip very light yellows/limes: keep warm hues slightly deeper via shared mid L.
  const hues = [
    0, 14, 28, 38, 48, 58,
    78, 100, 128, 148, 165, 178,
    192, 205, 220, 240, 268, 300,
  ];
  const variants: Array<{ s: number; l: number }> = [
    { s: 60, l: 48 }, // primary: text / badge balance
    { s: 55, l: 42 }, // slightly deeper
    { s: 65, l: 54 }, // slightly brighter, still readable
  ];
  const out: string[] = [];
  for (const h of hues) {
    for (const v of variants) {
      // Yellow–cyan read bright at mid L; deepen so names stay readable on white.
      let l = v.l;
      if (h >= 28 && h <= 58) l = Math.max(32, v.l - 14);
      else if (h >= 78 && h <= 192) l = Math.max(34, v.l - 14);
      out.push(hslToHex(h, v.s, l));
    }
  }
  return out;
}

function hslToHex(h: number, s: number, l: number): string {
  const S = s / 100;
  const L = l / 100;
  const C = (1 - Math.abs(2 * L - 1)) * S;
  const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - C / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) { r = C; g = X; }
  else if (h < 120) { r = X; g = C; }
  else if (h < 180) { g = C; b = X; }
  else if (h < 240) { g = X; b = C; }
  else if (h < 300) { r = X; b = C; }
  else { r = C; b = X; }
  const toByte = (n: number) => Math.round((n + m) * 255);
  const hex = (n: number) => toByte(n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
