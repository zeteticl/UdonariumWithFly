import { AudioPlayer } from '@udonarium/core/file-storage/audio-player';

/** Seamless ambient loop with head/tail crossfade (no hard loop click). */
export class WeatherLoopPlayer {
  static readonly DEFAULT_OVERLAP_SEC = 6;
  static readonly MIN_OVERLAP_SEC = 0;
  static readonly MAX_OVERLAP_SEC = 30;
  private static readonly FADE_STEPS = 24;
  private static readonly TICK_MS = 50;

  private url = '';
  private a: HTMLAudioElement | null = null;
  private b: HTMLAudioElement | null = null;
  private active: HTMLAudioElement | null = null;
  private standby: HTMLAudioElement | null = null;
  private crossfadeStarted = false;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private onEnded: (() => void) | null = null;
  private wired = new WeakSet<HTMLAudioElement>();
  private overlapSec = WeatherLoopPlayer.DEFAULT_OVERLAP_SEC;
  private baseVolume = 1;

  static clampOverlapSec(sec: number): number {
    if (!isFinite(sec)) return WeatherLoopPlayer.DEFAULT_OVERLAP_SEC;
    return Math.max(
      WeatherLoopPlayer.MIN_OVERLAP_SEC,
      Math.min(WeatherLoopPlayer.MAX_OVERLAP_SEC, sec),
    );
  }

  get overlapSeconds(): number {
    return this.overlapSec;
  }

  /** Update crossfade window; takes effect on the next loop boundary. */
  setOverlapSeconds(sec: number) {
    this.overlapSec = WeatherLoopPlayer.clampOverlapSec(sec);
  }

  play(url: string, volume = 1, overlapSec = this.overlapSec): boolean {
    this.stop();
    if (!url) return false;
    this.url = url;
    this.overlapSec = WeatherLoopPlayer.clampOverlapSec(overlapSec);
    this.baseVolume = Math.max(0, Math.min(1, volume));
    this.a = this.createElement(url, this.baseVolume);
    this.b = this.createElement(url, this.baseVolume);
    this.active = this.a;
    this.standby = this.b;
    this.crossfadeStarted = false;
    this.onEnded = () => this.handleEnded();
    this.active.addEventListener('ended', this.onEnded);
    this.startTick();
    this.active.play().catch(() => { /* autoplay policy */ });
    return true;
  }

  stop() {
    this.clearFade();
    this.clearTick();
    for (const el of [this.a, this.b]) {
      if (!el) continue;
      if (this.onEnded) el.removeEventListener('ended', this.onEnded);
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.a = this.b = this.active = this.standby = null;
    this.onEnded = null;
    this.crossfadeStarted = false;
    this.url = '';
  }

  isPlaying(): boolean {
    return !!(this.active && !this.active.paused);
  }

  setVolume(volume: number) {
    this.baseVolume = Math.max(0, Math.min(1, volume));
    if (this.fadeTimer != null) return; // mid-crossfade owns element volumes
    if (this.active) this.active.volume = this.baseVolume;
    if (this.standby && this.standby.paused) this.standby.volume = this.baseVolume;
  }

  private createElement(url: string, volume: number): HTMLAudioElement {
    const el = new Audio(url);
    el.loop = false;
    el.preload = 'auto';
    el.volume = volume;
    this.wireAmbient(el);
    return el;
  }

  /** Route through ambient gain so mute/volume sliders apply. */
  private wireAmbient(el: HTMLAudioElement) {
    if (this.wired.has(el)) return;
    void AudioPlayer.ambientNode;
    try {
      const source = AudioPlayer.audioContext.createMediaElementSource(el);
      source.connect(AudioPlayer.ambientNode);
      this.wired.add(el);
    } catch {
      // Fallback: direct element volume only.
    }
  }

  private startTick() {
    this.clearTick();
    this.tickTimer = setInterval(() => this.tickCrossfade(), WeatherLoopPlayer.TICK_MS);
  }

  private clearTick() {
    if (this.tickTimer != null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private effectiveOverlap(duration: number): number {
    if (!(duration > 0) || !isFinite(duration)) return 0;
    // Keep head and tail from fully overlapping each other.
    const max = Math.max(0, duration * 0.45);
    return Math.min(this.overlapSec, max);
  }

  private tickCrossfade() {
    const current = this.active;
    const next = this.standby;
    if (!current || !next || this.crossfadeStarted) return;
    const duration = current.duration;
    if (!duration || !isFinite(duration)) return;
    const overlap = this.effectiveOverlap(duration);
    if (overlap <= 0) {
      // Hard restart near end (no crossfade).
      if (duration - current.currentTime > 0.05) return;
      this.hardRestart(current);
      return;
    }
    const remain = duration - current.currentTime;
    if (remain > overlap || remain <= 0) return;
    this.beginCrossfade(current, next, overlap);
  }

  private handleEnded() {
    if (this.crossfadeStarted) return;
    const current = this.active;
    const next = this.standby;
    if (!current || !next) return;
    const duration = current.duration;
    const overlap = duration && isFinite(duration) ? this.effectiveOverlap(duration) : 0;
    if (overlap > 0) {
      // Missed the time window — start next immediately at full volume.
      this.beginCrossfade(current, next, Math.min(0.15, overlap || 0.15), true);
      return;
    }
    this.hardRestart(current);
  }

  private hardRestart(current: HTMLAudioElement) {
    try {
      current.currentTime = 0;
      current.volume = this.baseVolume;
      void current.play().catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  }

  private beginCrossfade(
    current: HTMLAudioElement,
    next: HTMLAudioElement,
    overlap: number,
    snap = false,
  ) {
    this.crossfadeStarted = true;
    next.currentTime = 0;
    const target = this.baseVolume;
    if (snap) {
      next.volume = target;
      void next.play().catch(() => { this.crossfadeStarted = false; });
      current.pause();
      current.currentTime = 0;
      current.volume = target;
      this.swapActive(current, next);
      return;
    }

    next.volume = 0;
    void next.play().catch(() => { this.crossfadeStarted = false; });

    let step = 0;
    this.clearFade();
    const steps = WeatherLoopPlayer.FADE_STEPS;
    this.fadeTimer = setInterval(() => {
      step++;
      const t = step / steps;
      if (current) current.volume = Math.max(0, target * (1 - t));
      if (next) next.volume = Math.max(0, target * t);
      if (step >= steps) {
        this.clearFade();
        if (current) {
          current.pause();
          current.currentTime = 0;
          current.volume = target;
        }
        if (next) next.volume = target;
        this.swapActive(current, next);
      }
    }, Math.max(16, (overlap * 1000) / steps));
  }

  private swapActive(outgoing: HTMLAudioElement, incoming: HTMLAudioElement) {
    if (this.onEnded && outgoing) outgoing.removeEventListener('ended', this.onEnded);
    this.active = incoming;
    this.standby = outgoing;
    this.crossfadeStarted = false;
    if (this.onEnded && this.active) this.active.addEventListener('ended', this.onEnded);
  }

  private clearFade() {
    if (this.fadeTimer != null) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
  }
}
