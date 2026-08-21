import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { Network } from './core/system';
import { DataElement } from './data-element';
import { PeerCursor } from './peer-cursor';
import {
  emptyMaskAppearanceSnap,
  emptyMaskTokenFxConfig,
  MaskAppearanceSnap,
  MaskTokenFxConfig,
  parseMaskAppearanceSnap,
  parseMaskTokenFxConfig,
  stringifyMaskAppearanceSnap,
  stringifyMaskTokenFxConfig,
} from './table-fx/mask-appearance';
import {
  hostHasClickAction,
  hostHasClickActionKind,
  parseClickActionsJson,
  resolveEnabledClickActions,
  stringifyClickActions,
  TabletopClickAction,
  TabletopClickTabMode,
} from './tabletop-click-action';
import { TabletopObject } from './tabletop-object';
import { moveToBackmost, moveToTopmost, moveToTopmostInTier } from './tabletop-object-util';
import { TableSelecter } from './table-selecter';

@SyncObject('table-mask')
export class GameTableMask extends TabletopObject {
  @SyncVar() isLock: boolean = false;
  /** Dense paint order among layer peers (reconcile puts masks above desk). */
  @SyncVar() zindex: number = 0;
  @SyncVar() blendType: number = 0;
  @SyncVar() isTransparentOnGMMode: boolean = false;

  @SyncVar() owner: string = '';
  @SyncVar() scratchingGrids: string = '';
  @SyncVar() scratchedGrids: string = '';
  @SyncVar() isScratchPreviewOnGMMode = false;
  @SyncVar() isPreview = false;

  /**
   * Masks are GameTable children (not location/placement tokens).
   * Parent === current view table ⇒ on the desktop for [ ] / caches.
   */
  get isVisibleOnTable(): boolean {
    const view = TableSelecter.instance?.viewTable;
    return !!view && this.parent === view;
  }

  @SyncVar() borderType = 1; // 0:不顯示 1:僅未鎖定時顯示 2:一律顯示
  /**
   * Overlay text anchor (Word-style): `{vertical}-{horizontal}`
   * vertical: top|middle|bottom · horizontal: left|center|right
   */
  @SyncVar() textPosition: string = 'middle-center';

  static readonly TEXT_ALIGN_V = ['top', 'middle', 'bottom'] as const;
  static readonly TEXT_ALIGN_H = ['left', 'center', 'right'] as const;

  get textAlignV(): 'top' | 'middle' | 'bottom' {
    const v = (this.textPosition || 'middle-center').split('-')[0];
    return (GameTableMask.TEXT_ALIGN_V as readonly string[]).includes(v)
      ? v as 'top' | 'middle' | 'bottom'
      : 'middle';
  }
  set textAlignV(v: string) {
    const vert = (GameTableMask.TEXT_ALIGN_V as readonly string[]).includes(v) ? v : 'middle';
    this.mutateAppearance(() => { this.textPosition = `${vert}-${this.textAlignH}`; });
  }

  get textAlignH(): 'left' | 'center' | 'right' {
    const parts = (this.textPosition || 'middle-center').split('-');
    const h = parts[1] || 'center';
    return (GameTableMask.TEXT_ALIGN_H as readonly string[]).includes(h)
      ? h as 'left' | 'center' | 'right'
      : 'center';
  }
  set textAlignH(h: string) {
    const horiz = (GameTableMask.TEXT_ALIGN_H as readonly string[]).includes(h) ? h : 'center';
    this.mutateAppearance(() => { this.textPosition = `${this.textAlignV}-${horiz}`; });
  }
  /** When true, footprint blocks light and vision (opt-in; floors stay open by default). */
  @SyncVar() affectsLight: boolean = false;

  /** Legacy single action; kept in sync with clickActionsJson[0] or 'none'. */
  @SyncVar() clickAction: TabletopClickAction = 'none';
  /** Multi-select enabled actions JSON array (preferred). */
  @SyncVar() clickActionsJson: string = '';
  /** Chat / dice text. */
  @SyncVar() clickPayload: string = '';
  @SyncVar() clickGameType: string = 'DiceBot';
  @SyncVar() clickTabMode: TabletopClickTabMode = 'current';
  @SyncVar() clickTabId: string = '';
  @SyncVar() clickMusicTrack: number = 0;
  @SyncVar() clickMusicLoop: boolean = true;
  @SyncVar() clickMusicId: string = '';
  @SyncVar() clickCutinId: string = '';
  @SyncVar() clickNoteId: string = '';
  @SyncVar() clickTableId: string = '';
  @SyncVar() clickPresetId: string = '';

  /** Locked “default” appearance for A/B toggle (JSON). */
  @SyncVar() appearanceDefaultJson: string = '';
  /** Alternate appearance set (JSON). */
  @SyncVar() appearanceAltJson: string = '';
  /** True when currently showing the alt appearance. */
  @SyncVar() appearanceIsAlt: boolean = false;

  /** Image FX + altitude for Alt+double-click action `tokenFx` (JSON). */
  @SyncVar() tokenFxJson: string = '';
  /** Image FX + altitude for standing-on-mask auto apply (JSON). Independent of tokenFxJson. */
  @SyncVar() tokenFxPassiveJson: string = '';
  /** When true, standing on the mask auto-applies tokenFxPassiveJson. */
  @SyncVar() tokenFxPassive: boolean = false;

  get name(): string { return this.getCommonValue('name', ''); }
  set name(name: string) { this.setCommonValue('name', name); }
  get width(): number { return this.getCommonValue('width', 1); }
  set width(width: number) { this.setCommonValue('width', width); }
  get height(): number { return this.getCommonValue('height', 1); }
  set height(height: number) { this.setCommonValue('height', height); }
  get opacity(): number {
    let element = this.getElement('opacity', this.commonDataElement);
    let num = element ? <number>element.currentValue / <number>element.value : 1;
    return Number.isNaN(num) ? 1 : num;
  }
  /** UI percent 0–100 (numberResource currentValue). */
  get opacityPercent(): number {
    const element = this.getElement('opacity', this.commonDataElement);
    if (!element) return 100;
    const n = Number(element.currentValue);
    return Number.isNaN(n) ? 100 : n;
  }
  set opacityPercent(percent: number) {
    const element = this.getElement('opacity', this.commonDataElement);
    if (!element) return;
    const max = Number(element.value) || 100;
    const n = Math.max(0, Math.min(max, Number(percent)));
    element.currentValue = Number.isNaN(n) ? max : n;
  }

  setImage(identifier: string) {
    const element = this.getElement('imageIdentifier', this.imageDataElement);
    if (element) element.value = identifier || '';
  }
  
  get fontsize(): number { 
    let element = this.getElement('fontsize', this.commonDataElement);
    return element ? +element.value : 18;
  }
  set fontsize(fontsize: number) { this.setCommonValue('fontsize', fontsize); }
  
  get text(): string { 
    let element = this.getElement('text', this.commonDataElement);
    return element ? element.value + '' : '';
  }
  set text(text: string) { this.setCommonValue('text', text); }

  get color(): string { 
    let element = this.getElement('color', this.commonDataElement);
    return element ? element.value + '' : '#555555';
  }
  set color(color: string) { this.setCommonValue('color', color); }

  get bgcolor(): string { 
    let element = this.getElement('color', this.commonDataElement);
    return element ? element.currentValue + '' : '#0a0a0a';
  }
  set bgcolor(bgcolor: string) { 
    let element = this.getElement('color', this.commonDataElement);
    if (element) element.currentValue = bgcolor;
  }

  get ownerName(): string {
    return PeerCursor.findByUserId(this.owner)?.name || '';
  }

  get ownerColor(): string {
    return PeerCursor.findByUserId(this.owner)?.color || '#444444';
  }

  get hasOwner(): boolean { return !!(this.owner && this.owner.length); }
  get ownerIsOnline(): boolean { return this.hasOwner && (this.isMine || Network.peers.some(peer => peer.userId === this.owner && peer.isOpen)); }
  get isMine(): boolean { return Network.peer.userId === this.owner; }

  get imageIdentifier(): string {
    const el = this.imageElement;
    return el ? (el.value + '') : '';
  }

  get enabledClickActions(): TabletopClickAction[] {
    return resolveEnabledClickActions(this);
  }

  get hasAnyClickAction(): boolean {
    return hostHasClickAction(this);
  }

  hasClickActionKind(action: TabletopClickAction): boolean {
    return hostHasClickActionKind(this, action);
  }

  setEnabledClickActions(actions: TabletopClickAction[]) {
    const next = stringifyClickActions(actions || []);
    this.clickActionsJson = next;
    const list = parseClickActionsJson(next);
    this.clickAction = list.length ? list[0] : 'none';
  }

  toggleClickAction(action: TabletopClickAction) {
    if (!action || action === 'none') {
      this.setEnabledClickActions([]);
      return;
    }
    const cur = this.enabledClickActions.slice();
    const i = cur.indexOf(action);
    if (i >= 0) cur.splice(i, 1);
    else {
      cur.push(action);
      this.migrateLegacyPayloadInto(action);
    }
    this.setEnabledClickActions(cur);
  }

  /** Move shared legacy clickPayload into typed id fields when enabling multi actions. */
  private migrateLegacyPayloadInto(action: TabletopClickAction) {
    const payload = (this.clickPayload || '').trim();
    if (!payload || this.clickAction !== action) return;
    if (action === 'music' && !this.clickMusicId) this.clickMusicId = payload;
    else if (action === 'cutin' && !this.clickCutinId) this.clickCutinId = payload;
    else if (action === 'note' && !this.clickNoteId) this.clickNoteId = payload;
    else if (action === 'table' && !this.clickTableId) this.clickTableId = payload;
    else if (action === 'preset' && !this.clickPresetId) this.clickPresetId = payload;
  }

  get appearanceAlt(): MaskAppearanceSnap {
    return parseMaskAppearanceSnap(this.appearanceAltJson);
  }
  set appearanceAlt(snap: MaskAppearanceSnap) {
    this.appearanceAltJson = stringifyMaskAppearanceSnap(snap || emptyMaskAppearanceSnap());
  }

  /** Click FX (Alt+double-click). */
  get tokenFxConfig(): MaskTokenFxConfig {
    return parseMaskTokenFxConfig(this.tokenFxJson);
  }
  set tokenFxConfig(cfg: MaskTokenFxConfig) {
    this.tokenFxJson = stringifyMaskTokenFxConfig(cfg || emptyMaskTokenFxConfig());
  }

  /** Standing FX (auto apply while token is on the mask). */
  get tokenFxPassiveConfig(): MaskTokenFxConfig {
    return parseMaskTokenFxConfig(this.tokenFxPassiveJson);
  }
  set tokenFxPassiveConfig(cfg: MaskTokenFxConfig) {
    this.tokenFxPassiveJson = stringifyMaskTokenFxConfig(cfg || emptyMaskTokenFxConfig());
  }

  captureAppearanceSnap(): MaskAppearanceSnap {
    return {
      opacityPercent: this.opacityPercent,
      width: this.width,
      height: this.height,
      altitude: this.altitude,
      fontsize: this.fontsize,
      color: this.color,
      imageIdentifier: this.imageIdentifier,
    };
  }

  applyAppearanceSnap(snap: MaskAppearanceSnap): void {
    if (!snap) return;
    this.opacityPercent = snap.opacityPercent;
    this.width = snap.width;
    this.height = snap.height;
    this.altitude = snap.altitude;
    this.fontsize = snap.fontsize;
    this.color = snap.color;
    this.setImage(snap.imageIdentifier || '');
  }

  /** Toggle between locked default appearance and appearanceAltJson. */
  toggleAppearanceSets(): boolean {
    // Switching to B requires a configured alt set (avoid applying empty 1×1 defaults).
    if (!this.appearanceIsAlt && !this.appearanceAltJson) return false;
    if (!this.appearanceDefaultJson) {
      this.appearanceDefaultJson = stringifyMaskAppearanceSnap(this.captureAppearanceSnap());
    }
    if (this.appearanceIsAlt) {
      this.applyAppearanceSnap(parseMaskAppearanceSnap(this.appearanceDefaultJson));
      this.appearanceIsAlt = false;
    } else {
      this.applyAppearanceSnap(this.appearanceAlt);
      this.appearanceIsAlt = true;
    }
    return true;
  }

  complement(): void {
    let element = this.getElement('fontsize', this.commonDataElement);
    if (!element && this.commonDataElement) {
      this.commonDataElement.appendChild(DataElement.create('fontsize', 18, { }, 'fontsize_' + this.identifier));
    }
    element = this.getElement('text', this.commonDataElement);
    if (!element && this.commonDataElement) {
      this.commonDataElement.appendChild(DataElement.create('text', '', { type: 'note', currentValue: '' }, 'text_' + this.identifier));
    }
    element = this.getElement('color', this.commonDataElement);
    if (!element && this.commonDataElement) {
      this.commonDataElement.appendChild(DataElement.create('color', "#555555", { type: 'colors', currentValue: '#0a0a0a' }, 'color_' + this.identifier));
    }
    element = this.getElement('altitude', this.commonDataElement);
    if (!element && this.commonDataElement) {
      this.commonDataElement.appendChild(DataElement.create('altitude', 0, {}, 'altitude_' + this.identifier));
    }
    this.migrateLegacyClickConfig();
    this.migrateSharedTokenFxToPassive();
  }

  /**
   * Legacy: stand + click shared tokenFxJson. Copy once into tokenFxPassiveJson
   * when standing FX is enabled so existing rooms keep their stand look.
   */
  private migrateSharedTokenFxToPassive() {
    if (this.tokenFxPassiveJson) return;
    if (!this.tokenFxPassive || !this.tokenFxJson) return;
    this.tokenFxPassiveJson = this.tokenFxJson;
  }

  /** One-time: single clickAction + shared payload → multi actions + typed ids. */
  private migrateLegacyClickConfig() {
    if (this.clickActionsJson) return;
    if (!this.clickAction || this.clickAction === 'none') return;
    const payload = (this.clickPayload || '').trim();
    if (payload && this.clickAction !== 'chat') {
      if (this.clickAction === 'music' && !this.clickMusicId) this.clickMusicId = payload;
      else if (this.clickAction === 'cutin' && !this.clickCutinId) this.clickCutinId = payload;
      else if (this.clickAction === 'note' && !this.clickNoteId) this.clickNoteId = payload;
      else if (this.clickAction === 'table' && !this.clickTableId) this.clickTableId = payload;
      else if (this.clickAction === 'preset' && !this.clickPresetId) this.clickPresetId = payload;
    }
    this.clickActionsJson = stringifyClickActions([this.clickAction]);
  }

  toTopmost() {
    moveToTopmost(this);
  }

  raiseInTier() {
    moveToTopmostInTier(this);
  }

  toBackmost() {
    moveToBackmost(this);
  }

  static create(name: string, width: number, height: number, opacity: number, identifier?: string): GameTableMask {
    let object: GameTableMask = null;

    if (identifier) {
      object = new GameTableMask(identifier);
    } else {
      object = new GameTableMask();
    }
    object.createDataElements();

    object.commonDataElement.appendChild(DataElement.create('name', name, {}, 'name_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('width', width, {}, 'width_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('height', height, {}, 'height_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('opacity', opacity, { type: 'numberResource', currentValue: opacity }, 'opacity_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('fontsize', 18, { }, 'fontsize_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('text', '', { type: 'note', currentValue: '' }, 'text_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('color', "#555555", { type: 'colors' , currentValue: '#0a0a0a' }, 'ccolor_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('altitude', 0, { }, 'altitude_' + object.identifier));
    object.initialize();

    return object;
  }
}
