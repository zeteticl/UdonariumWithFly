import { ImageFile } from './core/file-storage/image-file';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { MathUtil } from './core/system/util/math-util';
import { DataElement } from './data-element';
import { TabletopObject } from './tabletop-object';

export enum TerrainViewState {
  NULL = 0,
  FLOOR = 1,
  WALL = 2,
  ALL = 3,
}
export enum SlopeDirection {
  NONE = 0,
  TOP = 1,
  BOTTOM = 2,
  LEFT = 3,
  RIGHT = 4,
}

/** CSS neon styles for signs / emissive facades (no WebGL bloom). */
export enum TerrainNeonType {
  NONE = 0,
  SOFT = 1,
  TUBE = 2,
  EDGE = 3,
  FLICKER = 4,
  PULSE = 5,
  STROBE = 6,
}

export const TERRAIN_NEON_DEFAULT_COLOR = '#33ffff';
/** Soft floor for thin signs / bridges (settings). */
export const TERRAIN_SIZE_MIN = 0.1;
export const SLOPE_DEG_MIN = 1;
export const SLOPE_DEG_MAX = 45;

export type TerrainFaceName =
  | 'floor'
  | 'underside'
  | 'wall'
  | 'wallTop'
  | 'wallBottom'
  | 'wallLeft'
  | 'wallRight';

/** Optional per-face image element names (fallback to wall / floor). */
export const TERRAIN_FACE_ELEMENTS: TerrainFaceName[] = [
  'floor',
  'underside',
  'wall',
  'wallTop',
  'wallBottom',
  'wallLeft',
  'wallRight',
];

/**
 * Floor sample at a table point (flat roof or slope ramp).
 * No new SyncVars — pure derived geometry for ride / tip.
 */
export type TerrainFloorHit = {
  posZ: number;
  /** Pedestal tip CSS (empty on flat floors). Local-only visual. */
  alignCss: string;
};

@SyncObject('terrain')
export class Terrain extends TabletopObject {
  @SyncVar() isLocked: boolean = false;
  @SyncVar() mode: TerrainViewState = TerrainViewState.ALL;
  @SyncVar() rotate: number = 0;
  @SyncVar() isDropShadow: boolean = true;
  @SyncVar() isSurfaceShading: boolean = true
  @SyncVar() isInteract: boolean = true;
  /** When true, footprint blocks light and vision (opt-in; floors stay open by default). */
  @SyncVar() affectsLight: boolean = false;
  @SyncVar() isSlope: boolean = false;
  @SyncVar() slopeDirection: number = SlopeDirection.NONE;
  /**
   * Historical wall CSS uses scaleX(-1) on top/left faces (can mirror sign text).
   * Default true keeps old look; turn off for readable neon / sign faces.
   */
  @SyncVar() mirrorWallTop: boolean = true;
  @SyncVar() mirrorWallLeft: boolean = true;
  /** Neon glow style; 0 = off. See TerrainNeonType. */
  @SyncVar() neonType: number = TerrainNeonType.NONE;
  /** CSS color for neon halo; empty uses default cyan. */
  @SyncVar() neonColor: string = '';
  @SyncVar() neonOnWalls: boolean = true;
  @SyncVar() neonOnFloor: boolean = false;
  /**
   * JSON: uncropped bake source image ids + W/E/S/N insets + uncropped grid size / table anchor.
   * Empty for hand-made terrain. Used to reopen the shared crop preview.
   */
  @SyncVar() bakeCropJson: string = '';
  /**
   * Shared id for multi-box model imports. Same id → move / assemble as one group.
   * Empty for hand-made or single-box terrain.
   */
  @SyncVar() bakeGroupId: string = '';

  get width(): number { return this.getCommonValue('width', 1); }
  set width(width: number) { this.setCommonValue('width', width); }
  get height(): number { return this.getCommonValue('height', 1); }
  set height(height: number) { this.setCommonValue('height', height); }
  get depth(): number { return this.getCommonValue('depth', 1); }
  set depth(depth: number) { this.setCommonValue('depth', depth); }
  get name(): string { return this.getCommonValue('name', ''); }
  set name(name: string) { this.setCommonValue('name', name); }

  get wallImage(): ImageFile { return this.getImageFile('wall'); }
  get floorImage(): ImageFile { return this.getImageFile('floor'); }
  get undersideImage(): ImageFile { return this.getImageFile('underside'); }
  get wallTopImage(): ImageFile { return this.getImageFile('wallTop'); }
  get wallBottomImage(): ImageFile { return this.getImageFile('wallBottom'); }
  get wallLeftImage(): ImageFile { return this.getImageFile('wallLeft'); }
  get wallRightImage(): ImageFile { return this.getImageFile('wallRight'); }

  /**
   * Resolve a face texture: per-face override if set, else wall (vertical) or floor (horizontal).
   */
  faceImage(face: TerrainFaceName): ImageFile {
    if (face === 'floor') return this.floorImage;
    if (face === 'wall') return this.wallImage;
    const own = this.getImageFile(face);
    if (own && !own.isEmpty) return own;
    if (face === 'underside') return this.floorImage;
    return this.wallImage;
  }

  /** True when a dedicated (non-fallback) image id is stored for the face. */
  hasOwnFaceImage(face: TerrainFaceName): boolean {
    if (face === 'floor' || face === 'wall') {
      const img = this.getImageFile(face);
      return !!(img && img.identifier);
    }
    const el = this.imageDataElement?.getFirstElementByName(face);
    const v = el ? (el.value + '') : '';
    return !!(v && v !== 'null');
  }

  get hasWall(): boolean { return this.mode & TerrainViewState.WALL ? true : false; }
  get hasFloor(): boolean { return this.mode & TerrainViewState.FLOOR ? true : false; }

  /** Slope angle (radians) used by floor CSS and ride sampling — single source of truth. */
  get slopeAngleRad(): number {
    if (!this.isSlope) return 0;
    const h = Math.max(0, this.height || 0);
    if (h <= 0) return 0;
    const dir = this.slopeDirection === SlopeDirection.NONE ? SlopeDirection.BOTTOM : this.slopeDirection;
    if (dir === SlopeDirection.LEFT || dir === SlopeDirection.RIGHT) {
      return Math.atan(h / Math.max(0.001, this.width || 1));
    }
    if (dir === SlopeDirection.TOP || dir === SlopeDirection.BOTTOM) {
      return Math.atan(h / Math.max(0.001, this.depth || 1));
    }
    return 0;
  }

  get slopeDegrees(): number {
    return MathUtil.degrees(this.slopeAngleRad);
  }

  /** Run length (grid) along the slope axis. */
  get slopeRun(): number {
    const dir = this.slopeDirection === SlopeDirection.NONE ? SlopeDirection.BOTTOM : this.slopeDirection;
    if (dir === SlopeDirection.LEFT || dir === SlopeDirection.RIGHT) {
      return Math.max(TERRAIN_SIZE_MIN, MathUtil.clampMin(this.width, 0));
    }
    return Math.max(TERRAIN_SIZE_MIN, MathUtil.clampMin(this.depth, 0));
  }

  /**
   * Set incline by rewriting height = tan(deg) * run.
   * Enables isSlope when deg >= SLOPE_DEG_MIN.
   */
  setSlopeDegrees(degrees: number): void {
    const clamped = Math.min(SLOPE_DEG_MAX, Math.max(0, degrees));
    this.mutateAppearance(() => {
      if (clamped < SLOPE_DEG_MIN) {
        this.isSlope = false;
        this.slopeDirection = SlopeDirection.NONE;
        return;
      }
      this.isSlope = true;
      if (this.slopeDirection === SlopeDirection.NONE) {
        this.slopeDirection = SlopeDirection.BOTTOM;
      }
      const rad = MathUtil.radians(clamped);
      this.height = Math.max(TERRAIN_SIZE_MIN, Math.tan(rad) * this.slopeRun);
    });
  }

  /** Same transform string as legacy floorModCss (mid-pivot ramp). */
  get floorModCss(): string {
    const tmp = this.slopeAngleRad;
    if (!tmp) return '';
    const s = 1 / Math.cos(tmp);
    const dir = this.slopeDirection === SlopeDirection.NONE ? SlopeDirection.BOTTOM : this.slopeDirection;
    switch (dir) {
      case SlopeDirection.TOP:
        return ` rotateX(${tmp}rad) scaleY(${s})`;
      case SlopeDirection.BOTTOM:
        return ` rotateX(${-tmp}rad) scaleY(${s})`;
      case SlopeDirection.LEFT:
        return ` rotateY(${-tmp}rad) scaleX(${s})`;
      case SlopeDirection.RIGHT:
        return ` rotateY(${tmp}rad) scaleX(${s})`;
      default:
        return '';
    }
  }

  get floorBrightness(): number {
    if (!this.isSurfaceShading || !this.isSlope) return 1.0;
    const dir = this.slopeDirection === SlopeDirection.NONE ? SlopeDirection.BOTTOM : this.slopeDirection;
    switch (dir) {
      case SlopeDirection.TOP: return 0.4;
      case SlopeDirection.BOTTOM: return 1.0;
      case SlopeDirection.LEFT: return 0.6;
      case SlopeDirection.RIGHT: return 0.9;
      default: return 1.0;
    }
  }

  /**
   * Sample this terrain's floor under (worldX, worldY).
   * Returns null outside footprint / without floor — callers keep prior pose (compat).
   */
  floorHitAt(worldX: number, worldY: number, gridSize: number = 50): TerrainFloorHit | null {
    if (!this.hasFloor || !this.isInteract) return null;
    if (this.location?.name !== 'table') return null;

    const g = gridSize;
    const w = Math.max(0.001, (this.width || 1) * g);
    const d = Math.max(0.001, (this.depth || 1) * g);
    const cx = (this.location?.x ?? 0) + w / 2;
    const cy = (this.location?.y ?? 0) + d / 2;
    const rad = -((this.rotate || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = worldX - cx;
    const dy = worldY - cy;
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;
    const halfW = w / 2;
    const halfD = d / 2;
    if (localX < -halfW || localX > halfW || localY < -halfD || localY > halfD) return null;

    const u = (localX + halfW) / w;
    const v = (localY + halfD) / d;
    const base = (this.posZ || 0) + (this.altitude || 0) * g;
    const hPx = Math.max(0, this.height || 0) * g;
    const angle = this.slopeAngleRad;

    let posZ = base + hPx;
    let alignCss = '';
    const dir = this.slopeDirection === SlopeDirection.NONE ? SlopeDirection.BOTTOM : this.slopeDirection;
    if (this.isSlope && dir !== SlopeDirection.NONE && hPx > 0 && angle > 0) {
      let rise = 0;
      switch (dir) {
        case SlopeDirection.TOP: rise = v; break;
        case SlopeDirection.BOTTOM: rise = 1 - v; break;
        case SlopeDirection.LEFT: rise = u; break;
        case SlopeDirection.RIGHT: rise = 1 - u; break;
        default: rise = 0.5; break;
      }
      posZ = base + hPx * rise;
      const deg = (angle * 180) / Math.PI;
      let rx = 0;
      let ry = 0;
      switch (dir) {
        case SlopeDirection.TOP: rx = deg; break;
        case SlopeDirection.BOTTOM: rx = -deg; break;
        case SlopeDirection.LEFT: ry = -deg; break;
        case SlopeDirection.RIGHT: ry = deg; break;
      }
      const yaw = this.rotate || 0;
      alignCss = `rotateZ(${yaw}deg) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${-yaw}deg)`;
    }
    return { posZ, alignCss };
  }

  /** Highest interactable floor under a point (stacked decks). */
  static floorHitAt(
    terrains: Terrain[] | null | undefined,
    worldX: number,
    worldY: number,
    gridSize: number = 50,
  ): TerrainFloorHit | null {
    let best: TerrainFloorHit | null = null;
    for (const terrain of terrains || []) {
      const hit = terrain?.floorHitAt(worldX, worldY, gridSize);
      if (!hit) continue;
      if (!best || hit.posZ >= best.posZ) best = hit;
    }
    return best;
  }

  /**
   * Cheap AABB (+ diagonal pad when rotated) for tip-refresh filtering.
   * Not a substitute for floorHitAt — only skips irrelevant terrain UPDATEs.
   */
  mayAffectWorldPoint(worldX: number, worldY: number, gridSize: number = 50, padPx: number = 25): boolean {
    if (!this.hasFloor || !this.isInteract) return false;
    if (this.location?.name !== 'table') return false;
    const g = gridSize;
    const w = Math.max(0, (this.width || 1) * g);
    const d = Math.max(0, (this.depth || 1) * g);
    const x0 = this.location?.x ?? 0;
    const y0 = this.location?.y ?? 0;
    const rotPad = (this.rotate || 0) % 90 !== 0 ? Math.hypot(w, d) * 0.5 - Math.max(w, d) * 0.5 : 0;
    const pad = padPx + Math.max(0, rotPad);
    return worldX >= x0 - pad && worldX <= x0 + w + pad
      && worldY >= y0 - pad && worldY <= y0 + d + pad;
  }

  complement(): void {
    let element = this.getElement('altitude', this.commonDataElement);
    if (!element && this.commonDataElement) {
      this.commonDataElement.appendChild(DataElement.create('altitude', 0, {}, 'altitude_' + this.identifier));
    }
    // Do NOT ensureFaceImageElements here: empty face DataElements would
    // ObjectStore.add+broadcast on every ZIP/XML load and storm peers.
    // Slots are created lazily in setFaceImage / settings openImage.
  }

  /**
   * Lazily add optional face slots when the user edits a face.
   * Avoid calling from complement()/load — each DataElement.create broadcasts.
   */
  ensureFaceImageElements(): void {
    if (!this.imageDataElement) return;
    const optional: TerrainFaceName[] = ['underside', 'wallTop', 'wallBottom', 'wallLeft', 'wallRight'];
    for (const name of optional) {
      if (this.imageDataElement.getFirstElementByName(name)) continue;
      this.imageDataElement.appendChild(
        DataElement.create(name, '', { type: 'image' }, `${name}_${this.identifier}`)
      );
    }
  }

  setFaceImage(face: TerrainFaceName, imageIdentifier: string): void {
    this.ensureFaceImageElements();
    let el = this.imageDataElement?.getFirstElementByName(face);
    if (!el && this.imageDataElement) {
      el = DataElement.create(face, '', { type: 'image' }, `${face}_${this.identifier}`);
      this.imageDataElement.appendChild(el);
    }
    if (el) el.value = imageIdentifier ?? '';
  }

  static create(name: string, width: number, depth: number, height: number, wall: string, floor: string, identifier?: string): Terrain {
    let object: Terrain = null;

    if (identifier) {
      object = new Terrain(identifier);
    } else {
      object = new Terrain();
    }
    object.createDataElements();

    object.commonDataElement.appendChild(DataElement.create('name', name, {}, 'name_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('width', width, {}, 'width_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('height', height, {}, 'height_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('depth', depth, {}, 'depth_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('altitude', 0, {}, 'altitude_' + object.identifier));
    object.imageDataElement.appendChild(DataElement.create('wall', wall, { type: 'image' }, 'wall_' + object.identifier));
    object.imageDataElement.appendChild(DataElement.create('floor', floor, { type: 'image' }, 'floor_' + object.identifier));
    // Face slots stay lazy (see ensureFaceImageElements) to keep CREATE payloads small.
    object.initialize();

    return object;
  }
}
