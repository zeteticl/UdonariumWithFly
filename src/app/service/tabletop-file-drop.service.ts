import { Injectable } from '@angular/core';

import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { FileArchiver } from '@udonarium/core/file-storage/file-archiver';
import { IMAGE_SOURCE_MAX_BYTES } from '@udonarium/core/file-storage/image-normalize';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { MimeType } from '@udonarium/core/file-storage/mime-type';
import { DiceSymbol, DiceType } from '@udonarium/dice-symbol';
import { GameCharacter } from '@udonarium/game-character';
import { GameTableMask } from '@udonarium/game-table-mask';
import { fitGameTableSizeToImage } from '@udonarium/game-table-fit';
import { Network } from '@udonarium/core/system';
import { ImageTag } from '@udonarium/image-tag';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TableSelecter } from '@udonarium/table-selecter';
import { Terrain } from '@udonarium/terrain';
import { classifyNoteFile, NoteFileKind } from '@udonarium/note-file-kind';
import {
  dropLooksLikeModelPackage,
  importModelAsTerrain,
  modelImportErrorI18nKey,
} from '@udonarium/terrain-model/model-terrain-import';
import { MODEL_MAX_FILE_BYTES } from '@udonarium/terrain-model/mesh-ir';
import { expandModelDropFiles, isBlendFile, isZipFile, packagePathOf } from '@udonarium/terrain-model/model-package-files';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { DropCreateChooserComponent, DropCreateChoice } from 'component/drop-create-chooser/drop-create-chooser.component';
import { footprintDebug } from '@udonarium/terrain-model/footprint-debug';
import { MovableDirective } from 'directive/movable.directive';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { NoteImportService } from 'service/note-import.service';
import { PointerCoordinate } from 'service/pointer-device.service';
import { TabletopSelectionService } from 'service/tabletop-selection.service';
import { TerrainBakeCropService } from 'service/terrain-bake-crop.service';

const MEGA = 1024 * 1024;
const MAX_IMAGE = IMAGE_SOURCE_MAX_BYTES;
const MAX_PDF = 20 * MEGA;
const MAX_VIDEO = 50 * MEGA;
const MAX_AUDIO = 20 * MEGA;
const MAX_MODEL = MODEL_MAX_FILE_BYTES;

type DropKind = NoteFileKind | 'model' | 'model-sidecar' | 'audio';
type DropChoice =
  | 'token' | 'note' | 'card' | 'stack' | 'terrain' | 'terrainBake' | 'mask' | 'coin' | 'library'
  | 'tableMap' | 'tableBackground' | 'jukebox';

const CLIPBOARD_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'application/pdf': 'pdf',
};

/** Files from a drop or Ctrl+V clipboard. Screenshots become `clipboard.png` when unnamed. */
export function filesFromDataTransfer(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const out: File[] = [];
  const seen = new Set<string>();
  const add = (file: File | null | undefined) => {
    if (!file) return;
    const named = ensureClipboardFileName(file);
    const key = `${named.name}:${named.size}:${named.lastModified}:${named.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(named);
  };
  const items = dt.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== 'file') continue;
      add(item.getAsFile());
    }
  }
  if (!out.length && dt.files) {
    for (let i = 0; i < dt.files.length; i++) add(dt.files[i]);
  }
  return out;
}

function ensureClipboardFileName(file: File): File {
  if ((file.name || '').trim()) return file;
  const type = (file.type || '').toLowerCase();
  const ext = CLIPBOARD_EXT[type] || (type.startsWith('image/') ? 'png' : 'bin');
  return new File([file], `clipboard.${ext}`, {
    type: file.type || 'application/octet-stream',
    lastModified: file.lastModified,
  });
}

@Injectable({ providedIn: 'root' })
export class TabletopFileDropService {
  private busy = false;

  constructor(
    private modalService: ModalService,
    private noteImport: NoteImportService,
    private i18n: I18nService,
    private bakeCrop: TerrainBakeCropService,
    private selection: TabletopSelectionService,
  ) { }

  hasFileDrag(e: DragEvent): boolean {
    if (e.dataTransfer?.files?.length) return true;
    const types = Array.from(e.dataTransfer?.types || []);
    if (types.includes('Files')) return true;
    const items = e.dataTransfer?.items;
    if (!items) return false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') return true;
    }
    return false;
  }

  /**
   * Sync gate for Ctrl+V: only claim the paste when at least one file looks usable.
   * Avoids preventDefault on blend-only / junk file items that would block further handling.
   */
  looksAcceptable(files: File[]): boolean {
    for (const file of files || []) {
      if (isBlendFile(file)) continue;
      if (isZipFile(file) || /\.zip$/i.test(packagePathOf(file))) return true;
      if (this.classify(file, false)) return true;
      if (/\.(stl|obj|glb|gltf|fbx)$/i.test(file.name || '')) return true;
    }
    return false;
  }

  /** Table drop and Ctrl+V (OS files / screenshot) share this chooser. */
  async handleDrop(files: FileList | File[], position: PointerCoordinate): Promise<void> {
    if (this.busy || Network.GuestMode()) return;
    const raw = Array.from(files || []);
    this.busy = true;
    try {
      let expanded: File[];
      try {
        expanded = await expandModelDropFiles(raw);
      } catch (err) {
        const key = modelImportErrorI18nKey(err);
        void this.modalService.open(ConfirmationComponent, {
          title: this.i18n.t('modelImport.errorTitle'),
          text: this.i18n.t(key),
          type: ConfirmationType.OK,
          okLabel: this.i18n.t('common.ok'),
        });
        return;
      }
      const asModelPackage = dropLooksLikeModelPackage(expanded);
      const accepted = this.filterAccepted(expanded, asModelPackage);
      if (!accepted.length) return;
      const images = accepted.filter(f => this.classify(f, asModelPackage) === 'image');
      const notes = accepted.filter(f => this.isNoteCapable(f, asModelPackage));
      const audios = accepted.filter(f => this.classify(f, asModelPackage) === 'audio');
      const modelFiles = asModelPackage ? accepted : [];
      const choices = this.buildChoices(
        images.length,
        notes.length,
        audios.length,
        accepted.length,
        modelFiles.length > 0,
      );
      if (!choices.length) return;

      const defaultChoice = this.defaultChoice(choices, {
        hasModel: modelFiles.length > 0,
        imageCount: images.length,
        noteCount: notes.length,
        audioCount: audios.length,
      });

      const result = await this.modalService.open<{ choice: string } | false | null>(DropCreateChooserComponent, {
        title: this.i18n.t('dropCreate.subtitle', { count: accepted.length }),
        text: this.i18n.t('dropCreate.text', { count: accepted.length }),
        help: this.i18n.t('dropCreate.help'),
        okLabel: this.i18n.t('dropCreate.ok'),
        cancelLabel: this.i18n.t('common.cancel'),
        choices,
        choiceValue: defaultChoice,
        panelWidth: '440px',
      });

      if (!result || !result.choice) return;
      const created = await this.create(
        result.choice as DropChoice,
        accepted,
        images,
        notes,
        audios,
        modelFiles,
        position,
      );
      if (created) SoundEffect.play(PresetSound.cardPut);
    } finally {
      this.busy = false;
    }
  }

  private buildChoices(
    imageCount: number,
    noteCount: number,
    audioCount: number,
    totalCount: number,
    hasModelPackage: boolean,
  ): DropCreateChoice[] {
    const choices: DropCreateChoice[] = [];
    if (hasModelPackage) {
      choices.push({
        id: 'terrainBake',
        label: this.i18n.t('dropCreate.terrainBake'),
        icon: 'view_in_ar',
        hint: this.i18n.t('dropCreate.hint.terrainBake'),
      });
    }
    if (imageCount > 0) {
      // Single image: allow replacing the current table map / background.
      if (imageCount === 1 && TableSelecter.instance.viewTable) {
        choices.push({
          id: 'tableMap',
          label: this.i18n.t('dropCreate.tableMap'),
          icon: 'map',
          hint: this.i18n.t('dropCreate.hint.tableMap'),
        });
        choices.push({
          id: 'tableBackground',
          label: this.i18n.t('dropCreate.tableBackground'),
          icon: 'wallpaper',
          hint: this.i18n.t('dropCreate.hint.tableBackground'),
        });
      }
      choices.push({
        id: 'token',
        label: this.i18n.t('dropCreate.token', { count: imageCount }),
        icon: 'person',
        hint: this.i18n.t('dropCreate.hint.token'),
      });
      choices.push({
        id: 'card',
        label: this.i18n.t('dropCreate.card', { count: imageCount }),
        icon: 'style',
        hint: this.i18n.t('dropCreate.hint.card'),
      });
      if (imageCount >= 2) {
        choices.push({
          id: 'stack',
          label: this.i18n.t('dropCreate.stack', { count: imageCount }),
          icon: 'layers',
          hint: this.i18n.t('dropCreate.hint.stack'),
        });
      }
      choices.push({
        id: 'terrain',
        label: this.i18n.t('dropCreate.terrain'),
        icon: 'landscape',
        hint: this.i18n.t('dropCreate.hint.terrain'),
      });
      choices.push({
        id: 'mask',
        label: this.i18n.t('dropCreate.mask', { count: imageCount }),
        icon: 'layers_clear',
        hint: this.i18n.t('dropCreate.hint.mask'),
      });
      choices.push({
        id: 'coin',
        label: this.i18n.t('dropCreate.coin'),
        icon: 'monetization_on',
        hint: this.i18n.t('dropCreate.hint.coin'),
      });
    }
    if (noteCount > 0) {
      choices.push({
        id: 'note',
        label: this.i18n.t('dropCreate.note', { count: noteCount }),
        icon: 'description',
        hint: this.i18n.t('dropCreate.hint.note'),
      });
    }
    if (audioCount > 0) {
      choices.push({
        id: 'jukebox',
        label: this.i18n.t('dropCreate.jukebox', { count: audioCount }),
        icon: 'library_music',
        hint: this.i18n.t('dropCreate.hint.jukebox'),
      });
    }
    // Skip "library only" when the batch is audio-only — jukebox is the storage path.
    if (totalCount > 0 && totalCount > audioCount) {
      choices.push({
        id: 'library',
        label: this.i18n.t('dropCreate.library', { count: totalCount }),
        icon: 'photo_library',
        hint: this.i18n.t('dropCreate.hint.library'),
      });
    }
    return choices;
  }

  private defaultChoice(
    choices: DropCreateChoice[],
    counts: { hasModel: boolean; imageCount: number; noteCount: number; audioCount: number },
  ): string {
    if (counts.hasModel && choices.some(c => c.id === 'terrainBake')) return 'terrainBake';
    if (counts.imageCount > 0 && choices.some(c => c.id === 'token')) return 'token';
    if (counts.noteCount > 0 && choices.some(c => c.id === 'note')) return 'note';
    if (counts.audioCount > 0 && choices.some(c => c.id === 'jukebox')) return 'jukebox';
    return choices[0]?.id || '';
  }

  private async create(
    choice: DropChoice,
    accepted: File[],
    images: File[],
    notes: File[],
    audios: File[],
    modelFiles: File[],
    position: PointerCoordinate,
  ): Promise<boolean> {
    switch (choice) {
      case 'token':
        return this.createTokens(images, position);
      case 'note': {
        const created = await this.noteImport.importFiles(notes, { addToTable: true, position });
        return created.length > 0;
      }
      case 'card':
        return this.createCards(images, position);
      case 'stack':
        return this.createCardStack(images, position);
      case 'terrain':
        return this.createTerrain(images, position);
      case 'terrainBake':
        return this.createTerrainFromModel(modelFiles.length ? modelFiles : accepted, position);
      case 'mask':
        return this.createMasks(images, position);
      case 'coin':
        return this.createCoin(images, position);
      case 'tableMap':
        return this.replaceTableImage(images, 'map');
      case 'tableBackground':
        return this.replaceTableImage(images, 'background');
      case 'jukebox':
        return this.importToJukebox(audios);
      case 'library':
        return this.importToLibrary(accepted);
      default:
        return false;
    }
  }

  private async createTerrainFromModel(files: File[], position: PointerCoordinate): Promise<boolean> {
    try {
      const preview = await this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('modelImport.previewAskTitle'),
        text: this.i18n.t('modelImport.previewAsk'),
        type: ConfirmationType.OK_CANCEL,
        okLabel: this.i18n.t('modelImport.previewAskOk'),
        cancelLabel: this.i18n.t('modelImport.previewAskSkip'),
      });
      await importModelAsTerrain(files, position, {
        previewBox: preview === true ? (ctx) => this.bakeCrop.previewImportBox(ctx) : undefined,
      }).then(result => {
        if (result.terrains.length > 1) {
          // Sync screen poses after Angular mounts movables; select afterward so
          // self-UPDATE while selected cannot skip the footprint layout.
          setTimeout(() => {
            const before = result.terrains.map(t => ({
              name: t.name,
              location: { ...t.location },
              pose: t.getPoseForView(),
            }));
            for (const t of result.terrains) {
              const pose = t.getPoseForView();
              MovableDirective.syncPoseFromUndo(t, pose.x, pose.y, pose.posZ);
            }
            footprintDebug('fileDrop syncMovable+select', {
              before,
              afterPose: result.terrains.map(t => ({
                name: t.name,
                pose: t.getPoseForView(),
              })),
              poseYSpan: (() => {
                const ys = result.terrains.map(t => t.getPoseForView().y);
                return +(Math.max(...ys) - Math.min(...ys)).toFixed(2);
              })(),
            });
            this.selection.clear();
            for (const t of result.terrains) this.selection.add(t);
          }, 0);
        }
      });
      return true;
    } catch (err) {
      if (err instanceof Error && err.message === 'MODEL_IMPORT_CANCELLED') return false;
      const key = modelImportErrorI18nKey(err);
      void this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('modelImport.errorTitle'),
        text: this.i18n.t(key),
        type: ConfirmationType.OK,
        okLabel: this.i18n.t('common.ok'),
      });
      return false;
    }
  }
  /** Replace current viewed table's map or background with the dropped image. */
  private async replaceTableImage(files: File[], slot: 'map' | 'background'): Promise<boolean> {
    if (!files.length) return false;
    const table = TableSelecter.instance.viewTable;
    if (!table) return false;
    const image = await ImageStorage.instance.addAsync(files[0]);
    if (slot === 'map') {
      table.imageIdentifier = image.identifier;
      // Match grid cells to image pixels at current gridSize (aspect-preserving clamp).
      await fitGameTableSizeToImage(table, image);
    } else {
      table.backgroundImageIdentifier = image.identifier;
    }
    return true;
  }

  /** Audio → FileArchiver (jukebox / audio library). */
  private async importToJukebox(files: File[]): Promise<boolean> {
    if (!files.length) return false;
    await FileArchiver.instance.load(files);
    return true;
  }

  /** Media → FileArchiver; text/json/xml/html → note inventory (or room XML via archiver). */
  private async importToLibrary(files: File[]): Promise<boolean> {
    const media: File[] = [];
    const noteFiles: File[] = [];
    for (const file of files) {
      const kind = this.classify(file, false);
      if (kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'audio') media.push(file);
      else if (kind === 'text') noteFiles.push(file);
    }
    let ok = false;
    if (media.length) {
      await FileArchiver.instance.load(media);
      ok = true;
    }
    // Room XML etc. still go through FileArchiver text/xml path.
    const xmlLike = noteFiles.filter(f => this.isXmlLike(f));
    const plainText = noteFiles.filter(f => !this.isXmlLike(f));
    if (xmlLike.length) {
      await FileArchiver.instance.load(xmlLike);
      ok = true;
    }
    if (plainText.length) {
      const created = await this.noteImport.importFiles(plainText, { addToTable: false });
      if (created.length) ok = true;
    }
    return ok;
  }

  private isXmlLike(file: File): boolean {
    const type = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    return type === 'application/xml' || type === 'text/xml' || name.endsWith('.xml');
  }

  private async createTokens(files: File[], position: PointerCoordinate): Promise<boolean> {
    if (!files.length) return false;
    const grid = 50;
    for (let i = 0; i < files.length; i++) {
      const image = await ImageStorage.instance.addAsync(files[i]);
      const name = this.baseName(files[i].name) || this.i18n.t('action.newCharacter');
      const character = GameCharacter.create(name, 1, image.identifier);
      const col = i % 5;
      const row = Math.floor(i / 5);
      character.location.x = position.x - 25 + col * grid;
      character.location.y = position.y - 25 + row * grid;
      character.posZ = position.z;
      character.setLocation('table');
    }
    return true;
  }

  private async createCards(files: File[], position: PointerCoordinate): Promise<boolean> {
    if (!files.length) return false;
    const backId = this.ensureDefaultCardBack();
    const grid = 50;
    for (let i = 0; i < files.length; i++) {
      const image = await ImageStorage.instance.addAsync(files[i]);
      const name = this.baseName(files[i].name) || this.i18n.t('action.cardName');
      const card = Card.create(name, image.identifier, backId);
      const col = i % 5;
      const row = Math.floor(i / 5);
      card.location.x = position.x - 25 + col * grid;
      card.location.y = position.y - 25 + row * grid;
      card.posZ = position.z;
      card.setLocation('table');
    }
    return true;
  }

  private async createCardStack(files: File[], position: PointerCoordinate): Promise<boolean> {
    if (!files.length) return false;
    const backId = this.ensureDefaultCardBack();
    const stack = CardStack.create(this.i18n.t('dropCreate.stackName'));
    stack.location.x = position.x - 25;
    stack.location.y = position.y - 25;
    stack.posZ = position.z;
    stack.setLocation('table');
    for (const file of files) {
      const image = await ImageStorage.instance.addAsync(file);
      const name = this.baseName(file.name) || this.i18n.t('action.cardName');
      stack.putOnBottom(Card.create(name, image.identifier, backId));
    }
    return true;
  }

  private async createTerrain(files: File[], position: PointerCoordinate): Promise<boolean> {
    if (!files.length) return false;
    const viewTable = TableSelecter.instance.viewTable;
    if (!viewTable) return false;
    const wall = await ImageStorage.instance.addAsync(files[0]);
    const floor = files[1]
      ? await ImageStorage.instance.addAsync(files[1])
      : wall;
    const name = this.baseName(files[0].name) || this.i18n.t('action.terrainName');
    const terrain = Terrain.create(name, 2, 2, 2, wall.identifier, floor.identifier);
    terrain.location.x = position.x - 50;
    terrain.location.y = position.y - 50;
    terrain.posZ = position.z;
    viewTable.appendChild(terrain);
    return true;
  }

  private async createMasks(files: File[], position: PointerCoordinate): Promise<boolean> {
    if (!files.length) return false;
    const viewTable = TableSelecter.instance.viewTable;
    if (!viewTable) return false;
    const grid = 50;
    for (let i = 0; i < files.length; i++) {
      const image = await ImageStorage.instance.addAsync(files[i]);
      const name = this.baseName(files[i].name) || this.i18n.t('action.mapMaskName');
      const mask = GameTableMask.create(name, 5, 5, 100);
      mask.setImage(image.identifier);
      const col = i % 5;
      const row = Math.floor(i / 5);
      mask.location.x = position.x - 25 + col * grid;
      mask.location.y = position.y - 25 + row * grid;
      mask.posZ = position.z;
      viewTable.appendChild(mask);
    }
    return true;
  }

  private async createCoin(files: File[], position: PointerCoordinate): Promise<boolean> {
    if (!files.length) return false;
    const headsImg = await ImageStorage.instance.addAsync(files[0]);
    const tailsImg = files[1]
      ? await ImageStorage.instance.addAsync(files[1])
      : headsImg;
    const name = this.baseName(files[0].name) || this.i18n.t('action.coinName');
    const coin = DiceSymbol.create(name, DiceType.D2, 1);
    const faces = coin.faces;
    if (faces[0]) coin.imageDataElement.getFirstElementByName(faces[0]).value = headsImg.identifier;
    if (faces[1]) coin.imageDataElement.getFirstElementByName(faces[1]).value = tailsImg.identifier;
    coin.face = faces[0] || coin.face;
    coin.location.x = position.x - 25;
    coin.location.y = position.y - 25;
    coin.posZ = position.z;
    coin.setLocation('table');
    return true;
  }

  private ensureDefaultCardBack(): string {
    const backUrl = './assets/images/trump/z01.gif';
    let back = ImageStorage.instance.get(backUrl);
    if (!back) {
      back = ImageStorage.instance.add(backUrl);
      ImageTag.create(back.identifier).tag = '*default ' + this.i18n.t('action.cardName');
    }
    return back.identifier;
  }

  private filterAccepted(files: File[], asModelPackage: boolean): File[] {
    const out: File[] = [];
    for (const file of files) {
      const kind = this.classify(file, asModelPackage);
      if (!kind) continue;
      if (!this.withinSize(file, kind)) continue;
      out.push(file);
    }
    return out;
  }

  private classify(file: File, asModelPackage = false): DropKind | null {
    const name = (file.name || '').toLowerCase();
    const path = packagePathOf(file);
    if (/\.(stl|obj|glb|gltf|fbx)$/i.test(name) || /\.(stl|obj|glb|gltf|fbx)$/i.test(path)) return 'model';
    if (/\.(mtl|bin)$/i.test(name) || /\.(mtl|bin)$/i.test(path)) return asModelPackage ? 'model-sidecar' : null;
    // Textures only join the bag when this drop is already a model package.
    if (asModelPackage && /\.(png|jpe?g|webp|gif|bmp)$/i.test(name)) return 'model-sidecar';
    if (isZipFile(file)) return null;
    // Before note video: audio/ogg and .mp3 etc. belong in the jukebox, not notes.
    if (MimeType.isAudioFile(file)) return 'audio';
    return classifyNoteFile(file);
  }

  private isNoteCapable(file: File, asModelPackage = false): boolean {
    const kind = this.classify(file, asModelPackage);
    return kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'text';
  }

  private withinSize(file: File, kind: DropKind): boolean {
    if (kind === 'image' && file.size > MAX_IMAGE) return false;
    if (kind === 'pdf' && file.size > MAX_PDF) return false;
    if (kind === 'video' && file.size > MAX_VIDEO) return false;
    if (kind === 'audio' && file.size > MAX_AUDIO) return false;
    if ((kind === 'model' || kind === 'model-sidecar') && file.size > MAX_MODEL) return false;
    return true;
  }

  private baseName(fileName: string): string {
    return (fileName || '').replace(/\.[^.]+$/, '').trim();
  }
}
