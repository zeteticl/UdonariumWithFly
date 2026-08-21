/** Leave/switch flush may persist only trusted tabletop, or an explicit pre-clear snapshot. */
export function shouldPersistLeaveFlush(
  contentTrusted: boolean,
  hasExplicitSnapshot: boolean,
): boolean {
  return contentTrusted || hasExplicitSnapshot;
}
