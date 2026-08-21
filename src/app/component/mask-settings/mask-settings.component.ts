import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';

import { ChatTab } from '@udonarium/chat-tab';
import { ChatTabList } from '@udonarium/chat-tab-list';
import { AudioStorage } from '@udonarium/core/file-storage/audio-storage';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { CutInList } from '@udonarium/cut-in-list';
import { GameTable } from '@udonarium/game-table';
import { GameTableMask } from '@udonarium/game-table-mask';
import { JUKEBOX_TRACK_COUNT } from '@udonarium/Jukebox';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ScenePresetList } from '@udonarium/scene-preset-list';
import {
  emptyMaskAppearanceSnap,
  emptyMaskTokenFxConfig,
  MaskAppearanceSnap,
  MaskTokenFxConfig,
} from '@udonarium/table-fx/mask-appearance';
import { TabletopClickAction, TabletopClickTabMode } from '@udonarium/tabletop-click-action';
import { TextNote } from '@udonarium/text-note';

import { FileSelecterComponent } from 'component/file-selecter/file-selecter.component';
import { ChatMessageService } from 'service/chat-message.service';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

type TokenFxFlag = keyof Pick<
  MaskTokenFxConfig,
  'isInverse' | 'isHollow' | 'isBlackPaint' | 'isGrayscale' | 'isSepia' | 'isWhitePaint' | 'isMatrix' | 'isFlipVertical' | 'isContrast'
>;

/** UI tab id: click-action kinds plus standing Token FX (tokenFxPassive). */
type MaskActionTabId = TabletopClickAction | 'tokenFxStand';

@Component({
  selector: 'mask-settings',
  templateUrl: './mask-settings.component.html',
  styleUrls: ['../shared/settings-ui.css', './mask-settings.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class MaskSettingsComponent implements OnInit, OnChanges, OnDestroy {
  @Input() mask: GameTableMask = null;
  @Input() embedded = false;

  isDragOver = false;
  /** Collapsed state for each enabled action panel (default: expanded). Persisted per mask. */
  private panelCollapsed: { [id: string]: boolean } = {};
  private static readonly PANEL_COLLAPSE_KEY = 'udonarium-mask-action-panel-collapsed';

  readonly trackIndexes = Array.from({ length: JUKEBOX_TRACK_COUNT }, (_, i) => i);

  readonly actions: { id: MaskActionTabId; icon: string; labelKey: string }[] = [
    { id: 'none', icon: 'block', labelKey: 'note.actionNone' },
    { id: 'chat', icon: 'chat', labelKey: 'note.actionChat' },
    { id: 'music', icon: 'music_note', labelKey: 'mask.actionMusic' },
    { id: 'cutin', icon: 'movie', labelKey: 'mask.actionCutin' },
    { id: 'note', icon: 'description', labelKey: 'mask.actionNote' },
    { id: 'table', icon: 'map', labelKey: 'note.actionTable' },
    { id: 'preset', icon: 'bookmark', labelKey: 'note.actionPreset' },
    { id: 'toggleAppearance', icon: 'flip', labelKey: 'mask.actionToggleAppearance' },
    { id: 'tokenFxStand', icon: 'accessibility_new', labelKey: 'mask.actionTokenFxStand' },
    { id: 'tokenFx', icon: 'touch_app', labelKey: 'mask.actionTokenFxClick' },
  ];

  readonly fxFlags: { key: TokenFxFlag; labelKey: string }[] = [
    { key: 'isInverse', labelKey: 'mask.fx.inverse' },
    { key: 'isFlipVertical', labelKey: 'mask.fx.flipVertical' },
    { key: 'isHollow', labelKey: 'mask.fx.blur' },
    { key: 'isGrayscale', labelKey: 'mask.fx.grayscale' },
    { key: 'isSepia', labelKey: 'mask.fx.sepia' },
    { key: 'isMatrix', labelKey: 'mask.fx.matrix' },
    { key: 'isContrast', labelKey: 'mask.fx.contrast' },
    { key: 'isBlackPaint', labelKey: 'mask.fx.blackSilhouette' },
    { key: 'isWhitePaint', labelKey: 'mask.fx.whiteSilhouette' },
  ];

  readonly blendOptions = [
    { value: 0, labelKey: 'mask.dynamic.4' },
    { value: 1, labelKey: 'mask.dynamic.5' },
    { value: 2, labelKey: 'mask.dynamic.6' },
  ];

  readonly borderOptions = [
    { value: 0, labelKey: 'mask.dynamic.1' },
    { value: 1, labelKey: 'mask.dynamic.2' },
    { value: 2, labelKey: 'mask.dynamic.3' },
  ];

  get tables(): GameTable[] { return ObjectStore.instance.getObjects(GameTable); }
  get presets() { return ScenePresetList.instance.presets; }
  get chatTabs() { return this.chatMessageService.chatTabs; }
  tabLabel(tab: ChatTab): string {
    if (!tab || tab.name === '') return this.i18n.t('chat.unnamedTab');
    return ChatTabList.localizedName(tab);
  }
  get audios() { return AudioStorage.instance.audios.filter(a => !a.isHidden); }
  get cutIns() { return CutInList.instance.cutIns; }
  get notes(): TextNote[] {
    const gm = !!PeerCursor.myCursor?.isGMMode;
    return ObjectStore.instance.getObjects(TextNote).filter(n => n?.canSeeSelfOnly || gm);
  }

  get altSnap(): MaskAppearanceSnap {
    return this.mask ? this.mask.appearanceAlt : emptyMaskAppearanceSnap();
  }

  /** Click FX config. */
  get tokenFx(): MaskTokenFxConfig {
    return this.mask ? this.mask.tokenFxConfig : emptyMaskTokenFxConfig();
  }

  /** Standing FX config. */
  get tokenFxStand(): MaskTokenFxConfig {
    return this.mask ? this.mask.tokenFxPassiveConfig : emptyMaskTokenFxConfig();
  }

  get altImageUrl(): string {
    const id = this.altSnap.imageIdentifier;
    if (!id) return '';
    return ImageStorage.instance.get(id)?.url || '';
  }

  constructor(
    private changeDetector: ChangeDetectorRef,
    private modalService: ModalService,
    private panelService: PanelService,
    private chatMessageService: ChatMessageService,
    private i18n: I18nService
  ) { }

  GuestMode() { return Network.GuestMode(); }

  ngOnInit() {
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', event => {
        if (this.mask && event.data?.identifier === this.mask.identifier) {
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_OBJECT_CHILDREN', event => {
        if (this.mask && event.data?.identifier === this.mask.identifier) {
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_FILE_RESOURE', () => this.changeDetector.markForCheck())
      .on('SYNCHRONIZE_FILE_LIST', () => this.changeDetector.markForCheck());
    if (this.mask) {
      this.mask.complement();
      this.loadPanelCollapsed();
    }
    this.refreshTitle();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['mask'] && this.mask) {
      this.mask.complement();
      this.loadPanelCollapsed();
      this.refreshTitle();
    }
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  isActionOn(action: TabletopClickAction): boolean {
    return !!this.mask && this.mask.hasClickActionKind(action);
  }

  /** Standing FX is independent of Alt+click (tokenFxPassive SyncVar). */
  get isTokenFxStandOn(): boolean {
    return !!this.mask?.tokenFxPassive;
  }

  get isTokenFxClickOn(): boolean {
    return this.isActionOn('tokenFx');
  }

  /** Panels area visible when any click action or standing FX is on. */
  get showActionPanels(): boolean {
    return !!this.mask && (this.mask.hasAnyClickAction || this.isTokenFxStandOn);
  }

  isTabActive(id: MaskActionTabId): boolean {
    if (!this.mask) return false;
    if (id === 'none') return !this.mask.hasAnyClickAction && !this.isTokenFxStandOn;
    if (id === 'tokenFxStand') return this.isTokenFxStandOn;
    return this.isActionOn(id);
  }

  isPanelExpanded(action: string): boolean {
    return !this.panelCollapsed[action];
  }

  togglePanel(action: string, e?: Event) {
    e?.preventDefault();
    e?.stopPropagation();
    this.panelCollapsed[action] = !this.panelCollapsed[action];
    this.savePanelCollapsed();
    this.changeDetector.markForCheck();
  }

  /** Multi-select toggle. "none" clears all click actions + standing FX. */
  setClickAction(action: MaskActionTabId) {
    if (!this.mask || this.GuestMode()) return;
    if (action === 'none') {
      this.mask.setEnabledClickActions([]);
      this.mask.tokenFxPassive = false;
    } else if (action === 'tokenFxStand') {
      const wasOn = this.isTokenFxStandOn;
      this.mask.tokenFxPassive = !wasOn;
      if (!wasOn) {
        this.panelCollapsed['tokenFxStand'] = false;
        this.savePanelCollapsed();
      }
    } else {
      const wasOn = this.isActionOn(action);
      this.mask.toggleClickAction(action);
      if (!wasOn) {
        this.panelCollapsed[action] = false;
        this.savePanelCollapsed();
      }
    }
    this.changeDetector.markForCheck();
  }

  private loadPanelCollapsed() {
    const maskId = this.mask?.identifier;
    if (!maskId) {
      this.panelCollapsed = {};
      return;
    }
    try {
      const raw = localStorage.getItem(MaskSettingsComponent.PANEL_COLLAPSE_KEY);
      if (!raw) {
        this.panelCollapsed = {};
        return;
      }
      const all = JSON.parse(raw);
      const entry = all && typeof all === 'object' ? all[maskId] : null;
      this.panelCollapsed = entry && typeof entry === 'object' ? { ...entry } : {};
    } catch {
      this.panelCollapsed = {};
    }
  }

  private savePanelCollapsed() {
    const maskId = this.mask?.identifier;
    if (!maskId) return;
    try {
      let all: { [maskId: string]: { [action: string]: boolean } } = {};
      const raw = localStorage.getItem(MaskSettingsComponent.PANEL_COLLAPSE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') all = parsed;
      }
      all[maskId] = { ...this.panelCollapsed };
      localStorage.setItem(MaskSettingsComponent.PANEL_COLLAPSE_KEY, JSON.stringify(all));
    } catch {
      /* ignore quota / private mode */
    }
  }

  setTabMode(mode: TabletopClickTabMode) {
    if (!this.mask || this.GuestMode()) return;
    this.mask.clickTabMode = mode;
    this.changeDetector.markForCheck();
  }

  setBlendType(value: number) {
    if (!this.mask || this.GuestMode()) return;
    this.mask.mutateAppearance(() => { this.mask.blendType = value; });
    this.changeDetector.markForCheck();
  }

  setBorderType(value: number) {
    if (!this.mask || this.GuestMode()) return;
    this.mask.mutateAppearance(() => { this.mask.borderType = value; });
    this.changeDetector.markForCheck();
  }

  setAppearanceFlag(key: 'isLock' | 'affectsLight' | 'isAltitudeIndicate', value: boolean) {
    if (!this.mask || this.GuestMode()) return;
    this.mask.mutateAppearance(() => { (this.mask as any)[key] = value; });
    this.changeDetector.markForCheck();
  }

  setTextAlignH(value: string) {
    if (!this.mask || this.GuestMode()) return;
    this.mask.mutateAppearance(() => { this.mask.textAlignH = value; });
    this.changeDetector.markForCheck();
  }

  setTextAlignV(value: string) {
    if (!this.mask || this.GuestMode()) return;
    this.mask.mutateAppearance(() => { this.mask.textAlignV = value; });
    this.changeDetector.markForCheck();
  }

  patchAlt(partial: Partial<MaskAppearanceSnap>) {
    if (!this.mask || this.GuestMode()) return;
    this.mask.appearanceAlt = { ...this.altSnap, ...partial };
    this.changeDetector.markForCheck();
  }

  patchTokenFx(partial: Partial<MaskTokenFxConfig>) {
    if (!this.mask || this.GuestMode()) return;
    this.mask.tokenFxConfig = { ...this.tokenFx, ...partial };
    this.changeDetector.markForCheck();
  }

  patchTokenFxStand(partial: Partial<MaskTokenFxConfig>) {
    if (!this.mask || this.GuestMode()) return;
    this.mask.tokenFxPassiveConfig = { ...this.tokenFxStand, ...partial };
    this.changeDetector.markForCheck();
  }

  setTokenFxFlag(key: TokenFxFlag, checked: boolean) {
    this.patchTokenFx({ [key]: !!checked } as Partial<MaskTokenFxConfig>);
  }

  setTokenFxStandFlag(key: TokenFxFlag, checked: boolean) {
    this.patchTokenFxStand({ [key]: !!checked } as Partial<MaskTokenFxConfig>);
  }

  copyCurrentToAlt() {
    if (!this.mask || this.GuestMode()) return;
    this.mask.appearanceAlt = this.mask.captureAppearanceSnap();
    this.changeDetector.markForCheck();
  }

  openImage() {
    if (!this.mask || this.GuestMode()) return;
    const current = this.mask.imageFile?.identifier || '';
    this.modalService.open<string>(FileSelecterComponent, {
      isAllowedEmpty: true,
      currentImageIdentifires: current ? [current] : []
    }).then(value => {
      if (value == null) return;
      this.mask.setImage(value);
      this.changeDetector.markForCheck();
    });
  }

  openAltImage() {
    if (!this.mask || this.GuestMode()) return;
    const current = this.altSnap.imageIdentifier || '';
    this.modalService.open<string>(FileSelecterComponent, {
      isAllowedEmpty: true,
      currentImageIdentifires: current ? [current] : []
    }).then(value => {
      if (value == null) return;
      this.patchAlt({ imageIdentifier: value || '' });
    });
  }

  clearImage() {
    if (!this.mask || this.GuestMode()) return;
    this.mask.setImage('');
    this.changeDetector.markForCheck();
  }

  clearAltImage() {
    this.patchAlt({ imageIdentifier: '' });
  }

  onDragOver(e: DragEvent) {
    if (this.GuestMode()) return;
    if (!this.hasImageFile(e)) return;
    e.preventDefault();
    e.stopPropagation();
    this.isDragOver = true;
  }

  onDragLeave(e: DragEvent) {
    e.preventDefault();
    this.isDragOver = false;
  }

  async onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.isDragOver = false;
    if (!this.mask || this.GuestMode()) return;
    const file = this.firstImageFile(e);
    if (!file) return;
    try {
      const image = await ImageStorage.instance.addAsync(file);
      this.mask.setImage(image.identifier);
      this.changeDetector.markForCheck();
    } catch (err) {
      console.warn('mask image drop failed', err);
    }
  }

  resetColors() {
    if (!this.mask || this.GuestMode()) return;
    this.mask.color = '#555555';
    this.mask.bgcolor = '#0a0a0a';
    this.changeDetector.markForCheck();
  }

  private hasImageFile(e: DragEvent): boolean {
    const items = e.dataTransfer?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && (items[i].type || '').startsWith('image/')) return true;
      }
    }
    const files = e.dataTransfer?.files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        if ((files[i].type || '').startsWith('image/')) return true;
      }
    }
    return false;
  }

  private firstImageFile(e: DragEvent): File | null {
    const files = e.dataTransfer?.files;
    if (!files) return null;
    for (let i = 0; i < files.length; i++) {
      if ((files[i].type || '').startsWith('image/')) return files[i];
    }
    return null;
  }

  private refreshTitle() {
    if (this.embedded || !this.mask) return;
    let title = this.i18n.t('mask.panelTitle');
    if (this.mask.name?.length) title += ' - ' + this.mask.name;
    this.panelService.title = title;
  }
}
