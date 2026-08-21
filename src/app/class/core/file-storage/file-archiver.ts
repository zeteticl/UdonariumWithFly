import { BlobReader, BlobWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { saveAs } from 'file-saver';

import { AudioLibrary } from '@udonarium/audio-library';
import { EventSystem } from '../system';
import { StringUtil } from '../system/util/string-util';
import { XmlUtil } from '../system/util/xml-util';
import { AudioFile } from './audio-file';
import { AudioStorage } from './audio-storage';
import { FileReaderUtil } from './file-reader-util';
import { IMAGE_SOURCE_MAX_BYTES } from './image-normalize';
import { ImageStorage } from './image-storage';
import { MimeType } from './mime-type';
import { PdfStorage } from './pdf-storage';
import { VideoStorage } from './video-storage';
import { AudioImportNameService } from 'service/audio-import-name.service';
import { poseDebug } from '@udonarium/table-fx/pose-debug';
import { TabletopLoadSettle } from '@udonarium/tabletop-load-settle';
import { folderBackupDebug } from 'service/folder-backup-debug';

type MetaData = { percent: number, currentFile: string };
type UpdateCallback = (metadata: MetaData) => void;

const MEGA_BYTE = 1024 * 1024;

export class FileArchiver {
  private static _instance: FileArchiver
  static get instance(): FileArchiver {
    if (!FileArchiver._instance) FileArchiver._instance = new FileArchiver();
    return FileArchiver._instance;
  }

  /** Chrome often rejects move(); remember and skip after first NotAllowedError. */
  private static moveUnsupported = false;

  /** Public audio import cap (jukebox drop / FileArchiver). */
  static readonly MAX_AUDIO_BYTES = 20 * MEGA_BYTE;

  /** Source accept cap; stored size is enforced by normalizeImageBlob (≤2MB). */
  private maxImageSize = IMAGE_SOURCE_MAX_BYTES;
  private maxAudioeSize = FileArchiver.MAX_AUDIO_BYTES;
  private maxPdfSize = 20 * MEGA_BYTE;
  private maxVideoSize = 50 * MEGA_BYTE;
  private loadDepth = 0;
  /** Oversized audio rejected during the current outermost load batch. */
  private pendingAudioRejects: { name: string; reason: 'tooLarge' }[] = [];

  private callbackOnDragEnter;
  private callbackOnDragOver;
  private callbackOnDrop;

  private constructor() {
  }

  initialize() {
    this.destroy();
    this.addEventListeners();
  }

  private destroy() {
    this.removeEventListeners();
  }

  private addEventListeners() {
    this.removeEventListeners();
    this.callbackOnDragEnter = (e) => this.onDragEnter(e);
    this.callbackOnDragOver = (e) => this.onDragOver(e);
    this.callbackOnDrop = (e) => this.onDrop(e);
    document.body.addEventListener('dragenter', this.callbackOnDragEnter, false);
    document.body.addEventListener('dragover', this.callbackOnDragOver, false);
    document.body.addEventListener('drop', this.callbackOnDrop, false);
  }

  private removeEventListeners() {
    document.body.removeEventListener('dragenter', this.callbackOnDragEnter, false);
    document.body.removeEventListener('dragover', this.callbackOnDragOver, false);
    document.body.removeEventListener('drop', this.callbackOnDrop, false);
    this.callbackOnDragEnter = null;
    this.callbackOnDragOver = null;
    this.callbackOnDrop = null;
  }

  private onDragEnter(event: DragEvent) {
    event.preventDefault();
  };

  private onDragOver(event: DragEvent) {
    event.preventDefault();
  };

  private onDrop(event: DragEvent) {
    event.preventDefault();
    let files = event.dataTransfer.files
    this.load(files);
  };

  /** True when the outermost load batch opened at least one ZIP (room archive path). */
  private loadHadZip = false;

  async load(files: File[]): Promise<void>
  async load(files: FileList): Promise<void>
  async load(files: any): Promise<void> {
    if (!files) return;
    let loadFiles: File[] = files instanceof FileList ? toArrayOfFileList(files) : files;

    this.loadDepth++;
    if (this.loadDepth === 1) {
      this.loadHadZip = false;
      this.pendingAudioRejects = [];
    }
    const nameService = AudioImportNameService.instance;
    nameService?.beginBatch();
    try {
      for (let file of loadFiles) {
        await this.handleImage(file);
        await this.handleAudio(file);
        await this.handlePdf(file);
        await this.handleVideo(file);
        await this.handleAudioUrlManifest(file);
        await this.handleText(file);
        if (await this.handleZip(file)) {
          this.loadHadZip = true;
          // Before XML restore remount finishes: keep gate until ARCHIVE sync ends.
          TabletopLoadSettle.markExpectArchive();
        }
        EventSystem.trigger('FILE_LOADED', { file: file });
      }
    } finally {
      nameService?.endBatch();
      this.loadDepth--;
      if (this.loadDepth === 0) {
        if (this.pendingAudioRejects.length) {
          EventSystem.trigger('AUDIO_IMPORT_REJECTED', {
            rejects: this.pendingAudioRejects.slice(),
            maxBytes: this.maxAudioeSize,
          });
          this.pendingAudioRejects = [];
        }
        // Only after a ZIP batch: audio/image drops must not remount table tokens.
        if (this.loadHadZip) {
          TabletopLoadSettle.markExpectArchive();
          poseDebug('FileArchiver ARCHIVE_LOAD_COMPLETE firing', {
            fileCount: loadFiles.length,
            names: loadFiles.map(f => f.name).slice(0, 20),
          });
          folderBackupDebug('FileArchiver ARCHIVE_LOAD_COMPLETE', {
            fileCount: loadFiles.length,
            names: loadFiles.map(f => f.name).slice(0, 30),
          });
          EventSystem.trigger('ARCHIVE_LOAD_COMPLETE', null);
        }
      }
    }
  }

  private async handleAudioUrlManifest(file: File) {
    const baseName = file.name.split(/[\\/]/).pop();
    if (baseName !== 'fly_audioUrls.json') return;
    try {
      const text = await FileReaderUtil.readAsTextAsync(file);
      const list = JSON.parse(text);
      if (!Array.isArray(list)) return;
      for (const item of list) {
        if (!item || typeof item.url !== 'string') continue;
        const url = item.url.trim();
        if (!StringUtil.validUrl(url)) continue;
        const name = (typeof item.name === 'string' && item.name.trim()) ? item.name.trim() : url;
        const identifier = (typeof item.identifier === 'string' && item.identifier.trim()) ? item.identifier.trim() : url;
        AudioStorage.instance.add({
          identifier,
          name,
          type: '',
          blob: null,
          url
        });
        AudioLibrary.instance.ensureListed(identifier);
      }
    } catch (reason) {
      console.warn(reason);
    }
  }

  private async handleImage(file: File) {
    if (file.type.indexOf('image/') < 0) return;
    if (this.maxImageSize < file.size) {
      console.warn(`File size limit exceeded. -> ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
      return;
    }
    try {
      await ImageStorage.instance.addAsync(file);
    } catch (e) {
      console.warn(`Image import failed (normalize/store). -> ${file.name}`, e);
    }
  }

  /** True when this file should be imported as jukebox audio. */
  private static isAudioFile(file: File): boolean {
    return MimeType.isAudioFile(file);
  }

  private async handleAudio(file: File) {
    if (!FileArchiver.isAudioFile(file)) return;
    if (this.maxAudioeSize < file.size) {
      console.warn(`File size limit exceeded. -> ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
      this.pendingAudioRejects.push({ name: file.name, reason: 'tooLarge' });
      return;
    }
    // Room ZIP / folder media are "<sha256>.ext". Display names + folders live in
    // fly_audioLibrary.xml — do not treat restore as a fresh import (no name dialog,
    // do not overwrite library names with the hash or re-parsed tags).
    const restorePacked = MimeType.isRoomPackedAudioFileName(file.name)
      || MimeType.isLegacyMisnamedAudioFile(file.name);

    let displayName: string | undefined;
    if (!restorePacked) {
      const nameService = AudioImportNameService.instance;
      displayName = nameService
        ? await nameService.resolveDisplayName(file)
        : undefined;
    }

    // Normalize legacy "<hash>.mpeg" (typed video/mpeg) to audio/mpeg + .mp3
    // so the next save does not re-emit a video-colliding extension.
    let importFile: File = file;
    if (MimeType.isLegacyMisnamedAudioFile(file.name)) {
      const base = MimeType.fileBaseName(file.name);
      const ab = await file.arrayBuffer();
      importFile = new File([ab], base.replace(/\.mpeg$/i, '.mp3'), { type: 'audio/mpeg' });
    }
    const created = await AudioFile.createAsync(importFile, restorePacked ? undefined : displayName);
    const existed = !!AudioStorage.instance.get(created.identifier);
    const audio = AudioStorage.instance.add(created);
    if (!audio) return;
    if (existed) {
      // Same bytes — list again in the target folder (settings can differ per folder).
      AudioLibrary.instance.ensureListed(audio.identifier);
      return;
    }
    if (!restorePacked && displayName) {
      AudioLibrary.instance.renameAudio(audio.identifier, displayName);
    }
    AudioLibrary.instance.ensureListed(audio.identifier);
  }

  private async handlePdf(file: File) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) return;
    if (this.maxPdfSize < file.size) {
      console.warn(`PDF size limit exceeded. -> ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
      return;
    }
    await PdfStorage.instance.addAsync(file);
  }

  private async handleVideo(file: File) {
    // Audio wins when both handlers could match (esp. legacy "<hash>.mpeg" MP3s).
    if (FileArchiver.isAudioFile(file)) return;
    const isVideo = (file.type && file.type.indexOf('video/') === 0)
      || /\.(mp4|webm|mov|m4v|ogv|mpg|mpeg)$/i.test(file.name);
    if (!isVideo) return;
    if (this.maxVideoSize < file.size) {
      console.warn(`Video size limit exceeded. -> ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
      return;
    }
    await VideoStorage.instance.addAsync(file);
  }

  private async handleText(file: File): Promise<void> {
    const type = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    const isTextish = type.indexOf('text/') === 0
      || type === 'application/xml'
      || type === 'application/json'
      || /\.(xml|html?|txt|json|csv|md)$/i.test(name);
    if (!isTextish) return;
    try {
      let xmlElement: Element = XmlUtil.xml2element(await FileReaderUtil.readAsTextAsync(file));
      if (xmlElement) EventSystem.trigger('XML_LOADED', { xmlElement: xmlElement });
    } catch (reason) {
      console.warn(reason);
    }
  }

  /** @returns true when the file was opened as a ZIP with at least one entry. */
  private async handleZip(file: File): Promise<boolean> {
    if (!(0 <= file.type.indexOf('application/') || file.type.length < 1)) return false;

    try {
      const zipReader = new ZipReader(new BlobReader(file));
      const entries = await zipReader.getEntries();
      if (!entries?.length) return false;

      for (let entry of entries) {
        try {
          let blob = await entry.getData(new BlobWriter());
          await this.load([new File([blob], entry.filename, { type: MimeType.type(entry.filename) })]);
        } catch (reason) {
          console.warn(reason);
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  async createZipBlobAsync(files: File[], updateCallback?: UpdateCallback): Promise<Blob>
  async createZipBlobAsync(files: FileList, updateCallback?: UpdateCallback): Promise<Blob>
  async createZipBlobAsync(files: any, updateCallback?: UpdateCallback): Promise<Blob> {
    if (!files) return new Blob();
    let saveFiles: File[] = files instanceof FileList ? toArrayOfFileList(files) : files;

    let zipWriter = new ZipWriter(new BlobWriter('application/zip'), { bufferedWrite: true });

    let sumProgress = 0;
    let sumTotal = 0;
    await Promise.all(Array.from(saveFiles).map(async file => {
      let prevProgress = 0;
      sumTotal += file.size;
      zipWriter.add(file.name, new BlobReader(file), {
        async onprogress(progress, total) {
          sumProgress += progress - prevProgress;
          prevProgress = progress;
          let percent = sumProgress * 100 / sumTotal;
          if (updateCallback) updateCallback({ percent: percent, currentFile: file.name });
        }
      });
    }));

    return await zipWriter.close();
  }

  async saveAsync(files: File[], zipName: string, updateCallback?: UpdateCallback): Promise<void>
  async saveAsync(files: FileList, zipName: string, updateCallback?: UpdateCallback): Promise<void>
  async saveAsync(files: any, zipName: string, updateCallback?: UpdateCallback): Promise<void> {
    if (!files) return;
    saveAs(await this.createZipBlobAsync(files, updateCallback), zipName + '.zip');
  }

  /**
   * Write a blob into a directory.
   * Prefer atomic tmp+move when the browser allows it; otherwise write the final
   * name directly (Chrome commonly rejects move — avoid double-write + warn spam).
   */
  async writeBlobToDirectory(dirHandle: FileSystemDirectoryHandle, fileName: string, blob: Blob): Promise<void> {
    const canTryMove =
      !FileArchiver.moveUnsupported &&
      typeof (FileSystemFileHandle.prototype as { move?: unknown }).move === 'function';

    if (!canTryMove) {
      await this.writeBlobDirect(dirHandle, fileName, blob);
      return;
    }

    const tmpName = fileName + '.tmp';
    try {
      const tmpHandle = await dirHandle.getFileHandle(tmpName, { create: true });
      const writable = await tmpHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      await tmpHandle.move(fileName);
      return;
    } catch {
      FileArchiver.moveUnsupported = true;
      try { await dirHandle.removeEntry(tmpName); } catch { /* ignore */ }
      // One fallback write after first move failure; later calls go direct.
      await this.writeBlobDirect(dirHandle, fileName, blob);
    }
  }

  private async writeBlobDirect(
    dirHandle: FileSystemDirectoryHandle,
    fileName: string,
    blob: Blob
  ): Promise<void> {
    const handle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async ensureDirectory(
    parent: FileSystemDirectoryHandle,
    name: string
  ): Promise<FileSystemDirectoryHandle> {
    return parent.getDirectoryHandle(name, { create: true });
  }

  async ensureDirectoryPath(
    root: FileSystemDirectoryHandle,
    segments: string[]
  ): Promise<FileSystemDirectoryHandle> {
    let cur = root;
    for (const seg of segments) {
      if (!seg) continue;
      cur = await this.ensureDirectory(cur, seg);
    }
    return cur;
  }

  async fileExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
    try {
      await dir.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  async readFilesFromDirectory(dir: FileSystemDirectoryHandle): Promise<File[]> {
    const files: File[] = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file') continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      files.push(new File([file], name, { type: file.type || MimeType.type(name) }));
    }
    return files;
  }

  async copyDirectoryContents(
    src: FileSystemDirectoryHandle,
    dest: FileSystemDirectoryHandle,
    options?: { exclude?: Set<string> }
  ): Promise<void> {
    const exclude = options?.exclude;
    for await (const [name, handle] of src.entries()) {
      if (exclude?.has(name)) continue;
      if (handle.kind === 'file') {
        const file = await (handle as FileSystemFileHandle).getFile();
        await this.writeBlobToDirectory(dest, name, file);
      } else if (handle.kind === 'directory') {
        const childDest = await this.ensureDirectory(dest, name);
        await this.copyDirectoryContents(handle as FileSystemDirectoryHandle, childDest, options);
      }
    }
  }

  async removeDirectoryRecursive(parent: FileSystemDirectoryHandle, name: string): Promise<void> {
    try {
      await parent.removeEntry(name, { recursive: true });
    } catch (e) {
      // Idempotent: replace/prune often remove paths that were never created.
      if (e && (e as DOMException).name === 'NotFoundError') return;
      console.warn('removeDirectoryRecursive failed', name, e);
    }
  }

  /**
   * Write into name.next/ then replace name/ (best-effort atomic directory swap).
   */
  async replaceDirectoryFrom(
    parent: FileSystemDirectoryHandle,
    destName: string,
    source: FileSystemDirectoryHandle
  ): Promise<void> {
    const nextName = `${destName}.next`;
    await this.removeDirectoryRecursive(parent, nextName);
    const nextDir = await this.ensureDirectory(parent, nextName);
    await this.copyDirectoryContents(source, nextDir);
    await this.removeDirectoryRecursive(parent, destName);
    // File System Access has no rename-dir; copy next → dest then drop next.
    const destDir = await this.ensureDirectory(parent, destName);
    await this.copyDirectoryContents(nextDir, destDir);
    await this.removeDirectoryRecursive(parent, nextName);
  }
}

function toArrayOfFileList(fileList: FileList): File[] {
  let files: File[] = [];
  let length = fileList.length;
  for (let i = 0; i < length; i++) { files.push(fileList[i]); }
  return files;
}
