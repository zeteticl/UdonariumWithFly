import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { TerrainFaceName } from '@udonarium/terrain';
import {
  FaceEdgeInsets,
  PerFaceInsets,
  autoPerFaceInsets,
  clipPathForFace,
  clonePerFaceInsets,
  clampInsets,
  emptyInsets,
} from '@udonarium/terrain-model/bake-crop';
import { BakedFaceBlobs } from '@udonarium/terrain-model/ortho-bake';
import { EventSystem } from '@udonarium/core/system';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

export type TerrainBakeCropMode = 'import' | 'edit';

export type TerrainBakeCropThumb = {
  face: TerrainFaceName;
  url: string;
  labelKey: string;
};

export type TerrainBakeCropResolve =
  | { action: 'confirm'; faces: PerFaceInsets }
  | { action: 'skip' }
  | { action: 'abort' };

export type TerrainBakeCropHost = {
  mode: TerrainBakeCropMode;
  thumbs: TerrainBakeCropThumb[];
  faces: PerFaceInsets;
  selectedFace?: TerrainFaceName;
  index?: number;
  total?: number;
  boxName?: string;
  livePreview?: (faces: PerFaceInsets) => void;
  /** Edit mode: persist insets as the user adjusts (no Confirm required). */
  persist?: (faces: PerFaceInsets) => void;
  /** Preferred over fetch(thumb.url) — returns the uncropped source blob. */
  faceBlob?: (face: TerrainFaceName) => Promise<Blob | null>;
  /** Called once when the panel/modal finishes (confirm / skip / abort / close). */
  settle?: (result: TerrainBakeCropResolve | false) => void;
};

@Component({
  selector: 'app-terrain-bake-crop',
  templateUrl: './terrain-bake-crop.component.html',
  styleUrls: ['../shared/settings-ui.css', './terrain-bake-crop.component.css'],
  standalone: false,
})
export class TerrainBakeCropComponent implements OnInit, OnDestroy {
  mode: TerrainBakeCropMode = 'edit';
  thumbs: TerrainBakeCropThumb[] = [];
  faces: PerFaceInsets = {};
  selectedFace: TerrainFaceName = 'wallBottom';
  index = 0;
  total = 1;
  boxName = '';
  private livePreview: ((faces: PerFaceInsets) => void) | null = null;
  private persist: ((faces: PerFaceInsets) => void) | null = null;
  private faceBlob: ((face: TerrainFaceName) => Promise<Blob | null>) | null = null;
  private settle: ((result: TerrainBakeCropResolve | false) => void) | null = null;
  private settled = false;
  /** true when opened as a floating panel (map stays interactive). */
  private panelHost = false;

  readonly sliderMax = 100;
  autoBusy = false;

  constructor(
    private modalService: ModalService,
    private panelService: PanelService,
    private i18n: I18nService,
    private changeDetector: ChangeDetectorRef,
  ) {
    const opt = modalService.option;
    if (opt && (opt.mode || opt.thumbs)) {
      this.applyHost(opt as TerrainBakeCropHost);
    }
  }

  /** Configure after PanelService.open (modal option is not available). */
  setup(host: TerrainBakeCropHost) {
    this.panelHost = true;
    this.applyHost(host);
    this.refreshTitle();
    this.emitPreview();
  }

  ngOnInit() {
    this.refreshTitle();
    this.emitPreview();
    EventSystem.register(this).on('LOCALE_CHANGED', () => this.refreshTitle());
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    if (this.settled) return;
    // Panel X / destroy: keep current crop (edit already persisted; import confirms).
    if (this.mode === 'edit') {
      this.finish(false);
    } else {
      this.finish({ action: 'confirm', faces: clonePerFaceInsets(this.faces) });
    }
  }

  selectFace(face: TerrainFaceName) {
    this.selectedFace = face;
    if (!this.faces[face]) this.faces[face] = emptyInsets();
  }

  clipFor(face: TerrainFaceName): string {
    return clipPathForFace(face, this.faces[face] || emptyInsets());
  }

  pct(side: keyof FaceEdgeInsets): number {
    const insets = this.faces[this.selectedFace] || emptyInsets();
    return Math.round((insets[side] || 0) * 1000) / 10;
  }

  setPct(side: keyof FaceEdgeInsets, value: number) {
    const cur = this.faces[this.selectedFace] || emptyInsets();
    this.faces = {
      ...this.faces,
      [this.selectedFace]: clampInsets({ ...cur, [side]: Math.max(0, (+value || 0) / 100) }),
    };
    this.emitPreview();
    if (this.mode === 'edit') this.persist?.(clonePerFaceInsets(this.faces));
  }

  async autoCrop() {
    if (this.autoBusy || !this.thumbs.length) return;
    this.autoBusy = true;
    try {
      const blobs: BakedFaceBlobs = {};
      for (const t of this.thumbs) {
        let blob: Blob | null = null;
        if (this.faceBlob) {
          try { blob = await this.faceBlob(t.face); } catch { blob = null; }
        }
        if (!blob) {
          try {
            const res = await fetch(t.url);
            if (res.ok) blob = await res.blob();
          } catch {
            blob = null;
          }
        }
        if (blob) blobs[t.face] = blob;
      }
      if (!Object.keys(blobs).length) return;
      this.faces = await autoPerFaceInsets(blobs);
      if (!this.faces[this.selectedFace]) this.faces[this.selectedFace] = emptyInsets();
      this.emitPreview();
      if (this.mode === 'edit') this.persist?.(clonePerFaceInsets(this.faces));
      this.changeDetector.markForCheck();
    } finally {
      this.autoBusy = false;
      this.changeDetector.markForCheck();
    }
  }

  confirm() {
    if (this.mode === 'edit') {
      this.persist?.(clonePerFaceInsets(this.faces));
      this.finish(false);
      this.closeHost();
      return;
    }
    this.finish({ action: 'confirm', faces: clonePerFaceInsets(this.faces) });
    this.closeHost();
  }

  skip() {
    this.finish({ action: 'skip' });
    this.closeHost();
  }

  abort() {
    this.finish({ action: 'abort' });
    this.closeHost();
  }

  cancel() {
    // Edit: close only (insets already saved on each change).
    if (this.mode === 'edit') {
      this.finish(false);
      this.closeHost();
      return;
    }
    this.finish({ action: 'abort' });
    this.closeHost();
  }

  private applyHost(host: TerrainBakeCropHost) {
    this.mode = host.mode === 'import' ? 'import' : 'edit';
    this.thumbs = Array.isArray(host.thumbs) ? host.thumbs : [];
    this.faces = clonePerFaceInsets(host.faces || {});
    this.index = Math.max(0, +(host.index) || 0);
    this.total = Math.max(1, +(host.total) || 1);
    this.boxName = host.boxName || '';
    this.livePreview = typeof host.livePreview === 'function' ? host.livePreview : null;
    this.persist = typeof host.persist === 'function' ? host.persist : null;
    this.faceBlob = typeof host.faceBlob === 'function' ? host.faceBlob : null;
    this.settle = typeof host.settle === 'function' ? host.settle : null;
    const initial = host.selectedFace;
    this.selectedFace = this.thumbs.some(t => t.face === initial)
      ? initial!
      : (this.thumbs.find(t => t.face === 'wallBottom')?.face || this.thumbs[0]?.face || 'wallBottom');
    if (!this.faces[this.selectedFace]) this.faces[this.selectedFace] = emptyInsets();
  }

  private emitPreview() {
    this.livePreview?.(clonePerFaceInsets(this.faces));
  }

  private finish(result: TerrainBakeCropResolve | false) {
    if (this.settled) return;
    this.settled = true;
    this.settle?.(result);
    if (!this.panelHost) {
      this.modalService.resolve(result);
    }
  }

  private closeHost() {
    if (this.panelHost) this.panelService.close();
  }

  private refreshTitle() {
    const base = this.i18n.t('terrainBakeCrop.title');
    const extra = this.total > 1
      ? this.i18n.t('terrainBakeCrop.boxOf', { current: this.index + 1, total: this.total })
      : (this.boxName || '');
    const title = extra ? `${base}〈${extra}〉` : base;
    this.modalService.title = this.panelService.title = title;
  }
}
