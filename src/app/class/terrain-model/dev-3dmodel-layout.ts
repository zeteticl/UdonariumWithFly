export type DevModelLayoutCursor = {
  x: number;
  y: number;
  rowHeight: number;
};

export function createDevModelLayoutCursor(marginPx: number): DevModelLayoutCursor {
  return { x: marginPx, y: marginPx, rowHeight: 0 };
}

/**
 * Place the next box on the table; wrap to a new row when it would exceed table width.
 */
export function placeDevModelAndAdvance(
  cursor: DevModelLayoutCursor,
  widthPx: number,
  depthPx: number,
  tableWidthPx: number,
  gapPx: number,
  marginPx: number,
): { x: number; y: number } {
  if (cursor.x > marginPx && cursor.x + widthPx > tableWidthPx) {
    cursor.x = marginPx;
    cursor.y += cursor.rowHeight + gapPx;
    cursor.rowHeight = 0;
  }
  const placed = { x: cursor.x, y: cursor.y };
  cursor.x += widthPx + gapPx;
  cursor.rowHeight = Math.max(cursor.rowHeight, depthPx);
  return placed;
}
