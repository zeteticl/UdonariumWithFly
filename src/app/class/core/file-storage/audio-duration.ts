/**
 * Probe playable duration (seconds) via HTMLAudioElement metadata.
 * Returns 0 when unknown (CORS, missing URL, timeout, or non-finite duration).
 */
export function probeAudioDurationSec(audio: { url?: string }, timeoutMs = 8000): Promise<number> {
  const url = audio?.url;
  if (!url) return Promise.resolve(0);

  return new Promise(resolve => {
    const el = new Audio();
    el.preload = 'metadata';
    let settled = false;

    const finish = (sec: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      el.onloadedmetadata = null;
      el.onerror = null;
      el.removeAttribute('src');
      try { el.load(); } catch { /* ignore */ }
      resolve(sec > 0 && Number.isFinite(sec) ? sec : 0);
    };

    const timer = window.setTimeout(() => finish(0), timeoutMs);
    el.onloadedmetadata = () => finish(el.duration);
    el.onerror = () => finish(0);
    el.src = url;
  });
}
