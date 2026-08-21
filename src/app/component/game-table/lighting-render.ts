import { GameTable } from '@udonarium/game-table';
import { TableLight } from '@udonarium/table-fx/table-light';

import { WallPolyline } from './footprint-walls';
import { isGlobalIlluminationActive, VisionLightActor } from './vision-math';

const MAX_LIGHTS = 48;
const MAX_OCCLUDERS = 80;

export interface LightOccluder {
  id: string;
  points: { x: number; y: number }[];
}

interface PointLightSource {
  x: number;
  y: number;
  brightRadius: number;
  dimRadius: number;
  color: string;
  intensity: number;
  /** Skip casting shadows from this occluder (e.g. character holding the light). */
  excludeOccluderId?: string;
}

export class LightingRender {
  constructor(readonly canvasElement: HTMLCanvasElement) {}

  /** Free the canvas buffer while lighting/vision are unused. */
  release() {
    if (this.canvasElement.width !== 0) this.canvasElement.width = 0;
    if (this.canvasElement.height !== 0) this.canvasElement.height = 0;
  }

  render(
    table: GameTable,
    visionCharacters: VisionLightActor[],
    lightCharacters: VisionLightActor[],
    occluders: LightOccluder[],
    isGM: boolean,
    /** Mask/terrain footprints as 4-edge wall loops (same as scene walls). */
    footprintWalls: WallPolyline[] = [],
  ) {
    const darkness = Math.max(0, Math.min(1, table.darkness ?? 0));
    const ambient = Math.max(0, Math.min(1, table.globalIllumination ?? 1));
    const baseAlpha = darkness * (1 - ambient * 0.35);
    const giActive = isGlobalIlluminationActive(table);
    if (baseAlpha <= 0.001 && !table.visionEnabled) {
      this.release();
      return;
    }

    const width = table.width * table.gridSize;
    const height = table.height * table.gridSize;
    if (this.canvasElement.width !== width) this.canvasElement.width = width;
    if (this.canvasElement.height !== height) this.canvasElement.height = height;

    const ctx = this.canvasElement.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    const fp = footprintWalls || [];
    const wallsLight: WallPolyline[] = [
      ...(table.walls || []).filter(w => w.blocksLight),
      ...fp,
    ];
    const wallsVision: WallPolyline[] = [
      ...(table.walls || []).filter(w => w.blocksVision),
      ...fp,
    ];
    // Token bodies only (masks/terrains are walls via footprintWalls).
    const occluderList = (occluders || []).slice(0, MAX_OCCLUDERS);
    const tokenIds = new Set((lightCharacters || []).map(c => c.identifier));
    const visionOccluders = occluderList.filter(o => !tokenIds.has(o.id));
    const sources = this.collectLightSources(table, lightCharacters, darkness).slice(0, MAX_LIGHTS);

    if (baseAlpha > 0.001) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = this.darknessOverlayFill(darkness, baseAlpha);
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = 'destination-out';
      // Foundry GI: LoS is treated as brightly lit ??punch full vision cones out of darkness.
      if (giActive && table.visionEnabled && visionCharacters.length) {
        this.punchVisionAsLight(ctx, table, visionCharacters, wallsVision, visionOccluders, width, height);
      }
      for (const light of sources) {
        this.drawPointLight(ctx, light, wallsLight, occluderList, width, height);
      }

      ctx.globalCompositeOperation = 'source-over';
      for (const light of sources) {
        this.drawLightTint(ctx, light);
      }
    }

    if (table.visionEnabled && !isGM) {
      this.applyVisionMask(
        ctx,
        table,
        visionCharacters,
        wallsVision,
        wallsLight,
        visionOccluders,
        sources,
        width,
        height,
        giActive,
      );
    }
  }

  /**
   * Warm amber at dusk (~0.4); fades toward near-black by night.
   * Pure black looked too cool for the dusk preset.
   */
  private darknessOverlayFill(darkness: number, alpha: number): string {
    const duskCenter = 0.4;
    const warmth = Math.max(0, 1 - Math.abs(darkness - duskCenter) / 0.42);
    const a = Math.min(0.92, alpha);
    const r = Math.round(8 + 220 * warmth);
    const g = Math.round(4 + 140 * warmth);
    const b = Math.round(12 + 8 * warmth);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  private collectLightSources(
    table: GameTable,
    lightCharacters: VisionLightActor[],
    darkness: number,
  ): PointLightSource[] {
    const grid = table.gridSize || 50;
    const sources: PointLightSource[] = [];

    for (const light of table.lights || []) {
      if (!light.isActiveAtDarkness(darkness)) continue;
      sources.push({
        x: light.x,
        y: light.y,
        brightRadius: Math.max(0, light.brightRadius),
        dimRadius: Math.max(0, light.dimRadius),
        color: light.color || '#ffd080',
        intensity: light.intensity ?? 0.7,
      });
    }

    for (const ch of lightCharacters || []) {
      const dimGrid = ch.dimLightGrid;
      if (dimGrid <= 0) continue;
      const brightGrid = ch.brightLightGrid;
      sources.push({
        x: ch.location.x + (ch.size * grid) / 2,
        y: ch.location.y + (ch.size * grid) / 2,
        brightRadius: brightGrid * grid,
        dimRadius: dimGrid * grid,
        color: '#ffe2a8',
        intensity: 0.75,
        excludeOccluderId: ch.identifier,
      });
    }

    return sources;
  }

  /** With GI on, clear darkness inside each vision cone (LoS = brightly lit). */
  private punchVisionAsLight(
    ctx: CanvasRenderingContext2D,
    table: GameTable,
    characters: VisionLightActor[],
    wallsLight: WallPolyline[],
    occluders: LightOccluder[],
    width: number,
    height: number,
  ) {
    const grid = table.gridSize || 50;
    for (const ch of characters) {
      const cx = ch.location.x + (ch.size * grid) / 2;
      const cy = ch.location.y + (ch.size * grid) / 2;
      const visionR = Math.max(1, ch.visionRangeGrid * grid);
      ctx.save();
      if (wallsLight.length || occluders.length) {
        ctx.beginPath();
        ctx.rect(0, 0, width, height);
        for (const wall of wallsLight) {
          this.appendPolylineShadowPath(ctx, cx, cy, wall.points, width, height);
        }
        for (const occ of occluders) {
          if (occ.id === ch.identifier) continue;
          this.appendPolylineShadowPath(ctx, cx, cy, this.closedEdges(occ.points), width, height, true);
        }
        ctx.clip('evenodd');
      }
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.beginPath();
      ctx.arc(cx, cy, visionR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawPointLight(
    ctx: CanvasRenderingContext2D,
    light: PointLightSource,
    walls: WallPolyline[],
    occluders: LightOccluder[],
    tableW: number,
    tableH: number,
  ) {
    const r = Math.max(light.dimRadius, light.brightRadius, 1);
    ctx.save();
    if (walls.length || occluders.length) {
      ctx.beginPath();
      ctx.rect(0, 0, tableW, tableH);
      for (const wall of walls) {
        this.appendPolylineShadowPath(ctx, light.x, light.y, wall.points, tableW, tableH);
      }
      for (const occ of occluders) {
        if (light.excludeOccluderId && occ.id === light.excludeOccluderId) continue;
        this.appendPolylineShadowPath(ctx, light.x, light.y, this.closedEdges(occ.points), tableW, tableH, true);
      }
      ctx.clip('evenodd');
    }

    const grad = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, r);
    const bright = Math.max(0, Math.min(r, light.brightRadius));
    const intensity = Math.max(0, Math.min(1, light.intensity ?? 0.7));
    grad.addColorStop(0, `rgba(0,0,0,${0.95 * intensity})`);
    if (bright > 0 && bright < r) {
      grad.addColorStop(bright / r, `rgba(0,0,0,${0.8 * intensity})`);
      grad.addColorStop(Math.min(1, bright / r + 0.08), `rgba(0,0,0,${0.45 * intensity})`);
    } else {
      grad.addColorStop(0.55, `rgba(0,0,0,${0.7 * intensity})`);
    }
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(light.x, light.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawLightTint(ctx: CanvasRenderingContext2D, light: PointLightSource) {
    const r = Math.max(light.dimRadius, 1);
    const rgb = this.hexToRgb(light.color || '#ffd080');
    if (!rgb) return;
    const intensity = Math.max(0, Math.min(1, light.intensity ?? 0.7));
    const grad = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, r);
    grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.22 * intensity})`);
    grad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(light.x, light.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Expand open polyline segments into shadow quads. */
  private appendPolylineShadowPath(
    ctx: CanvasRenderingContext2D,
    lx: number,
    ly: number,
    pts: { x: number; y: number }[],
    tableW: number,
    tableH: number,
    closed = false,
  ) {
    if (!pts || pts.length < 2) return;
    const extent = Math.max(tableW, tableH) * 3;
    const edgeCount = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < edgeCount; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ax = a.x - lx;
      const ay = a.y - ly;
      const bx = b.x - lx;
      const by = b.y - ly;
      const aLen = Math.hypot(ax, ay) || 1;
      const bLen = Math.hypot(bx, by) || 1;
      const aFar = { x: lx + (ax / aLen) * extent, y: ly + (ay / aLen) * extent };
      const bFar = { x: lx + (bx / bLen) * extent, y: ly + (by / bLen) * extent };
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(bFar.x, bFar.y);
      ctx.lineTo(aFar.x, aFar.y);
      ctx.closePath();
    }
  }

  private closedEdges(points: { x: number; y: number }[]): { x: number; y: number }[] {
    return points || [];
  }

  private applyVisionMask(
    ctx: CanvasRenderingContext2D,
    table: GameTable,
    characters: VisionLightActor[],
    wallsVision: WallPolyline[],
    wallsLight: WallPolyline[],
    occluders: LightOccluder[],
    sources: PointLightSource[],
    width: number,
    height: number,
    giActive: boolean,
  ) {
    if (!characters.length) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0,0,0,0.96)';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    const grid = table.gridSize || 50;
    // Positive reveal mask (opaque = can see).
    const reveal = document.createElement('canvas');
    reveal.width = width;
    reveal.height = height;
    const rctx = reveal.getContext('2d');

    for (const ch of characters) {
      const cx = ch.location.x + (ch.size * grid) / 2;
      const cy = ch.location.y + (ch.size * grid) / 2;
      const visionR = Math.max(1, ch.visionRangeGrid * grid);
      const brightR = Math.min(visionR, Math.max(0, ch.brightLightGrid * grid));
      const dimR = Math.min(visionR, Math.max(brightR, ch.dimLightGrid * grid || visionR * 0.65));

      rctx.save();
      if (wallsVision.length || occluders.length) {
        rctx.beginPath();
        rctx.rect(0, 0, width, height);
        for (const wall of wallsVision) {
          this.appendPolylineShadowPath(rctx, cx, cy, wall.points, width, height);
        }
        for (const occ of occluders) {
          if (occ.id === ch.identifier) continue;
          this.appendPolylineShadowPath(rctx, cx, cy, occ.points, width, height, true);
        }
        rctx.clip('evenodd');
      }
      const grad = rctx.createRadialGradient(cx, cy, 0, cx, cy, visionR);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      if (brightR > 0 && brightR < visionR) {
        grad.addColorStop(brightR / visionR, 'rgba(0,0,0,1)');
      }
      if (dimR > brightR && dimR < visionR) {
        grad.addColorStop(dimR / visionR, 'rgba(0,0,0,0.85)');
      } else {
        grad.addColorStop(0.7, 'rgba(0,0,0,0.9)');
      }
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      rctx.fillStyle = grad;
      rctx.beginPath();
      rctx.arc(cx, cy, visionR, 0, Math.PI * 2);
      rctx.fill();
      rctx.restore();
    }

    // Foundry GI off: vision only reveals illuminated areas (vision ??lit).
    if (!giActive) {
      const litPos = document.createElement('canvas');
      litPos.width = width;
      litPos.height = height;
      const lp = litPos.getContext('2d');
      for (const light of sources) {
        this.drawPositiveLightMask(lp, light, wallsLight, occluders, width, height);
      }
      rctx.globalCompositeOperation = 'destination-in';
      rctx.drawImage(litPos, 0, 0);
    }

    // Fog = opaque black, then cut out revealed areas.
    const fog = document.createElement('canvas');
    fog.width = width;
    fog.height = height;
    const fctx = fog.getContext('2d');
    fctx.fillStyle = 'rgba(0,0,0,0.96)';
    fctx.fillRect(0, 0, width, height);
    fctx.globalCompositeOperation = 'destination-out';
    fctx.drawImage(reveal, 0, 0);

    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(fog, 0, 0);
  }

  /** Opaque light footprint for intersecting with vision when GI is off. */
  private drawPositiveLightMask(
    ctx: CanvasRenderingContext2D,
    light: PointLightSource,
    walls: WallPolyline[],
    occluders: LightOccluder[],
    tableW: number,
    tableH: number,
  ) {
    const r = Math.max(light.dimRadius, light.brightRadius, 1);
    ctx.save();
    if (walls.length || occluders.length) {
      ctx.beginPath();
      ctx.rect(0, 0, tableW, tableH);
      for (const wall of walls) {
        this.appendPolylineShadowPath(ctx, light.x, light.y, wall.points, tableW, tableH);
      }
      for (const occ of occluders) {
        if (light.excludeOccluderId && occ.id === light.excludeOccluderId) continue;
        this.appendPolylineShadowPath(ctx, light.x, light.y, this.closedEdges(occ.points), tableW, tableH, true);
      }
      ctx.clip('evenodd');
    }
    const grad = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, r);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.85)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(light.x, light.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }
}
