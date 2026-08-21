/**
 * Temporary diagnostics for post-ZIP token pose sync.
 * Filter DevTools console by: PoseDebug
 * Set POSE_DEBUG = false to silence.
 */
export const POSE_DEBUG = false;

export function poseDebug(tag: string, data?: Record<string, unknown>) {
  if (!POSE_DEBUG) return;
  if (data !== undefined) console.log(`[PoseDebug] ${tag}`, data);
  else console.log(`[PoseDebug] ${tag}`);
}

export function countMovables(): number {
  try {
    // Lazy require to avoid circular imports at module init — callers pass count instead when possible.
    return -1;
  } catch {
    return -1;
  }
}
