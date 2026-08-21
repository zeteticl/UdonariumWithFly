import { AudioFile, AudioState } from './audio-file';
import { FileReaderUtil } from './file-reader-util';

export enum VolumeType {
  MASTER,
  AUDITION,
  SOUND_EFFECT,
  NOTICE,
  AMBIENT,
  /** Jukebox soundboard pads (separate from system SE). */
  SOUNDBOARD,
}

declare global {
  interface Window {
    AudioContext: typeof AudioContext;
    webkitAudioContext: typeof AudioContext;
  }
}

type AudioCache = { url: string, blob: Blob };

export class AudioPlayer {

  static readonly AUDITION_VOLUME_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-audition-volume-local-storage';
  static readonly MAIN_VOLUME_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-main-volume-local-storage';
  static readonly SOUND_EFFECT_VOLUME_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-sound-effect-volume-local-storage';
  static readonly SOUNDBOARD_VOLUME_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-soundboard-volume-local-storage';
  static readonly NOTICE_VOLUME_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-notice-volume-local-storage';
  static readonly AMBIENT_VOLUME_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-ambient-volume-local-storage';

  static readonly AUDITION_IS_MUTE_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-audition-is-mute-local-storage';
  static readonly MAIN_IS_MUTE_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-main-is-mute-local-storage';
  static readonly SOUND_EFFECT_IS_MUTE_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-sound-effect-is-mute-local-storage';
  static readonly SOUNDBOARD_IS_MUTE_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-soundboard-is-mute-local-storage';
  static readonly NOTICE_IS_MUTE_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-notice-is-mute-local-storage';
  static readonly AMBIENT_IS_MUTE_LOCAL_STORAGE_KEY = 'udonanaumu-audio-player-ambient-is-mute-local-storage';

  private static _audioContext: AudioContext;
  static get audioContext(): AudioContext {
    if (!AudioPlayer._audioContext) AudioPlayer._audioContext = new (window.AudioContext || window.webkitAudioContext)();
    return AudioPlayer._audioContext;
  }

  private static _isMute: boolean = false;
  static get isMute(): boolean { return AudioPlayer._isMute; }
  static set isMute(isMute: boolean) {
    AudioPlayer._isMute = isMute;
    AudioPlayer.volume = AudioPlayer._volume;
  }

  /** Players using element-direct playback (cross-origin URL without CORS). */
  private static elementDirectPlayers = new Set<AudioPlayer>();

  private static refreshElementDirectVolumes() {
    for (const player of AudioPlayer.elementDirectPlayers) {
      player.applyElementVolume();
    }
  }

  private static _volume: number = 0.5;
  static get volume(): number { return AudioPlayer._volume; }
  static set volume(volume: number) {
    AudioPlayer._volume = volume;
    AudioPlayer.applyGain(AudioPlayer._masterGainNode, AudioPlayer.isMute, AudioPlayer._volume);
    AudioPlayer.refreshElementDirectVolumes();
  }

  private static _isAuditionMute: boolean = false;
  static get isAuditionMute(): boolean { return AudioPlayer._isAuditionMute; }
  static set isAuditionMute(isAuditionMute: boolean) {
    AudioPlayer._isAuditionMute = isAuditionMute;
    AudioPlayer.auditionVolume = AudioPlayer._auditionVolume;
  }

  private static _auditionVolume: number = 0.5;
  static get auditionVolume(): number { return AudioPlayer._auditionVolume; }
  static set auditionVolume(auditionVolume: number) {
    AudioPlayer._auditionVolume = auditionVolume;
    AudioPlayer.applyGain(AudioPlayer._auditionGainNode, AudioPlayer.isAuditionMute, AudioPlayer._auditionVolume);
    AudioPlayer.refreshElementDirectVolumes();
  }

  private static _isSoundEffectMute: boolean = false;
  static get isSoundEffectMute(): boolean { return AudioPlayer._isSoundEffectMute; }
  static set isSoundEffectMute(isSoundEffectMute: boolean) { 
    AudioPlayer._isSoundEffectMute = isSoundEffectMute; 
    AudioPlayer.soundEffectVolume = AudioPlayer._soundEffectVolume;
  }

  private static _soundEffectVolume: number = 0.5;
  static get soundEffectVolume(): number { return AudioPlayer._soundEffectVolume; }
  static set soundEffectVolume(soundEffectVolume: number) {
    AudioPlayer._soundEffectVolume = soundEffectVolume;
    AudioPlayer.applyGain(AudioPlayer._soundEffectGainNode, AudioPlayer.isSoundEffectMute, AudioPlayer._soundEffectVolume);
    AudioPlayer.refreshElementDirectVolumes();
  }

  private static _isSoundboardMute: boolean = false;
  static get isSoundboardMute(): boolean { return AudioPlayer._isSoundboardMute; }
  static set isSoundboardMute(isSoundboardMute: boolean) {
    AudioPlayer._isSoundboardMute = isSoundboardMute;
    AudioPlayer.soundboardVolume = AudioPlayer._soundboardVolume;
  }

  private static _soundboardVolume: number = 0.5;
  static get soundboardVolume(): number { return AudioPlayer._soundboardVolume; }
  static set soundboardVolume(soundboardVolume: number) {
    AudioPlayer._soundboardVolume = soundboardVolume;
    AudioPlayer.applyGain(AudioPlayer._soundboardGainNode, AudioPlayer.isSoundboardMute, AudioPlayer._soundboardVolume);
    AudioPlayer.refreshElementDirectVolumes();
  }

  private static _isNoticeMute: boolean = false;
  static get isNoticeMute(): boolean { return AudioPlayer._isNoticeMute; }
  static set isNoticeMute(isNoticeMute: boolean) { 
    AudioPlayer._isNoticeMute = isNoticeMute;
    AudioPlayer.noticeVolume = AudioPlayer._noticeVolume;
  }

  private static _noticeVolume: number = 0.5;
  static get noticeVolume(): number { return AudioPlayer._noticeVolume; }
  static set noticeVolume(noticeVolume: number) {
    AudioPlayer._noticeVolume = noticeVolume;
    AudioPlayer.applyGain(AudioPlayer._noticeGainNode, AudioPlayer.isNoticeMute, AudioPlayer._noticeVolume);
    AudioPlayer.refreshElementDirectVolumes();
  }

  private static _isAmbientMute: boolean = false;
  static get isAmbientMute(): boolean { return AudioPlayer._isAmbientMute; }
  static set isAmbientMute(isAmbientMute: boolean) {
    AudioPlayer._isAmbientMute = isAmbientMute;
    AudioPlayer.ambientVolume = AudioPlayer._ambientVolume;
  }

  private static _ambientVolume: number = 0.5;
  static get ambientVolume(): number { return AudioPlayer._ambientVolume; }
  static set ambientVolume(ambientVolume: number) {
    AudioPlayer._ambientVolume = ambientVolume;
    AudioPlayer.applyGain(AudioPlayer._ambientGainNode, AudioPlayer.isAmbientMute, AudioPlayer._ambientVolume);
    AudioPlayer.refreshElementDirectVolumes();
  }

  /** Initial / target linear gain for a channel (respect mute set before the GainNode exists). */
  private static channelGain(muted: boolean, volume: number): number {
    return muted ? 0 : Math.max(0, Math.min(1, volume));
  }

  /** Immediate mute/unmute (avoid setTargetAtTime lag on one-shot SE). */
  private static applyGain(node: GainNode | undefined, muted: boolean, volume: number) {
    if (!node) return;
    node.gain.setValueAtTime(
      AudioPlayer.channelGain(muted, volume),
      AudioPlayer.audioContext.currentTime,
    );
  }

  private static _masterGainNode: GainNode
  private static get masterGainNode(): GainNode {
    if (!AudioPlayer._masterGainNode) {
      let masterGain = AudioPlayer.audioContext.createGain();
      masterGain.gain.setValueAtTime(
        AudioPlayer.channelGain(AudioPlayer.isMute, AudioPlayer._volume),
        AudioPlayer.audioContext.currentTime,
      );
      masterGain.connect(AudioPlayer.audioContext.destination);
      AudioPlayer._masterGainNode = masterGain;
    }
    return AudioPlayer._masterGainNode;
  }

  private static _auditionGainNode: GainNode
  private static get auditionGainNode(): GainNode {
    if (!AudioPlayer._auditionGainNode) {
      let auditionGain = AudioPlayer.audioContext.createGain();
      auditionGain.gain.setValueAtTime(
        AudioPlayer.channelGain(AudioPlayer.isAuditionMute, AudioPlayer._auditionVolume),
        AudioPlayer.audioContext.currentTime,
      );
      auditionGain.connect(AudioPlayer.audioContext.destination);
      AudioPlayer._auditionGainNode = auditionGain;
    }
    return AudioPlayer._auditionGainNode;
  }

  private static _soundEffectGainNode: GainNode
  private static get soundEffectGainNode(): GainNode {
    if (!AudioPlayer._soundEffectGainNode) {
      let soundEffectGain = AudioPlayer.audioContext.createGain();
      soundEffectGain.gain.setValueAtTime(
        AudioPlayer.channelGain(AudioPlayer.isSoundEffectMute, AudioPlayer._soundEffectVolume),
        AudioPlayer.audioContext.currentTime,
      );
      soundEffectGain.connect(AudioPlayer.audioContext.destination);
      AudioPlayer._soundEffectGainNode = soundEffectGain;
    }
    return AudioPlayer._soundEffectGainNode;
  }

  private static _soundboardGainNode: GainNode
  private static get soundboardGainNode(): GainNode {
    if (!AudioPlayer._soundboardGainNode) {
      let soundboardGain = AudioPlayer.audioContext.createGain();
      soundboardGain.gain.setValueAtTime(
        AudioPlayer.channelGain(AudioPlayer.isSoundboardMute, AudioPlayer._soundboardVolume),
        AudioPlayer.audioContext.currentTime,
      );
      soundboardGain.connect(AudioPlayer.audioContext.destination);
      AudioPlayer._soundboardGainNode = soundboardGain;
    }
    return AudioPlayer._soundboardGainNode;
  }

  private static _noticeGainNode: GainNode
  private static get noticeGainNode(): GainNode {
    if (!AudioPlayer._noticeGainNode) {
      let noticeGain = AudioPlayer.audioContext.createGain();
      noticeGain.gain.setValueAtTime(
        AudioPlayer.channelGain(AudioPlayer.isNoticeMute, AudioPlayer._noticeVolume),
        AudioPlayer.audioContext.currentTime,
      );
      noticeGain.connect(AudioPlayer.audioContext.destination);
      AudioPlayer._noticeGainNode = noticeGain;
    }
    return AudioPlayer._noticeGainNode;
  }

  private static _ambientGainNode: GainNode
  private static get ambientGainNode(): GainNode {
    if (!AudioPlayer._ambientGainNode) {
      let ambientGain = AudioPlayer.audioContext.createGain();
      ambientGain.gain.setValueAtTime(
        AudioPlayer.channelGain(AudioPlayer.isAmbientMute, AudioPlayer._ambientVolume),
        AudioPlayer.audioContext.currentTime,
      );
      ambientGain.connect(AudioPlayer.audioContext.destination);
      AudioPlayer._ambientGainNode = ambientGain;
    }
    return AudioPlayer._ambientGainNode;
  }

  static get rootNode(): AudioNode { return AudioPlayer.masterGainNode; }
  static get auditionNode(): AudioNode { return AudioPlayer.auditionGainNode; }
  static get soundEffectNode(): AudioNode { return AudioPlayer.soundEffectGainNode; }
  static get soundboardNode(): AudioNode { return AudioPlayer.soundboardGainNode; }
  static get noticeNode(): AudioNode { return AudioPlayer.noticeGainNode; }
  static get ambientNode(): AudioNode { return AudioPlayer.ambientGainNode; }

  /**
   * Keep MASTER and AMBIENT personal buses at the same level.
   * Jukebox track 0 uses MASTER; tracks 1–3 and weather use AMBIENT.
   */
  static syncMusicBuses(volume: number, muted = false) {
    const v = Math.max(0, Math.min(1, volume));
    AudioPlayer.isMute = muted || v <= 0;
    AudioPlayer.volume = v;
    AudioPlayer.isAmbientMute = muted || v <= 0;
    AudioPlayer.ambientVolume = v;
  }

  private _audioElm: HTMLAudioElement;
  private get audioElm(): HTMLAudioElement {
    if (!this._audioElm) {
      this._audioElm = new Audio();
      this._audioElm.onplay = () => { }
      this._audioElm.onpause = () => { this.mediaElementSource.disconnect(); }
      this._audioElm.onended = () => { this.mediaElementSource.disconnect(); }
    }
    return this._audioElm;
  }

  /** Separate element that never attaches MediaElementSource (required for non-CORS remote URLs). */
  private _directAudioElm: HTMLAudioElement;
  private get directAudioElm(): HTMLAudioElement {
    if (!this._directAudioElm) {
      this._directAudioElm = new Audio();
    }
    return this._directAudioElm;
  }

  private _mediaElementSource: MediaElementAudioSourceNode;
  private get mediaElementSource(): MediaElementAudioSourceNode {
    if (!this._mediaElementSource) this._mediaElementSource = AudioPlayer.audioContext.createMediaElementSource(this.audioElm);
    return this._mediaElementSource;
  }

  /** When true, play remote URL via HTMLAudioElement (speakers), not Web Audio. */
  private elementDirect = false;
  private roomGain = 1;
  /** 0–1 multiplier for fade in/out / crossfade (does not change stored roomGain). */
  private playbackFactor = 1;
  /** 0–1 multiplier for cut-in ducking (does not change stored roomGain). */
  private duckFactor = 1;
  private loopFlag = false;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onEndedBound = () => {
    if (this.endedAction) this.endedAction();
  };

  // Make this an event?
  public endedAction: Function;

  audio: AudioFile;
  volumeType: VolumeType = VolumeType.MASTER;

  get volume(): number { return this.roomGain; }
  set volume(volume) {
    this.roomGain = volume;
    this.applyElementVolume();
  }
  get loop(): boolean { return this.loopFlag; }
  set loop(loop) {
    this.loopFlag = !!loop;
    if (this._audioElm) this._audioElm.loop = this.loopFlag;
    if (this._directAudioElm) this._directAudioElm.loop = this.loopFlag;
  }
  get paused(): boolean {
    if (this.elementDirect) return !this._directAudioElm || this._directAudioElm.paused;
    return !this._audioElm || this._audioElm.paused;
  }

  get currentTime(): number {
    const elm = this.activeElement;
    if (!elm || !isFinite(elm.currentTime)) return 0;
    return elm.currentTime;
  }
  set currentTime(time: number) {
    const elm = this.activeElement;
    if (!elm) return;
    const t = Math.max(0, isFinite(time) ? time : 0);
    try {
      const dur = elm.duration;
      elm.currentTime = (dur && isFinite(dur)) ? Math.min(t, Math.max(0, dur - 0.05)) : t;
    } catch { /* ignore seek errors while loading */ }
  }

  get duration(): number {
    const elm = this.activeElement;
    if (!elm) return 0;
    const d = elm.duration;
    return d && isFinite(d) ? d : 0;
  }

  private get activeElement(): HTMLAudioElement | null {
    if (this.elementDirect) return this._directAudioElm || null;
    return this._audioElm || null;
  }

  private static cacheMap: Map<string, AudioCache> = new Map();

  constructor(audio?: AudioFile) {
    this.audio = audio;
  }

  static play(audio: AudioFile, volume: number = 1.0) {
    if (AudioPlayer.isMute || AudioPlayer.volume <= 0) return;
    this.playBufferAsync(audio, volume);
  }

  static playSoundEffect(audio: AudioFile, volume: number = 1.0) {
    if (AudioPlayer.isSoundEffectMute || AudioPlayer.soundEffectVolume <= 0) return;
    // Touch gain node so a pre-first-play mute is applied before audio starts.
    void AudioPlayer.soundEffectNode;
    this.playBufferAsyncBase(
      AudioPlayer.soundEffectNode,
      audio,
      volume,
      () => AudioPlayer.isSoundEffectMute || AudioPlayer.soundEffectVolume <= 0,
    );
  }

  static playSoundboard(audio: AudioFile, volume: number = 1.0) {
    if (AudioPlayer.isSoundboardMute || AudioPlayer.soundboardVolume <= 0) return;
    void AudioPlayer.soundboardNode;
    const startEpoch = AudioPlayer.soundboardEpoch;
    void AudioPlayer.playBufferAsyncBase(
      AudioPlayer.soundboardNode,
      audio,
      volume,
      () => AudioPlayer.isSoundboardMute || AudioPlayer.soundboardVolume <= 0,
      {
        epoch: () => AudioPlayer.soundboardEpoch,
        startEpoch,
        voices: AudioPlayer.soundboardVoices,
      },
    );
  }

  /** Force-stop every active soundboard one-shot (local). Bumps epoch to cancel in-flight starts. */
  static stopSoundboard() {
    AudioPlayer.soundboardEpoch += 1;
    const voices = AudioPlayer.soundboardVoices.splice(0);
    for (const voice of voices) {
      try { voice.source.onended = null; } catch { /* ignore */ }
      try { voice.source.stop(); } catch { /* already stopped */ }
      try { voice.source.disconnect(); } catch { /* ignore */ }
      try { voice.gain.disconnect(); } catch { /* ignore */ }
      voice.source.buffer = null;
    }
  }

  private static soundboardEpoch = 0;
  private static readonly soundboardVoices: { source: AudioBufferSourceNode; gain: GainNode }[] = [];


  static playNotice(audio: AudioFile, volume: number = 1.0) {
    if (AudioPlayer.isNoticeMute || AudioPlayer.noticeVolume <= 0) return;
    void AudioPlayer.noticeNode;
    this.playBufferAsyncBase(
      AudioPlayer.noticeNode,
      audio,
      volume,
      () => AudioPlayer.isNoticeMute || AudioPlayer.noticeVolume <= 0,
    );
  }

  private static isCrossOriginHttpUrl(url: string): boolean {
    if (!url || url.startsWith('blob:') || url.startsWith('data:')) return false;
    try {
      const absolute = new URL(url, window.location.href);
      if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return false;
      return absolute.origin !== window.location.origin;
    } catch {
      return false;
    }
  }

  private getChannelLinearVolume(): number {
    switch (this.volumeType) {
      case VolumeType.AUDITION:
        return AudioPlayer.channelGain(AudioPlayer.isAuditionMute, AudioPlayer.auditionVolume);
      case VolumeType.SOUND_EFFECT:
        return AudioPlayer.channelGain(AudioPlayer.isSoundEffectMute, AudioPlayer.soundEffectVolume);
      case VolumeType.SOUNDBOARD:
        return AudioPlayer.channelGain(AudioPlayer.isSoundboardMute, AudioPlayer.soundboardVolume);
      case VolumeType.NOTICE:
        return AudioPlayer.channelGain(AudioPlayer.isNoticeMute, AudioPlayer.noticeVolume);
      case VolumeType.AMBIENT:
        return AudioPlayer.channelGain(AudioPlayer.isAmbientMute, AudioPlayer.ambientVolume);
      default:
        return AudioPlayer.channelGain(AudioPlayer.isMute, AudioPlayer.volume);
    }
  }

  private applyElementVolume() {
    const gain = Math.max(0, Math.min(1, this.roomGain * this.playbackFactor * this.duckFactor));
    if (this.elementDirect && this._directAudioElm) {
      this._directAudioElm.volume = Math.max(0, Math.min(1, gain * this.getChannelLinearVolume()));
    } else if (this._audioElm) {
      this._audioElm.volume = gain;
    }
  }

  /** Cut-in duck multiplier (1 = normal, 0.25 = ducked). */
  setDuckFactor(factor: number) {
    this.duckFactor = Math.max(0, Math.min(1, isFinite(factor) ? factor : 1));
    this.applyElementVolume();
  }

  /** Cancel any in-flight volume ramp. */
  clearFade() {
    if (this.fadeTimer != null) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
  }

  /**
   * Linear ramp of playbackFactor from current to `to` over `durationSec`.
   * durationSec <= 0 snaps immediately.
   */
  fadePlaybackFactorTo(to: number, durationSec: number): Promise<void> {
    const target = Math.max(0, Math.min(1, to));
    this.clearFade();
    if (!(durationSec > 0)) {
      this.playbackFactor = target;
      this.applyElementVolume();
      return Promise.resolve();
    }
    const from = this.playbackFactor;
    const steps = Math.max(4, Math.min(48, Math.round(durationSec * 20)));
    const stepMs = (durationSec * 1000) / steps;
    let step = 0;
    return new Promise(resolve => {
      this.fadeTimer = setInterval(() => {
        step++;
        const t = step / steps;
        this.playbackFactor = from + (target - from) * t;
        this.applyElementVolume();
        if (step >= steps) {
          this.clearFade();
          this.playbackFactor = target;
          this.applyElementVolume();
          resolve();
        }
      }, stepMs);
    });
  }

  play(audio: AudioFile = this.audio) {
    this.clearFade();
    this.stop();
    this.audio = audio;
    if (!this.audio) return;
    this.playbackFactor = 1;
    // Ensure channel GainNode exists with current mute. Still start the element when
    // muted (gain 0) so local unmute restores BGM without depending on room sync.
    void this.getConnectingAudioNode();
    AudioPlayer.ensureContextRunning();

    let url = this.audio.url;
    const remoteCrossOrigin = audio.state === AudioState.URL && AudioPlayer.isCrossOriginHttpUrl(url);
    const hasBlobCache = audio.state === AudioState.URL && AudioPlayer.cacheMap.has(audio.identifier);

    if (hasBlobCache) {
      url = AudioPlayer.cacheMap.get(audio.identifier).url;
    } else if (audio.state === AudioState.URL && !remoteCrossOrigin) {
      // Same-origin / relative assets: optional prefetch into blob cache.
      AudioPlayer.createCacheAsync(audio);
    }
    // Remote cross-origin: do not fetch() — CORS usually blocks and only spams console.

    // MediaElementSource requires CORS for remote media; without it output is silent.
    // Use a dedicated HTMLAudioElement that never joins the Web Audio graph.
    this.elementDirect = remoteCrossOrigin && !hasBlobCache;

    if (this.elementDirect) {
      AudioPlayer.elementDirectPlayers.add(this);
      const elm = this.directAudioElm;
      elm.loop = this.loopFlag;
      elm.removeAttribute('crossorigin');
      elm.src = url;
      this.applyElementVolume();
      elm.addEventListener('ended', this.onEndedBound, { once: true });
      elm.load();
      elm.play().catch(reason => { console.warn(reason); });
      return;
    }

    AudioPlayer.elementDirectPlayers.delete(this);
    this.mediaElementSource.connect(this.getConnectingAudioNode());
    this.audioElm.loop = this.loopFlag;
    this.audioElm.crossOrigin = null;
    this.audioElm.src = url;
    this.applyElementVolume();
    this.audioElm.addEventListener('ended', this.onEndedBound, { once: true });
    this.audioElm.load();
    this.audioElm.play().catch(reason => { console.warn(reason); });
  }

  /** Start playback with fade-in (playbackFactor 0 → 1). */
  playWithFadeIn(audio: AudioFile, durationSec: number, startAt = 0) {
    this.play(audio);
    if (startAt > 0) this.currentTime = startAt;
    if (!(durationSec > 0)) return;
    this.playbackFactor = 0;
    this.applyElementVolume();
    void this.fadePlaybackFactorTo(1, durationSec);
  }

  pause() {
    if (this.elementDirect) {
      this._directAudioElm?.pause();
      return;
    }
    if (this._audioElm) this._audioElm.pause();
  }

  /** Resume after pause (reconnects Web Audio graph if needed). */
  resume() {
    AudioPlayer.ensureContextRunning();
    if (this.elementDirect) {
      void this._directAudioElm?.play().catch(() => {});
      return;
    }
    if (!this._audioElm) return;
    try {
      this.mediaElementSource.connect(this.getConnectingAudioNode());
    } catch { /* already connected */ }
    void this._audioElm.play().catch(() => {});
  }

  stop() {
    this.clearFade();
    this.playbackFactor = 1;
    AudioPlayer.elementDirectPlayers.delete(this);
    this.elementDirect = false;

    if (this._directAudioElm) {
      this._directAudioElm.removeEventListener('ended', this.onEndedBound);
      this._directAudioElm.pause();
      this._directAudioElm.currentTime = 0;
      this._directAudioElm.removeAttribute('src');
      this._directAudioElm.load();
    }

    if (!this._audioElm) return;
    this._audioElm.removeEventListener('ended', this.onEndedBound);
    this._audioElm.pause();
    this._audioElm.currentTime = 0;
    this._audioElm.src = '';
    this._audioElm.load();
    if (this._mediaElementSource) this._mediaElementSource.disconnect();
  }

  /** Fade out then stop. */
  async stopWithFadeOut(durationSec: number): Promise<void> {
    if (!(durationSec > 0) || this.paused) {
      this.stop();
      return;
    }
    await this.fadePlaybackFactorTo(0, durationSec);
    this.stop();
  }

  private getConnectingAudioNode() {
    switch (this.volumeType) {
      case VolumeType.AUDITION:
        return AudioPlayer.auditionNode;
      case VolumeType.SOUND_EFFECT:
        return AudioPlayer.soundEffectNode;
      case VolumeType.SOUNDBOARD:
        return AudioPlayer.soundboardNode;
      case VolumeType.NOTICE:
        return AudioPlayer.noticeNode;
      case VolumeType.AMBIENT:
        return AudioPlayer.ambientNode;
      default:
        return AudioPlayer.rootNode;
    }
  }

  private static async playBufferAsync(audio: AudioFile, volume: number = 1.0) {
    AudioPlayer.playBufferAsyncBase(AudioPlayer.rootNode, audio, volume);
    /*
    let source = await AudioPlayer.createBufferSourceAsync(audio);
    if (!source) return;

    let gain = AudioPlayer.audioContext.createGain();
    gain.gain.setValueAtTime(volume, AudioPlayer.audioContext.currentTime);

    gain.connect(AudioPlayer.rootNode);
    source.connect(gain);

    source.onended = () => {
      source.stop();
      source.disconnect();
      gain.disconnect();
      source.buffer = null;
    };

    source.start();
    */
  }

  private static async playBufferAsyncBase(
    audioNode: AudioNode,
    audio: AudioFile,
    volume: number = 1.0,
    isCancelled?: () => boolean,
    track?: {
      epoch: () => number;
      startEpoch: number;
      voices: { source: AudioBufferSourceNode; gain: GainNode }[];
    },
  ) {
    AudioPlayer.ensureContextRunning();
    let source = await AudioPlayer.createBufferSourceAsync(audio);
    if (!source) return;
    // Re-check after async decode — mute is per-client and may flip while loading.
    if (isCancelled?.() || (track && track.epoch() !== track.startEpoch)) {
      source.buffer = null;
      return;
    }

    let gain = AudioPlayer.audioContext.createGain();
    gain.gain.setValueAtTime(volume, AudioPlayer.audioContext.currentTime);

    gain.connect(audioNode);
    source.connect(gain);

    const voice = track ? { source, gain } : null;
    if (voice) track.voices.push(voice);

    source.onended = () => {
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
      gain.disconnect();
      source.buffer = null;
      if (voice && track) {
        const i = track.voices.indexOf(voice);
        if (i >= 0) track.voices.splice(i, 1);
      }
    };

    source.start();
  }

  private static async createBufferSourceAsync(audio: AudioFile): Promise<AudioBufferSourceNode> {
    if (!audio) return null;
    try {
      let blob = audio.blob;
      if (audio.state === AudioState.URL) {
        if (AudioPlayer.cacheMap.has(audio.identifier)) {
          blob = AudioPlayer.cacheMap.get(audio.identifier).blob;
        } else {
          let cache = await AudioPlayer.createCacheAsync(audio);
          blob = cache && cache.blob ? cache.blob : null;
        }
      }
      if (!blob) return null;
      let decodedData = await this.decodeAudioDataAsync(blob);
      let source = AudioPlayer.audioContext.createBufferSource();
      source.buffer = decodedData;
      return source;
    } catch (reason) {
      console.warn(reason);
      return null;
    }
  }

  private static decodeAudioDataAsync(blob: Blob): Promise<AudioBuffer> {
    return new Promise(async (resolve, reject) => {
      AudioPlayer.audioContext.decodeAudioData(
        await FileReaderUtil.readAsArrayBufferAsync(blob),
        decodedData => resolve(decodedData),
        error => reject(error));
    });
  }

  private static async getBlobAsync(audio: AudioFile): Promise<Blob> {
    if (audio.blob) return audio.blob;
    if (audio.url.length < 1) throw new Error('Invalid audio URL');

    try {
      let response = await fetch(audio.url);
      if (!response.ok) throw new Error('Network response was not ok.');
      let blob = await response.blob();
      return blob;
    } catch (error) {
      console.warn('There has been a problem with your fetch operation: ', error.message);
      throw error;
    }
  }

  private static async createCacheAsync(audio: AudioFile): Promise<AudioCache> {
    let cache = { url: audio.url, blob: null };
    try {
      cache.blob = await AudioPlayer.getBlobAsync(audio);
    } catch (e) {
      // Expected for many remote hosts (no CORS). Playback may still work via element-direct.
      console.warn('Audio cache skipped (CORS or network):', audio.url);
      return cache;
    }

    if (AudioPlayer.cacheMap.has(audio.identifier)) {
      return AudioPlayer.cacheMap.get(audio.identifier);
    }

    cache.url = URL.createObjectURL(cache.blob);
    AudioPlayer.cacheMap.set(audio.identifier, cache);
    return cache;
  }

  /**
   * Browsers block AudioContext until a user gesture. Do not create/resume here —
   * only unlock on the first pointer/key interaction.
   */
  static resumeAudioContext() {
    if (AudioPlayer._unlockBound) return;
    AudioPlayer._unlockBound = true;
    const unlock = () => {
      AudioPlayer.ensureContextRunning();
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('touchstart', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('touchstart', unlock, true);
    document.addEventListener('keydown', unlock, true);
  }

  /** Create context if needed and resume when suspended (call from user gestures / play). */
  static ensureContextRunning() {
    try {
      const ctx = AudioPlayer.audioContext;
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    } catch { /* ignore */ }
  }

  private static _unlockBound = false;
}
