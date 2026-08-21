/** Pure planning for soundboard multi-drop (OVER cancel → skip, overflow → folder). */

export type SoundboardCandidate = { id: string; over: boolean };

export type SoundboardAssignAction =
  | { type: 'pad'; pad: number; id: string }
  | { type: 'folder'; id: string }
  | { type: 'skip'; id: string };

/**
 * Decide pad / folder / skip for each ready candidate in drop order.
 * Declining OVER skips over-limit clips entirely (no pad, no folder move).
 * Allowed clips past `slotCount` go folder-only.
 */
export function planSoundboardAssign(
  candidates: SoundboardCandidate[],
  allowOver: boolean,
  startPad: number,
  slotCount: number,
): SoundboardAssignAction[] {
  if (!candidates.length || slotCount < 1) return [];
  let pad = Math.max(0, Math.min(startPad, slotCount - 1));
  const actions: SoundboardAssignAction[] = [];
  for (const c of candidates) {
    if (c.over && !allowOver) {
      actions.push({ type: 'skip', id: c.id });
      continue;
    }
    if (pad >= slotCount) {
      actions.push({ type: 'folder', id: c.id });
      continue;
    }
    actions.push({ type: 'pad', pad, id: c.id });
    pad += 1;
  }
  return actions;
}

/** Duration slightly over the guide counts as OVER (matches jukebox probe tolerance). */
export function isSoundboardOverDuration(durationSec: number, maxSec: number): boolean {
  return durationSec > maxSec + 0.05;
}
