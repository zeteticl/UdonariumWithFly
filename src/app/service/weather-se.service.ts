import { Injectable, OnDestroy } from '@angular/core';

import { Jukebox, JUKEBOX_WEATHER_TRACK } from '@udonarium/Jukebox';
import { GameTable, WeatherType } from '@udonarium/game-table';
import { EventSystem } from '@udonarium/core/system';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { TableSelecter } from '@udonarium/table-selecter';
import { AudioPlayer } from '@udonarium/core/file-storage/audio-player';

import { WeatherLoopPlayer } from './weather-loop-player';

/** Built-in weather loops under assets/audio/weather/ (files optional). */
const WEATHER_SE_PATH: Partial<Record<WeatherType, string>> = {
  rain: 'assets/audio/weather/rain.ogg',
  thunderstorm: 'assets/audio/weather/thunderstorm.ogg',
  wind: 'assets/audio/weather/wind.ogg',
  burning: 'assets/audio/weather/burning.ogg',
  snow: 'assets/audio/weather/snow.ogg',
  sandstorm: 'assets/audio/weather/sandstorm.ogg',
  fog: 'assets/audio/weather/wind.ogg',
  sakura: 'assets/audio/weather/wind.ogg',
  maple: 'assets/audio/weather/wind.ogg',
};

function resolveAssetUrl(relativePath: string): string {
  try {
    return new URL(relativePath, document.baseURI).href;
  } catch {
    return relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  }
}

/**
 * Weather ambience on Jukebox track 5 (index 4).
 * Enable flag + overlap seconds are room-synced via Jukebox; each client plays locally.
 */
@Injectable({ providedIn: 'root' })
export class WeatherSeService implements OnDestroy {
  private lastType: WeatherType | null = null;
  private lastUrl = '';
  private needsUnlockRetry = false;
  private readonly loopPlayer = new WeatherLoopPlayer();

  constructor() {
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', event => {
        const alias = event?.data?.aliasName;
        if (alias === Jukebox.aliasName || (!alias && event?.data?.identifier === 'Jukebox')) {
          this.applyOverlapFromJukebox();
          this.applyVolumeFromJukebox();
          this.syncFromTable();
          return;
        }
        if (alias && alias !== GameTable.aliasName) return;
        this.syncFromTable();
      })
      .on('SELECT_GAME_TABLE', () => this.syncFromTable())
      .on('VIEW_GAME_TABLE', () => this.syncFromTable())
      .on('JUKEBOX_AUDIO_UNLOCKED', () => this.retryAfterUnlock());
    this.syncFromTable();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    this.stop();
  }

  get isEnabled(): boolean {
    const j = this.jukebox();
    if (!j) return true;
    return j.weatherSeEnabled !== false;
  }

  /** True when the local weather loop is currently audible. */
  get isPlaying(): boolean {
    return this.loopPlayer.isPlaying();
  }

  setEnabled(enabled: boolean) {
    this.jukebox()?.setWeatherSeEnabled(!!enabled);
    this.lastType = null;
    this.lastUrl = '';
    this.needsUnlockRetry = false;
    this.syncFromTable();
  }

  /** Current room-synced crossfade seconds (falls back to default). */
  get overlapSec(): number {
    const j = this.jukebox();
    if (j) return j.effectiveOverlapSec(JUKEBOX_WEATHER_TRACK);
    return WeatherLoopPlayer.DEFAULT_OVERLAP_SEC;
  }

  setOverlapSec(sec: number) {
    this.jukebox()?.setWeatherLoopOverlapSec(sec);
    this.applyOverlapFromJukebox();
  }

  syncFromTable() {
    this.applyOverlapFromJukebox();
    this.applyVolumeFromJukebox();
    const table = TableSelecter.instance?.viewTable;
    const type: WeatherType = table?.weatherType || 'none';
    this.applyWeatherType(type);
  }

  private jukebox(): Jukebox | null {
    return ObjectStore.instance.get<Jukebox>('Jukebox') || null;
  }

  private applyOverlapFromJukebox() {
    this.loopPlayer.setOverlapSeconds(this.overlapSec);
  }

  /** Room-synced weather track roomGain (0–1). */
  private weatherRoomGain(): number {
    const g = this.jukebox()?.tracks[JUKEBOX_WEATHER_TRACK]?.roomGain;
    return typeof g === 'number' && isFinite(g) ? Math.max(0, Math.min(1, g)) : 1;
  }

  private applyVolumeFromJukebox() {
    const gain = this.weatherRoomGain();
    this.loopPlayer.setVolume(gain);
    if (gain > 0 && this.needsUnlockRetry && this.lastUrl) {
      this.startPlayback(this.lastUrl);
    }
  }

  private applyWeatherType(type: WeatherType) {
    if (!this.isEnabled || type === 'none') {
      if (this.lastType !== 'none' || this.lastUrl) this.stop();
      this.lastType = 'none';
      this.lastUrl = '';
      this.needsUnlockRetry = false;
      return;
    }
    const path = WEATHER_SE_PATH[type];
    if (!path) {
      if (this.lastUrl) this.stop();
      this.lastType = type;
      this.lastUrl = '';
      this.needsUnlockRetry = false;
      return;
    }
    const url = resolveAssetUrl(path);
    const already =
      this.lastType === type
      && this.lastUrl === url
      && !this.needsUnlockRetry
      && this.loopPlayer.isPlaying();
    if (already) return;

    this.lastType = type;
    this.lastUrl = url;
    this.startPlayback(url);
  }

  private startPlayback(url: string) {
    AudioPlayer.ensureContextRunning();
    try {
      this.jukebox()?.stopBuiltInLocal(JUKEBOX_WEATHER_TRACK);
    } catch { /* ignore */ }

    const roomGain = this.weatherRoomGain();
    if (roomGain <= 0) {
      this.loopPlayer.setVolume(0);
      this.needsUnlockRetry = true;
      return;
    }

    const ok = this.loopPlayer.play(url, roomGain, this.overlapSec);
    this.needsUnlockRetry = !ok;
    window.setTimeout(() => {
      if (!this.isEnabled || this.lastUrl !== url) return;
      this.needsUnlockRetry = !this.loopPlayer.isPlaying();
    }, 250);
  }

  private retryAfterUnlock() {
    if (!this.isEnabled || !this.lastUrl || this.lastType === 'none' || !this.lastType) {
      this.needsUnlockRetry = false;
      return;
    }
    if (!this.needsUnlockRetry && this.loopPlayer.isPlaying()) return;
    this.startPlayback(this.lastUrl);
  }

  private stop() {
    this.loopPlayer.stop();
    try {
      this.jukebox()?.stopBuiltInLocal(JUKEBOX_WEATHER_TRACK);
    } catch { /* ignore */ }
  }
}
