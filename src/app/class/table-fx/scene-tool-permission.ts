import { GuestSession } from '../guest-session';
import { SyncObject, SyncVar } from '../core/synchronize-object/decorator';
import { GameObject } from '../core/synchronize-object/game-object';
import { InnerXml } from '../core/synchronize-object/object-serializer';
import { Network } from '../core/system';
import { PeerCursor } from '../peer-cursor';

export type SceneCreateKind = 'light' | 'wall' | 'draw-rect' | 'draw-ellipse' | 'draw-polygon' | 'draw-freehand' | 'draw-text';
export type SceneModifyKind = 'light' | 'wall' | 'drawing';

/** Menu tour ids that players always see (not configurable). */
const ALWAYS_OPEN_MENUS = new Set([
  'menu.connection',
  'menu.chat',
  'menu.combat',
  'menu.settings',
  'menu.disconnect',
  'menu.more',
]);

/**
 * Room-wide permissions for non-GM players.
 * Scene tools default allowed; room data load (ZIP / folder) defaults GM-only.
 * Menu items: images / music / toolbox / inventory / notes default visible; others default hidden.
 * GM is always unrestricted.
 */
@SyncObject('scene-tool-permission')
export class SceneToolPermission extends GameObject implements InnerXml {
  @SyncVar() playerCanCreateLight: boolean = true;
  @SyncVar() playerCanCreateWall: boolean = true;
  @SyncVar() playerCanCreateRect: boolean = true;
  @SyncVar() playerCanCreateEllipse: boolean = true;
  @SyncVar() playerCanCreatePolygon: boolean = true;
  @SyncVar() playerCanCreateFreehand: boolean = true;
  @SyncVar() playerCanCreateText: boolean = true;

  @SyncVar() playerCanModifyLight: boolean = true;
  @SyncVar() playerCanModifyWall: boolean = true;
  @SyncVar() playerCanModifyDrawing: boolean = true;

  /** When false (default), only GM may load a room ZIP while in a room. */
  @SyncVar() playerCanLoadZip: boolean = false;
  /** When false (default), only GM may load a room from the backup folder while in a room. */
  @SyncVar() playerCanLoadRoom: boolean = false;

  /**
   * Atmosphere controls (toolbox + map settings).
   * Default on so players with toolbox/table access keep current behaviour; GM can revoke.
   */
  @SyncVar() playerCanControlWeather: boolean = true;
  @SyncVar() playerCanControlDayNight: boolean = true;

  /**
   * Player menu visibility.
   * Default on: images / music / toolbox / inventory / notes.
   * Default off: table / scene preset / scenario text.
   * Guests still blocked by GuestMode; GM always unrestricted.
   */
  @SyncVar() playerCanOpenTable: boolean = false;
  @SyncVar() playerCanOpenImages: boolean = true;
  @SyncVar() playerCanOpenMusic: boolean = true;
  @SyncVar() playerCanOpenToolbox: boolean = true;
  @SyncVar() playerCanOpenScenePreset: boolean = false;
  @SyncVar() playerCanOpenScenarioText: boolean = false;
  @SyncVar() playerCanOpenInventory: boolean = true;
  @SyncVar() playerCanOpenNotes: boolean = true;

  private static _instance: SceneToolPermission;

  static get instance(): SceneToolPermission {
    if (!SceneToolPermission._instance) {
      SceneToolPermission._instance = new SceneToolPermission('SceneToolPermission');
      SceneToolPermission._instance.initialize();
    }
    return SceneToolPermission._instance;
  }

  private get isGM(): boolean {
    return !!PeerCursor.myCursor?.isGMMode;
  }

  get canOpenPanel(): boolean {
    if (GuestSession.isGuest) return false;
    return this.isGM || this.canCreateAnything || this.canModifyAnything;
  }

  get canCreateAnything(): boolean {
    return this.playerCanCreateLight
      || this.playerCanCreateWall
      || this.playerCanCreateRect
      || this.playerCanCreateEllipse
      || this.playerCanCreatePolygon
      || this.playerCanCreateFreehand
      || this.playerCanCreateText;
  }

  get canModifyAnything(): boolean {
    return this.playerCanModifyLight || this.playerCanModifyWall || this.playerCanModifyDrawing;
  }

  /** @deprecated Prefer {@link canCreateKind}. True if any create permission. */
  get canCreate(): boolean {
    if (GuestSession.isGuest) return false;
    return this.isGM || this.canCreateAnything;
  }

  /** @deprecated Prefer {@link canModifyKind}. True if any modify permission. */
  get canModify(): boolean {
    if (GuestSession.isGuest) return false;
    return this.isGM || this.canModifyAnything;
  }

  canCreateKind(kind: SceneCreateKind): boolean {
    if (GuestSession.isGuest) return false;
    if (this.isGM) return true;
    switch (kind) {
      case 'light': return !!this.playerCanCreateLight;
      case 'wall': return !!this.playerCanCreateWall;
      case 'draw-rect': return !!this.playerCanCreateRect;
      case 'draw-ellipse': return !!this.playerCanCreateEllipse;
      case 'draw-polygon': return !!this.playerCanCreatePolygon;
      case 'draw-freehand': return !!this.playerCanCreateFreehand;
      case 'draw-text': return !!this.playerCanCreateText;
      default: return false;
    }
  }

  canModifyKind(kind: SceneModifyKind): boolean {
    if (GuestSession.isGuest) return false;
    if (this.isGM) return true;
    switch (kind) {
      case 'light': return !!this.playerCanModifyLight;
      case 'wall': return !!this.playerCanModifyWall;
      case 'drawing': return !!this.playerCanModifyDrawing;
      default: return false;
    }
  }

  /** Whether the given scene-tool mode may be used to place/create. */
  canUseCreateMode(mode: string): boolean {
    if (mode === 'light' || mode === 'wall') return this.canCreateKind(mode);
    if (mode.startsWith('draw-')) return this.canCreateKind(mode as SceneCreateKind);
    return false;
  }

  /**
   * Load room ZIP. Guests never; GM always; outside a room always (lobby / solo);
   * in-room players need {@link playerCanLoadZip}.
   */
  canLoadZip(): boolean {
    if (GuestSession.isGuest) return false;
    if (this.isGM) return true;
    if (!Network.peer?.isRoom) return true;
    return !!this.playerCanLoadZip;
  }

  /**
   * Load room from folder backup. Same rules as {@link canLoadZip}.
   */
  canLoadRoom(): boolean {
    if (GuestSession.isGuest) return false;
    if (this.isGM) return true;
    if (!Network.peer?.isRoom) return true;
    return !!this.playerCanLoadRoom;
  }

  /**
   * Change map weather (type / intensity). Guests never; GM always;
   * missing SyncVar (older rooms) falls back to allowed.
   */
  canControlWeather(): boolean {
    if (GuestSession.isGuest) return false;
    if (this.isGM) return true;
    return this.menuFlag(this.playerCanControlWeather, true);
  }

  /**
   * Change day/night (darkness tween / darkness slider). Same rules as weather.
   */
  canControlDayNight(): boolean {
    if (GuestSession.isGuest) return false;
    if (this.isGM) return true;
    return this.menuFlag(this.playerCanControlDayNight, true);
  }

  /**
   * Whether the local user may see / open a main-menu item.
   * Core items always allowed; guests blocked on configurable items; GM always allowed.
   * Missing SyncVar keys (older room sync) fall back to each field's intended default.
   */
  canOpenMenu(tourId: string): boolean {
    if (!tourId) return false;
    if (ALWAYS_OPEN_MENUS.has(tourId)) return true;
    if (tourId === 'menu.sceneTools') return this.canOpenPanel;
    if (this.isGM) return true;
    if (GuestSession.isGuest) return false;
    switch (tourId) {
      case 'menu.table': return this.menuFlag(this.playerCanOpenTable, false);
      case 'menu.images': return this.menuFlag(this.playerCanOpenImages, true);
      case 'menu.music': return this.menuFlag(this.playerCanOpenMusic, true);
      case 'menu.toolbox': return this.menuFlag(this.playerCanOpenToolbox, true);
      case 'menu.scenePreset': return this.menuFlag(this.playerCanOpenScenePreset, false);
      case 'menu.scenarioText': return this.menuFlag(this.playerCanOpenScenarioText, false);
      case 'menu.inventory': return this.menuFlag(this.playerCanOpenInventory, true);
      case 'menu.notes': return this.menuFlag(this.playerCanOpenNotes, true);
      default: return false;
    }
  }


  /** Treat absent SyncVar as {@link defaultOn} (older hosts may omit new keys). */
  private menuFlag(value: boolean | undefined | null, defaultOn: boolean): boolean {
    return value == null ? defaultOn : !!value;
  }

  setAllCreate(enabled: boolean) {
    const v = !!enabled;
    this.playerCanCreateLight = v;
    this.playerCanCreateWall = v;
    this.playerCanCreateRect = v;
    this.playerCanCreateEllipse = v;
    this.playerCanCreatePolygon = v;
    this.playerCanCreateFreehand = v;
    this.playerCanCreateText = v;
  }

  setAllModify(enabled: boolean) {
    const v = !!enabled;
    this.playerCanModifyLight = v;
    this.playerCanModifyWall = v;
    this.playerCanModifyDrawing = v;
  }

  setAllMenus(enabled: boolean) {
    const v = !!enabled;
    this.playerCanOpenTable = v;
    this.playerCanOpenImages = v;
    this.playerCanOpenMusic = v;
    this.playerCanOpenToolbox = v;
    this.playerCanOpenScenePreset = v;
    this.playerCanOpenScenarioText = v;
    this.playerCanOpenInventory = v;
    this.playerCanOpenNotes = v;
  }

  get allMenusEnabled(): boolean {
    return this.playerCanOpenTable
      && this.playerCanOpenImages
      && this.playerCanOpenMusic
      && this.playerCanOpenToolbox
      && this.playerCanOpenScenePreset
      && this.playerCanOpenScenarioText
      && this.playerCanOpenInventory
      && this.playerCanOpenNotes;
  }

  innerXml(): string { return ''; }

  parseInnerXml(element: Element) {
    const context = SceneToolPermission.instance.toContext();
    context.syncData = this.toContext().syncData;
    SceneToolPermission.instance.apply(context);
    SceneToolPermission.instance.update();
    this.destroy();
  }
}
