import { Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';

import { AudioLibrary, AudioLibraryFolder, JUKEBOX_AUDIO_DRAG_LIST_MIME, JUKEBOX_AUDIO_DRAG_MIME, SOUNDBOARD_FOLDER_ID } from '@udonarium/audio-library';
import { AudioFile, AudioState } from '@udonarium/core/file-storage/audio-file';
import { probeAudioDurationSec } from '@udonarium/core/file-storage/audio-duration';
import { AudioPlayer, VolumeType } from '@udonarium/core/file-storage/audio-player';
import { AudioStorage } from '@udonarium/core/file-storage/audio-storage';
import { FileArchiver } from '@udonarium/core/file-storage/file-archiver';
import {
  formatJukeboxImportRejectLines,
  JukeboxImportReject,
  partitionJukeboxImportFiles,
} from '@udonarium/core/file-storage/jukebox-import-files';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { Jukebox, JUKEBOX_TRACK_COUNT, JUKEBOX_WEATHER_TRACK, JUKEBOX_TRANSPORT_MAX, SOUNDBOARD_SLOT_COUNT, SOUNDBOARD_MAX_DURATION_SEC, SOUNDBOARD_PAD_COOLDOWN_MS, JukeboxTrackState, SoundboardSlot } from '@udonarium/Jukebox';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { isSoundboardOverDuration, planSoundboardAssign } from '@udonarium/soundboard-assign';
import { ChatWindowComponent } from 'component/chat-window/chat-window.component';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService } from 'service/context-menu.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';
import { I18nService } from 'service/i18n.service';
import { WeatherSeService } from 'service/weather-se.service';

import * as localForage from 'localforage';

const JUKEBOX_REJECT_TOAST_MS = 5000;

@Component({
    selector: 'app-jukebox',
    templateUrl: './jukebox.component.html',
    styleUrls: ['../shared/settings-ui.css', './jukebox.component.css'],
    standalone: false
})
export class JukeboxComponent implements OnInit, OnDestroy {

  readonly trackCount = JUKEBOX_TRACK_COUNT;
  readonly weatherTrackIndex = JUKEBOX_WEATHER_TRACK;
  readonly soundboardMaxDurationSec = SOUNDBOARD_MAX_DURATION_SEC;
  readonly soundboardPadCooldownMs = SOUNDBOARD_PAD_COOLDOWN_MS;
  playTargetTrack = 0;
  /** Formal play mode: true = LOOP, false = once */
  playLoop = true;
  showHelp = false;
  showMixer = true;
  linkError = '';
  expandedFolders: { [folderId: string]: boolean } = { '': true };
  /** HTML5 DnD visual state */
  draggingAudioId: string = '';
  /** Identifiers moved together when dragging a multi-selection. */
  dragAudioIds: string[] = [];
  dropFolderId: string | null = null;
  dropTrackIndex: number | null = null;
  /** Soundboard pad drop highlight. */
  dropPadIndex: number | null = null;
  /** Insert index in folder list (before removal); null = not in reorder mode. */
  dropInsertIndex: number | null = null;
  dropReorderFolderId: string | null = null;
  /** OS file drop target folder (null = none). */
  dropFileFolderId: string | null = null;
  /** Soundboard section (non-pad) is an OS-file / library drop target. */
  dropSoundboardSurface = false;

  /** Non-focusing import-reject notice (auto-clears). */
  rejectToastLines: string[] = [];
  private rejectToastTimer: ReturnType<typeof setTimeout> | null = null;

  /** Library multi-select (Ctrl = toggle, Shift = range). */
  selectedAudioIds = new Set<string>();
  selectionAnchorId: string | null = null;
  /** Folder of the selection anchor (Shift-range stays in one folder). */
  selectionAnchorFolderId: string | null = null;

  @ViewChild('libraryScroll', { static: false }) libraryScroll?: ElementRef<HTMLElement>;

  get selectedCount(): number { return this.selectedAudioIds.size; }

  readonly audioDragMime = JUKEBOX_AUDIO_DRAG_MIME;

  get isMute() { return AudioPlayer.isMute; }
  set isMute(isMute: boolean) {
    AudioPlayer.isMute = isMute;
    AudioPlayer.isAmbientMute = isMute;
    EventSystem.trigger('CHANGE_JUKEBOX_VOLUME', null);
    if (!isMute) {
      localForage.removeItem(AudioPlayer.MAIN_IS_MUTE_LOCAL_STORAGE_KEY).catch(e => console.log(e));
      localForage.removeItem(AudioPlayer.AMBIENT_IS_MUTE_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.MAIN_IS_MUTE_LOCAL_STORAGE_KEY, true).catch(e => console.log(e));
      localForage.setItem(AudioPlayer.AMBIENT_IS_MUTE_LOCAL_STORAGE_KEY, true).catch(e => console.log(e));
    }
  }

  /**
   * Local master for all jukebox music (BGM + ambient tracks + weather).
   * Keeps MASTER and AMBIENT buses in lockstep; per-track roomGain stays relative.
   */
  get musicMasterVolume(): number { return AudioPlayer.volume; }
  set musicMasterVolume(volume: number) {
    const v = Math.max(0, Math.min(1, Number(volume) || 0));
    this.isMute = v === 0;
    AudioPlayer.volume = v;
    AudioPlayer.ambientVolume = v;
    EventSystem.trigger('CHANGE_JUKEBOX_VOLUME', null);
    if (v === 0.5) {
      localForage.removeItem(AudioPlayer.MAIN_VOLUME_LOCAL_STORAGE_KEY).catch(e => console.log(e));
      localForage.removeItem(AudioPlayer.AMBIENT_VOLUME_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.MAIN_VOLUME_LOCAL_STORAGE_KEY, v).catch(e => console.log(e));
      localForage.setItem(AudioPlayer.AMBIENT_VOLUME_LOCAL_STORAGE_KEY, v).catch(e => console.log(e));
    }
  }

  get percentMusicMasterVolume(): number { return Math.floor(this.musicMasterVolume * 100); }

  get isAuditionMute() { return AudioPlayer.isAuditionMute; }
  set isAuditionMute(isAuditionMute: boolean) {
    AudioPlayer.isAuditionMute = isAuditionMute;
    EventSystem.trigger('CHANGE_JUKEBOX_VOLUME', null);
    if (!isAuditionMute) {
      localForage.removeItem(AudioPlayer.AUDITION_IS_MUTE_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.AUDITION_IS_MUTE_LOCAL_STORAGE_KEY, isAuditionMute).catch(e => console.log(e));
    }
  }
  get auditionVolume(): number { return AudioPlayer.auditionVolume; }
  set auditionVolume(auditionVolume: number) {
    this.isAuditionMute = (auditionVolume == 0);
    AudioPlayer.auditionVolume = auditionVolume;
    EventSystem.trigger('CHANGE_JUKEBOX_VOLUME', null);
    if (AudioPlayer.auditionVolume == 0.5) {
      localForage.removeItem(AudioPlayer.AUDITION_VOLUME_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.AUDITION_VOLUME_LOCAL_STORAGE_KEY, auditionVolume).catch(e => console.log(e));
    }
  }

  get isSoundEffectMute() { return AudioPlayer.isSoundEffectMute; }
  set isSoundEffectMute(isSoundEffectMute: boolean) {
    AudioPlayer.isSoundEffectMute = isSoundEffectMute;
    if (!isSoundEffectMute) {
      localForage.removeItem(AudioPlayer.SOUND_EFFECT_IS_MUTE_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.SOUND_EFFECT_IS_MUTE_LOCAL_STORAGE_KEY, isSoundEffectMute).catch(e => console.log(e));
    }
  }
  get soundEffectVolume(): number { return AudioPlayer.soundEffectVolume; }
  set soundEffectVolume(soundEffectVolume: number) {
    this.isSoundEffectMute = (soundEffectVolume == 0);
    AudioPlayer.soundEffectVolume = soundEffectVolume;
    if (AudioPlayer.soundEffectVolume == 0.5) {
      localForage.removeItem(AudioPlayer.SOUND_EFFECT_VOLUME_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.SOUND_EFFECT_VOLUME_LOCAL_STORAGE_KEY, soundEffectVolume).catch(e => console.log(e));
    }
  }

  get isSoundboardMute() { return AudioPlayer.isSoundboardMute; }
  set isSoundboardMute(isSoundboardMute: boolean) {
    AudioPlayer.isSoundboardMute = isSoundboardMute;
    if (!isSoundboardMute) {
      localForage.removeItem(AudioPlayer.SOUNDBOARD_IS_MUTE_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.SOUNDBOARD_IS_MUTE_LOCAL_STORAGE_KEY, isSoundboardMute).catch(e => console.log(e));
    }
  }
  get soundboardVolume(): number { return AudioPlayer.soundboardVolume; }
  set soundboardVolume(soundboardVolume: number) {
    this.isSoundboardMute = (soundboardVolume == 0);
    AudioPlayer.soundboardVolume = soundboardVolume;
    if (AudioPlayer.soundboardVolume == 0.5) {
      localForage.removeItem(AudioPlayer.SOUNDBOARD_VOLUME_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.SOUNDBOARD_VOLUME_LOCAL_STORAGE_KEY, soundboardVolume).catch(e => console.log(e));
    }
  }

  get isNoticeMute() { return AudioPlayer.isNoticeMute; }
  set isNoticeMute(isNoticeMute: boolean) {
    AudioPlayer.isNoticeMute = isNoticeMute;
    // Keep chat toolbar notice toggle in sync.
    ChatWindowComponent.isNoticeOn = !isNoticeMute;
    localForage.setItem(ChatWindowComponent.CHAT_IS_NOTICE_ON_LOCAL_STORAGE_KEY, !isNoticeMute).catch(e => console.log(e));
    if (!isNoticeMute) {
      localForage.removeItem(AudioPlayer.NOTICE_IS_MUTE_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.NOTICE_IS_MUTE_LOCAL_STORAGE_KEY, isNoticeMute).catch(e => console.log(e));
    }
  }
  get noticeVolume(): number { return AudioPlayer.noticeVolume; }
  set noticeVolume(noticeVolume: number) {
    this.isNoticeMute = (noticeVolume == 0);
    AudioPlayer.noticeVolume = noticeVolume;
    if (AudioPlayer.noticeVolume == 0.5) {
      localForage.removeItem(AudioPlayer.NOTICE_VOLUME_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(AudioPlayer.NOTICE_VOLUME_LOCAL_STORAGE_KEY, noticeVolume).catch(e => console.log(e));
    }
  }

  get audios(): AudioFile[] { return AudioStorage.instance.audios.filter(audio => !audio.isHidden); }
  get library(): AudioLibrary { return AudioLibrary.instance; }
  get folders(): AudioLibraryFolder[] { return this.library.folders; }
  get jukebox(): Jukebox { return ObjectStore.instance.get<Jukebox>('Jukebox'); }
  get tracks(): JukeboxTrackState[] { return this.jukebox?.tracks || []; }

  get trackIndexes(): number[] {
    return Array.from({ length: JUKEBOX_TRACK_COUNT }, (_, i) => i);
  }

  get percentAuditionVolume(): number { return Math.floor(this.auditionVolume * 100); }
  set percentAuditionVolume(percentAuditionVolume: number) { this.auditionVolume = percentAuditionVolume / 100; }
  get percentSoundEffectVolume(): number { return Math.floor(this.soundEffectVolume * 100); }
  set percentSoundEffectVolume(percentSoundEffectVolume: number) { this.soundEffectVolume = percentSoundEffectVolume / 100; }
  get percentSoundboardVolume(): number { return Math.floor(this.soundboardVolume * 100); }
  set percentSoundboardVolume(percentSoundboardVolume: number) { this.soundboardVolume = percentSoundboardVolume / 100; }
  get percentNoticeVolume(): number { return Math.floor(this.noticeVolume * 100); }
  set percentNoticeVolume(percentNoticeVolume: number) { this.noticeVolume = percentNoticeVolume / 100; }

  readonly auditionPlayer: AudioPlayer = new AudioPlayer();
  private lazyUpdateTimer: NodeJS.Timeout = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private readonly musicTestPlayer: AudioPlayer = new AudioPlayer();
  private readonly auditionTestPlayer: AudioPlayer = new AudioPlayer();
  private readonly soundTestPlayer: AudioPlayer = new AudioPlayer();
  private readonly soundboardTestPlayer: AudioPlayer = new AudioPlayer();
  private readonly noticeTestPlayer: AudioPlayer = new AudioPlayer();
  /** Capture-phase DnD so OS file drops cannot fall through to the browser / body FileArchiver. */
  private readonly onHostDragOverCapture = (event: DragEvent) => this.handleHostDragOverCapture(event);
  private readonly onHostDropCapture = (event: DragEvent) => this.handleHostDropCapture(event);

  constructor(
    private modalService: ModalService,
    private panelService: PanelService,
    private ngZone: NgZone,
    private contextMenuService: ContextMenuService,
    private i18n: I18nService,
    private hostRef: ElementRef<HTMLElement>,
    private weatherSe: WeatherSeService,
  ) {
    this.musicTestPlayer.volumeType = VolumeType.MASTER;
    this.auditionTestPlayer.volumeType = VolumeType.AUDITION;
    this.soundTestPlayer.volumeType = VolumeType.SOUND_EFFECT;
    this.soundboardTestPlayer.volumeType = VolumeType.SOUNDBOARD;
    this.noticeTestPlayer.volumeType = VolumeType.NOTICE;
  }

  GuestMode() {
    return Network.GuestMode();
  }

  trackName(index: number): string {
    if (index === 0) return this.i18n.t('jukebox.trackBgm');
    if (index === 1) return this.i18n.t('jukebox.trackAmbient');
    if (index === 4) return this.i18n.t('jukebox.trackWeather');
    return this.i18n.t('jukebox.trackN', { n: index + 1 });
  }

  trackAudio(index: number): AudioFile {
    return this.jukebox?.audioAt(index);
  }

  trackDisplayName(index: number): string {
    const audio = this.trackAudio(index);
    if (audio) return this.displayName(audio);
    const id = this.tracks[index]?.audioIdentifier;
    return this.tracks[index]?.label || id || '';
  }

  onPlayTrackClick(index: number) {
    const audio = this.trackAudio(index);
    if (!audio) return;
    this.playOrResumeTrack(index, audio);
  }

  displayName(audio: AudioFile): string {
    return this.library.displayName(audio);
  }

  audiosIn(folderId: string): AudioFile[] {
    return this.library.audiosInFolder(folderId || '', this.audios);
  }

  isFolderExpanded(folderId: string): boolean {
    return this.expandedFolders[folderId || ''] !== false;
  }

  toggleFolder(folderId: string) {
    const key = folderId || '';
    this.expandedFolders[key] = !this.isFolderExpanded(key);
  }

  trackRoomGainPercent(index: number): number {
    return Math.floor((this.tracks[index]?.roomGain ?? 1) * 100);
  }

  setTrackRoomGainPercent(index: number, percent: number) {
    if (this.GuestMode()) return;
    this.jukebox?.setTrackRoomGain(index, percent / 100);
  }

  get weatherOverlapSec(): number {
    return this.weatherSe.overlapSec;
  }

  setWeatherOverlapSec(sec: number) {
    if (this.GuestMode()) return;
    this.weatherSe.setOverlapSec(Number(sec));
  }

  fadeSecOf(index: number): number {
    return this.jukebox?.effectiveFadeSec(index) ?? 2.5;
  }

  overlapSecOf(index: number): number {
    return this.jukebox?.effectiveOverlapSec(index)
      ?? (index === this.weatherTrackIndex ? this.weatherOverlapSec : 2.5);
  }

  formatFadeSec(sec: number): string {
    const n = Math.round((sec || 0) * 10) / 10;
    return `${n}${this.i18n.t('jukebox.trackFadeUnit')}`;
  }

  fadePanelHint(index: number): string {
    return index === this.weatherTrackIndex
      ? this.i18n.t('jukebox.weatherOverlapHint')
      : this.i18n.t('jukebox.trackFadeHint');
  }

  setFadeSecOf(index: number, sec: number) {
    if (this.GuestMode()) return;
    this.jukebox?.setTrackFadeSecAt(index, Number(sec));
  }

  setOverlapSecOf(index: number, sec: number) {
    if (this.GuestMode()) return;
    this.jukebox?.setTrackOverlapSecAt(index, Number(sec));
  }

  get weatherSePlaying(): boolean {
    return this.weatherSe.isEnabled && this.weatherSe.isPlaying;
  }

  /** Stable pad list — never return a fresh array each CD (that remounts *ngFor and breaks DnD). */
  private soundboardSlotsCache: SoundboardSlot[] = Array.from(
    { length: SOUNDBOARD_SLOT_COUNT },
    () => ({ audioIdentifier: '', label: '' }),
  );
  private soundboardSlotsJsonSeen = '\0';
  /** Cached clip durations (seconds) keyed by audio identifier. */
  private readonly padDurationById = new Map<string, number>();
  /** Earliest performance.now() when each pad may fire again. */
  private readonly padClickReadyAt: number[] = Array.from({ length: SOUNDBOARD_SLOT_COUNT }, () => 0);

  get soundboardSlots(): SoundboardSlot[] {
    this.syncSoundboardSlotsCache();
    return this.soundboardSlotsCache;
  }

  private syncSoundboardSlotsCache() {
    const json = this.jukebox?.soundboardJson ?? '';
    if (json === this.soundboardSlotsJsonSeen) return;
    this.soundboardSlotsJsonSeen = json;
    try {
      this.soundboardSlotsCache = this.jukebox?.soundboard
        ?? Array.from({ length: SOUNDBOARD_SLOT_COUNT }, () => ({ audioIdentifier: '', label: '' }));
    } catch {
      this.soundboardSlotsCache = Array.from(
        { length: SOUNDBOARD_SLOT_COUNT },
        () => ({ audioIdentifier: '', label: '' }),
      );
    }
    for (const slot of this.soundboardSlotsCache) {
      if (slot.audioIdentifier) this.ensurePadDuration(slot.audioIdentifier);
    }
  }

  private ensurePadDuration(audioId: string) {
    if (!audioId || this.padDurationById.has(audioId)) return;
    const audio = AudioStorage.instance.get(audioId);
    if (!audio?.url) return;
    this.padDurationById.set(audioId, 0);
    void probeAudioDurationSec(audio).then(sec => {
      if (!(sec > 0)) return;
      this.padDurationById.set(audioId, sec);
      this.ngZone.run(() => { });
    });
  }

  trackPadIndex(index: number, _slot?: SoundboardSlot): number {
    return index;
  }

  playOrResumeTrack(index: number, audio: AudioFile) {
    if (this.GuestMode() || !this.jukebox || index > JUKEBOX_TRANSPORT_MAX) return;
    const t = this.tracks[index];
    if (t?.isPlaying && t.isPaused) {
      this.jukebox.resumeTrack(index);
      return;
    }
    if (t?.isPlaying && !t.isPaused) return;
    if (audio) this.assignAndPlay(audio, index);
  }

  pauseTrack(index: number) {
    if (this.GuestMode()) return;
    this.jukebox?.pauseTrack(index);
  }

  trackProgress(index: number): number {
    const t = this.tracks[index];
    if (!t?.isPlaying) return 0;
    if (t.isPaused) return t.currentTime || 0;
    return this.jukebox?.localCurrentTime(index) || t.currentTime || 0;
  }

  trackDuration(index: number): number {
    return this.jukebox?.localDuration(index) || 0;
  }

  seekTrack(index: number, time: number) {
    if (this.GuestMode()) return;
    this.jukebox?.seekTrack(index, Number(time));
  }

  formatTime(sec: number): string {
    if (!sec || !isFinite(sec)) return '0:00';
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r < 10 ? '0' : ''}${r}`;
  }

  padDisplayName(index: number): string {
    const slot = this.soundboardSlots[index];
    if (!slot?.audioIdentifier) return this.i18n.t('jukebox.soundboardEmpty');
    const audio = AudioStorage.instance.get(slot.audioIdentifier);
    // Prefer live library name so renames in the soundboard folder stay in sync.
    if (audio) return this.displayName(audio);
    return slot.label || slot.audioIdentifier;
  }

  padDurationSec(index: number): number {
    const id = this.soundboardSlots[index]?.audioIdentifier;
    if (!id) return 0;
    this.ensurePadDuration(id);
    return this.padDurationById.get(id) || 0;
  }

  padDurationLabel(index: number): string {
    if (!this.soundboardSlots[index]?.audioIdentifier) return '';
    const sec = this.padDurationSec(index);
    if (!(sec > 0)) return '…';
    const n = Math.round(sec * 10) / 10;
    return `${n}${this.i18n.t('jukebox.trackFadeUnit')}`;
  }

  padTitle(index: number): string {
    const slot = this.soundboardSlots[index];
    if (!slot?.audioIdentifier) return this.i18n.t('jukebox.soundboardDropHint');
    const name = this.padDisplayName(index);
    const dur = this.padDurationLabel(index);
    return dur && dur !== '…' ? `${name} · ${dur}` : name;
  }

  triggerPad(index: number) {
    if (index < 0 || index >= SOUNDBOARD_SLOT_COUNT) return;
    const now = performance.now();
    if (now < this.padClickReadyAt[index]) return;
    const slot = this.soundboardSlots[index];
    if (!slot?.audioIdentifier) return;
    const audio = AudioStorage.instance.get(slot.audioIdentifier);
    if (!audio?.isReady) return;
    this.padClickReadyAt[index] = now + this.soundboardPadCooldownMs;
    AudioPlayer.ensureContextRunning();
    // Guests may fire pads for themselves; room broadcast stays for non-guests.
    if (this.GuestMode()) SoundEffect.playPadLocal(audio);
    else SoundEffect.playPad(audio);
  }

  onPadClick(event: MouseEvent, index: number) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('.jb-pad-clear')) return;
    event.preventDefault();
    this.triggerPad(index);
  }

  stopSoundboardPads(event?: Event) {
    event?.preventDefault();
    event?.stopPropagation();
    // Guests silence themselves; room hosts broadcast a hard stop to everyone.
    if (this.GuestMode()) SoundEffect.stopPadsLocal();
    else SoundEffect.stopPads();
  }

  @HostListener('contextmenu', ['$event'])
  onHostContextMenu(event: MouseEvent) {
    // Suppress the browser menu; library rows/folders open the app menu themselves.
    event.preventDefault();
  }

  clearPad(index: number, event?: Event) {
    event?.stopPropagation();
    if (this.GuestMode()) return;
    this.jukebox?.clearSoundboardSlot(index);
  }

  onSoundboardDragOver(event: DragEvent) {
    if (!this.claimSoundboardDrag(event)) return;
    this.updateSoundboardDropHighlight(event.clientX, event.clientY);
  }

  onSoundboardDragLeave(event: DragEvent) {
    const related = event.relatedTarget as HTMLElement | null;
    if (related?.closest?.('.jb-soundboard')) return;
    this.dropSoundboardSurface = false;
    this.dropPadIndex = null;
  }

  onSoundboardDrop(event: DragEvent) {
    const index = this.resolveSoundboardDropIndex(event);
    if (this.isFileLikeDrag(event) || event.dataTransfer?.files?.length) {
      void this.acceptOsFileDropToPad(event, index);
      return;
    }
    if (this.GuestMode()) {
      event.preventDefault();
      event.stopPropagation();
      this.clearDropState();
      return;
    }
    if (!this.isAudioDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const ids = this.readDragAudioIds(event);
    this.clearDropState();
    if (ids.length < 1) return;
    void this.assignManyToSoundboard(index, ids);
  }

  /**
   * Always preventDefault for file/audio drags over the soundboard so the browser
   * never navigates / opens the file. Returns false when this is not a claimable drag.
   */
  private claimSoundboardDrag(event: DragEvent): boolean {
    const fileLike = this.isFileLikeDrag(event);
    const audioLike = this.isAudioDrag(event);
    if (!fileLike && !audioLike) return false;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    return !this.GuestMode();
  }

  private updateSoundboardDropHighlight(clientX: number, clientY: number) {
    const at = this.resolvePadIndexAtPoint(clientX, clientY);
    if (at != null) {
      if (this.dropPadIndex !== at) this.dropPadIndex = at;
      if (this.dropSoundboardSurface) this.dropSoundboardSurface = false;
    } else {
      if (this.dropPadIndex !== null) this.dropPadIndex = null;
      if (!this.dropSoundboardSurface) this.dropSoundboardSurface = true;
    }
  }

  /**
   * Hit-test by pointer geometry (not event.target — drag ghosts / capture skew target).
   * Inside the pad grid (including gaps), pick the nearest pad; header/surface → null.
   */
  private resolvePadIndexAtPoint(clientX: number, clientY: number): number | null {
    const host = this.hostRef?.nativeElement as HTMLElement | undefined;
    if (!host) return null;
    const grid = host.querySelector('.jb-soundboard .jb-pad-grid') as HTMLElement | null;
    const pads = host.querySelectorAll('.jb-soundboard .jb-pad');
    if (!pads.length) return null;

    for (let i = 0; i < pads.length; i++) {
      const r = pads[i].getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom) {
        return i;
      }
    }

    if (!grid) return null;
    const g = grid.getBoundingClientRect();
    if (clientX < g.left || clientX >= g.right || clientY < g.top || clientY >= g.bottom) {
      return null;
    }

    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pads.length; i++) {
      const r = pads[i].getBoundingClientRect();
      const cx = Math.min(Math.max(clientX, r.left), r.right);
      const cy = Math.min(Math.max(clientY, r.top), r.bottom);
      const dx = clientX - cx;
      const dy = clientY - cy;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  /** Prefer live pointer position; fall back to last highlight, then pad 0 (surface). */
  private resolveSoundboardDropIndex(event: DragEvent): number {
    return this.resolvePadIndexAtPoint(event.clientX, event.clientY)
      ?? this.dropPadIndex
      ?? 0;
  }

  private ensureSoundboardFolder(): AudioLibraryFolder {
    return this.library.ensureFolder(SOUNDBOARD_FOLDER_ID, this.i18n.t('jukebox.soundboard'));
  }

  private assignToSoundboard(index: number, audioId: string, label = '') {
    if (!this.jukebox || !audioId) return;
    const folder = this.ensureSoundboardFolder();
    this.library.ensureListed(audioId, folder.id);
    this.expandedFolders[folder.id] = true;
    this.jukebox.setSoundboardSlot(index, audioId, label);
    this.soundboardSlotsJsonSeen = '\0';
    this.syncSoundboardSlotsCache();
  }

  /**
   * Place ids on consecutive pads starting at `startIndex`, replacing whatever is there.
   * Clips longer than SOUNDBOARD_MAX_DURATION_SEC prompt once for OVER (allow onto pads).
   * Declining OVER → skip those files (no pad, no folder move). Leftovers past slot 8 → folder only.
   * Multi-file drops keep order; one confirm covers all over-limit files in the batch.
   */
  private async assignManyToSoundboard(startIndex: number, ids: string[]) {
    if (!this.jukebox || this.GuestMode() || ids.length < 1) return;
    let pad = Math.max(0, Math.min(startIndex, SOUNDBOARD_SLOT_COUNT - 1));
    const maxSec = SOUNDBOARD_MAX_DURATION_SEC;

    const candidates: { id: string; audio: AudioFile; duration: number; over: boolean }[] = [];
    for (const id of ids) {
      const audio = AudioStorage.instance.get(id);
      if (!audio?.isReady) continue;
      const duration = await probeAudioDurationSec(audio);
      if (duration > 0) this.padDurationById.set(id, duration);
      candidates.push({
        id,
        audio,
        duration,
        over: isSoundboardOverDuration(duration, maxSec),
      });
    }
    if (!candidates.length) return;

    const overList = candidates.filter(c => c.over);
    let allowOver = false;
    if (overList.length) {
      const names = overList.map(c => {
        const dur = c.duration > 0
          ? ` (${Math.round(c.duration * 10) / 10}${this.i18n.t('jukebox.trackFadeUnit')})`
          : '';
        return `${this.displayName(c.audio)}${dur}`;
      }).join('\n');
      const confirmed = await this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('jukebox.soundboardOverConfirmTitle'),
        text: this.i18n.t('jukebox.soundboardOverConfirm', {
          max: maxSec,
          count: overList.length,
          names,
        }),
        materialIcon: 'timer',
        type: ConfirmationType.OK_CANCEL,
        okLabel: this.i18n.t('jukebox.soundboardOverConfirmOk'),
        cancelLabel: this.i18n.t('confirm.cancel'),
      });
      allowOver = confirmed === true;
    }

    const plan = planSoundboardAssign(
      candidates.map(c => ({ id: c.id, over: c.over })),
      allowOver,
      pad,
      SOUNDBOARD_SLOT_COUNT,
    );
    const byId = new Map(candidates.map(c => [c.id, c]));
    for (const action of plan) {
      if (action.type === 'skip') continue;
      const c = byId.get(action.id);
      if (!c) continue;
      if (action.type === 'folder') {
        const folder = this.ensureSoundboardFolder();
        this.library.ensureListed(c.id, folder.id);
        this.expandedFolders[folder.id] = true;
        continue;
      }
      this.assignToSoundboard(action.pad, c.id, this.displayName(c.audio));
    }
  }

  private async acceptOsFileDropToPad(event: DragEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer?.files;
    this.clearDropState();
    if (!files?.length || this.GuestMode()) return;
    // Import to library root first; assignMany moves confirmed clips into the soundboard folder.
    // Avoid pre-listing into the soundboard folder so Cancel on OVER can abort with no move.
    const beforeAll = new Set(AudioStorage.instance.audios.map(a => a.identifier));
    await this.importFilesToFolder('', files);
    const newlyStored = AudioStorage.instance.audios
      .map(a => a.identifier)
      .filter(id => !beforeAll.has(id));
    if (newlyStored.length) void this.assignManyToSoundboard(index, newlyStored);
  }

  ngOnInit() {
    Promise.resolve().then(() => this.refreshPanelTitle());
    this.auditionPlayer.volumeType = VolumeType.AUDITION;
    this.progressTimer = setInterval(() => {
      const playing = this.tracks.some((t, i) => i <= 3 && t?.isPlaying && !t?.isPaused);
      if (playing) this.ngZone.run(() => { });
    }, 250);
    EventSystem.register(this)
      .on('*', event => {
        if (event.eventName.startsWith('FILE_') || event.eventName.startsWith('UPDATE_GAME_OBJECT')) this.lazyNgZoneUpdate();
      })
      .on('LOCALE_CHANGED', () => this.refreshPanelTitle());
    const host = this.hostRef?.nativeElement;
    if (host) {
      host.addEventListener('dragover', this.onHostDragOverCapture, true);
      host.addEventListener('drop', this.onHostDropCapture, true);
    }
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    if (this.progressTimer != null) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
    if (this.rejectToastTimer != null) {
      clearTimeout(this.rejectToastTimer);
      this.rejectToastTimer = null;
    }
    const host = this.hostRef?.nativeElement;
    if (host) {
      host.removeEventListener('dragover', this.onHostDragOverCapture, true);
      host.removeEventListener('drop', this.onHostDropCapture, true);
    }
    this.stop();
  }

  /** Capture: keep browser from navigating even if a child forgot preventDefault. */
  private handleHostDragOverCapture(event: DragEvent) {
    if (!this.isFileLikeDrag(event) && !this.isAudioDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    const target = event.target as HTMLElement | null;
    const overBoard = !!target?.closest?.('.jb-soundboard');
    if (!overBoard) {
      if (this.dropPadIndex != null || this.dropSoundboardSurface) {
        this.ngZone.run(() => {
          this.dropPadIndex = null;
          this.dropSoundboardSurface = false;
        });
      }
      return;
    }
    if (this.GuestMode()) return;
    this.ngZone.run(() => this.updateSoundboardDropHighlight(event.clientX, event.clientY));
  }

  /**
   * Capture drop over the soundboard claims the event before body FileArchiver.
   * Index comes from pointer geometry, not event.target.
   */
  private handleHostDropCapture(event: DragEvent) {
    const target = event.target as HTMLElement | null;
    if (!target?.closest?.('.jb-soundboard')) return;
    const fileLike = this.isFileLikeDrag(event) || !!(event.dataTransfer?.files?.length);
    const audioLike = this.isAudioDrag(event);
    if (!fileLike && !audioLike) return;

    event.preventDefault();
    event.stopPropagation();
    if (this.GuestMode()) {
      this.clearDropState();
      return;
    }

    const index = this.resolveSoundboardDropIndex(event);

    this.ngZone.run(() => {
      if (fileLike) void this.acceptOsFileDropToPad(event, index);
      else {
        const ids = this.readDragAudioIds(event);
        this.clearDropState();
        if (ids.length) void this.assignManyToSoundboard(index, ids);
      }
    });
  }

  play(audio: AudioFile) {
    if (this.GuestMode()) return;
    this.auditionPlayer.play(audio);
  }

  stop() {
    if (this.GuestMode()) return;
    this.auditionPlayer.stop();
  }

  isAuditionPlaying(audio: AudioFile): boolean {
    return !!audio && this.auditionPlayer?.audio === audio && !this.auditionPlayer?.paused;
  }

  toggleAudition(audio: AudioFile, event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.GuestMode() || !audio) return;
    if (this.isAuditionPlaying(audio)) this.stop();
    else this.play(audio);
  }

  /** Effective track for UI: audio override > folder default. */
  trackTypeOf(audio: AudioFile, folderId?: string): number {
    if (!audio) return 0;
    return this.library.effectiveTrackType(audio.identifier, folderId) % this.trackCount;
  }

  hasOwnTrackType(audio: AudioFile, folderId?: string): boolean {
    return !!audio && this.library.hasTrackType(audio.identifier, folderId);
  }

  isPlayingOnTrack(audio: AudioFile): boolean {
    return !!audio && !!this.jukebox?.isAnyTrackPlayingAudio(audio);
  }

  /** True when this audio is actively playing (not paused) on any track. */
  isActivelyPlayingOnTrack(audio: AudioFile): boolean {
    if (!audio || !this.jukebox) return false;
    return this.tracks.some(
      t => t.isPlaying && !t.isPaused && t.audioIdentifier === audio.identifier,
    );
  }

  isPausedOnTrack(audio: AudioFile): boolean {
    if (!audio || !this.jukebox) return false;
    return this.tracks.some(
      t => t.isPlaying && t.isPaused && t.audioIdentifier === audio.identifier,
    );
  }

  libraryPlayIcon(audio: AudioFile): string {
    return this.isActivelyPlayingOnTrack(audio) ? 'pause' : 'play_arrow';
  }

  libraryPlayTitle(audio: AudioFile): string {
    if (this.isActivelyPlayingOnTrack(audio)) return this.i18n.t('jukebox.pause');
    if (this.isPausedOnTrack(audio)) return this.i18n.t('jukebox.resume');
    return this.i18n.t('jukebox.play');
  }

  isPlayLoop(audio: AudioFile, folderId?: string): boolean {
    if (!audio) return true;
    return this.library.effectivePlayLoop(audio.identifier, folderId);
  }

  hasOwnPlayLoop(audio: AudioFile, folderId?: string): boolean {
    return !!audio && this.library.hasPlayLoop(audio.identifier, folderId);
  }

  folderTrackType(folderId: string): number {
    return this.library.folderTrackType(folderId || '') % this.trackCount;
  }

  trackShortName(index: number): string {
    if (index === 0) return 'BGM';
    if (index === 1) return 'Amb';
    return String(index + 1);
  }

  /** Cycle this audio's track override only (does not put it on a track). */
  cycleTrackType(audio: AudioFile, folderId: string, event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.GuestMode() || !audio) return;
    let next = (this.trackTypeOf(audio, folderId) + 1) % this.trackCount;
    if (next === JUKEBOX_WEATHER_TRACK) next = (next + 1) % this.trackCount;
    this.library.setTrackType(audio.identifier, next, folderId || '');
  }

  cycleFolderTrackType(folderId: string, event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.GuestMode()) return;
    let next = (this.folderTrackType(folderId) + 1) % this.trackCount;
    if (next === JUKEBOX_WEATHER_TRACK) next = (next + 1) % this.trackCount;
    this.library.setFolderTrackType(folderId || '', next);
    this.ngZone.run(() => { });
  }

  togglePlayMode(audio: AudioFile, folderId: string, event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.GuestMode() || !audio) return;
    this.library.setPlayLoop(audio.identifier, !this.isPlayLoop(audio, folderId), folderId || '');
  }

  /** Put this audio on its effective track and play (or pause / resume if already on a track). */
  toggleLibraryPlay(audio: AudioFile, folderId: string, event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.GuestMode() || !audio || !this.jukebox) return;
    const tracks = this.tracks;
    let matched = false;
    for (let i = 0; i < tracks.length; i++) {
      if (!tracks[i].isPlaying || tracks[i].audioIdentifier !== audio.identifier) continue;
      matched = true;
      this.jukebox.toggleTrackPlayback(i);
    }
    if (matched) return;
    const track = this.trackTypeOf(audio, folderId);
    const loop = this.isPlayLoop(audio, folderId);
    this.jukebox.playTrack(track, audio.identifier, loop);
  }

  playFormal(audio: AudioFile, folderId?: string) {
    if (this.GuestMode() || !audio || !this.jukebox) return;
    const fid = folderId != null ? folderId : this.library.folderOf(audio.identifier);
    this.jukebox.playTrack(this.trackTypeOf(audio, fid), audio.identifier, this.isPlayLoop(audio, fid));
  }

  assignToTrack(audio: AudioFile, trackIndex?: number, event?: Event) {
    event?.stopPropagation();
    if (this.GuestMode() || !audio || !this.jukebox) return;
    const index = trackIndex != null ? trackIndex : this.trackTypeOf(audio);
    this.library.setTrackType(audio.identifier, index);
    this.jukebox.setTrackAudio(index, audio.identifier);
  }

  assignAndPlay(audio: AudioFile, trackIndex?: number) {
    if (this.GuestMode() || !audio || !this.jukebox) return;
    const index = trackIndex != null ? trackIndex : this.trackTypeOf(audio);
    this.library.setTrackType(audio.identifier, index);
    this.jukebox.playTrack(index, audio.identifier, this.isPlayLoop(audio));
  }

  toggleTrackSlot(index: number, audio: AudioFile) {
    if (this.GuestMode() || !this.jukebox) return;
    if (this.tracks[index]?.isPlaying) {
      this.jukebox.toggleTrackPlayback(index);
    } else if (audio) {
      this.assignAndPlay(audio, index);
    }
  }

  stopBGM(audio: AudioFile) {
    if (this.GuestMode()) return;
    const tracks = this.tracks;
    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i].isPlaying && tracks[i].audioIdentifier === audio.identifier) {
        this.jukebox.stopTrack(i);
      }
    }
  }

  stopTrack(index: number) {
    if (this.GuestMode()) return;
    this.jukebox?.stopTrack(index);
  }

  stopAllTracks() {
    if (this.GuestMode()) return;
    this.jukebox?.stopAll();
  }

  createFolder() {
    if (this.GuestMode()) return;
    const name = window.prompt(this.i18n.t('jukebox.folderNamePrompt'), this.i18n.t('jukebox.folderDefaultName'));
    if (name == null) return;
    const folder = this.library.createFolder(name);
    this.expandedFolders[folder.id] = true;
  }

  /** Toggle folder order mode: shuffle vs sequential (same pattern as LOOP). */
  toggleFolderShuffleMode(folderId: string, event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.GuestMode()) return;
    const fid = folderId || '';
    this.library.setFolderShuffle(fid, !this.folderShuffle(fid));
    this.ngZone.run(() => { });
  }

  /** Play / pause / resume folder queue using folder shuffle preference. */
  playFolderQueue(folderId: string, event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.GuestMode() || !this.jukebox) return;
    const fid = folderId || '';
    const track = this.folderTrackType(fid);
    if (this.isFolderPlaying(fid)) {
      this.jukebox.toggleTrackPlayback(track);
      this.ngZone.run(() => { });
      return;
    }
    const ids = this.audiosIn(fid).filter(a => a.isReady).map(a => a.identifier);
    if (ids.length < 1) return;
    const shuffle = this.folderShuffle(fid);
    const mode = shuffle ? 'shuffle-loop' as const : 'queue-loop' as const;
    this.jukebox.playQueue(track, ids, mode);
    this.ngZone.run(() => { });
  }

  /** @deprecated use playFolderQueue */
  playFolderShuffleLoop(folderId: string, event?: Event) {
    this.playFolderQueue(folderId, event);
  }

  isFolderPlaying(folderId: string): boolean {
    if (!this.jukebox) return false;
    const trackIndex = this.folderTrackType(folderId);
    const t = this.tracks[trackIndex];
    if (!t?.isPlaying) return false;
    const inFolder = new Set(this.audiosIn(folderId || '').map(a => a.identifier));
    if (t.audioIdentifier && inFolder.has(t.audioIdentifier)) return true;
    return Array.isArray(t.queue) && t.queue.length > 0 && t.queue.every(id => inFolder.has(id));
  }

  isFolderActivelyPlaying(folderId: string): boolean {
    if (!this.isFolderPlaying(folderId)) return false;
    const t = this.tracks[this.folderTrackType(folderId)];
    return !!(t && !t.isPaused);
  }

  folderPlayIcon(folderId: string): string {
    return this.isFolderActivelyPlaying(folderId) ? 'pause' : 'play_arrow';
  }

  folderPlayTitle(folderId: string): string {
    if (this.isFolderActivelyPlaying(folderId)) return this.i18n.t('jukebox.pause');
    if (this.isFolderPlaying(folderId)) return this.i18n.t('jukebox.resume');
    return this.i18n.t('jukebox.folderPlayQueue');
  }

  folderShuffle(folderId: string): boolean {
    return this.library.folderShuffle(folderId || '');
  }

  handleFolderFileSelect(event: Event, folderId: string) {
    if (this.GuestMode()) return;
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (files?.length) void this.importFilesToFolder(folderId || '', files);
    input.value = '';
  }

  promptFolderLink(folderId: string, event?: Event) {
    event?.stopPropagation();
    if (this.GuestMode()) return;
    const url = (window.prompt(this.i18n.t('jukebox.linkUrlPlaceholder'), '') || '').trim();
    if (!url) return;
    this.linkError = '';
    if (!StringUtil.validUrl(url)) {
      this.linkError = this.i18n.t('jukebox.linkInvalid');
      window.alert(this.linkError);
      return;
    }
    const name = this.displayNameFromUrl(url);
    AudioStorage.instance.add({
      identifier: url,
      name,
      type: '',
      blob: null,
      url
    });
    this.library.ensureListed(url, folderId || '');
    this.expandedFolders[folderId || ''] = true;
  }

  async importFilesToFolder(folderId: string, files: FileList | File[]) {
    if (this.GuestMode() || !files?.length) return;
    const maxBytes = FileArchiver.MAX_AUDIO_BYTES;
    const { accepted, rejected } = partitionJukeboxImportFiles(Array.from(files), maxBytes);
    if (rejected.length) this.showImportRejectToast(rejected);
    if (!accepted.length) return;
    const fid = folderId || '';
    this.library.importFolderId = fid;
    this.expandedFolders[fid] = true;
    try {
      await FileArchiver.instance.load(accepted);
    } finally {
      this.library.importFolderId = null;
    }
  }

  /** Non-modal, no-focus toast beside the library; auto-hides after 5s. */
  private showImportRejectToast(rejects: JukeboxImportReject[]) {
    if (!rejects.length) return;
    const maxMb = Math.round(FileArchiver.MAX_AUDIO_BYTES / (1024 * 1024));
    this.rejectToastLines = formatJukeboxImportRejectLines(
      rejects,
      (key, params) => this.i18n.t(key, params),
      maxMb,
    );
    if (this.rejectToastTimer != null) clearTimeout(this.rejectToastTimer);
    this.rejectToastTimer = setTimeout(() => {
      this.ngZone.run(() => {
        this.rejectToastLines = [];
        this.rejectToastTimer = null;
      });
    }, JUKEBOX_REJECT_TOAST_MS);
  }

  // —— Library selection ——————————————————————————————————————————

  isAudioSelected(audioId: string): boolean {
    return !!audioId && this.selectedAudioIds.has(audioId);
  }

  clearSelection() {
    if (this.selectedAudioIds.size < 1 && !this.selectionAnchorId) return;
    this.selectedAudioIds = new Set();
    this.selectionAnchorId = null;
    this.selectionAnchorFolderId = null;
  }

  /**
   * Pointer down: Explorer-style — keep multi-selection when starting a drag from
   * an already-selected row; otherwise select only this row so a drag moves one item.
   * Ctrl/Shift selection is handled on click.
   */
  onAudioRowPointerDown(event: PointerEvent, audio: AudioFile, folderId: string) {
    if (this.GuestMode() || !audio || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('.jb-lib-actions, button, input, label, a')) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (this.isAudioSelected(audio.identifier) && this.selectedAudioIds.size > 1) return;
    this.selectedAudioIds = new Set([audio.identifier]);
    this.selectionAnchorId = audio.identifier;
    this.selectionAnchorFolderId = folderId || '';
  }

  onAudioRowClick(event: MouseEvent, audio: AudioFile, folderId: string) {
    if (this.GuestMode() || !audio) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('.jb-lib-actions, button, input, label, a')) return;
    const fid = folderId || '';
    const mod = event.ctrlKey || event.metaKey;

    if (event.shiftKey) {
      const anchor = (this.selectionAnchorFolderId === fid && this.selectionAnchorId)
        ? this.selectionAnchorId
        : audio.identifier;
      this.selectRangeInFolder(fid, anchor, audio.identifier, mod);
      return;
    }
    if (mod) {
      this.toggleAudioSelection(audio.identifier, fid);
      return;
    }
    this.selectedAudioIds = new Set([audio.identifier]);
    this.selectionAnchorId = audio.identifier;
    this.selectionAnchorFolderId = fid;
  }

  onLibraryBackgroundPointerDown(event: PointerEvent) {
    if (this.GuestMode() || event.button !== 0) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('.jb-lib-row, .jb-folder-acts, .jb-folder-toggle, button, input, label, a')) return;
    this.clearSelection();
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeyDown(event: KeyboardEvent) {
    if (this.GuestMode()) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const root = this.hostRef?.nativeElement;
    const scroll = this.libraryScroll?.nativeElement;
    const active = document.activeElement as Node | null;
    const inPanel = !!(root && (root.contains(active) || root.matches(':hover') || scroll?.matches(':hover')));
    if (!inPanel) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey && !event.shiftKey && (event.code === 'KeyA' || event.key === 'a' || event.key === 'A')) {
      event.preventDefault();
      this.selectAllVisible();
      return;
    }
    if (!mod && !event.altKey && !event.shiftKey && event.code === 'Escape') {
      if (this.selectedAudioIds.size > 0) {
        event.preventDefault();
        this.clearSelection();
      }
      return;
    }
    if (!mod && !event.altKey && (event.code === 'Delete' || event.key === 'Delete'
      || event.code === 'Backspace' || event.key === 'Backspace')) {
      if (this.selectedAudioIds.size > 0) {
        event.preventDefault();
        this.removeSelectedAudios(this.selectionAnchorFolderId || '');
      }
    }
  }

  private toggleAudioSelection(audioId: string, folderId: string) {
    const next = new Set(this.selectedAudioIds);
    if (next.has(audioId)) next.delete(audioId);
    else next.add(audioId);
    this.selectedAudioIds = next;
    this.selectionAnchorId = audioId;
    this.selectionAnchorFolderId = folderId || '';
  }

  private selectRangeInFolder(folderId: string, fromId: string, toId: string, additive: boolean) {
    const list = this.audiosIn(folderId || '');
    const ids = list.map(a => a.identifier);
    let a = ids.indexOf(fromId);
    let b = ids.indexOf(toId);
    if (a < 0) a = b;
    if (b < 0) b = a;
    if (a < 0 || b < 0) {
      this.selectedAudioIds = new Set([toId]);
      this.selectionAnchorId = toId;
      this.selectionAnchorFolderId = folderId || '';
      return;
    }
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const next = additive ? new Set(this.selectedAudioIds) : new Set<string>();
    for (let i = lo; i <= hi; i++) next.add(ids[i]);
    this.selectedAudioIds = next;
    if (!this.selectionAnchorId || this.selectionAnchorFolderId !== (folderId || '')) {
      this.selectionAnchorId = fromId;
      this.selectionAnchorFolderId = folderId || '';
    }
  }

  private selectAllVisible() {
    const next = new Set(this.visibleAudioIdsInOrder());
    this.selectedAudioIds = next;
    this.selectionAnchorId = next.size ? Array.from(next)[0] : null;
    this.selectionAnchorFolderId = null;
  }

  private visibleAudioIdsInOrder(): string[] {
    const ids: string[] = [];
    for (const a of this.audiosIn('')) ids.push(a.identifier);
    for (const folder of this.folders) {
      for (const a of this.audiosIn(folder.id)) ids.push(a.identifier);
    }
    return ids;
  }

  private orderedSelectedIds(): string[] {
    return this.visibleAudioIdsInOrder().filter(id => this.selectedAudioIds.has(id));
  }

  // —— Drag & drop ————————————————————————————————————————————————

  onAudioDragStart(event: DragEvent, audio: AudioFile) {
    if (this.GuestMode() || !audio || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('.jb-lib-actions, button, input, label, a')) {
      event.preventDefault();
      return;
    }
    // Ctrl/Shift+drag reserved for selection gestures — do not start HTML5 drag.
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      return;
    }

    this.draggingAudioId = audio.identifier;
    if (this.isAudioSelected(audio.identifier) && this.selectedAudioIds.size > 1) {
      this.dragAudioIds = this.orderedSelectedIds();
    } else {
      this.dragAudioIds = [audio.identifier];
      this.selectedAudioIds = new Set([audio.identifier]);
      this.selectionAnchorId = audio.identifier;
    }

    const ids = this.dragAudioIds;
    event.dataTransfer.setData(JUKEBOX_AUDIO_DRAG_MIME, ids[0] || audio.identifier);
    event.dataTransfer.setData(JUKEBOX_AUDIO_DRAG_LIST_MIME, JSON.stringify(ids));
    event.dataTransfer.setData('text/plain', ids.join('\n'));
    event.dataTransfer.effectAllowed = 'copyMove';
    try {
      const ghost = document.createElement('div');
      ghost.className = 'jb-drag-ghost';
      const label = ids.length > 1
        ? this.i18n.t('jukebox.selectedCount', { count: ids.length })
        : this.displayName(audio);
      ghost.textContent = label;
      ghost.style.cssText = 'position:absolute;top:-1000px;left:-1000px;padding:4px 8px;background:#3a2f24;color:#fff;border-radius:4px;font-size:12px;pointer-events:none;';
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 12, 12);
      setTimeout(() => ghost.remove(), 0);
    } catch { /* ignore */ }
  }

  onAudioDragEnd() {
    const snapshot = this.draggingAudioId;
    setTimeout(() => {
      if (this.draggingAudioId === snapshot) this.clearDropState();
    }, 50);
  }

  onFolderDragOver(event: DragEvent, folderId: string) {
    if (this.isOsFileDrag(event)) {
      this.setOsFileDropFolder(event, folderId);
      return;
    }
    if (!this.isAudioDrag(event)) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('.jb-lib-row, .jb-folder-acts')) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const id = folderId || '';
    if (this.dropFileFolderId !== null) this.dropFileFolderId = null;
    if (this.dropFolderId !== id) this.dropFolderId = id;
    if (this.dropTrackIndex !== null) this.dropTrackIndex = null;
    if (this.dropInsertIndex !== null) this.dropInsertIndex = null;
    if (this.dropReorderFolderId !== null) this.dropReorderFolderId = null;
  }

  onFolderDrop(event: DragEvent, folderId: string) {
    if (this.isOsFileDrag(event)) {
      void this.acceptOsFileDrop(event, folderId);
      return;
    }
    if (!this.isAudioDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const ids = this.readDragAudioIds(event);
    this.clearDropState();
    if (ids.length < 1 || this.GuestMode()) return;
    this.library.moveMany(ids, folderId || '', null);
    this.expandedFolders[folderId || ''] = true;
  }

  onLibRowDragOver(event: DragEvent, folderId: string, rowAudio: AudioFile) {
    if (this.isOsFileDrag(event)) {
      this.setOsFileDropFolder(event, folderId);
      return;
    }
    if (!this.isAudioDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    const row = event.currentTarget as HTMLElement;
    const insertIndex = this.resolveRowInsertIndex(folderId || '', rowAudio, event.clientY, row);
    if (this.dropFileFolderId !== null) this.dropFileFolderId = null;
    if (this.dropFolderId !== null) this.dropFolderId = null;
    if (this.dropTrackIndex !== null) this.dropTrackIndex = null;
    const fid = folderId || '';
    if (this.dropReorderFolderId !== fid) this.dropReorderFolderId = fid;
    if (this.dropInsertIndex !== insertIndex) this.dropInsertIndex = insertIndex;
  }

  onLibRowDrop(event: DragEvent, folderId: string, rowAudio: AudioFile) {
    if (this.isOsFileDrag(event)) {
      void this.acceptOsFileDrop(event, folderId);
      return;
    }
    if (!this.isAudioDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const ids = this.readDragAudioIds(event);
    const row = event.currentTarget as HTMLElement;
    // Always resolve from the drop event — cached dragover index can lag behind the pointer.
    const insertIndex = this.resolveRowInsertIndex(folderId || '', rowAudio, event.clientY, row);
    this.clearDropState();
    if (ids.length < 1 || this.GuestMode()) return;
    this.library.moveManyAt(ids, folderId || '', insertIndex);
    this.expandedFolders[folderId || ''] = true;
  }

  onFolderEndDragOver(event: DragEvent, folderId: string) {
    if (this.isOsFileDrag(event)) {
      this.setOsFileDropFolder(event, folderId);
      return;
    }
    if (!this.isAudioDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const fid = folderId || '';
    const insertIndex = this.library.orderedIdsInFolder(fid).length;
    if (this.dropFileFolderId !== null) this.dropFileFolderId = null;
    if (this.dropFolderId !== null) this.dropFolderId = null;
    if (this.dropTrackIndex !== null) this.dropTrackIndex = null;
    if (this.dropReorderFolderId !== fid) this.dropReorderFolderId = fid;
    if (this.dropInsertIndex !== insertIndex) this.dropInsertIndex = insertIndex;
  }

  onFolderEndDrop(event: DragEvent, folderId: string) {
    if (this.isOsFileDrag(event)) {
      void this.acceptOsFileDrop(event, folderId);
      return;
    }
    if (!this.isAudioDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const ids = this.readDragAudioIds(event);
    const fid = folderId || '';
    const insertIndex = this.library.orderedIdsInFolder(fid).length;
    this.clearDropState();
    if (ids.length < 1 || this.GuestMode()) return;
    this.library.moveManyAt(ids, fid, insertIndex);
    this.expandedFolders[fid] = true;
  }

  /** Index to insert before in the current folder list (pre-removal). */
  private resolveRowInsertIndex(
    folderId: string,
    rowAudio: AudioFile,
    clientY: number,
    rowEl: HTMLElement
  ): number {
    const list = this.library.orderedIdsInFolder(folderId || '');
    const idx = list.indexOf(rowAudio.identifier);
    if (idx < 0) return list.length;
    const rect = rowEl.getBoundingClientRect();
    const after = clientY > rect.top + rect.height * 0.5;
    return after ? idx + 1 : idx;
  }

  onTrackDragOver(event: DragEvent, trackIndex: number) {
    if (trackIndex === JUKEBOX_WEATHER_TRACK) return;
    if (!this.isAudioDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = event.altKey ? 'copy' : 'move';
    }
    if (this.dropTrackIndex !== trackIndex) this.dropTrackIndex = trackIndex;
    if (this.dropFolderId !== null) this.dropFolderId = null;
    if (this.dropInsertIndex !== null) this.dropInsertIndex = null;
    if (this.dropReorderFolderId !== null) this.dropReorderFolderId = null;
  }

  onTrackDragLeave(event: DragEvent, trackIndex: number) {
    const related = event.relatedTarget as Node | null;
    const current = event.currentTarget as HTMLElement | null;
    if (current && related && current.contains(related)) return;
    if (this.dropTrackIndex === trackIndex) this.dropTrackIndex = null;
  }

  onTrackDrop(event: DragEvent, trackIndex: number) {
    if (trackIndex === JUKEBOX_WEATHER_TRACK) return;
    if (!this.isAudioDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const ids = this.readDragAudioIds(event);
    const playNow = event.altKey;
    this.clearDropState();
    const id = ids[0];
    if (!id || this.GuestMode() || !this.jukebox) return;
    const audio = AudioStorage.instance.get(id);
    if (!audio?.isReady) return;
    this.library.setTrackType(id, trackIndex);
    if (playNow) this.jukebox.playTrack(trackIndex, id, this.library.playLoopOf(id));
    else this.jukebox.setTrackAudio(trackIndex, id);
  }

  onLibraryScrollDragOver(event: DragEvent) {
    if (this.isAudioDrag(event)) {
      if (event.target === event.currentTarget) {
        event.preventDefault();
        if (this.dropFolderId !== null) this.dropFolderId = null;
        if (this.dropInsertIndex !== null) this.dropInsertIndex = null;
        if (this.dropReorderFolderId !== null) this.dropReorderFolderId = null;
      }
      return;
    }
    if (this.isOsFileDrag(event)) {
      // Whole library surface accepts OS audio files (root when not over a folder).
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      if (this.dropFileFolderId === null) this.dropFileFolderId = '';
    }
  }

  onLibraryScrollDrop(event: DragEvent) {
    if (this.isAudioDrag(event)) {
      if (this.dropFolderId !== null && this.dropInsertIndex == null) {
        this.onFolderDrop(event, this.dropFolderId);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.clearDropState();
      return;
    }
    if (this.isOsFileDrag(event)) {
      const fid = this.dropFileFolderId !== null ? this.dropFileFolderId : '';
      void this.acceptOsFileDrop(event, fid);
    }
  }

  onLibraryFilesDragLeave(event: DragEvent) {
    const related = event.relatedTarget as Node | null;
    const current = event.currentTarget as HTMLElement | null;
    if (current && related && current.contains(related)) return;
    this.dropFileFolderId = null;
  }

  /** Whole folder block highlight while this folder is the audio-move drop destination. */
  isDropFolder(folderId: string): boolean {
    return this.dropFolderId !== null && this.dropFolderId === (folderId || '');
  }

  /** Folder highlight while OS files are dragged over it. */
  isFileDropFolder(folderId: string): boolean {
    return this.dropFileFolderId !== null && this.dropFileFolderId === (folderId || '');
  }

  isDropBefore(audioId: string, folderId: string): boolean {
    if (this.dropInsertIndex == null || this.dropReorderFolderId !== (folderId || '')) return false;
    const list = this.library.orderedIdsInFolder(folderId || '');
    if (this.dropInsertIndex < 0 || this.dropInsertIndex >= list.length) return false;
    return list[this.dropInsertIndex] === audioId;
  }

  isDropAtFolderEnd(folderId: string): boolean {
    if (this.dropInsertIndex == null || this.dropReorderFolderId !== (folderId || '')) return false;
    return this.dropInsertIndex >= this.library.orderedIdsInFolder(folderId || '').length;
  }

  isDragRow(audioId: string): boolean {
    if (!this.draggingAudioId) return false;
    if (this.dragAudioIds.length > 1) return this.dragAudioIds.includes(audioId);
    return this.draggingAudioId === audioId;
  }

  trackFolderId(_index: number, folder: AudioLibraryFolder): string {
    return folder?.id || '';
  }

  trackAudioId(_index: number, audio: AudioFile): string {
    return audio?.identifier || '';
  }

  private isOsFileDrag(event: DragEvent): boolean {
    if (this.GuestMode()) return false;
    return this.isFileLikeDrag(event);
  }

  /** Detect OS file drag without GuestMode gating (used to block browser navigation). */
  private isFileLikeDrag(event: DragEvent): boolean {
    const types = Array.from(event.dataTransfer?.types || []);
    if (types.includes('Files') || types.includes('application/x-moz-file')) return true;
    const items = event.dataTransfer?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i]?.kind === 'file') return true;
      }
    }
    return false;
  }

  private setOsFileDropFolder(event: DragEvent, folderId: string) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    const id = folderId || '';
    if (this.dropFileFolderId !== id) this.dropFileFolderId = id;
    if (this.dropFolderId !== null) this.dropFolderId = null;
    if (this.dropTrackIndex !== null) this.dropTrackIndex = null;
    if (this.dropInsertIndex !== null) this.dropInsertIndex = null;
    if (this.dropReorderFolderId !== null) this.dropReorderFolderId = null;
  }

  private async acceptOsFileDrop(event: DragEvent, folderId: string) {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer?.files;
    this.clearDropState();
    if (files?.length) await this.importFilesToFolder(folderId || '', files);
  }

  private isAudioDrag(event: DragEvent): boolean {
    if (this.GuestMode()) return false;
    if (this.draggingAudioId || this.dragAudioIds.length) return true;
    const types = Array.from(event.dataTransfer?.types || []);
    if (types.includes(JUKEBOX_AUDIO_DRAG_MIME) || types.includes(JUKEBOX_AUDIO_DRAG_LIST_MIME)) return true;
    if (types.includes('text/plain') && !types.includes('Files')) return true;
    return false;
  }

  private readAudioDragId(event: DragEvent): string {
    const ids = this.readDragAudioIds(event);
    return ids[0] || '';
  }

  private readDragAudioIds(event: DragEvent): string[] {
    if (this.dragAudioIds.length) return this.dragAudioIds.slice();
    try {
      const raw = event.dataTransfer?.getData(JUKEBOX_AUDIO_DRAG_LIST_MIME) || '';
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((id: any) => typeof id === 'string' && id);
        }
      }
    } catch { /* ignore */ }
    const typed = (event.dataTransfer?.getData(JUKEBOX_AUDIO_DRAG_MIME)
      || event.dataTransfer?.getData('text/plain')
      || this.draggingAudioId
      || '').trim();
    if (!typed) return [];
    if (typed.includes('\n')) return typed.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    return [typed];
  }

  private clearDropState() {
    this.draggingAudioId = '';
    this.dragAudioIds = [];
    this.dropFolderId = null;
    this.dropTrackIndex = null;
    this.dropPadIndex = null;
    this.dropInsertIndex = null;
    this.dropReorderFolderId = null;
    this.dropFileFolderId = null;
    this.dropSoundboardSurface = false;
  }

  isUrlAudio(audio: AudioFile): boolean {
    return !!audio && audio.state === AudioState.URL;
  }

  onAudioContextMenu(event: MouseEvent, audio: AudioFile, folderId: string = '') {
    event.preventDefault();
    event.stopPropagation();
    if (this.GuestMode() || !audio) return;
    const fid = folderId || '';
    if (!this.isAudioSelected(audio.identifier)) {
      this.selectedAudioIds = new Set([audio.identifier]);
      this.selectionAnchorId = audio.identifier;
      this.selectionAnchorFolderId = fid;
    }
    const selectedIds = this.orderedSelectedIds();
    const multi = selectedIds.length > 1;
    const t = (key: string, params?: any) => this.i18n.t(key, params);
    const position = { x: event.pageX, y: event.pageY };

    if (multi) {
      const folderMoves: ContextMenuAction[] = [
        { name: t('jukebox.moveToRoot'), action: () => this.moveSelectedToFolder('') }
      ];
      for (const folder of this.folders) {
        folderMoves.push({
          name: folder.name,
          action: () => this.moveSelectedToFolder(folder.id)
        });
      }
      const menu: ContextMenuAction[] = [
        { name: t('jukebox.moveToFolder'), subActions: folderMoves },
        ContextMenuSeparator,
        { name: t('jukebox.removeSelected'), action: () => this.removeSelectedAudios(fid) },
      ];
      this.contextMenuService.open(position, menu, t('jukebox.selectedCount', { count: selectedIds.length }));
      return;
    }

    const folderMoves: ContextMenuAction[] = [
      { name: t('jukebox.moveToRoot'), action: () => this.library.moveToFolder(audio.identifier, '') }
    ];
    for (const folder of this.folders) {
      folderMoves.push({
        name: folder.name,
        action: () => this.library.moveToFolder(audio.identifier, folder.id)
      });
    }
    const assignTracks: ContextMenuAction[] = this.trackIndexes
      .filter(i => i !== JUKEBOX_WEATHER_TRACK)
      .map(i => ({
        name: this.trackName(i),
        action: () => this.assignToTrack(audio, i)
      }));
    const playTracks: ContextMenuAction[] = this.trackIndexes
      .filter(i => i !== JUKEBOX_WEATHER_TRACK)
      .map(i => ({
        name: this.trackName(i),
        action: () => this.assignAndPlay(audio, i)
      }));
    const menu: ContextMenuAction[] = [
      { name: t('jukebox.audition'), action: () => this.play(audio), selfOnly: true },
      { name: t('jukebox.playOnce'), action: () => { this.library.setPlayLoop(audio.identifier, false, fid); this.playFormal(audio, fid); } },
      { name: t('jukebox.playLoop'), action: () => { this.library.setPlayLoop(audio.identifier, true, fid); this.playFormal(audio, fid); } },
      ContextMenuSeparator,
      { name: t('jukebox.assignTrack'), subActions: assignTracks },
      { name: t('jukebox.playToTrack'), subActions: playTracks },
      ContextMenuSeparator,
      { name: t('jukebox.rename'), action: () => this.renameAudio(audio) },
      { name: t('jukebox.moveToFolder'), subActions: folderMoves },
      ContextMenuSeparator,
      { name: t('jukebox.removeFromLibrary'), action: () => this.removeAudio(audio, fid) },
    ];
    this.contextMenuService.open(position, menu, this.displayName(audio));
  }

  onFolderContextMenu(event: MouseEvent, folder: AudioLibraryFolder) {
    event.preventDefault();
    event.stopPropagation();
    if (this.GuestMode() || !folder) return;
    const t = (key: string) => this.i18n.t(key);
    const position = { x: event.pageX, y: event.pageY };
    const menu: ContextMenuAction[] = [
      { name: t('jukebox.folderPlayQueue'), action: () => this.playFolderQueue(folder.id) },
      ContextMenuSeparator,
      { name: t('jukebox.rename'), action: () => this.renameFolder(folder) },
      { name: t('jukebox.deleteFolder'), action: () => this.deleteFolder(folder) },
    ];
    this.contextMenuService.open(position, menu, folder.name);
  }

  private renameAudio(audio: AudioFile) {
    const current = this.displayName(audio);
    const name = window.prompt(this.i18n.t('jukebox.renamePrompt'), current);
    if (name == null || !name.trim()) return;
    this.library.renameAudio(audio.identifier, name.trim());
  }

  private renameFolder(folder: AudioLibraryFolder) {
    const name = window.prompt(this.i18n.t('jukebox.folderNamePrompt'), folder.name);
    if (name == null) return;
    this.library.renameFolder(folder.id, name);
  }

  private deleteFolder(folder: AudioLibraryFolder) {
    if (!window.confirm(this.i18n.t('jukebox.deleteFolderConfirm', { name: folder.name }))) return;
    this.library.deleteFolder(folder.id);
  }

  private removeAudio(audio: AudioFile, folderId: string = '') {
    if (!window.confirm(this.i18n.t('jukebox.removeConfirm', { name: this.displayName(audio) }))) return;
    this.removeAudioImmediate(audio, folderId || '');
    this.selectedAudioIds.delete(audio.identifier);
    this.selectedAudioIds = new Set(this.selectedAudioIds);
  }

  private moveSelectedToFolder(folderId: string) {
    const ids = this.orderedSelectedIds();
    if (ids.length < 1 || this.GuestMode()) return;
    this.library.moveMany(ids, folderId || '', null);
    this.expandedFolders[folderId || ''] = true;
  }

  private removeSelectedAudios(folderId: string = '') {
    const ids = this.orderedSelectedIds();
    if (ids.length < 1) return;
    if (!window.confirm(this.i18n.t('jukebox.removeSelectedConfirm', { count: ids.length }))) return;
    const fid = folderId || this.selectionAnchorFolderId || '';
    for (const id of ids) {
      const audio = AudioStorage.instance.get(id);
      if (audio) this.removeAudioImmediate(audio, fid);
      else {
        const gone = this.library.removeFromFolder(id, fid);
        if (gone) AudioStorage.instance.delete(id);
      }
    }
    AudioStorage.instance.lazySynchronize(100);
    this.clearSelection();
  }

  private removeAudioImmediate(audio: AudioFile, folderId: string = '') {
    this.stopBGM(audio);
    if (this.auditionPlayer.audio === audio) this.stop();
    const gone = this.library.removeFromFolder(audio.identifier, folderId || '');
    if (gone) {
      AudioStorage.instance.delete(audio.identifier);
      AudioStorage.instance.lazySynchronize(100);
    }
  }

  private displayNameFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const last = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
      return last || parsed.hostname || url;
    } catch {
      return url;
    }
  }

  /** Play one sample on the matching local bus after the user finishes a volume drag. */
  previewLocalVolume(channel: 'music' | 'audition' | 'notice' | 'se' | 'soundboard') {
    switch (channel) {
      case 'music':
        if (this.isMute || this.musicMasterVolume <= 0) return;
        this.playChannelPreview(this.musicTestPlayer, PresetSound.piecePut);
        return;
      case 'audition':
        if (this.isAuditionMute || this.auditionVolume <= 0) return;
        this.playChannelPreview(this.auditionTestPlayer, PresetSound.puyon);
        return;
      case 'notice':
        if (this.isNoticeMute || this.noticeVolume <= 0) return;
        this.playChannelPreview(this.noticeTestPlayer, PresetSound.puyon);
        return;
      case 'se':
        if (this.isSoundEffectMute || this.soundEffectVolume <= 0) return;
        this.playChannelPreview(this.soundTestPlayer, PresetSound.piecePut);
        return;
      case 'soundboard': {
        if (this.isSoundboardMute || this.soundboardVolume <= 0) return;
        const padId = this.soundboardSlots.find(s => s.audioIdentifier)?.audioIdentifier;
        this.playChannelPreview(this.soundboardTestPlayer, padId || PresetSound.piecePut);
        return;
      }
    }
  }

  private playChannelPreview(player: AudioPlayer, audioIdentifier: string) {
    const audio = AudioStorage.instance.get(audioIdentifier);
    if (audio?.isReady) {
      EventSystem.unregister(this, 'UPDATE_AUDIO_RESOURE');
      player.play(audio);
      return;
    }
    EventSystem.register(this)
      .on('UPDATE_AUDIO_RESOURE', -100, () => {
        this.playChannelPreview(player, audioIdentifier);
      });
  }

  private lazyNgZoneUpdate() {
    if (this.lazyUpdateTimer !== null) return;
    this.lazyUpdateTimer = setTimeout(() => {
      this.lazyUpdateTimer = null;
      this.ngZone.run(() => { });
    }, 100);
  }

  private refreshPanelTitle() {
    this.modalService.title = this.panelService.title = this.i18n.t('jukebox.title');
  }
}
