import { Injectable } from '@angular/core';
import { ObjectNode } from '@udonarium/core/synchronize-object/object-node';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { GuestSession } from '@udonarium/guest-session';
import { TableDrawing } from '@udonarium/table-fx/table-drawing';
import { TableLight } from '@udonarium/table-fx/table-light';
import { SceneToolPermission } from '@udonarium/table-fx/scene-tool-permission';
import { TableWall } from '@udonarium/table-fx/table-wall';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TableSelecter } from '@udonarium/table-selecter';
import { translate } from 'i18n';
import { I18nService } from './i18n.service';
import { DeleteEntry, UndoCommand, UndoService } from './undo.service';

type SceneNudgeSnap =
  | { kind: 'drawing'; x: number; y: number; points: { x: number; y: number }[] }
  | { kind: 'light'; x: number; y: number }
  | { kind: 'wall'; points: { x: number; y: number }[] };

interface SceneNudgeCommand extends UndoCommand {
  __before: Map<string, SceneNudgeSnap>;
  __after: Map<string, SceneNudgeSnap>;
}

/** `none` = idle (no tool lit). `select` = scene-object pick only. */
export type SceneToolMode = 'none' | 'select' | 'light' | 'wall' | 'draw-rect' | 'draw-ellipse' | 'draw-polygon' | 'draw-freehand' | 'draw-text';

@Injectable({ providedIn: 'root' })
export class SceneToolService {
  mode: SceneToolMode = 'none';
  /** True while the scene-tools panel is open (GM edit overlays). */
  isPanelOpen = false;
  wallDraftPoints: { x: number; y: number }[] = [];
  polygonDraftPoints: { x: number; y: number }[] = [];
  drawStrokeColor = '#e11d48';
  drawFillOpacity = 0.15;
  /** Stroke width in px for freehand / shapes. */
  drawStrokeWidth = 4;
  drawStrokeOpacity = 1;
  /** Text content for next place / edit. */
  draftText = translate('scene.draftText');
  draftFontSize = 18;

  /** Defaults for next placed light (radii in grid squares). */
  lightColor = '#ffd080';
  lightIntensity = 0.75;
  lightBrightGrid = 2;
  lightDimGrid = 4;
  lightName = translate('scene.lightName');

  /** Multi-select sets (box / list). Primaries below drive the property panel. */
  selectedDrawings: TableDrawing[] = [];
  selectedLights: TableLight[] = [];
  selectedWalls: TableWall[] = [];

  /** Focused object for property editing (set when exactly one item is selected). */
  selectedDrawing: TableDrawing = null;
  selectedLight: TableLight = null;
  selectedWall: TableWall = null;

  constructor(
    private i18n: I18nService,
    private undoService: UndoService,
  ) {
    this.refreshLocalizedDefaults();
    EventSystem.register(this)
      .on('LOCALE_CHANGED', () => this.refreshLocalizedDefaults());
  }

  /** Record a newly created scene object for Ctrl+Z. Call after appendChild. */
  trackCreated(object: ObjectNode | ObjectNode[]) {
    this.undoService.recordCreated(object, 'scene-create');
  }

  private refreshLocalizedDefaults() {
    this.draftText = this.i18n.t('scene.draftText');
    this.lightName = this.i18n.t('scene.lightName');
  }

  /** Show wall lines / light dots only while the GM panel is open. */
  get showEditOverlay(): boolean {
    return this.isPanelOpen;
  }

  get isDrawMode(): boolean {
    return this.mode.startsWith('draw-');
  }

  get isSceneSelectMode(): boolean {
    return this.mode === 'select';
  }

  get selectionCount(): number {
    return this.selectedDrawings.length + this.selectedLights.length + this.selectedWalls.length;
  }

  /** Flat list of currently selected scene objects (drawings, lights, walls). */
  get selectedObjects(): ObjectNode[] {
    return [
      ...this.selectedDrawings,
      ...this.selectedLights,
      ...this.selectedWalls,
    ];
  }

  /** When true, normal tabletop pick / character select yields to scene tools. */
  get isBlockingPick(): boolean {
    return this.mode !== 'none';
  }

  resetDrafts() {
    this.wallDraftPoints = [];
    this.polygonDraftPoints = [];
  }

  setMode(mode: SceneToolMode) {
    // Toolbar: clicking Select again turns it off (do not stay lit).
    if (mode === 'select' && this.mode === 'select') {
      this.idle();
      return;
    }
    this.mode = mode;
    this.resetDrafts();
    if (mode !== 'select' && mode !== 'none') {
      this.clearSelection();
    }
  }

  /** Enter select without toggle (e.g. picking from the scene object list). */
  enterSelect() {
    this.mode = 'select';
    this.resetDrafts();
  }

  /** Leave any active tool without keeping select lit. */
  idle() {
    this.mode = 'none';
    this.resetDrafts();
  }

  clearSelection() {
    this.selectedDrawings = [];
    this.selectedLights = [];
    this.selectedWalls = [];
    this.selectedDrawing = null;
    this.selectedLight = null;
    this.selectedWall = null;
  }

  isDrawingSelected(d: TableDrawing): boolean {
    return !!d && this.selectedDrawings.includes(d);
  }

  isLightSelected(l: TableLight): boolean {
    return !!l && this.selectedLights.includes(l);
  }

  isWallSelected(w: TableWall): boolean {
    return !!w && this.selectedWalls.includes(w);
  }

  selectDrawing(d: TableDrawing) {
    this.clearSelection();
    if (!d) return;
    this.selectedDrawings = [d];
    this.selectedDrawing = d;
    this.syncDrawingDraftFrom(d);
  }

  selectLight(l: TableLight) {
    this.clearSelection();
    if (!l) return;
    this.selectedLights = [l];
    this.selectedLight = l;
  }

  selectWall(w: TableWall) {
    this.clearSelection();
    if (!w) return;
    this.selectedWalls = [w];
    this.selectedWall = w;
  }

  /** Replace selection with all objects inside a marquee (may be mixed types). */
  setMultiSelection(drawings: TableDrawing[], lights: TableLight[], walls: TableWall[]) {
    this.selectedDrawings = drawings.slice();
    this.selectedLights = lights.slice();
    this.selectedWalls = walls.slice();
    const total = this.selectionCount;
    if (total === 1) {
      this.selectedDrawing = this.selectedDrawings[0] ?? null;
      this.selectedLight = this.selectedLights[0] ?? null;
      this.selectedWall = this.selectedWalls[0] ?? null;
      if (this.selectedDrawing) this.syncDrawingDraftFrom(this.selectedDrawing);
    } else {
      this.selectedDrawing = null;
      this.selectedLight = null;
      this.selectedWall = null;
    }
  }

  private syncDrawingDraftFrom(d: TableDrawing) {
    this.drawStrokeColor = d.strokeColor || this.drawStrokeColor;
    this.drawStrokeWidth = d.strokeWidth || this.drawStrokeWidth;
    this.drawStrokeOpacity = d.strokeOpacity ?? this.drawStrokeOpacity;
    if (d.type !== 'freehand' && d.type !== 'text') {
      this.drawFillOpacity = d.fillOpacity ?? this.drawFillOpacity;
    }
    if (d.type === 'text') {
      this.draftText = d.text || '';
      this.draftFontSize = d.fontSize || 18;
    }
  }

  applyTextToSelected() {
    if (!this.selectedDrawing || this.selectedDrawing.type !== 'text') return;
    this.selectedDrawing.text = this.draftText || '';
    this.selectedDrawing.fontSize = this.draftFontSize || 18;
    this.selectedDrawing.strokeColor = this.drawStrokeColor;
  }

  /** Delete currently selected scene objects (drawings / lights / walls). */
  deleteSelection(): boolean {
    if (GuestSession.isGuest || Network.GuestMode()) return false;
    if (this.selectionCount < 1) return false;
    const perm = SceneToolPermission.instance;
    if (this.selectedDrawings.length && !perm.canModifyKind('drawing')) return false;
    if (this.selectedLights.length && !perm.canModifyKind('light')) return false;
    if (this.selectedWalls.length && !perm.canModifyKind('wall')) return false;

    const parentId = TableSelecter.instance.viewTable?.identifier || '';
    const entries: DeleteEntry[] = [];
    for (const obj of [...this.selectedDrawings, ...this.selectedLights, ...this.selectedWalls]) {
      entries.push({
        kind: 'destroy',
        xml: obj.toXml(),
        parentId: (obj as ObjectNode).parentId || parentId,
        liveId: obj.identifier,
      });
    }

    for (const d of this.selectedDrawings.slice()) d.destroy();
    for (const l of this.selectedLights.slice()) l.destroy();
    for (const w of this.selectedWalls.slice()) w.destroy();
    this.clearSelection();
    this.undoService.recordDeleted(entries, 'scene-delete');
    SoundEffect.play(PresetSound.sweep);
    this.notifyTableUpdate();
    return true;
  }

  /** Nudge selected scene objects by pixel delta (WASD / arrows). */
  nudgeSelection(dx: number, dy: number): boolean {
    if (GuestSession.isGuest || Network.GuestMode()) return false;
    if (this.selectionCount < 1 || (dx === 0 && dy === 0)) return false;
    const perm = SceneToolPermission.instance;
    const before = this.captureSceneNudgeState(perm);
    let moved = false;

    if (perm.canModifyKind('drawing')) {
      for (const d of this.selectedDrawings) {
        this.nudgeDrawing(d, dx, dy);
        moved = true;
      }
    }
    if (perm.canModifyKind('light')) {
      for (const l of this.selectedLights) {
        l.x += dx;
        l.y += dy;
        moved = true;
      }
    }
    if (perm.canModifyKind('wall')) {
      for (const w of this.selectedWalls) {
        const pts = w.points || [];
        if (!pts.length) continue;
        w.points = pts.map(p => ({ x: p.x + dx, y: p.y + dy }));
        moved = true;
      }
    }

    if (moved) {
      const after = this.captureSceneNudgeState(perm);
      this.recordSceneNudge(before, after);
      this.notifyTableUpdate();
    }
    return moved;
  }

  private captureSceneNudgeState(perm: SceneToolPermission): Map<string, SceneNudgeSnap> {
    const map = new Map<string, SceneNudgeSnap>();
    if (perm.canModifyKind('drawing')) {
      for (const d of this.selectedDrawings) {
        map.set(d.identifier, {
          kind: 'drawing',
          x: d.x,
          y: d.y,
          points: (d.geom?.points || []).map(p => ({ x: p.x, y: p.y })),
        });
      }
    }
    if (perm.canModifyKind('light')) {
      for (const l of this.selectedLights) {
        map.set(l.identifier, { kind: 'light', x: l.x, y: l.y });
      }
    }
    if (perm.canModifyKind('wall')) {
      for (const w of this.selectedWalls) {
        map.set(w.identifier, {
          kind: 'wall',
          points: (w.points || []).map(p => ({ x: p.x, y: p.y })),
        });
      }
    }
    return map;
  }

  private recordSceneNudge(before: Map<string, SceneNudgeSnap>, after: Map<string, SceneNudgeSnap>) {
    const apply = (snap: Map<string, SceneNudgeSnap>) => {
      for (const [id, state] of snap) {
        if (state.kind === 'drawing') {
          const d = ObjectStore.instance.get<TableDrawing>(id);
          if (!d) continue;
          d.x = state.x;
          d.y = state.y;
          if (state.points?.length) {
            const geom = d.geom || {};
            geom.points = state.points.map(p => ({ x: p.x, y: p.y }));
            d.geom = geom;
          }
        } else if (state.kind === 'light') {
          const l = ObjectStore.instance.get<TableLight>(id);
          if (!l) continue;
          l.x = state.x;
          l.y = state.y;
        } else if (state.kind === 'wall') {
          const w = ObjectStore.instance.get<TableWall>(id);
          if (!w || !state.points) continue;
          w.points = state.points.map(p => ({ x: p.x, y: p.y }));
        }
      }
      this.notifyTableUpdate();
    };

    const makeCmd = (b: Map<string, SceneNudgeSnap>, a: Map<string, SceneNudgeSnap>): SceneNudgeCommand => ({
      label: 'scene-nudge',
      __before: b,
      __after: a,
      undo: () => apply(b),
      redo: () => apply(a),
    });

    this.undoService.pushMerged('scene-nudge', makeCmd(before, after), (prev, next) => {
      const p = prev as SceneNudgeCommand;
      const n = next as SceneNudgeCommand;
      return makeCmd(p.__before ?? before, n.__after ?? after);
    });
  }

  private nudgeDrawing(d: TableDrawing, dx: number, dy: number) {
    d.x += dx;
    d.y += dy;
    const geom = d.geom || {};
    const pts: { x: number; y: number }[] = geom.points || [];
    if (pts.length) {
      geom.points = pts.map(p => ({ x: p.x + dx, y: p.y + dy }));
      d.geom = geom;
    }
  }

  /** Notify peers / render that the current table's scene children changed. */
  notifyTableUpdate() {
    const table = TableSelecter.instance.viewTable;
    if (table) EventSystem.trigger('UPDATE_GAME_OBJECT', table.toContext());
  }
}
