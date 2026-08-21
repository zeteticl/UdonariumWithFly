import { Injectable, NgZone } from '@angular/core';

import { ChatTabList } from '@udonarium/chat-tab-list';
import { FileArchiver } from '@udonarium/core/file-storage/file-archiver';
import { AudioState } from '@udonarium/core/file-storage/audio-file';
import { AudioStorage } from '@udonarium/core/file-storage/audio-storage';
import { ImageFile, ImageState } from '@udonarium/core/file-storage/image-file';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { PdfState } from '@udonarium/core/file-storage/pdf-file';
import { PdfStorage } from '@udonarium/core/file-storage/pdf-storage';
import { VideoState } from '@udonarium/core/file-storage/video-file';
import { VideoStorage } from '@udonarium/core/file-storage/video-storage';
import { MimeType } from '@udonarium/core/file-storage/mime-type';
import { GameObject } from '@udonarium/core/synchronize-object/game-object';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { PromiseQueue } from '@udonarium/core/system/util/promise-queue';
import { EventSystem } from '@udonarium/core/system';
import { XmlUtil } from '@udonarium/core/system/util/xml-util';
import { DataSummarySetting } from '@udonarium/data-summary-setting';
import { DiceRollTableList } from '@udonarium/dice-roll-table-list';
import { Jukebox } from '@udonarium/Jukebox';
import { Room } from '@udonarium/room';
import { TableSelecter } from '@udonarium/table-selecter';
import { TabletopObject } from '@udonarium/tabletop-object';

import Beautify from 'vkbeautify';

import { ImageTagList } from '@udonarium/image-tag-list';
import { ChatTab } from '@udonarium/chat-tab';
import { CutInList } from '@udonarium/cut-in-list';
import { AuraNameConfig } from '@udonarium/table-fx/aura-name-config';
import { SceneToolPermission } from '@udonarium/table-fx/scene-tool-permission';
import { CombatTracker } from '@udonarium/table-fx/combat-tracker';
import { ScenePresetList } from '@udonarium/scene-preset-list';
import { ScenarioTextList } from '@udonarium/scenario-text-list';
import { AudioLibrary } from '@udonarium/audio-library';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { MovableDirective } from 'directive/movable.directive';
import { BatchService } from './batch.service';
import { ChatMessageService } from './chat-message.service';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { I18nService } from './i18n.service';
import { ModalService } from './modal.service';
import saveAs from 'file-saver';
import * as localForage from 'localforage';
import {
  FOLDER_BACKUP_FORMAT_VERSION,
  LATEST_DIR,
  MANIFEST_FILE,
  MEDIA_DIR,
  ROOM_META_FILE,
  ROOMS_DIR,
  STATE_FILE_NAMES,
  PREVIEW_FILE,
  STATE_ZIP_FILE,
  isMediaFileName,
  mediaHashFromName,
  computeStateFingerprint,
  sha256Hex,
} from './folder-backup-layout';
import { remapImageIdentifiers as remapXmlImageIds, remapIdsInJson as remapJsonImageIds } from './save-xml-remap.util';
import { reparentOrphanTableFx } from './tabletop-orphan-fx.util';

type UpdateCallback = (percent: number) => void;

export type SaveIncludeAudioAskContext = 'zip' | 'folder';

@Injectable({
  providedIn: 'root'
})
export class SaveDataService {
  private static queue: PromiseQueue = new PromiseQueue('SaveDataServiceQueue');
  static readonly INCLUDE_AUDIO_STORAGE_KEY = 'udonarium.save.includeAudio';

  /** null = user has not chosen yet; undefined = not loaded from storage. */
  private includeAudioCache: boolean | null | undefined;
  private includeAudioLoaded = false;

  /** Cache materialized ./assets URL images so folder auto-backup does not re-fetch/normalize every flush. */
  private packedAssetCache = new Map<string, { sourceUrl: string; hashId: string; file: File }>();

  constructor(
    private ngZone: NgZone,
    private chatMessageService: ChatMessageService,
    private i18n: I18nService,
    private modalService: ModalService,
    private batchService: BatchService,
  ) {
    // Register early so ARCHIVE_LOAD_COMPLETE can sync poses after ZIP load.
    MovableDirective.ensurePoseFlushHook();
    EventSystem.register(this).on('ARCHIVE_LOAD_COMPLETE', () => {
      this.notifyRoomLoadIssuesIfNeeded();
    });
  }

  /** After a room archive load, surface skipped objects once (if any). */
  private notifyRoomLoadIssuesIfNeeded() {
    if (!Room.pendingLoadUserNotice) return;
    Room.pendingLoadUserNotice = false;
    const report = Room.lastLoadReport;
    if (!report?.skipped?.length) return;
    const skipped = report.skipped.length;
    const text = this.i18n.t('save.roomPartialLoad.text', {
      loaded: report.loaded,
      skipped,
    });
    this.chatMessageService.sendOperationLog(text);
    if (!ModalService.defaultParentViewContainerRef) return;
    void this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('save.roomPartialLoad.title'),
      text,
      materialIcon: 'warning',
      type: ConfirmationType.OK,
      okLabel: this.i18n.t('confirm.ok'),
    });
  }

  /** After room XML serialize, surface skipped objects (modal only for interactive ZIP). */
  private notifyRoomSaveIssuesIfNeeded(showModal: boolean) {
    const report = Room.lastSaveReport;
    if (!report?.skipped?.length) return;
    const text = this.i18n.t('save.roomPartialSave.text', {
      written: report.written,
      skipped: report.skipped.length,
    });
    this.chatMessageService.sendOperationLog(text);
    if (!showModal || !ModalService.defaultParentViewContainerRef) return;
    void this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('save.roomPartialSave.title'),
      text,
      materialIcon: 'warning',
      type: ConfirmationType.OK,
      okLabel: this.i18n.t('confirm.ok'),
    });
  }

  /** Sync view of preference for settings toggles (defaults to true before load / when unset). */
  get includeAudio(): boolean {
    return this.includeAudioCache !== false;
  }

  async initializeIncludeAudioPreference(): Promise<void> {
    await this.ensureIncludeAudioLoaded();
  }

  async getIncludeAudio(): Promise<boolean> {
    await this.ensureIncludeAudioLoaded();
    // Unset → include for legacy callers; folder bind forces an explicit choice first.
    return this.includeAudioCache !== false;
  }

  private async ensureIncludeAudioLoaded(): Promise<void> {
    if (this.includeAudioLoaded) return;
    try {
      const v = await localForage.getItem<boolean | string>(SaveDataService.INCLUDE_AUDIO_STORAGE_KEY);
      if (v === null || v === undefined) {
        this.includeAudioCache = null;
      } else {
        this.includeAudioCache = !(v === false || v === 'false');
      }
    } catch {
      this.includeAudioCache = null;
    }
    this.includeAudioLoaded = true;
  }

  async setIncludeAudio(include: boolean): Promise<void> {
    this.includeAudioCache = !!include;
    this.includeAudioLoaded = true;
    try {
      await localForage.setItem(SaveDataService.INCLUDE_AUDIO_STORAGE_KEY, this.includeAudioCache);
    } catch { /* ignore */ }
  }

  /**
   * Ask whether to pack music files into a room save.
   * Returns include flag, or null if cancelled / no choice.
   * Folder bind asks this before the directory picker and writes the choice as the local default;
   * ZIP uses remember checkbox.
   */
  async askIncludeAudio(context: SaveIncludeAudioAskContext): Promise<boolean | null> {
    if (!ModalService.defaultParentViewContainerRef) {
      return this.getIncludeAudio();
    }
    await this.ensureIncludeAudioLoaded();
    const preset = this.includeAudioCache;
    const folderHelpSections = context === 'folder' ? [
      {
        title: this.i18n.t('save.includeAudio.helpFolder.include.title'),
        body: this.i18n.t('save.includeAudio.helpFolder.include.body'),
      },
      {
        title: this.i18n.t('save.includeAudio.helpFolder.points.title'),
        chips: [
          { label: this.i18n.t('save.includeAudio.chip.latest'), tone: 'latest' },
          { label: this.i18n.t('save.includeAudio.chip.recent'), tone: 'recent' },
          { label: this.i18n.t('save.includeAudio.chip.day'), tone: 'day' },
          { label: this.i18n.t('save.includeAudio.chip.week'), tone: 'week' },
          { label: this.i18n.t('save.includeAudio.chip.month'), tone: 'month' },
        ],
        body: this.i18n.t('save.includeAudio.helpFolder.points.body'),
      },
      {
        title: this.i18n.t('save.includeAudio.helpFolder.list.title'),
        body: this.i18n.t('save.includeAudio.helpFolder.list.body'),
      },
    ] : [];
    const result = await this.modalService.open<{ choice: string; remember: boolean } | false>(ConfirmationComponent, {
      title: this.i18n.t('save.includeAudio.title'),
      text: this.i18n.t(context === 'folder' ? 'save.includeAudio.textFolder' : 'save.includeAudio.textZip'),
      help: context === 'folder' ? '' : this.i18n.t('save.includeAudio.helpZip'),
      helpSections: folderHelpSections,
      materialIcon: 'library_music',
      type: ConfirmationType.OK_CANCEL,
      okLabel: this.i18n.t('confirm.ok'),
      cancelLabel: this.i18n.t('confirm.cancel'),
      choices: [
        { id: 'include', label: this.i18n.t('save.includeAudio.include') },
        { id: 'exclude', label: this.i18n.t('save.includeAudio.exclude') },
      ],
      // Folder bind: no pre-selection until user picks. ZIP may reuse last preference.
      choiceValue: context === 'folder'
        ? (preset === null || preset === undefined ? '' : (preset ? 'include' : 'exclude'))
        : (preset === false ? 'exclude' : 'include'),
      requireChoice: true,
      rememberLabel: context === 'zip' ? this.i18n.t('save.includeAudio.remember') : '',
      rememberValue: context === 'zip',
    });
    if (!result) return null;
    if (result.choice !== 'include' && result.choice !== 'exclude') return null;
    const include = result.choice === 'include';
    if (context === 'folder' || result.remember) {
      await this.setIncludeAudio(include);
    }
    return include;
  }

  saveRoomAsync(fileName?: string, updateCallback?: UpdateCallback, includeAudio?: boolean): Promise<void> {
    const name = fileName ?? this.i18n.t('save.roomFilePrefix');
    this.chatMessageService.sendOperationLog(this.i18n.t('save.roomDownloaded', { file: name }));
    return SaveDataService.queue.add((resolve, reject) => resolve(this._saveRoomAsync(name, updateCallback, includeAudio)));
  }

  saveRoomToDirectoryAsync(
    dirHandle: FileSystemDirectoryHandle,
    roomId: string,
    displayName: string,
    updateCallback?: UpdateCallback,
    auth?: {
      allowUser: boolean;
      allowGuest: boolean;
      secrets?: {
        v: 1;
        salt: string;
        iv: string;
        data: string;
      };
    },
    includeAudio?: boolean
  ): Promise<void> {
    return SaveDataService.queue.add((resolve, reject) =>
      resolve(this._saveRoomToDirectoryAsync(dirHandle, roomId, displayName, updateCallback, auth, includeAudio))
    );
  }

  async buildRoomFiles(includeAudio = true): Promise<File[]> {
    this.prepareRoomSnapshotForSave();
    try {
      return await this.buildRoomFilesCore(includeAudio);
    } finally {
      // Re-apply standing mask FX that were stripped so the live room looks unchanged.
      EventSystem.trigger('AFTER_ROOM_SAVE', null);
    }
  }

  private async buildRoomFilesCore(includeAudio = true): Promise<File[]> {
    let files: File[] = [];
    let roomXml = this.convertToXml(new Room());
    let chatXml = this.convertToXml(ChatTabList.instance);
    let diceRollTableXml = this.convertToXml(DiceRollTableList.instance);
    let cutInXml = this.convertToXml(CutInList.instance);
    let summarySetting = this.convertToXml(DataSummarySetting.instance);
    let auraNameXml = this.convertToXml(AuraNameConfig.instance);
    let combatXml = this.convertToXml(CombatTracker.instance);
    let scenePermXml = this.convertToXml(SceneToolPermission.instance);
    let scenePresetXml = this.convertToXml(ScenePresetList.instance);
    let scenarioTextXml = this.convertToXml(ScenarioTextList.instance);
    let audioLibraryXml = this.convertToXml(AudioLibrary.instance);
    const jukebox = Jukebox.instance;
    let jukeboxXml = jukebox ? this.convertToXml(jukebox) : '';

    let images: ImageFile[] = [];
    images = images.concat(this.searchImageFiles(roomXml));
    images = images.concat(this.searchImageFiles(chatXml));
    images = images.concat(this.searchImageFiles(cutInXml));
    images = images.concat(this.searchImageFiles(scenePresetXml));
    images = images.concat(this.collectStorageImages());

    const { imageFiles, idRemap } = await this.packImagesForZip(images);
    if (idRemap.size) {
      roomXml = this.remapImageIdentifiers(roomXml, idRemap);
      chatXml = this.remapImageIdentifiers(chatXml, idRemap);
      cutInXml = this.remapImageIdentifiers(cutInXml, idRemap);
      scenePresetXml = this.remapImageIdentifiers(scenePresetXml, idRemap);
      combatXml = this.remapImageIdentifiers(combatXml, idRemap);
    }

    files.push(new File([roomXml], 'fly_data.xml', { type: 'text/plain' }));
    files.push(new File([chatXml], 'fly_chat.xml', { type: 'text/plain' }));
    files.push(new File([diceRollTableXml], 'fly_rollTable.xml', { type: 'text/plain' }));
    files.push(new File([cutInXml], 'fly_cutIn.xml', { type: 'text/plain' }));
    files.push(new File([summarySetting], 'summary.xml', { type: 'text/plain' }));
    files.push(new File([auraNameXml], 'fly_auraNames.xml', { type: 'text/plain' }));
    files.push(new File([combatXml], 'fly_combat.xml', { type: 'text/plain' }));
    files.push(new File([scenePermXml], 'fly_scenePerm.xml', { type: 'text/plain' }));
    files.push(new File([scenePresetXml], 'fly_scenePreset.xml', { type: 'text/plain' }));
    files.push(new File([scenarioTextXml], 'fly_scenarioText.xml', { type: 'text/plain' }));
    files.push(new File([audioLibraryXml], 'fly_audioLibrary.xml', { type: 'text/plain' }));
    if (jukeboxXml) {
      files.push(new File([jukeboxXml], 'fly_jukebox.xml', { type: 'text/plain' }));
    }
    files.push(...imageFiles);

    let imageTagXml = this.convertToXml(ImageTagList.create(images));
    if (idRemap.size) imageTagXml = this.remapImageIdentifiers(imageTagXml, idRemap);
    files.push(new File([imageTagXml], 'fly_imageTag.xml', { type: 'text/plain' }));

    // User-uploaded BGM / SE (preset asset sounds are isHidden and omitted).
    if (includeAudio) {
      const urlAudioManifest: { identifier: string; name: string; url: string }[] = [];
      for (const audio of AudioStorage.instance.audios) {
        if (audio.isHidden) continue;
        if (audio.state === AudioState.COMPLETE && audio.blob) {
          const ext = MimeType.audioExtension(audio.blob.type || 'audio/mpeg');
          const type = MimeType.audioMimeForExtension(ext);
          files.push(new File([audio.blob], audio.identifier + '.' + ext, { type }));
        } else if (audio.state === AudioState.URL && StringUtil.validUrl(audio.url)) {
          urlAudioManifest.push({
            identifier: audio.identifier,
            name: audio.name,
            url: audio.url
          });
        }
      }
      if (urlAudioManifest.length > 0) {
        files.push(new File([JSON.stringify(urlAudioManifest)], 'fly_audioUrls.json', { type: 'application/json' }));
      }
    }

    // PDFs attached to notes (referenced by pdfIdentifier in room XML).
    const pdfIds = new Set<string>();
    const pdfIdMatches = roomXml.matchAll(/pdfIdentifier[=:][\s"]*([a-f0-9]{64})/gi);
    for (const m of pdfIdMatches) pdfIds.add(m[1]);
    for (const pdf of PdfStorage.instance.pdfs) {
      if (pdf.state === PdfState.COMPLETE && pdf.blob) pdfIds.add(pdf.identifier);
    }
    for (const id of pdfIds) {
      const pdf = PdfStorage.instance.get(id);
      if (pdf && pdf.state === PdfState.COMPLETE && pdf.blob) {
        files.push(new File([pdf.blob], pdf.identifier + '.pdf', { type: 'application/pdf' }));
      }
    }

    // Videos attached to notes.
    const videoIds = new Set<string>();
    const videoIdMatches = roomXml.matchAll(/videoIdentifier[=:][\s"]*([a-f0-9]{64})/gi);
    for (const m of videoIdMatches) videoIds.add(m[1]);
    for (const video of VideoStorage.instance.videos) {
      if (video.state === VideoState.COMPLETE && video.blob) videoIds.add(video.identifier);
    }
    for (const id of videoIds) {
      const video = VideoStorage.instance.get(id);
      if (video && video.state === VideoState.COMPLETE && video.blob) {
        const ext = MimeType.extension(video.blob.type) || 'mp4';
        files.push(new File([video.blob], video.identifier + '.' + ext, { type: video.blob.type || 'video/mp4' }));
      }
    }
    return files;
  }

  /** Flush live poses and reparent orphan table FX before Room XML. */
  private prepareRoomSnapshotForSave() {
    const viewId = TabletopObject.resolveViewTableIdentifier();
    try {
      this.batchService.flushNow();
    } catch (e) {
      console.warn('prepareRoomSnapshotForSave: BatchService.flushNow failed', e);
    }
    try {
      MovableDirective.flushAllPosesToTable(viewId || undefined);
    } catch (e) {
      console.warn('prepareRoomSnapshotForSave: MovableDirective.flushAllPosesToTable failed', e);
    }
    try {
      TabletopObject.flushLivePosesToView(viewId || undefined);
    } catch (e) {
      console.warn('prepareRoomSnapshotForSave: flushLivePosesToView failed', e);
    }
    try {
      reparentOrphanTableFx();
    } catch (e) {
      console.warn('prepareRoomSnapshotForSave: reparentOrphanTableFx failed', e);
    }
    // Strip temporary standing-mask FX so they are not baked into the ZIP permanently.
    EventSystem.trigger('BEFORE_ROOM_SAVE', null);
  }

  /** All COMPLETE / local-asset images in the library (not only XML-referenced). */
  private collectStorageImages(): ImageFile[] {
    const out: ImageFile[] = [];
    for (const image of ImageStorage.instance.images) {
      if (!image) continue;
      if (image.state === ImageState.COMPLETE) {
        out.push(image);
        continue;
      }
      if (image.state === ImageState.URL && image.url && !/^https?:\/\//i.test(image.url)) {
        out.push(image);
      }
    }
    return out;
  }

  private async _saveRoomAsync(fileName?: string, updateCallback?: UpdateCallback, includeAudio?: boolean): Promise<void> {
    fileName = fileName ?? this.i18n.t('save.roomFilePrefix');
    const packAudio = includeAudio != null ? includeAudio : await this.getIncludeAudio();
    const files = await this.buildRoomFiles(packAudio);
    this.notifyRoomSaveIssuesIfNeeded(true);
    return this.saveAsync(files, this.appendTimestamp(fileName), updateCallback);
  }

  private async _saveRoomToDirectoryAsync(
    dirHandle: FileSystemDirectoryHandle,
    roomId: string,
    displayName: string,
    updateCallback?: UpdateCallback,
    auth?: {
      allowUser: boolean;
      allowGuest: boolean;
      secrets?: {
        v: 1;
        salt: string;
        iv: string;
        data: string;
      };
    },
    includeAudio?: boolean
  ): Promise<void> {
    const packAudio = includeAudio != null ? includeAudio : await this.getIncludeAudio();
    const files = await this.buildRoomFiles(packAudio);
    // Folder / auto-backup: log only — avoid modal spam on periodic writes.
    this.notifyRoomSaveIssuesIfNeeded(false);
    await this.writeRoomFolderLayout(dirHandle, roomId, displayName, files, auth, packAudio, updateCallback);
  }

  /**
   * Modern folder backup: shared media/ + rooms/<id>/latest/state.zip
   * (Chrome prompts on creating loose .xml via File System Access — keep XML inside zip).
   */
  private async writeRoomFolderLayout(
    root: FileSystemDirectoryHandle,
    roomId: string,
    displayName: string,
    files: File[],
    auth: {
      allowUser: boolean;
      allowGuest: boolean;
      secrets?: { v: 1; salt: string; iv: string; data: string };
    } | undefined,
    includeAudio: boolean,
    updateCallback?: UpdateCallback
  ): Promise<void> {
    const archiver = FileArchiver.instance;
    const mediaDir = await archiver.ensureDirectory(root, MEDIA_DIR);
    const roomsDir = await archiver.ensureDirectory(root, ROOMS_DIR);
    const roomDir = await archiver.ensureDirectory(roomsDir, roomId);
    const latestDir = await archiver.ensureDirectory(roomDir, LATEST_DIR);

    let prevStateFp = '';
    try {
      const prevManifestFile = await (await latestDir.getFileHandle(MANIFEST_FILE)).getFile();
      const prev = JSON.parse(await prevManifestFile.text()) as {
        stateFingerprint?: string;
      };
      prevStateFp = prev?.stateFingerprint || '';
    } catch { /* first save */ }

    const stateFiles: File[] = [];
    const mediaFiles: File[] = [];
    for (const file of files) {
      if (STATE_FILE_NAMES.has(file.name)) stateFiles.push(file);
      else if (isMediaFileName(file.name)) mediaFiles.push(file);
      else if (/\.(xml|json)$/i.test(file.name)) stateFiles.push(file);
      else mediaFiles.push(file);
    }

    const total = mediaFiles.length + 3;
    let done = 0;
    const report = () => {
      if (!updateCallback) return;
      const percent = Math.min(99, Math.round((done / Math.max(1, total)) * 100));
      this.ngZone.run(() => updateCallback(percent));
    };

    const mediaEntries: { hash: string; name: string }[] = [];
    for (const file of mediaFiles) {
      const hash = mediaHashFromName(file.name);
      mediaEntries.push({ hash, name: file.name });
      const exists = await archiver.fileExists(mediaDir, file.name);
      if (!exists) {
        await archiver.writeBlobToDirectory(mediaDir, file.name, file);
      }
      done++;
      report();
    }

    const fileFingerprints: Record<string, string> = {};
    for (const file of stateFiles) {
      const buf = await file.arrayBuffer();
      fileFingerprints[file.name] = await sha256Hex(buf);
    }
    const stateFingerprint = await computeStateFingerprint(fileFingerprints);

    if (stateFingerprint !== prevStateFp) {
      const stateZip = await archiver.createZipBlobAsync(stateFiles);
      await archiver.writeBlobToDirectory(latestDir, STATE_ZIP_FILE, stateZip);
      // Remove any prior loose .xml writes (Chrome prompts on those extensions).
      for await (const [name, handle] of latestDir.entries()) {
        if (handle.kind !== 'file') continue;
        if (name === STATE_ZIP_FILE || name === MANIFEST_FILE || name === PREVIEW_FILE) continue;
        if (/\.(xml|json\.tmp|xml\.tmp)$/i.test(name) || name.endsWith('.tmp')) {
          try {
            await latestDir.removeEntry(name);
          } catch { /* ignore */ }
        }
      }
    }
    done++;
    report();

    const savedAt = new Date().toISOString();
    const manifest = {
      formatVersion: FOLDER_BACKUP_FORMAT_VERSION,
      savedAt,
      files: fileFingerprints,
      stateFingerprint,
      stateZip: STATE_ZIP_FILE,
      media: mediaEntries,
    };
    await archiver.writeBlobToDirectory(
      latestDir,
      MANIFEST_FILE,
      new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
    );
    done++;
    report();

    let slots: {
      latest?: string;
      recent?: string[];
      snap_1d?: string;
      snap_7d?: string;
      snap_30d?: string;
      recentIndex?: number;
    } = { latest: savedAt };
    const roomMeta: Record<string, unknown> = {
      formatVersion: FOLDER_BACKUP_FORMAT_VERSION,
      roomId,
      displayName,
      savedAt,
      includeAudio,
      slots,
    };
    try {
      const existingMetaFile = await (await roomDir.getFileHandle(ROOM_META_FILE)).getFile();
      const existing = JSON.parse(await existingMetaFile.text()) as {
        slots?: typeof slots;
        firstSavedAt?: string;
      };
      if (existing?.slots) {
        slots = { ...existing.slots, latest: savedAt };
        roomMeta.slots = slots;
      }
      roomMeta.firstSavedAt = existing?.firstSavedAt || savedAt;
    } catch {
      roomMeta.firstSavedAt = savedAt;
    }
    if (auth) {
      roomMeta.allowUser = !!auth.allowUser;
      roomMeta.allowGuest = !!auth.allowGuest;
      if (auth.secrets) roomMeta.secrets = auth.secrets;
    }
    await archiver.writeBlobToDirectory(
      roomDir,
      ROOM_META_FILE,
      new Blob([JSON.stringify(roomMeta, null, 2)], { type: 'application/json' })
    );
    if (updateCallback) this.ngZone.run(() => updateCallback(100));
  }

  saveGameObjectAsync(gameObject: GameObject, fileName: string = 'fly_xml_data', updateCallback?: UpdateCallback): Promise<void> {
    this.chatMessageService.sendOperationLog(this.i18n.t('save.objectDownloaded', {
      type: this.aliasLabel(gameObject.aliasName),
      file: fileName
    }));
    return SaveDataService.queue.add((resolve, reject) => resolve(this._saveGameObjectAsync(gameObject, fileName, updateCallback)));
  }

  /**
   * Export several objects in one ZIP (`terrain-group` root) so import restores them together.
   */
  saveGameObjectsAsync(gameObjects: GameObject[], fileName: string = 'fly_xml_data', updateCallback?: UpdateCallback): Promise<void> {
    const list = (gameObjects || []).filter(o => !!o);
    if (!list.length) return Promise.resolve();
    if (list.length === 1) return this.saveGameObjectAsync(list[0], fileName, updateCallback);
    this.chatMessageService.sendOperationLog(this.i18n.t('save.objectDownloaded', {
      type: this.aliasLabel(list[0].aliasName),
      file: fileName
    }));
    return SaveDataService.queue.add((resolve) => resolve(this._saveGameObjectsAsync(list, fileName, updateCallback)));
  }

  /** File picker for XML/ZIP object data (pairs with saveGameObjectAsync / room ZIP load). */
  pickAndLoadXmlOrZip(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'application/xml,text/xml,application/zip';
    input.onchange = (event: Event) => {
      const files = (event.target as HTMLInputElement).files;
      if (files?.length) FileArchiver.instance.load(files);
    };
    input.click();
  }

  private async _saveGameObjectAsync(gameObject: GameObject, fileName: string = 'fly_xml_data', updateCallback?: UpdateCallback): Promise<void> {
    let files: File[] = [];
    let xml: string = this.convertToXml(gameObject);
    const images = this.searchImageFiles(xml);
    const { imageFiles, idRemap } = await this.packImagesForZip(images);
    if (idRemap.size) xml = this.remapImageIdentifiers(xml, idRemap);

    files.push(new File([xml], 'fly_data.xml', { type: 'text/plain' }));
    files.push(...imageFiles);
    let imageTagXml = this.convertToXml(ImageTagList.create(images));
    if (idRemap.size) imageTagXml = this.remapImageIdentifiers(imageTagXml, idRemap);
    files.push(new File([imageTagXml], 'fly_imageTag.xml', { type: 'text/plain' }));
    return this.saveAsync(files, this.appendTimestamp(fileName), updateCallback);
  }

  private async _saveGameObjectsAsync(gameObjects: GameObject[], fileName: string, updateCallback?: UpdateCallback): Promise<void> {
    let files: File[] = [];
    let xml = this.convertObjectsToGroupXml(gameObjects);
    const images = this.searchImageFiles(xml);
    const { imageFiles, idRemap } = await this.packImagesForZip(images);
    if (idRemap.size) xml = this.remapImageIdentifiers(xml, idRemap);

    files.push(new File([xml], 'fly_data.xml', { type: 'text/plain' }));
    files.push(...imageFiles);
    let imageTagXml = this.convertToXml(ImageTagList.create(images));
    if (idRemap.size) imageTagXml = this.remapImageIdentifiers(imageTagXml, idRemap);
    files.push(new File([imageTagXml], 'fly_imageTag.xml', { type: 'text/plain' }));
    return this.saveAsync(files, this.appendTimestamp(fileName), updateCallback);
  }

  /** Wrap multiple object XML trees so one ZIP import can place them as a group. */
  private convertObjectsToGroupXml(gameObjects: GameObject[]): string {
    const bodies = gameObjects.map(o => Beautify.xml(o.toXml(), 2)).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<terrain-group>\n${bodies}\n</terrain-group>`;
  }

  /**
   * Pack COMPLETE blobs and local asset URL images into ZIP files.
   * Asset URLs (./assets/...) have no blob until fetched; after packing, identifiers
   * become content hashes so ZIP reload matches ImageStorage.addAsync.
   */
  private async packImagesForZip(images: ImageFile[]): Promise<{ imageFiles: File[]; idRemap: Map<string, string> }> {
    const imageFiles: File[] = [];
    const idRemap = new Map<string, string>();
    const packedIds = new Set<string>();
    const seen = new Set<string>();

    for (const image of images) {
      if (!image || seen.has(image.identifier)) continue;
      seen.add(image.identifier);

      if (image.state === ImageState.COMPLETE && image.blob) {
        if (packedIds.has(image.identifier)) continue;
        packedIds.add(image.identifier);
        const ext = MimeType.extension(image.blob.type) || 'bin';
        imageFiles.push(new File(
          [image.blob],
          image.identifier + '.' + ext,
          { type: image.blob.type },
        ));
        continue;
      }

      if (image.state !== ImageState.URL || !image.url) continue;
      // Remote absolute URLs stay as references (no blob in ZIP).
      if (/^https?:\/\//i.test(image.url)) continue;

      try {
        const cached = this.packedAssetCache.get(image.identifier);
        if (cached && cached.sourceUrl === image.url) {
          if (image.identifier !== cached.hashId) idRemap.set(image.identifier, cached.hashId);
          if (!packedIds.has(cached.hashId)) {
            packedIds.add(cached.hashId);
            imageFiles.push(cached.file);
          }
          continue;
        }

        const res = await fetch(image.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const materialized = await ImageFile.createAsync(
          new File([blob], image.identifier, { type: blob.type || 'image/png' }),
        );
        if (image.identifier !== materialized.identifier) {
          idRemap.set(image.identifier, materialized.identifier);
        }
        const ext = MimeType.extension(materialized.blob.type) || 'bin';
        const file = new File(
          [materialized.blob],
          materialized.identifier + '.' + ext,
          { type: materialized.blob.type },
        );
        this.packedAssetCache.set(image.identifier, {
          sourceUrl: image.url,
          hashId: materialized.identifier,
          file,
        });
        if (packedIds.has(materialized.identifier)) continue;
        packedIds.add(materialized.identifier);
        imageFiles.push(file);
      } catch (e) {
        console.warn(`Failed to pack asset image ${image.identifier} (${image.url})`, e);
      }
    }

    return { imageFiles, idRemap };
  }

  /** Rewrite image ids in exported XML after materializing asset URLs to content hashes. */
  private remapImageIdentifiers(xml: string, idRemap: Map<string, string>): string {
    return remapXmlImageIds(xml, idRemap);
  }

  private remapIdsInJson(value: any, idRemap: Map<string, string>): any {
    return remapJsonImageIds(value, idRemap);
  }

  private saveAsync(files: File[], zipName: string, updateCallback?: UpdateCallback): Promise<void> {
    let progresPercent = -1;
    return FileArchiver.instance.saveAsync(files, zipName, meta => {
      if (!updateCallback) return;
      let percent = meta.percent | 0;
      if (percent <= progresPercent) return;
      progresPercent = percent;
      this.ngZone.run(() => updateCallback(progresPercent));
    });
  }

  private convertToXml(gameObject: GameObject): string {
    let xmlDeclaration = '<?xml version="1.0" encoding="UTF-8"?>';
    return xmlDeclaration + '\n' + Beautify.xml(gameObject.toXml(), 2);
  }

  private searchImageFiles(xml: string): ImageFile[] {
    let xmlElement: Element = XmlUtil.xml2element(xml);
    let files: ImageFile[] = [];
    if (!xmlElement) return files;

    let images: { [identifier: string]: ImageFile } = {};
    let imageElements = xmlElement.ownerDocument.querySelectorAll('*[type="image"]');

    for (let i = 0; i < imageElements.length; i++) {
      let identifier = imageElements[i].innerHTML;
      images[identifier] = ImageStorage.instance.get(identifier);

      let shadowIdentifier = imageElements[i].getAttribute('currentValue');
      if (shadowIdentifier) images[shadowIdentifier] = ImageStorage.instance.get(shadowIdentifier);
    }

    imageElements = xmlElement.ownerDocument.querySelectorAll('*[imageIdentifier], *[toImageIdentifier], *[backgroundImageIdentifier], *[backgroundImageIdentifier2], *[attachedImageIdentifiers]');

    for (let i = 0; i < imageElements.length; i++) {
      let identifier = imageElements[i].getAttribute('imageIdentifier');
      if (identifier) images[identifier] = ImageStorage.instance.get(identifier);

      let toIdentifier = imageElements[i].getAttribute('toImageIdentifier');
      if (toIdentifier) images[toIdentifier] = ImageStorage.instance.get(toIdentifier);

      let backgroundImageIdentifier = imageElements[i].getAttribute('backgroundImageIdentifier');
      if (backgroundImageIdentifier) images[backgroundImageIdentifier] = ImageStorage.instance.get(backgroundImageIdentifier);

      let backgroundImageIdentifier2 = imageElements[i].getAttribute('backgroundImageIdentifier2');
      if (backgroundImageIdentifier2) images[backgroundImageIdentifier2] = ImageStorage.instance.get(backgroundImageIdentifier2);

      const attached = imageElements[i].getAttribute('attachedImageIdentifiers');
      if (attached) {
        for (const id of attached.trim().split(/\s+/)) {
          if (id) images[id] = ImageStorage.instance.get(id);
        }
      }
    }
    for (let identifier in images) {
      let image = images[identifier];
      //if (image && image.state === ImageState.COMPLETE) {
      //  files.push(new File([image.blob], image.identifier + '.' + MimeType.extension(image.blob.type), { type: image.blob.type }));
      //}
      if (image) {
        files.push(image);
      }
    }
    return files;
  }

  private appendTimestamp(fileName: string): string {
    let date = new Date();
    let year = date.getFullYear();
    let month = ('00' + (date.getMonth() + 1)).slice(-2);
    let day = ('00' + date.getDate()).slice(-2);
    let hours = ('00' + date.getHours()).slice(-2);
    let minutes = ('00' + date.getMinutes()).slice(-2);

    return fileName + `_${year}-${month}-${day}_${hours}${minutes}`;
  }

  saveChatLog(logFormat: number, fileName: string, chatTabs: ChatTab[]=null, dateFormat='HH:mm', isWriteOerationLog=true) {
    const mimeType = (logFormat == 0 ? 'text/plain' : 'text/html');
    const ext = (logFormat == 0 ? '.txt' : '.html');
    const trueFileName = 'fly_' + this.appendTimestamp(fileName) + ext;
    this.chatMessageService.sendOperationLog(this.i18n.t('save.chatLogDownloaded', { file: trueFileName }));
    //const xml = ChatTabList.instance.log(logFormat, dateFormat, isWriteOerationLog, chatTabs);
    
    //const files: File[] = [];
    //files.push(new File([xml], trueFileName, {type: `${mimeType};charset=utf-8`}));

    saveAs(new Blob([ChatTabList.instance.log(logFormat, dateFormat, isWriteOerationLog, null, chatTabs)], {type: `${mimeType};charset=utf-8`}), trueFileName);
  }

  async saveChatLogAsync(logFormat: number, fileName: string, chatTabs: ChatTab[]=null, dateFormat='HH:mm', isWriteOerationLog=true, updateCallback?: UpdateCallback): Promise<void> {
    const trueFileName = 'fly_' + this.appendTimestamp(fileName);
    this.chatMessageService.sendOperationLog(this.i18n.t('save.chatLogZipDownloaded', { file: trueFileName }));
    const files: File[] = [];
    const images: ImageFile[] = (chatTabs ? chatTabs : [ChatTabList.instance]).reduce<ImageFile[]>((acm, obj) => acm.concat(this.searchImageFiles(this.convertToXml(obj))), []);
    const imageDict = {};
    const basename = path => path.split('/').pop().split('.').shift();
    let isLicenseIncluded = false;
    let isCopyrightIncluded = false;
    for (const image of images) {
      if (!imageDict[image.identifier]) {
        if (image.state === ImageState.COMPLETE) {
          const fileName = image.identifier + '.' + MimeType.extension(image.blob.type);
          imageDict[image.identifier] = 'images/' + fileName;
          files.push(new File([image.blob], 'images/' + fileName, { type: image.blob.type }));
        } else if (image.state === ImageState.URL) {
          if (image.url.startsWith('http')) {
            if (StringUtil.validUrl(image.url)) imageDict[image.identifier] = image.url;
          } else {
            await fetch(image.url)
              .then(response => response.blob())
              .then(blob => {
                const fileName = basename(image.identifier) + '.' + MimeType.extension(blob.type);
                imageDict[image.identifier] = 'udonarium_assets/' + fileName;
                files.push(new File([blob], 'udonarium_assets/' + fileName, { type: blob.type }))
              });
            if (image.url.indexOf('/dice/') >= 0) {
              if (!isLicenseIncluded) {
                await fetch('./assets/images/dice/license.txt')
                  .then(response => response.blob())
                  .then(blob => {
                    files.push(new File([blob], 'udonarium_assets/license.txt', { type: 'text/plain' }));
                    isLicenseIncluded = true;
                  });
              }
            } else {
              if (!isCopyrightIncluded) {
                await fetch('./assets/images/copyright.txt')
                  .then(response => response.blob())
                  .then(blob => {
                    files.push(new File([blob], 'udonarium_assets/copyright.txt', { type: 'text/plain' }));
                    isCopyrightIncluded = true;
                  });
              }
            }
          }
        }
      }
    }
    files.push(new File([ChatTabList.instance.log(logFormat, dateFormat, isWriteOerationLog, imageDict, chatTabs)], 'index.html', {type: 'text/html;charset=utf-8'}));
    return this.saveAsync(files, trueFileName, updateCallback);
  }

  private aliasLabel(aliasName: string): string {
    const key = `alias.${aliasName}`;
    const text = this.i18n.t(key);
    return text === key ? (StringUtil.aliasNameToClassName(aliasName) || aliasName) : text;
  }
}
