import { Injectable } from '@angular/core';

import { EventSystem } from '@udonarium/core/system';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { Terrain, TerrainFaceName } from '@udonarium/terrain';
import {
  BAKE_CROP_FACES,
  PerFaceInsets,
  applyBakeCropToTerrain,
  clonePerFaceInsets,
  hasBakeCropSources,
  parseBakeCropState,
} from '@udonarium/terrain-model/bake-crop';
import { BakeBoxPreviewContext, BakeBoxPreviewResult } from '@udonarium/terrain-model/model-terrain-import';
import { BakedFaceBlobs } from '@udonarium/terrain-model/ortho-bake';
import {
  TerrainBakeCropComponent,
  TerrainBakeCropResolve,
  TerrainBakeCropThumb,
} from 'component/terrain-bake-crop/terrain-bake-crop.component';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';

export const TERRAIN_BAKE_CROP_PREVIEW = 'TERRAIN_BAKE_CROP_PREVIEW';

@Injectable({ providedIn: 'root' })
export class TerrainBakeCropService {
  private live = new Map<string, PerFaceInsets>();

  constructor(
    private panelService: PanelService,
    private pointerDeviceService: PointerDeviceService,
  ) { }

  hasSources(terrain: Terrain | null | undefined): boolean {
    return hasBakeCropSources(terrain);
  }

  livePreviewFor(identifier: string | null | undefined): PerFaceInsets | null {
    if (!identifier) return null;
    return this.live.get(identifier) || null;
  }

  setLivePreview(identifier: string, faces: PerFaceInsets) {
    this.live.set(identifier, clonePerFaceInsets(faces));
    EventSystem.trigger(TERRAIN_BAKE_CROP_PREVIEW, { identifier });
  }

  clearLivePreview(identifier: string) {
    this.live.delete(identifier);
    EventSystem.trigger(TERRAIN_BAKE_CROP_PREVIEW, { identifier });
  }

  async previewImportBox(ctx: BakeBoxPreviewContext): Promise<BakeBoxPreviewResult> {
    const id = ctx.terrain.identifier;
    const urls = blobUrls(ctx.blobs);
    this.setLivePreview(id, ctx.faces || {});
    try {
      const result = await this.openPanel({
        mode: 'import',
        thumbs: thumbsFromUrls(urls),
        faces: ctx.faces || {},
        selectedFace: 'wallBottom',
        index: ctx.index,
        total: ctx.total,
        boxName: ctx.name,
        livePreview: (faces: PerFaceInsets) => this.setLivePreview(id, faces),
        faceBlob: async (face) => ctx.blobs[face] || null,
      });
      if (!result || result.action === 'abort') return { action: 'abort' };
      if (result.action === 'skip') return { action: 'skip' };
      return { action: 'confirm', faces: clonePerFaceInsets(result.faces) };
    } finally {
      this.clearLivePreview(id);
      revokeUrls(urls);
    }
  }

  async openEdit(terrain: Terrain): Promise<void> {
    const state = parseBakeCropState(terrain.bakeCropJson);
    if (!state) return;
    const id = terrain.identifier;
    const tourId = `terrain.bake-crop.${id}`;
    if (PanelService.bringTourPanelToFront(tourId)) return;

    const urls = sourceUrls(state.sources);
    const faces = clonePerFaceInsets(state.faces);
    this.setLivePreview(id, faces);
    // Restore sources immediately so CSS crop matches the editor (fixes prior double-crop saves).
    void applyBakeCropToTerrain(terrain, faces);

    try {
      await this.openPanel({
        mode: 'edit',
        thumbs: thumbsFromUrls(urls),
        faces,
        selectedFace: 'wallBottom',
        index: 0,
        total: 1,
        boxName: terrain.name,
        livePreview: (next: PerFaceInsets) => this.setLivePreview(id, next),
        persist: (next: PerFaceInsets) => { void applyBakeCropToTerrain(terrain, next); },
        faceBlob: async (face) => {
          const sid = state.sources[face];
          if (!sid) return null;
          return ImageStorage.instance.get(sid)?.blob || null;
        },
        tourPanelId: tourId,
      });
    } finally {
      this.clearLivePreview(id);
    }
  }

  private openPanel(host: {
    mode: 'import' | 'edit';
    thumbs: TerrainBakeCropThumb[];
    faces: PerFaceInsets;
    selectedFace?: TerrainFaceName;
    index?: number;
    total?: number;
    boxName?: string;
    livePreview?: (faces: PerFaceInsets) => void;
    persist?: (faces: PerFaceInsets) => void;
    faceBlob?: (face: TerrainFaceName) => Promise<Blob | null>;
    tourPanelId?: string;
  }): Promise<TerrainBakeCropResolve | false> {
    const ptr = this.pointerDeviceService.pointers[0] || { x: 120, y: 80 };
    const option: PanelOption = {
      title: 'Crop',
      left: Math.max(8, (ptr.x || 120) - 200),
      top: Math.max(8, (ptr.y || 80) - 40),
      width: 520,
      height: 520,
      tourPanelId: host.tourPanelId,
      geometryKey: 'panel.app-terrain-bake-crop',
    };
    return new Promise(resolve => {
      const component = this.panelService.open(TerrainBakeCropComponent, option);
      let done = false;
      const settle = (result: TerrainBakeCropResolve | false) => {
        if (done) return;
        done = true;
        resolve(result);
      };
      component.setup({ ...host, settle });
    });
  }
}

function blobUrls(blobs: BakedFaceBlobs): Partial<Record<TerrainFaceName, string>> {
  const urls: Partial<Record<TerrainFaceName, string>> = {};
  for (const face of BAKE_CROP_FACES) {
    const blob = blobs[face];
    if (blob) urls[face] = URL.createObjectURL(blob);
  }
  return urls;
}

function sourceUrls(sources: Partial<Record<TerrainFaceName, string>>): Partial<Record<TerrainFaceName, string>> {
  const urls: Partial<Record<TerrainFaceName, string>> = {};
  for (const face of BAKE_CROP_FACES) {
    const id = sources[face];
    if (!id) continue;
    const file = ImageStorage.instance.get(id);
    if (file?.url) urls[face] = file.url;
  }
  return urls;
}

function thumbsFromUrls(urls: Partial<Record<TerrainFaceName, string>>): TerrainBakeCropThumb[] {
  const labels: Partial<Record<TerrainFaceName, string>> = {
    floor: 'sheet.changeFloorImage',
    underside: 'terrain.settings.faceUnderside',
    wallTop: 'terrain.settings.faceWallTop',
    wallBottom: 'terrain.settings.faceWallBottom',
    wallLeft: 'terrain.settings.faceWallLeft',
    wallRight: 'terrain.settings.faceWallRight',
  };
  return BAKE_CROP_FACES
    .filter(face => urls[face])
    .map(face => ({ face, url: urls[face]!, labelKey: labels[face] || 'sheet.changeFloorImage' }));
}

function revokeUrls(urls: Partial<Record<TerrainFaceName, string>>): void {
  for (const url of Object.values(urls)) {
    if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}
