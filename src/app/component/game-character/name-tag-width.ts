/**
 * Soft ceiling: only past this width do we allow wrapping.
 * Typical token names stay on one line with no max-width cap.
 */
export const NAME_TAG_WRAP_WIDTH_PX = 360;

/** Approximate rendered name width (px) at 13px UI font + padding. Slightly generous. */
export function estimateNameTagWidthPx(name: string, fontPx = 13): number {
  let units = 0;
  for (const ch of name) {
    const cp = ch.codePointAt(0) ?? 0;
    // CJK / fullwidth ≈ 1em; ASCII / halfwidth ≈ 0.6em (prefer single-line).
    units += cp > 0xff ? 1 : 0.6;
  }
  return Math.ceil(units * fontPx + 28);
}

/** True only for very long names that should wrap instead of spanning the map. */
export function nameTagShouldWrap(name: string): boolean {
  return estimateNameTagWidthPx(name || '') > NAME_TAG_WRAP_WIDTH_PX;
}
