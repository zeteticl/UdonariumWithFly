import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';

import { AudioLibrary, JUKEBOX_AUDIO_DRAG_MIME } from '@udonarium/audio-library';
import { AudioFile } from '@udonarium/core/file-storage/audio-file';
import { AudioStorage } from '@udonarium/core/file-storage/audio-storage';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { Jukebox, MUSIC_HUD_SLOT_COUNT } from '@udonarium/Jukebox';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService } from 'service/context-menu.service';
import { I18nService } from 'service/i18n.service';
import { MobileLayoutService } from 'service/mobile-layout.service';

import * as localForage from 'localforage';

@Component({
  selector: 'music-hud',
  templateUrl: './music-hud.component.html',
  styleUrls: ['./music-hud.component.css'],
  standalone: false
})
export class MusicHudComponent implements OnInit, OnDestroy {
  static readonly VISIBLE_KEY = 'udonanaumu-music-hud-visible';
  static readonly POS_KEY = 'udonanaumu-music-hud-pos';
  static readonly COLLAPSED_KEY = 'udonanaumu-music-hud-collapsed';
  static isVisible = true;

  readonly slotCount = MUSIC_HUD_SLOT_COUNT;
  left = 12;
  /** Placeholder until placeDefaultTopRight(). */
  top = 12;
  /** Default collapsed so bar height matches map-zoom-hud chrome. */
  collapsed = true;
  dropSlotIndex: number | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragging = false;
  private lazyUpdateTimer: ReturnType<typeof setTimeout> = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private positionedDefault = false;
  private mobileSub: { unsubscribe: () => void } | null = null;

  /** Collapsed bar outer height (compact chrome). */
  private static readonly BAR_HEIGHT = 44;
  private static readonly HUD_WIDTH = 220;

  /** Forced off on mobile — use jukebox panel instead. */
  get visible(): boolean {
    return MusicHudComponent.isVisible && !this.mobileLayout.isMobile;
  }
  get isGuest(): boolean { return Network.GuestMode(); }
  get canControl(): boolean { return !this.isGuest; }

  get jukebox(): Jukebox {
    return ObjectStore.instance.get<Jukebox>('Jukebox');
  }

  get slotIndexes(): number[] {
    return Array.from({ length: this.slotCount }, (_, i) => i);
  }

  get libraryAudios(): AudioFile[] {
    return AudioStorage.instance.audios.filter(a => !a.isHidden);
  }

  constructor(
    private changeDetector: ChangeDetectorRef,
    private i18n: I18nService,
    private contextMenuService: ContextMenuService,
    private mobileLayout: MobileLayoutService,
  ) {}

  ngOnInit() {
    this.mobileSub = this.mobileLayout.isMobile$.subscribe(() => this.changeDetector.markForCheck());
    localForage.getItem(MusicHudComponent.VISIBLE_KEY).then(v => {
      if (typeof v === 'boolean') {
        MusicHudComponent.isVisible = v;
        this.changeDetector.markForCheck();
      }
    });
    localForage.getItem<{ left: number; top: number }>(MusicHudComponent.POS_KEY).then(pos => {
      if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
        this.left = pos.left;
        this.top = pos.top;
        this.positionedDefault = true;
        this.clampToViewport();
        this.changeDetector.markForCheck();
      } else {
        this.placeDefaultTopRight();
      }
    });
    localForage.getItem(MusicHudComponent.COLLAPSED_KEY).then(v => {
      if (typeof v === 'boolean') {
        this.collapsed = v;
        this.changeDetector.markForCheck();
      }
    });
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', () => this.lazyNgZoneUpdate())
      .on('UPDATE_AUDIO_RESOURE', () => this.lazyNgZoneUpdate())
      .on('FILE_LOADED', () => this.lazyNgZoneUpdate());
    this.progressTimer = setInterval(() => {
      if (this.slotIndexes.some(i => this.isPlaying(i))) this.changeDetector.markForCheck();
    }, 250);
    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('resize', this.onResize);
  }

  ngOnDestroy() {
    this.mobileSub?.unsubscribe();
    this.mobileSub = null;
    if (this.progressTimer != null) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
    EventSystem.unregister(this);
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('resize', this.onResize);
  }

  static setVisible(v: boolean) {
    MusicHudComponent.isVisible = v;
    localForage.setItem(MusicHudComponent.VISIBLE_KEY, v).catch(() => {});
  }

  trackName(index: number): string {
    if (index === 0) return this.i18n.t('jukebox.trackBgm');
    if (index === 1) return this.i18n.t('jukebox.trackAmbient');
    return this.i18n.t('jukebox.trackN', { n: index + 1 });
  }

  audioAt(index: number): AudioFile {
    return this.jukebox?.audioAt(index) || null;
  }

  displayName(index: number): string {
    const audio = this.audioAt(index);
    if (!audio) return this.i18n.t('musicHud.empty');
    return AudioLibrary.instance.displayName(audio);
  }

  isPlaying(index: number): boolean {
    const t = this.jukebox?.tracks[index];
    return !!(t?.isPlaying && !t?.isPaused);
  }

  trackProgress(index: number): number {
    const t = this.jukebox?.tracks[index];
    if (!t?.isPlaying) return 0;
    if (t.isPaused) return t.currentTime || 0;
    return this.jukebox?.localCurrentTime(index) || t.currentTime || 0;
  }

  trackDuration(index: number): number {
    return this.jukebox?.localDuration(index) || 0;
  }

  seekTrack(index: number, time: number) {
    if (!this.canControl) return;
    this.jukebox?.seekTrack(index, Number(time));
  }

  formatTime(sec: number): string {
    if (!sec || !isFinite(sec)) return '0:00';
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r < 10 ? '0' : ''}${r}`;
  }

  hasAudio(index: number): boolean {
    return !!this.jukebox?.tracks[index]?.audioIdentifier;
  }

  togglePlay(index: number, event?: MouseEvent) {
    if (!this.canControl) return;
    const jb = this.jukebox;
    if (!jb) return;
    const track = jb.tracks[index];
    if (!track?.audioIdentifier) {
      this.openAudioPicker(index, event);
      return;
    }
    jb.toggleTrackPlayback(index);
  }

  /** Playing or paused — keep scrubber / highlight while paused. */
  isTrackActive(index: number): boolean {
    return !!this.jukebox?.tracks[index]?.isPlaying;
  }

  isPaused(index: number): boolean {
    const t = this.jukebox?.tracks[index];
    return !!(t?.isPlaying && t?.isPaused);
  }

  playButtonIcon(index: number): string {
    return this.isPlaying(index) ? 'pause' : 'play_arrow';
  }

  playButtonTitle(index: number): string {
    if (!this.hasAudio(index)) return this.i18n.t('musicHud.pickAudio');
    if (this.isPlaying(index)) return this.i18n.t('jukebox.pause');
    if (this.isPaused(index)) return this.i18n.t('jukebox.resume');
    return this.i18n.t('jukebox.play');
  }

  onNameClick(index: number, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canControl) return;
    this.openAudioPicker(index, event);
  }

  /** Block browser menu on chrome / empty HUD areas (slots open the picker). */
  onHudContextMenu(event: MouseEvent) {
    event.preventDefault();
  }

  /** Right-click: open picker to change assigned music (assign only unless already playing). */
  onSlotContextMenu(index: number, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canControl) return;
    this.openAudioPicker(index, event, false);
  }

  /**
   * @param playOnPick when true, selecting a track also starts playback
   */
  openAudioPicker(index: number, event?: MouseEvent, playOnPick = true) {
    if (!this.canControl || !this.jukebox) return;
    const audios = this.libraryAudios;
    const position = event
      ? { x: event.pageX, y: event.pageY }
      : { x: this.left + 8, y: this.top + 40 };
    const t = (key: string) => this.i18n.t(key);
    const title = `${t('musicHud.pickAudio')} · ${this.trackName(index)}`;

    if (audios.length < 1) {
      this.contextMenuService.open(position, [
        { name: t('jukebox.empty'), disabled: true },
        ContextMenuSeparator,
        { name: t('musicHud.openLibrary'), action: () => this.openLibrary(), materialIcon: 'library_music' },
      ], title);
      return;
    }

    const currentId = this.jukebox.tracks[index]?.audioIdentifier || '';
    const wasPlaying = !!this.jukebox.tracks[index]?.isPlaying;
    const menu: ContextMenuAction[] = audios.map(audio => ({
      name: AudioLibrary.instance.displayName(audio),
      disabled: !audio.isReady,
      default: audio.identifier === currentId,
      materialIcon: audio.identifier === currentId ? 'check' : undefined,
      action: () => this.assignAudio(index, audio, playOnPick || wasPlaying),
    }));

    if (currentId) {
      menu.push(ContextMenuSeparator);
      menu.push({
        name: t('musicHud.clearSlot'),
        materialIcon: 'clear',
        action: () => this.clearSlot(index),
      });
    }

    this.contextMenuService.open(position, menu, title);
  }

  assignAudio(index: number, audio: AudioFile, playNow = false) {
    if (!this.canControl || !this.jukebox || !audio?.isReady) return;
    AudioLibrary.instance.setTrackType(audio.identifier, index);
    if (playNow) {
      const loop = AudioLibrary.instance.effectivePlayLoop(audio.identifier);
      this.jukebox.playTrack(index, audio.identifier, loop);
    } else {
      this.jukebox.setTrackAudio(index, audio.identifier);
    }
  }

  clearSlot(index: number) {
    if (!this.canControl || !this.jukebox) return;
    this.jukebox.clearTrack(index);
  }

  openLibrary() {
    EventSystem.trigger('OPEN_OR_TOGGLE_PANEL', 'JukeboxComponent');
  }

  toggleCollapsed() {
    this.collapsed = !this.collapsed;
    localForage.setItem(MusicHudComponent.COLLAPSED_KEY, this.collapsed).catch(() => {});
  }

  onSlotDragOver(event: DragEvent, index: number) {
    if (!this.canControl || !this.isAudioDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      // Must match jukebox effectAllowed ('copyMove') — 'link' was rejected by browsers.
      event.dataTransfer.dropEffect = event.altKey ? 'copy' : 'move';
    }
    this.dropSlotIndex = index;
  }

  onSlotDragLeave(event: DragEvent, index: number) {
    const related = event.relatedTarget as Node | null;
    const current = event.currentTarget as HTMLElement | null;
    if (current && related && current.contains(related)) return;
    if (this.dropSlotIndex === index) this.dropSlotIndex = null;
  }

  onSlotDrop(event: DragEvent, index: number) {
    if (!this.canControl || !this.isAudioDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const id = (event.dataTransfer?.getData(JUKEBOX_AUDIO_DRAG_MIME)
      || event.dataTransfer?.getData('text/plain')
      || '').trim();
    const playNow = event.altKey;
    this.dropSlotIndex = null;
    if (!id || !this.jukebox) return;
    const audio = AudioStorage.instance.get(id);
    if (!audio?.isReady) return;
    this.assignAudio(index, audio, playNow);
  }

  startDrag(event: PointerEvent) {
    if ((event.target as HTMLElement).closest('button.hud-collapse, button.hud-open, button.slot-play, .slot-name, .mini-plays')) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragging = true;
    this.dragOffsetX = event.clientX - this.left;
    this.dragOffsetY = event.clientY - this.top;
    (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
  }

  private isAudioDrag(event: DragEvent): boolean {
    const types = Array.from(event.dataTransfer?.types || []);
    if (types.includes(JUKEBOX_AUDIO_DRAG_MIME)) return true;
    // Same payload often only exposes text/plain across panels.
    if (types.includes('text/plain') && !types.includes('Files')) return true;
    return false;
  }

  /** Default: top-right corner with a small margin. */
  private placeDefaultTopRight() {
    if (this.positionedDefault) return;
    this.positionedDefault = true;
    const width = MusicHudComponent.HUD_WIDTH;
    const margin = 12;
    this.left = Math.max(margin, window.innerWidth - width - margin);
    this.top = margin;
    this.clampToViewport();
  }

  private onPointerMove = (event: PointerEvent) => {
    if (!this.dragging) return;
    this.left = event.clientX - this.dragOffsetX;
    this.top = event.clientY - this.dragOffsetY;
    this.clampToViewport();
    this.changeDetector.detectChanges();
  };

  private onPointerUp = () => {
    if (!this.dragging) return;
    this.dragging = false;
    this.persistPosition();
  };

  private onResize = () => {
    if (!this.positionedDefault) this.placeDefaultTopRight();
    this.clampToViewport();
    this.changeDetector.markForCheck();
  };

  private clampToViewport() {
    const maxLeft = Math.max(0, window.innerWidth - 48);
    const maxTop = Math.max(0, window.innerHeight - 40);
    this.left = Math.min(maxLeft, Math.max(0, this.left));
    this.top = Math.min(maxTop, Math.max(0, this.top));
  }

  private persistPosition() {
    localForage.setItem(MusicHudComponent.POS_KEY, { left: this.left, top: this.top }).catch(() => {});
  }

  private lazyNgZoneUpdate() {
    if (this.lazyUpdateTimer !== null) return;
    this.lazyUpdateTimer = setTimeout(() => {
      this.lazyUpdateTimer = null;
      this.changeDetector.markForCheck();
    }, 80);
  }
}
