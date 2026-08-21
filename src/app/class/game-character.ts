import { ChatPalette } from './chat-palette';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { DataElement } from './data-element';
import { TabletopObject, TablePlacementPose } from './tabletop-object';
import { moveToBackmost, moveToTopmost, moveToTopmostInTier } from './tabletop-object-util';
import { UUID } from '@udonarium/core/system/util/uuid';

import { StandList } from './stand-list';
import { Network } from './core/system';
import { PeerCursor } from './peer-cursor';
import { ObjectStore } from './core/synchronize-object/object-store';
import { translate } from 'i18n';
import type { CharacterToken } from './character-token';

@SyncObject('character')
export class GameCharacter extends TabletopObject {
  constructor(identifier: string = UUID.generateUuid()) {
    super(identifier);
    this.isAltitudeIndicate = true;
  }

  @SyncVar() rotate: number = 0;
  @SyncVar() roll: number = 0;
  /**
   * Dense paint order among layer peers (0..n-1 after reconcile / [ ] / click).
   * Default hierarchy is applied by reconcileLayerStack (desk < mask < character).
   */
  @SyncVar() zindex: number = 0;
  @SyncVar() isDropShadow: boolean = true;
  @SyncVar() isShowChatBubble: boolean = true;
  /** Show name on token (name-tag, or Polaroid caption when framed). */
  @SyncVar() isShowName: boolean = true;
  @SyncVar() owner: string = '';
  /**
   * Peer userId that claims this as their PC token (not stealth).
   * Used for chat default, FoW vision, combat "my turn", etc.
   */
  @SyncVar() playerOwner: string = '';
  @SyncVar() isAllowsChat: boolean = true;
  /** How far this character can see, in grid squares (FoW). */
  @SyncVar() visionRange: number = 6;
  /** Emitted bright-light radius in grid squares (0 = none). */
  @SyncVar() brightLight: number = 0;
  /** Emitted dim-light radius in grid squares (outer ring; 0 = none). */
  @SyncVar() dimLight: number = 0;
  /**
   * Peer userId that manually claims FoW vision from this character.
   * Chat-window auto links use {@link claimAutoVision} instead and do not write here.
   */
  @SyncVar() visionOwner: string = '';

  /** Session-only: Advanced copy applies auto-number to Token/Character clones. */
  static menuCloneAutoNumber = false;

  /** Local preferred chat character (last「作為我的角色」claim). */
  private static preferredChatCharacterId = '';

  /** HTML5 DnD type for dragging inventory characters onto the table. */
  static readonly INVENTORY_DRAG_MIME = 'application/x-udonarium-character';
  /** CTRL+drag from inventory: spawn a temporary copy (delete skips graveyard). */
  static readonly INVENTORY_TEMP_COPY_MIME = 'application/x-udonarium-character-temp';

  /**
   * Escape hatch for unit tests that exercise TabletopObject placement APIs via GameCharacter.
   * Product code must leave this false — bodies never sit on the table.
   */
  static allowLegacyBodyOnTable = false;

  /**
   * Clone an independent temporary sheet + Token on the map.
   * Stats (HP etc.) are NOT shared with the source; copy is hidden from inventory
   * and destroyed on delete (no graveyard). Use {@link CharacterToken.create}
   * (temporary:true) only when you intentionally want a shared-body projection.
   */
  static createTemporaryCopy(
    source: GameCharacter,
    pose?: { x?: number; y?: number; posZ?: number },
    tableId?: string,
    copyAppearanceFrom?: GameCharacter | CharacterToken
  ): CharacterToken {
    // Lazy require breaks character-token ↔ game-character cycle at module init.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CharacterToken } = require('./character-token') as typeof import('./character-token');
    const body = source.clone() as GameCharacter;
    body.isTemporaryCopy = true;
    body.isInventoryIndicate = false;
    body.playerOwner = '';
    body.visionOwner = '';
    body.owner = '';
    body.tablePlacements = '';
    body.tableIdentifier = '';
    const inventoryName = source.location.name && source.location.name !== 'table'
      ? source.location.name
      : 'common';
    body.location.name = inventoryName;
    CharacterToken.ensureBodyOffTable(body);
    body.update();

    const id = tableId || TabletopObject.resolveViewTableIdentifier() || '';
    return CharacterToken.create(body.identifier, {
      x: pose?.x ?? source.location.x,
      y: pose?.y ?? source.location.y,
      posZ: pose?.posZ ?? source.posZ,
    }, {
      tableId: id || undefined,
      temporary: true,
      copyAppearanceFrom: copyAppearanceFrom || source,
      // Do not steal major from an existing token on this map (plan: first only).
    });
  }

  /**
   * Duplicate the sheet (new inventory body). Optionally place one Token on the current view.
   * Distinct from Token duplicate ({@link CharacterToken.duplicateToken}) which shares the same body.
   */
  static cloneCharacter(
    source: GameCharacter,
    opts?: {
      pose?: { x?: number; y?: number; posZ?: number };
      tableId?: string;
      /** Default true when a view / table id is available. */
      placeToken?: boolean;
      numbered?: boolean;
      copyAppearanceFrom?: GameCharacter | CharacterToken;
    }
  ): { body: GameCharacter; token: CharacterToken | null } {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CharacterToken } = require('./character-token') as typeof import('./character-token');
    const body = source.clone() as GameCharacter;
    body.playerOwner = '';
    body.visionOwner = '';
    body.owner = '';
    body.isTemporaryCopy = false;
    body.tablePlacements = '';
    const inventoryName = source.location.name && source.location.name !== 'table'
      ? source.location.name
      : 'common';
    body.location.name = inventoryName;
    body.tableIdentifier = '';

    if (opts?.numbered) {
      body.name = GameCharacter.nextNumberedName(body.name);
    }
    body.update();

    const tableId = opts?.tableId || TabletopObject.resolveViewTableIdentifier() || '';
    const shouldPlace = opts?.placeToken !== false && !!tableId;
    let token: CharacterToken | null = null;
    if (shouldPlace) {
      const pose = opts?.pose || { x: (source.location.x || 0) + 50, y: (source.location.y || 0) + 50, posZ: source.posZ || 0 };
      token = CharacterToken.create(body.identifier, pose, {
        tableId,
        copyAppearanceFrom: opts?.copyAppearanceFrom || source,
        major: true,
      });
    }
    return { body, token };
  }

  /** Auto-number suffix for character / token display names (`Hero` → `Hero_1`). */
  static nextNumberedName(name: string, existingNames?: Iterable<string>): string {
    const tmp = (name || '').split('_');
    let baseName: string;
    if (tmp.length > 1 && /\d+/.test(tmp[tmp.length - 1])) {
      baseName = tmp.slice(0, tmp.length - 1).join('_');
    } else {
      baseName = tmp.join('_') || 'character';
    }
    let maxIndex = 0;
    const names = existingNames
      ? Array.from(existingNames)
      : ObjectStore.instance.getObjects(GameCharacter).map(c => c.name);
    for (const n of names) {
      if (!n || !n.startsWith(baseName)) continue;
      const index = n.match(/_(\d+)$/) ? +RegExp.$1 : 0;
      if (index > maxIndex) maxIndex = index;
    }
    return baseName + '_' + (maxIndex + 1);
  }

  /**
   * Bodies must not sit on the table — spawn / update a {@link CharacterToken} instead.
   * Appearance SyncVars on the body are copied onto the Token.
   */
  override addToTable(
    tableId?: string,
    pose?: Partial<TablePlacementPose>,
    exclusive = false
  ) {
    if (GameCharacter.allowLegacyBodyOnTable) {
      super.addToTable(tableId, pose, exclusive);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CharacterToken } = require('./character-token') as typeof import('./character-token');
    const id = tableId || TabletopObject.resolveViewTableIdentifier() || this.tableIdentifier || '';
    const nextPose = {
      x: pose?.x ?? this.location.x,
      y: pose?.y ?? this.location.y,
      posZ: pose?.posZ ?? this.posZ,
    };

    this.ensureBodyInventoryLocation(id);

    if (exclusive) {
      const onTarget = id ? CharacterToken.tokensOnTable(this.identifier, id) : [];
      const keep = onTarget[0] || null;
      for (const t of ObjectStore.instance.getObjects(CharacterToken)) {
        if (t.characterId !== this.identifier) continue;
        if (keep && t === keep) continue;
        t.destroy();
      }
      if (keep) {
        keep.addToTable(id, nextPose, true);
        CharacterToken.copyTableAppearance(keep, this);
        CharacterToken.reconcileMajor(this.identifier, id, keep.identifier);
        this.owner = '';
        return;
      }
      CharacterToken.destroyTokensForCharacter(this.identifier);
    } else if (id) {
      const onMap = CharacterToken.tokensOnTable(this.identifier, id);
      if (onMap.length > 0) {
        const t = CharacterToken.focusTokenForCharacter(this.identifier, id) || onMap[0];
        t.addToTable(id, nextPose, false);
        CharacterToken.copyTableAppearance(t, this);
        this.owner = '';
        return;
      }
    }

    const legacyId = CharacterToken.legacyTokenId(this.identifier);
    const legacyFree = !(ObjectStore.instance.get(legacyId) instanceof CharacterToken);
    const noTokensYet = CharacterToken.tokensOnTable(this.identifier).length < 1
      && ObjectStore.instance.getObjects(CharacterToken).every(t => t.characterId !== this.identifier);

    CharacterToken.create(this.identifier, nextPose, {
      tableId: id || undefined,
      identifier: (legacyFree && noTokensYet) ? legacyId : undefined,
      copyAppearanceFrom: this,
      major: true,
    });
    CharacterToken.ensureBodyOffTable(this);
    this.owner = '';
  }

  override setLocation(location: string, tableIdentifier?: string) {
    if (location === 'table' && !GameCharacter.allowLegacyBodyOnTable) {
      this.addToTable(tableIdentifier, {
        x: this.location.x,
        y: this.location.y,
        posZ: this.posZ,
      });
      return;
    }
    if (location === 'graveyard') {
      this.destroyMapTokens();
      super.setLocation(location, tableIdentifier);
      // Room-wide trash: never bind the sheet to a single map.
      if (this.tableIdentifier) {
        this.tableIdentifier = '';
        this.update();
      }
      return;
    }
    super.setLocation(location, tableIdentifier);
  }

  /**
   * leaveCurrentTable → removeFromTable may set location.name to graveyard without
   * going through setLocation; still tear down map Tokens and unbind the map.
   */
  override removeFromTable(tableId?: string, inventoryLocation = 'common') {
    super.removeFromTable(tableId, inventoryLocation);
    if (this.location.name === 'graveyard') {
      this.destroyMapTokens();
      if (this.tableIdentifier) {
        this.tableIdentifier = '';
        this.update();
      }
    }
  }

  /** Sheet in graveyard must not leave orphan map projections. */
  private destroyMapTokens() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CharacterToken } = require('./character-token') as typeof import('./character-token');
    CharacterToken.destroyTokensForCharacter(this.identifier);
  }

  /** Keep sheet in inventory (common by default) with no table placements. */
  private ensureBodyInventoryLocation(tableId: string) {
    if (this.location.name === 'table') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { CharacterToken } = require('./character-token') as typeof import('./character-token');
      CharacterToken.ensureBodyOffTable(this);
      return;
    }
    if (this.tablePlacements) this.tablePlacements = '';
    // Revive from graveyard (or unbound) into common when placing a map Token.
    if (!this.location.name || this.location.name === 'table' || this.location.name === 'graveyard') {
      this.tableIdentifier = tableId || this.tableIdentifier || TabletopObject.resolveViewTableIdentifier() || '';
      this.location.name = 'common';
      this.update();
    }
  }

  /** characterId → userId for chat-window auto vision (local session only). */
  private static autoVisionUser = new Map<string, string>();
  /** Refcount so multiple chat windows can share the same character. */
  private static autoVisionRefCount = new Map<string, number>();

  /** Link this character as FoW vision for a chat-window selection (refcounted). */
  static claimAutoVision(characterId: string, userId: string): void {
    if (!characterId || !userId) return;
    GameCharacter.autoVisionUser.set(characterId, userId);
    GameCharacter.autoVisionRefCount.set(
      characterId,
      (GameCharacter.autoVisionRefCount.get(characterId) || 0) + 1
    );
  }

  /** Release one chat-window auto vision claim. */
  static releaseAutoVision(characterId: string, userId: string): void {
    if (!characterId || !userId) return;
    if (GameCharacter.autoVisionUser.get(characterId) !== userId) return;
    const next = (GameCharacter.autoVisionRefCount.get(characterId) || 0) - 1;
    if (next <= 0) {
      GameCharacter.autoVisionRefCount.delete(characterId);
      GameCharacter.autoVisionUser.delete(characterId);
    } else {
      GameCharacter.autoVisionRefCount.set(characterId, next);
    }
  }
  @SyncVar() statusesJson: string = '[]';
  @SyncVar() floorRing: string = 'none';
  @SyncVar() floorRingColor: string = '';
  @SyncVar() floorRingSpeed: number = 1;

  /** Clue-board frame overlay: none | polaroid | photo | card */
  @SyncVar() tokenFrame: string = 'none';
  @SyncVar() tokenFrameCaption: string = '';
  @SyncVar() pushPin: boolean = false;
  @SyncVar() pushPinAngle: number = 0;
  /** Legacy SyncVar (unused for art; kept for room XML compat). */
  @SyncVar() pushPinColor: string = 'red';
  /** Active oblique styles: 2 | 3 | 6 | 7. 0 = derive from identifier. */
  @SyncVar() pushPinStyle: number = 0;
  /** CSS left/top of `.push-pin` on the token image-box (randomized). */
  @SyncVar() pushPinLeft: number = -4;
  @SyncVar() pushPinTop: number = -20;
  
  text = '';
  dialog = null;
  isEmote = false;
  isLoaded = false;

  // 很醜，有沒有別的方法
  chatBubbleAltitude = 0;

  /** Synced character speech balloon (public). Secret balloons still use EventSystem unicast. */
  @SyncVar() chatDialogText: string = '';
  @SyncVar() chatDialogColor: string = '';
  @SyncVar() chatDialogFaceIconIdentifier: string = '';
  @SyncVar() chatDialogIsEmote: boolean = false;
  /** Non-zero while a public balloon is active; bump to retrigger. */
  @SyncVar() chatDialogStamp: number = 0;

  openChatDialog(opts: {
    text: string;
    color?: string;
    faceIconIdentifier?: string;
    isEmote?: boolean;
    stamp?: number;
  }) {
    this.chatDialogText = opts.text || '';
    this.chatDialogColor = opts.color || '';
    this.chatDialogFaceIconIdentifier = opts.faceIconIdentifier || '';
    this.chatDialogIsEmote = !!opts.isEmote;
    this.chatDialogStamp = opts.stamp || Date.now();
  }

  clearChatDialog() {
    if (!this.chatDialogStamp && !this.chatDialogText) return;
    this.chatDialogText = '';
    this.chatDialogColor = '';
    this.chatDialogFaceIconIdentifier = '';
    this.chatDialogIsEmote = false;
    this.chatDialogStamp = 0;
  }

  get name(): string { return this.getCommonValue('name', ''); }
  set name(name) { this.setCommonValue('name', name); }
  get size(): number { return this.getCommonValue('size', 1); }
  get height(): number {
    let element = this.getElement('height', this.commonDataElement);
    //if (!element && this.commonDataElement) {
    //  this.commonDataElement.insertBefore(DataElement.create('height', 0, { 'currentValue': '' }, 'height_' + this.identifier), this.getElement('altitude', this.commonDataElement));
    //}
    let num = element ? +element.value : 0;
    if (element && element.currentValue) num = (Number.isNaN(num) ? 0 : num) * this.size;
    return Number.isNaN(num) ? 0 : num;
  }

  /**
   * Chat palette child. Does not auto-create — accidental empty creates during
   * sync races were blanking palettes room-wide. Use {@link ensureChatPalette}
   * when opening/editing the palette UI.
   */
  get chatPalette(): ChatPalette | null {
    return this.findChatPalette();
  }

  /** Existing palette on this character or already in ObjectStore (sync race safe). */
  findChatPalette(): ChatPalette | null {
    for (let child of this.children) {
      if (child instanceof ChatPalette) return child;
    }
    const existing = ObjectStore.instance.get<ChatPalette>('ChatPalette_' + this.identifier);
    if (existing instanceof ChatPalette) {
      if (existing.parent !== this) this.appendChild(existing);
      return existing;
    }
    return null;
  }

  /** Create a palette only when the UI explicitly needs one (e.g. confirm edit). */
  ensureChatPalette(initialValue?: string): ChatPalette {
    const found = this.findChatPalette();
    if (found) return found;
    const palette = new ChatPalette('ChatPalette_' + this.identifier);
    // Seed content before initialize(): SyncVar update() is a no-op until the
    // object is in ObjectStore, so the first broadcast includes text (not empty).
    if (initialValue != null) palette.setPalette(initialValue);
    palette.initialize();
    this.appendChild(palette);
    return palette;
  }

  get ownerName(): string {
    return PeerCursor.findByUserId(this.owner)?.name || '';
  }

  get ownerColor(): string {
    return PeerCursor.findByUserId(this.owner)?.color || '#444444';
  }

  get playerOwnerName(): string {
    const object = PeerCursor.findByUserId(this.playerOwner);
    return object ? object.name : (this.playerOwner ? translate('char.unknownPlayer') : '');
  }

  get playerOwnerColor(): string {
    const object = PeerCursor.findByUserId(this.playerOwner);
    return object ? object.color : '#64748b';
  }

  /** Chat send-from label: "Name (Player)" when claimed as someone's PC. */
  get chatSelectLabel(): string {
    const name = this.name || '';
    if (!this.playerOwner) return name;
    const owner = this.playerOwnerName;
    return owner ? `${name} (${owner})` : name;
  }
  
  /**
   * Stand list child. Does not auto-create — same sync-race class as chatPalette.
   * Use {@link ensureStandList} when the stand-setting UI needs one.
   */
  get standList(): StandList | null {
    return this.findStandList();
  }

  findStandList(): StandList | null {
    for (let child of this.children) {
      if (child instanceof StandList) return child;
    }
    const existing = ObjectStore.instance.get<StandList>('StandList_' + this.identifier);
    if (existing instanceof StandList) {
      if (existing.parent !== this) this.appendChild(existing);
      return existing;
    }
    return null;
  }

  /** Create an empty stand list only when the UI explicitly needs one. */
  ensureStandList(): StandList {
    const found = this.findStandList();
    if (found) return found;
    const standList = new StandList('StandList_' + this.identifier);
    standList.initialize();
    this.appendChild(standList);
    return standList;
  }

  toTopmost() {
    moveToTopmost(this);
  }

  /** Click / drag: stay in character tier (above masks/desk unless [ ] was used). */
  raiseInTier() {
    moveToTopmostInTier(this);
  }

  toBackmost() {
    moveToBackmost(this);
  }

  // GameObject Lifecycle
  onStoreAdded() {
    super.onStoreAdded();
  }

  /**
   * Always cascade-destroy map Tokens when the sheet is destroyed
   * (plan: delete body → Tokens; callers should not need to remember).
   */
  override destroy() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CharacterToken } = require('./character-token') as typeof import('./character-token');
    CharacterToken.destroyTokensForCharacter(this.identifier);
    if (GameCharacter.preferredChatCharacterId === this.identifier) {
      GameCharacter.preferredChatCharacterId = '';
    }
    GameCharacter.autoVisionUser.delete(this.identifier);
    GameCharacter.autoVisionRefCount.delete(this.identifier);
    super.destroy();
  }

  static create(name: string, size: number, imageIdentifier: string): GameCharacter {
    let gameCharacter: GameCharacter = new GameCharacter();
    gameCharacter.createDataElements();
    gameCharacter.initialize();
    gameCharacter.createTestGameDataElement(name, size, imageIdentifier);

    return gameCharacter;
  }

  /** Minimal character sheet (no sample resources/skills). Used by CCFOLIA clipboard import. */
  static createEmpty(name: string, size: number = 1): GameCharacter {
    const gameCharacter = new GameCharacter();
    gameCharacter.createDataElements();
    gameCharacter.initialize();

    gameCharacter.commonDataElement.appendChild(
      DataElement.create('name', name, {}, 'name_' + gameCharacter.identifier)
    );
    gameCharacter.commonDataElement.appendChild(
      DataElement.create('size', size, {}, 'size_' + gameCharacter.identifier)
    );
    gameCharacter.commonDataElement.appendChild(
      DataElement.create('height', 0, { currentValue: '' }, 'height_' + gameCharacter.identifier)
    );
    gameCharacter.commonDataElement.appendChild(
      DataElement.create('altitude', 0, {}, 'altitude_' + gameCharacter.identifier)
    );

    const standList = new StandList('StandList_' + gameCharacter.identifier);
    standList.initialize();
    gameCharacter.appendChild(standList);

    return gameCharacter;
  }

  get isHideIn(): boolean { return !!this.owner; }
  get isVisible(): boolean { return !this.owner || Network.peer.userId === this.owner; }

  /** Stealth owner or claimed PC token. */
  isControlledBy(userId: string): boolean {
    return !!userId && (this.playerOwner === userId || this.owner === userId);
  }

  get hasPlayerController(): boolean {
    return !!this.playerOwner || !!this.owner;
  }

  /**
   * Claimed PC tokens cannot be moved/rotated by other non-GM players.
   * Owner and GM may still manipulate them.
   */
  get isLockedByPlayerOwner(): boolean {
    if (!this.playerOwner) return false;
    if (PeerCursor.myCursor?.isGMMode) return false;
    return this.playerOwner !== Network.peer?.userId;
  }

  /**
   * Claim / release as the local player's exclusive PC token (chat + vision + control).
   * Unique: one owner per character; claiming releases this player's previous claim.
   * Returns false if another player already owns it (GM may take over).
   */
  static setAsMyToken(character: GameCharacter, enabled: boolean): boolean {
    const userId = Network.peer?.userId;
    if (!character || !userId) return false;
    if (enabled) {
      const takenByOther = !!character.playerOwner && character.playerOwner !== userId;
      if (takenByOther && !PeerCursor.myCursor?.isGMMode) return false;

      // One claimed character per player.
      for (const ch of ObjectStore.instance.getObjects(GameCharacter)) {
        if (ch === character) continue;
        if (ch.playerOwner === userId) {
          ch.playerOwner = '';
          if (ch.visionOwner === userId) ch.visionOwner = '';
        }
      }
      character.playerOwner = userId;
      character.visionOwner = userId;
      GameCharacter.preferredChatCharacterId = character.identifier;
      return true;
    }

    if (!character.playerOwner) return true;
    if (character.playerOwner !== userId && !PeerCursor.myCursor?.isGMMode) return false;
    const prev = character.playerOwner;
    character.playerOwner = '';
    if (character.visionOwner === prev) character.visionOwner = '';
    if (GameCharacter.preferredChatCharacterId === character.identifier) {
      GameCharacter.preferredChatCharacterId = '';
    }
    return true;
  }

  /** Preferred character for new chat windows (falls back to any of my tokens). */
  static preferredChatCharacter(userId: string = Network.peer?.userId): GameCharacter | null {
    if (!userId) return null;
    const preferredId = GameCharacter.preferredChatCharacterId;
    if (preferredId) {
      const preferred = ObjectStore.instance.get(preferredId);
      if (preferred instanceof GameCharacter
        && !preferred.isTemporaryCopy
        && preferred.playerOwner === userId) {
        return preferred;
      }
    }
    for (const ch of ObjectStore.instance.getObjects(GameCharacter)) {
      if (ch.isTemporaryCopy) continue;
      if (ch.playerOwner === userId) return ch;
    }
    return null;
  }

  /** Local session: which userId has chat-window auto vision on this character. */
  static getAutoVisionUserId(characterId: string): string | undefined {
    return GameCharacter.autoVisionUser.get(characterId);
  }

  /** Whether this character contributes FoW vision for the given peer userId. */
  providesVisionTo(userId: string): boolean {
    if (!userId) return false;
    if (this.playerOwner === userId) return true;
    if (this.visionOwner === userId) return true;
    return GameCharacter.autoVisionUser.get(this.identifier) === userId;
  }

  /** Emitted bright radius in grid squares (clamped ≥ 0). */
  get brightLightGrid(): number {
    return Math.max(0, Number(this.brightLight) || 0);
  }

  /** Emitted dim radius in grid squares (at least bright). */
  get dimLightGrid(): number {
    return Math.max(this.brightLightGrid, Number(this.dimLight) || 0);
  }

  get visionRangeGrid(): number {
    return Math.max(0, Number(this.visionRange) || 0);
  }

  static get isStealthMode(): boolean {
    // Stealth is per-Token (plan). Delegate — do not scan legacy on-table bodies.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CharacterToken } = require('./character-token') as { CharacterToken: typeof import('./character-token').CharacterToken };
    return CharacterToken.isStealthMode;
  }

  complement(): void {
    let element = this.getElement('altitude', this.commonDataElement);
    if (!element && this.commonDataElement) {
      this.commonDataElement.appendChild(DataElement.create('altitude', 0, {}, 'altitude_' + this.identifier));
    }
    element = this.getElement('height', this.commonDataElement);
    if (!element && this.commonDataElement) {
      this.commonDataElement.insertBefore(DataElement.create('height', 0, { 'currentValue': '' }, 'height_' + this.identifier), this.getElement('altitude', this.commonDataElement));
    }
  }

  createTestGameDataElement(name: string, size: number, imageIdentifier: string) {
    this.createDataElements();

    let nameElement: DataElement = DataElement.create('name', name, {}, 'name_' + this.identifier);
    let sizeElement: DataElement = DataElement.create('size', size, {}, 'size_' + this.identifier);
    let heightElement: DataElement = DataElement.create('height', 0, { 'currentValue': '' }, 'height_' + this.identifier);
    let altitudeElement: DataElement = DataElement.create('altitude', 0, {}, 'altitude_' + this.identifier);

    if (this.imageDataElement.getFirstElementByName('imageIdentifier')) {
      this.imageDataElement.getFirstElementByName('imageIdentifier').value = imageIdentifier;
    }

    let resourceElement: DataElement = DataElement.create(translate('sample.char.resources'), '', {}, '資源' + this.identifier);
    let hpElement: DataElement = DataElement.create('HP', 200, { 'type': 'numberResource', 'currentValue': '200' }, 'HP_' + this.identifier);
    let mpElement: DataElement = DataElement.create('MP', 100, { 'type': 'numberResource', 'currentValue': '100' }, 'MP_' + this.identifier);

    this.commonDataElement.appendChild(nameElement);
    this.commonDataElement.appendChild(sizeElement);
    this.commonDataElement.appendChild(heightElement);
    this.commonDataElement.appendChild(altitudeElement);

    this.detailDataElement.appendChild(resourceElement);
    resourceElement.appendChild(hpElement);
    resourceElement.appendChild(mpElement);

    //TEST
    let testElement: DataElement = DataElement.create(translate('sample.char.info'), '', {}, '情報' + this.identifier);
    this.detailDataElement.appendChild(testElement);
    testElement.appendChild(DataElement.create(translate('sample.char.desc'), translate('sample.char.descValue'), { 'type': 'note' }, '說明' + this.identifier));
    testElement.appendChild(DataElement.create(translate('sample.char.note'), translate('sample.char.noteValue'), { 'type': 'note' }, '筆記' + this.identifier));
    testElement.appendChild(DataElement.create(translate('sample.char.url'), 'https://www.example.com', { 'type': 'url' }, '參考URL' + this.identifier));

    //TEST
    testElement = DataElement.create(translate('sample.char.abilities'), '', {}, '能力' + this.identifier);
    this.detailDataElement.appendChild(testElement);
    testElement.appendChild(DataElement.create(translate('sample.char.dex'), 24, { 'type': 'abilityScore', 'currentValue': 'div6' }, '靈巧' + this.identifier));
    testElement.appendChild(DataElement.create(translate('sample.char.agi'), 24, { 'type': 'abilityScore', 'currentValue': 'div6' }, '敏捷' + this.identifier));
    testElement.appendChild(DataElement.create(translate('sample.char.str'), 24, { 'type': 'abilityScore', 'currentValue': 'div6' }, '筋力' + this.identifier));
    testElement.appendChild(DataElement.create(translate('sample.char.vit'), 24, { 'type': 'abilityScore', 'currentValue': 'div6' }, '生命力' + this.identifier));
    testElement.appendChild(DataElement.create(translate('sample.char.int'), 24, { 'type': 'abilityScore', 'currentValue': 'div6' }, '智力' + this.identifier));
    testElement.appendChild(DataElement.create(translate('sample.char.mnd'), 24, { 'type': 'abilityScore', 'currentValue': 'div6' }, '精神力' + this.identifier));

    //TEST
    testElement = DataElement.create(translate('sample.char.skills'), '', {}, '戰鬥特技' + this.identifier);
    this.detailDataElement.appendChild(testElement);
    testElement.appendChild(DataElement.create('Lv1', translate('sample.char.skill1'), {}, 'Lv1' + this.identifier));
    testElement.appendChild(DataElement.create('Lv3', translate('sample.char.skill3'), {}, 'Lv3' + this.identifier));
    testElement.appendChild(DataElement.create('Lv5', translate('sample.char.skill5'), {}, 'Lv5' + this.identifier));
    testElement.appendChild(DataElement.create('Lv7', translate('sample.char.skill7'), {}, 'Lv7' + this.identifier));
    testElement.appendChild(DataElement.create('Lv9', translate('sample.char.skill9'), {}, 'Lv9' + this.identifier));
    testElement.appendChild(DataElement.create(translate('sample.char.auto'), translate('sample.char.skillAuto'), {}, '自動' + this.identifier));

    let domParser: DOMParser = new DOMParser();
    let gameCharacterXMLDocument: Document = domParser.parseFromString(this.rootDataElement.toXml(), 'application/xml');

    let palette: ChatPalette = new ChatPalette('ChatPalette_' + this.identifier);
    palette.setPalette(translate('sample.char.palette'));
    palette.initialize();
    this.appendChild(palette);

    let standList = new StandList('StandList_' + this.identifier);
    standList.initialize();
    this.appendChild(standList);
  }
}
