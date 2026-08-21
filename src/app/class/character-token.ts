import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { ObjectStore } from './core/synchronize-object/object-store';
import { Network } from './core/system';
import { UUID } from './core/system/util/uuid';
import { GameCharacter } from './game-character';
import { PeerCursor } from './peer-cursor';
import { TabletopObject } from './tabletop-object';
import { moveToBackmost, moveToTopmost, moveToTopmostInTier } from './tabletop-object-util';

export type CharacterTokenPose = { x?: number; y?: number; posZ?: number };

/**
 * Map projection of a {@link GameCharacter} sheet.
 * No DataElement sheet — HP / images / palette live on the body only.
 *
 * Map cosmetics (altitude, aura, stealth, vision, rings, …) live here.
 * Always resolve the write target with {@link CharacterToken.appearanceHostFor}
 * instead of mutating the sheet when a Token is on the viewed map.
 */
@SyncObject('character-token')
export class CharacterToken extends TabletopObject {
  constructor(identifier: string = UUID.generateUuid()) {
    super(identifier);
    this.isAltitudeIndicate = true;
  }

  /** Body GameCharacter id. */
  @SyncVar() characterId: string = '';

  /** Per-map major marker (exclusive among same characterId on the same map). */
  @SyncVar() isMajorMarker: boolean = false;

  /** Optional display name override (auto-number); empty = use body name. */
  @SyncVar() displayNameOverride: string = '';

  @SyncVar() rotate: number = 0;
  @SyncVar() roll: number = 0;
  @SyncVar() zindex: number = 0;
  @SyncVar() isDropShadow: boolean = true;
  @SyncVar() isShowChatBubble: boolean = true;
  @SyncVar() isShowName: boolean = true;

  /** Stealth owner (hide-in) for this token projection. */
  @SyncVar() owner: string = '';

  @SyncVar() visionRange: number = 6;
  @SyncVar() brightLight: number = 0;
  @SyncVar() dimLight: number = 0;

  /** Per-token altitude (Token has no footprint DataElement sheet). */
  @SyncVar() altitudeValue: number = 0;

  @SyncVar() floorRing: string = 'none';
  @SyncVar() floorRingColor: string = '';
  @SyncVar() floorRingSpeed: number = 1;

  @SyncVar() tokenFrame: string = 'none';
  @SyncVar() tokenFrameCaption: string = '';
  @SyncVar() pushPin: boolean = false;
  @SyncVar() pushPinAngle: number = 0;
  @SyncVar() pushPinColor: string = 'red';
  @SyncVar() pushPinStyle: number = 0;
  @SyncVar() pushPinLeft: number = -4;
  @SyncVar() pushPinTop: number = -20;

  /** Client-local: mounted for visibility binding (not synced). */
  isLoaded = false;

  /** Stable id used when migrating a legacy on-table GameCharacter. */
  static legacyTokenId(characterId: string): string {
    return `character-token:legacy:${characterId}`;
  }

  get character(): GameCharacter | null {
    if (!this.characterId) return null;
    const body = ObjectStore.instance.get(this.characterId);
    return body instanceof GameCharacter ? body : null;
  }

  get name(): string {
    if (this.displayNameOverride) return this.displayNameOverride;
    return this.character?.name || '';
  }

  get size(): number {
    return this.character?.size ?? 1;
  }

  /** Proxy sheet image for UI (overview / range follow); Token has no image DataElement. */
  override get imageFile() {
    return this.character?.imageFile || super.imageFile;
  }

  override get altitude(): number {
    return Number(this.altitudeValue) || 0;
  }

  override set altitude(value: number) {
    const next = Number(value) || 0;
    if ((Number(this.altitudeValue) || 0) === next) return;
    this.mutateAppearance(() => { this.altitudeValue = next; });
  }

  /** Tokens store altitude on SyncVar, not a sheet DataElement. */
  override get isHaveAltitude(): boolean {
    return true;
  }

  get chatBubbleAltitude(): number {
    return this.character?.chatBubbleAltitude ?? 0;
  }

  get ownerName(): string {
    // Never return null: templates use ownerName.length during remount / room load.
    return PeerCursor.findByUserId(this.owner)?.name || '';
  }

  get ownerColor(): string {
    return PeerCursor.findByUserId(this.owner)?.color || '#444444';
  }

  /** Bodies that have at least one Token on the current view. */
  static bodiesWithTokenOnView(tableId?: string): GameCharacter[] {
    const id = tableId || TabletopObject.resolveViewTableIdentifier();
    if (!id) return [];
    const seen = new Set<string>();
    const out: GameCharacter[] = [];
    for (const t of ObjectStore.instance.getObjects(CharacterToken)) {
      if (!t.characterId || seen.has(t.characterId)) continue;
      if (t.location.name !== 'table' || !t.hasPlacement(id)) continue;
      if (t.isTemporaryCopy) continue;
      const body = t.character;
      if (!body || body.isTemporaryCopy) continue;
      seen.add(t.characterId);
      out.push(body);
    }
    return out;
  }

  /** True when body has Tokens on some map but none on the current view. */
  static hasTokenOnlyOnOtherMaps(characterId: string, tableId?: string): boolean {
    if (!characterId) return false;
    const viewId = tableId || TabletopObject.resolveViewTableIdentifier();
    const all = ObjectStore.instance.getObjects(CharacterToken).filter(
      (t) => t.characterId === characterId && t.location.name === 'table'
    );
    if (!all.length) return false;
    if (!viewId) return true;
    return !all.some((t) => t.hasPlacement(viewId));
  }

  /** Destroy all Tokens of a body on the given (or current) map. */
  static removeTokensOnTable(characterId: string, tableId?: string) {
    const tokens = CharacterToken.tokensOnTable(characterId, tableId);
    for (const t of tokens) t.destroy();
  }

  get isHideIn(): boolean {
    return !!this.owner;
  }

  get isVisible(): boolean {
    return !this.owner || Network.peer.userId === this.owner;
  }

  get isGMMode(): boolean {
    return PeerCursor.myCursor?.isGMMode ?? false;
  }

  get isLockedByPlayerOwner(): boolean {
    const body = this.character;
    if (!body?.playerOwner) return false;
    if (PeerCursor.myCursor?.isGMMode) return false;
    return body.playerOwner !== Network.peer?.userId;
  }

  get brightLightGrid(): number {
    return Math.max(0, Number(this.brightLight) || 0);
  }

  get dimLightGrid(): number {
    return Math.max(this.brightLightGrid, Number(this.dimLight) || 0);
  }

  get visionRangeGrid(): number {
    return Math.max(0, Number(this.visionRange) || 0);
  }

  /** FoW: token contributes vision when body is claimed / visionOwner / auto, or always if ranges set — match body rules via characterId. */
  providesVisionTo(userId: string): boolean {
    if (!userId) return false;
    const body = this.character;
    if (!body) return false;
    if (body.playerOwner === userId) return true;
    if (body.visionOwner === userId) return true;
    return GameCharacter.getAutoVisionUserId(body.identifier) === userId;
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

  /** Tokens of one body that are placed on the given map. */
  static tokensOnTable(characterId: string, tableId?: string): CharacterToken[] {
    const id = tableId || TabletopObject.resolveViewTableIdentifier();
    if (!characterId || !id) return [];
    return ObjectStore.instance.getObjects(CharacterToken).filter(
      (t) => t.characterId === characterId && t.location.name === 'table' && t.hasPlacement(id)
    );
  }

  static majorOnTable(characterId: string, tableId?: string): CharacterToken | null {
    const tokens = CharacterToken.tokensOnTable(characterId, tableId);
    return tokens.find((t) => t.isMajorMarker) || null;
  }

  /** Prefer major on view; else any token of the body on view. */
  static focusTokenForCharacter(characterId: string, tableId?: string): CharacterToken | null {
    const major = CharacterToken.majorOnTable(characterId, tableId);
    if (major) return major;
    const tokens = CharacterToken.tokensOnTable(characterId, tableId);
    return tokens[0] || null;
  }

  /**
   * Compliant host for map cosmetics / altitude / stealth / FoW radii.
   * Prefer a Token on the viewed map (or {@param preferredToken}); otherwise the sheet seed.
   * Sheet-only fields (name, size, HP, palette, stands) must stay on {@link GameCharacter}.
   */
  static appearanceHostFor(
    body: GameCharacter | null | undefined,
    opts?: { preferredToken?: CharacterToken | null; tableId?: string }
  ): GameCharacter | CharacterToken | null {
    if (!body) return null;
    const preferred = opts?.preferredToken;
    if (preferred && preferred.characterId === body.identifier) return preferred;
    return CharacterToken.focusTokenForCharacter(body.identifier, opts?.tableId) || body;
  }

  /**
   * Ensure at most one major among tokens of this character on {@param tableId}.
   * FIRST COME successor = smallest identifier.
   * @param preferTokenId when set, that token claims major (menu toggle / explicit claim).
   *   Omit to keep the current major, or assign FIRST COME if none exists.
   */
  static reconcileMajor(characterId: string, tableId?: string, preferTokenId?: string) {
    const id = tableId || TabletopObject.resolveViewTableIdentifier();
    if (!characterId || !id) return;
    const tokens = CharacterToken.tokensOnTable(characterId, id);
    if (tokens.length < 1) return;

    let keep: CharacterToken | null = null;
    if (preferTokenId) {
      keep = tokens.find((t) => t.identifier === preferTokenId) || null;
    }
    if (!keep) {
      keep = tokens.find((t) => t.isMajorMarker) || null;
    }
    if (!keep) {
      keep = [...tokens].sort((a, b) => a.identifier.localeCompare(b.identifier))[0];
    }
    for (const t of tokens) {
      const next = t === keep;
      if (t.isMajorMarker !== next) {
        t.isMajorMarker = next;
        t.update();
      }
    }
  }

  static create(
    characterId: string,
    pose?: CharacterTokenPose,
    opts?: {
      tableId?: string;
      temporary?: boolean;
      identifier?: string;
      /**
       * Major policy (per plan: first on map auto-major; later tokens must not steal):
       * - true → claim major for this token
       * - false / omitted → keep existing major; if none, FIRST COME (first token wins)
       */
      major?: boolean;
      copyAppearanceFrom?: GameCharacter | CharacterToken;
    }
  ): CharacterToken {
    const tableId = opts?.tableId || TabletopObject.resolveViewTableIdentifier() || '';
    const token = new CharacterToken(opts?.identifier || UUID.generateUuid());
    token.characterId = characterId;
    token.isTemporaryCopy = !!opts?.temporary;
    token.isInventoryIndicate = false;

    const src = opts?.copyAppearanceFrom;
    if (src) {
      CharacterToken.copyTableAppearance(token, src);
    } else {
      const body = ObjectStore.instance.get(characterId);
      if (body instanceof GameCharacter) {
        CharacterToken.copyTableAppearance(token, body);
      }
    }

    token.initialize();
    token.addToTable(
      tableId,
      {
        x: pose?.x ?? 0,
        y: pose?.y ?? 0,
        posZ: pose?.posZ ?? 0,
      },
      true
    );

    // Only prefer this token when explicitly claiming major. Default / false keep
    // the current major so inventory drop / paste / temp copy do not steal it
    // (and clue yarn / bubbles stay on the original major).
    if (opts?.major === true) {
      CharacterToken.reconcileMajor(characterId, tableId, token.identifier);
    } else {
      CharacterToken.reconcileMajor(characterId, tableId);
    }
    CharacterToken.reviveBodyFromGraveyard(characterId, tableId);
    return token;
  }

  /**
   * Placing a Token on the map revives a trashed sheet into common inventory
   * so it no longer appears under the graveyard tab.
   */
  static reviveBodyFromGraveyard(characterId: string, tableId?: string) {
    if (!characterId) return;
    const body = ObjectStore.instance.get(characterId);
    if (!(body instanceof GameCharacter)) return;
    if (body.location.name !== 'graveyard') return;
    body.setLocation('common', tableId || undefined);
  }

  /** Duplicate this token onto the current (or given) map. */
  duplicateToken(pose?: CharacterTokenPose, temporary = false): CharacterToken {
    if (temporary) {
      const body = this.character;
      if (!body) {
        return CharacterToken.create(this.characterId, {
          x: pose?.x ?? this.location.x,
          y: pose?.y ?? this.location.y,
          posZ: pose?.posZ ?? this.posZ,
        }, { temporary: true, copyAppearanceFrom: this, major: false });
      }
      return GameCharacter.createTemporaryCopy(body, {
        x: pose?.x ?? this.location.x,
        y: pose?.y ?? this.location.y,
        posZ: pose?.posZ ?? this.posZ,
      }, undefined, this);
    }
    return CharacterToken.create(this.characterId, {
      x: pose?.x ?? this.location.x,
      y: pose?.y ?? this.location.y,
      posZ: pose?.posZ ?? this.posZ,
    }, {
      copyAppearanceFrom: this,
      major: false,
    });
  }

  /**
   * Destroy a Token. If it belongs to a temporary body (independent sheet),
   * destroy that body as well so HP sheets do not linger off-inventory.
   */
  static destroyToken(token: CharacterToken) {
    if (!token) return;
    const characterId = token.characterId;
    const body = token.character;
    const tempBody = body instanceof GameCharacter && body.isTemporaryCopy ? body : null;
    token.destroy();
    if (tempBody) {
      CharacterToken.destroyTokensForCharacter(characterId);
      if (ObjectStore.instance.get(characterId)) tempBody.destroy();
      return;
    }
    CharacterToken.reconcileMajor(characterId);
  }

  static copyTableAppearance(dest: CharacterToken, src: GameCharacter | CharacterToken) {
    dest.rotate = src.rotate ?? 0;
    dest.roll = (src as any).roll ?? 0;
    dest.zindex = src.zindex ?? 0;
    dest.isDropShadow = (src as any).isDropShadow ?? true;
    dest.isShowChatBubble = (src as any).isShowChatBubble ?? true;
    dest.isShowName = (src as any).isShowName ?? true;
    dest.owner = (src as any).owner ?? '';
    dest.visionRange = (src as any).visionRange ?? 6;
    dest.brightLight = (src as any).brightLight ?? 0;
    dest.dimLight = (src as any).dimLight ?? 0;
    dest.altitudeValue = Number((src as any).altitude) || 0;
    dest.floorRing = (src as any).floorRing ?? 'none';
    dest.floorRingColor = (src as any).floorRingColor ?? '';
    dest.floorRingSpeed = (src as any).floorRingSpeed ?? 1;
    dest.tokenFrame = (src as any).tokenFrame ?? 'none';
    dest.tokenFrameCaption = (src as any).tokenFrameCaption ?? '';
    dest.pushPin = !!(src as any).pushPin;
    dest.pushPinAngle = (src as any).pushPinAngle ?? 0;
    dest.pushPinColor = (src as any).pushPinColor ?? 'red';
    dest.pushPinStyle = (src as any).pushPinStyle ?? 0;
    dest.pushPinLeft = (src as any).pushPinLeft ?? -4;
    dest.pushPinTop = (src as any).pushPinTop ?? -20;
    dest.isAltitudeIndicate = (src as any).isAltitudeIndicate ?? true;
    dest.isNotRide = (src as any).isNotRide ?? true;
    dest.currntImageIndex = (src as any).currntImageIndex ?? 0;
    dest.isUseIconToOverviewImage = !!(src as any).isUseIconToOverviewImage;
    dest.currntIconIndex = (src as any).currntIconIndex ?? 0;
    dest.aura = (src as any).aura ?? -1;
    dest.isInverse = !!(src as any).isInverse;
    dest.isHollow = !!(src as any).isHollow;
    dest.isBlackPaint = !!(src as any).isBlackPaint;
    dest.isGrayscale = !!(src as any).isGrayscale;
    dest.isSepia = !!(src as any).isSepia;
    dest.isWhitePaint = !!(src as any).isWhitePaint;
    dest.isMatrix = !!(src as any).isMatrix;
    dest.isFlipVertical = !!(src as any).isFlipVertical;
    dest.isContrast = !!(src as any).isContrast;
  }

  /**
   * Migrate legacy on-table GameCharacters into CharacterTokens.
   * Peer-equal: deterministic ids + skip if token already exists.
   */
  static migrateLegacyOnTableCharacters(): number {
    let count = 0;
    const viewId = TabletopObject.resolveViewTableIdentifier();
    const characters = ObjectStore.instance.getObjects(GameCharacter);

    for (const ch of characters) {
      try {
        if (ch.isTemporaryCopy) {
          CharacterToken.migrateTemporaryCharacter(ch);
          count++;
          continue;
        }
        if (ch.location.name !== 'table') continue;

        const tokenId = CharacterToken.legacyTokenId(ch.identifier);
        const existing = ObjectStore.instance.get(tokenId);
        if (existing instanceof CharacterToken) {
          CharacterToken.ensureBodyOffTable(ch);
          continue;
        }

        const tableId =
          ch.placementTableIds[0] ||
          ch.tableIdentifier ||
          viewId ||
          '';
        const pose = tableId ? ch.getPoseForTable(tableId) : null;
        CharacterToken.create(ch.identifier, {
          x: pose?.x ?? ch.location.x,
          y: pose?.y ?? ch.location.y,
          posZ: pose?.posZ ?? ch.posZ,
        }, {
          tableId,
          identifier: tokenId,
          major: true,
          copyAppearanceFrom: ch,
        });
        CharacterToken.ensureBodyOffTable(ch);
        count++;
      } catch (e) {
        console.warn('[CharacterToken] skip legacy migrate for body', ch?.identifier, e);
      }
    }

    try {
      CharacterToken.dedupeLegacyTokens();
    } catch (e) {
      console.warn('[CharacterToken] dedupeLegacyTokens failed', e);
    }
    try {
      CharacterToken.retargetClueAndRangeEndpoints();
    } catch (e) {
      console.warn('[CharacterToken] retargetClueAndRangeEndpoints failed', e);
    }
    return count;
  }

  /**
   * Rewrite legacy clue / range follow ids that still point at on-table bodies
   * to the deterministic legacy CharacterToken id.
   */
  static retargetClueAndRangeEndpoints() {
    // Lazy require to avoid circular imports at module load.
    const { ClueLink } = require('./clue-link') as typeof import('./clue-link');
    const { RangeArea } = require('./range') as typeof import('./range');

    for (const link of ClueLink.all()) {
      let changed = false;
      const fromTok = CharacterToken.retargetEndpointId(link.fromIdentifier);
      const toTok = CharacterToken.retargetEndpointId(link.toIdentifier);
      if (fromTok && fromTok !== link.fromIdentifier) {
        link.fromIdentifier = fromTok;
        changed = true;
      }
      if (toTok && toTok !== link.toIdentifier) {
        link.toIdentifier = toTok;
        changed = true;
      }
      if (changed) link.update();
    }

    for (const range of ObjectStore.instance.getObjects(RangeArea)) {
      const next = CharacterToken.retargetEndpointId(range.followingCharctorIdentifier);
      if (next && next !== range.followingCharctorIdentifier) {
        range.followingCharctorIdentifier = next;
        range.update();
      }
    }
  }

  /** If id is a GameCharacter that has a legacy token, return that token id. */
  private static retargetEndpointId(id: string): string | null {
    if (!id) return null;
    const obj = ObjectStore.instance.get(id);
    if (obj instanceof CharacterToken) return id;
    if (!(obj instanceof GameCharacter)) return null;
    const legacyId = CharacterToken.legacyTokenId(obj.identifier);
    const tok = ObjectStore.instance.get(legacyId);
    if (tok instanceof CharacterToken) return legacyId;
    const any = CharacterToken.focusTokenForCharacter(obj.identifier);
    return any?.identifier || null;
  }

  private static migrateTemporaryCharacter(ch: GameCharacter) {
    const tableId =
      ch.tableIdentifier ||
      TabletopObject.resolveViewTableIdentifier() ||
      '';
    // Keep the temp GameCharacter as a hidden body sheet; only the token sits on the table.
    CharacterToken.create(ch.identifier, {
      x: ch.location.x,
      y: ch.location.y,
      posZ: ch.posZ,
    }, {
      tableId: tableId || undefined,
      temporary: true,
      copyAppearanceFrom: ch,
    });
    CharacterToken.ensureBodyOffTable(ch);
    ch.isTemporaryCopy = true;
    ch.isInventoryIndicate = false;
    ch.update();
  }

  static ensureBodyOffTable(ch: GameCharacter) {
    if (ch.location.name !== 'table') {
      ch.tablePlacements = '';
      return;
    }
    const inv = 'common';
    ch.withSyncSuppressed(() => {
      ch.tablePlacements = '';
      ch.location = { name: inv, x: ch.location.x, y: ch.location.y };
    });
    ch.update();
  }

  /** Keep one legacy token per characterId (prefer deterministic legacy id). */
  static dedupeLegacyTokens() {
    const byChar = new Map<string, CharacterToken[]>();
    for (const t of ObjectStore.instance.getObjects(CharacterToken)) {
      if (!t.characterId) continue;
      const list = byChar.get(t.characterId) || [];
      list.push(t);
      byChar.set(t.characterId, list);
    }
    for (const [characterId, list] of byChar) {
      if (list.length < 2) continue;
      // Only dedupe obvious legacy duplicates that share the same single map pose
      // and include a deterministic legacy id — leave intentional multi-tokens alone
      // when they were user-created (random uuids, different positions).
      const legacyId = CharacterToken.legacyTokenId(characterId);
      const legacy = list.find((t) => t.identifier === legacyId);
      if (!legacy) continue;
      const samePoseDupes = list.filter((t) => {
        if (t === legacy) return false;
        return (
          t.location.x === legacy.location.x &&
          t.location.y === legacy.location.y &&
          t.tableIdentifier === legacy.tableIdentifier
        );
      });
      for (const d of samePoseDupes) {
        d.destroy();
      }
      CharacterToken.reconcileMajor(characterId);
    }
  }

  /** Destroy tokens whose body is gone. */
  static pruneOrphanTokens() {
    for (const t of ObjectStore.instance.getObjects(CharacterToken)) {
      try {
        if (!t.characterId || !t.character) {
          t.destroy();
        }
      } catch (e) {
        console.warn('[CharacterToken] pruneOrphanTokens skip', t?.identifier, e);
      }
    }
  }

  /** Destroy all tokens for a body (call before destroying the body). */
  static destroyTokensForCharacter(characterId: string) {
    if (!characterId) return;
    for (const t of ObjectStore.instance.getObjects(CharacterToken)) {
      if (t.characterId === characterId) t.destroy();
    }
  }

  static get isStealthMode(): boolean {
    for (const token of ObjectStore.instance.getObjects(CharacterToken)) {
      if (token.isHideIn && token.isVisible && token.isVisibleOnTable) return true;
    }
    return false;
  }
}
