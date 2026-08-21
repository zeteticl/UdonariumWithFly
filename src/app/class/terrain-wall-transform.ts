/**
 * West-wall CSS 3D. Legacy Udonarium uses scaleX(-1) + translateX(-100%)
 * around origin 0% 0%; turning mirror off must drop both or the panel
 * shifts to x=[-width, 0] (west wall in the wrong place).
 */
export function wallLeftCssTransform(mirror: boolean): string {
  if (mirror) {
    return 'rotateZ(90deg) rotateX(-90deg) scaleX(-1.0) translateX(-100%) translateY(-100%)';
  }
  return 'rotateZ(90deg) rotateX(-90deg) translateY(-100%)';
}

/** 2D prefix (before rotateX/Z), origin = element top-left. */
export function wallLeftPreRotateCorners(
  mirror: boolean,
  width: number,
  height: number,
): { x: number; y: number }[] {
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ];
  return corners.map(p => {
    let x = p.x;
    let y = p.y - height;
    if (mirror) {
      x = -(x - width);
    }
    return { x, y };
  });
}
