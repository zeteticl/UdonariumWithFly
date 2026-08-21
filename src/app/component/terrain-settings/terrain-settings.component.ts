import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';

import { EventSystem, Network } from '@udonarium/core/system';
import { SlopeDirection, Terrain, TerrainFaceName, TerrainNeonType, TerrainViewState, TERRAIN_NEON_DEFAULT_COLOR, TERRAIN_SIZE_MIN, SLOPE_DEG_MIN, SLOPE_DEG_MAX } from '@udonarium/terrain';

import { FileSelecterComponent } from 'component/file-selecter/file-selecter.component';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';
import { SaveDataService } from 'service/save-data.service';
import { TerrainBakeCropService } from 'service/terrain-bake-crop.service';
import { isBakeGroupComplete, terrainsInBakeGroup } from '@udonarium/terrain-model/bake-group';

@Component({
  selector: 'terrain-settings',
  templateUrl: './terrain-settings.component.html',
  styleUrls: ['../shared/settings-ui.css', '../shared/object-settings.css', './terrain-settings.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class TerrainSettingsComponent implements OnInit, OnChanges, OnDestroy {
  @Input() terrain: Terrain = null;

  isSaveing = false;
  progresPercent = 0;
  showFaceImages = false;
  /** When resizing run length, keep incline degrees and rewrite height. */
  lockSlopeDegrees = true;
  /** When editing width / depth / height, scale the other axes to keep proportions. */
  lockAspectRatio = false;

  readonly sizeMin = TERRAIN_SIZE_MIN;
  readonly slopeDegMin = SLOPE_DEG_MIN;
  readonly slopeDegMax = SLOPE_DEG_MAX;

  readonly modeOptions = [
    { value: TerrainViewState.ALL, labelKey: 'terrain.settings.modeAll' },
    { value: TerrainViewState.FLOOR, labelKey: 'terrain.settings.modeFloor' },
    { value: TerrainViewState.WALL, labelKey: 'terrain.settings.modeWall' },
  ];

  readonly slopeOptions = [
    { value: SlopeDirection.NONE, labelKey: 'terrain.settings.slopeNone' },
    { value: SlopeDirection.TOP, labelKey: 'terrain.settings.slopeTop' },
    { value: SlopeDirection.BOTTOM, labelKey: 'terrain.settings.slopeBottom' },
    { value: SlopeDirection.LEFT, labelKey: 'terrain.settings.slopeLeft' },
    { value: SlopeDirection.RIGHT, labelKey: 'terrain.settings.slopeRight' },
  ];

  readonly faceSlots: { face: TerrainFaceName; labelKey: string }[] = [
    { face: 'underside', labelKey: 'terrain.settings.faceUnderside' },
    { face: 'wallTop', labelKey: 'terrain.settings.faceWallTop' },
    { face: 'wallBottom', labelKey: 'terrain.settings.faceWallBottom' },
    { face: 'wallLeft', labelKey: 'terrain.settings.faceWallLeft' },
    { face: 'wallRight', labelKey: 'terrain.settings.faceWallRight' },
  ];

  readonly neonOptions = [
    { value: TerrainNeonType.NONE, labelKey: 'terrain.settings.neonNone' },
    { value: TerrainNeonType.SOFT, labelKey: 'terrain.settings.neonSoft' },
    { value: TerrainNeonType.TUBE, labelKey: 'terrain.settings.neonTube' },
    { value: TerrainNeonType.EDGE, labelKey: 'terrain.settings.neonEdge' },
    { value: TerrainNeonType.FLICKER, labelKey: 'terrain.settings.neonFlicker' },
    { value: TerrainNeonType.PULSE, labelKey: 'terrain.settings.neonPulse' },
    { value: TerrainNeonType.STROBE, labelKey: 'terrain.settings.neonStrobe' },
  ];

  readonly neonPresets = [
    { value: '#33ffff', labelKey: 'terrain.settings.neonPresetCyan' },
    { value: '#ff3399', labelKey: 'terrain.settings.neonPresetMagenta' },
    { value: '#ff3333', labelKey: 'terrain.settings.neonPresetRed' },
    { value: '#33ff66', labelKey: 'terrain.settings.neonPresetGreen' },
    { value: '#ffcc33', labelKey: 'terrain.settings.neonPresetAmber' },
    { value: '#ffffff', labelKey: 'terrain.settings.neonPresetWhite' },
  ];

  readonly neonDefaultColor = TERRAIN_NEON_DEFAULT_COLOR;

  constructor(
    private changeDetector: ChangeDetectorRef,
    private modalService: ModalService,
    private panelService: PanelService,
    private saveDataService: SaveDataService,
    private i18n: I18nService,
    private bakeCrop: TerrainBakeCropService,
  ) { }

  GuestMode() { return Network.GuestMode(); }

  ngOnInit() {
    EventSystem.register(this)
      .on('DELETE_GAME_OBJECT', event => {
        if (this.terrain && event.data?.identifier === this.terrain.identifier) this.panelService.close();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        if (this.terrain && event.data?.identifier === this.terrain.identifier) {
          this.refreshTitle();
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_FILE_RESOURE', () => this.changeDetector.markForCheck())
      .on('LOCALE_CHANGED', () => this.refreshTitle());
    this.terrain?.complement();
    this.refreshTitle();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['terrain'] && this.terrain) {
      this.terrain.complement();
      this.refreshTitle();
    }
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  get slopeDeg(): number {
    if (!this.terrain?.isSlope) return 0;
    return Math.round(this.terrain.slopeDegrees * 10) / 10;
  }

  setSlopeDeg(value: number) {
    if (!this.terrain || this.GuestMode()) return;
    this.terrain.setSlopeDegrees(+value);
    this.changeDetector.markForCheck();
  }

  onWidthChange(value: number) {
    if (!this.terrain || this.GuestMode()) return;
    const prevW = Math.max(TERRAIN_SIZE_MIN, this.terrain.width || TERRAIN_SIZE_MIN);
    const prevD = Math.max(TERRAIN_SIZE_MIN, this.terrain.depth || TERRAIN_SIZE_MIN);
    const prevH = Math.max(0, this.terrain.height || 0);
    const prevDeg = this.terrain.isSlope ? this.terrain.slopeDegrees : 0;
    const nextW = Math.max(TERRAIN_SIZE_MIN, +value || TERRAIN_SIZE_MIN);
    this.terrain.width = nextW;
    if (this.lockAspectRatio && prevW > 1e-9) {
      const scale = nextW / prevW;
      this.terrain.depth = this.roundSize(Math.max(TERRAIN_SIZE_MIN, prevD * scale));
      this.terrain.height = this.roundSize(Math.max(0, prevH * scale));
    }
    if (this.lockSlopeDegrees && this.terrain.isSlope && prevDeg >= SLOPE_DEG_MIN) {
      this.terrain.setSlopeDegrees(prevDeg);
    }
    this.changeDetector.markForCheck();
  }

  onDepthChange(value: number) {
    if (!this.terrain || this.GuestMode()) return;
    const prevW = Math.max(TERRAIN_SIZE_MIN, this.terrain.width || TERRAIN_SIZE_MIN);
    const prevD = Math.max(TERRAIN_SIZE_MIN, this.terrain.depth || TERRAIN_SIZE_MIN);
    const prevH = Math.max(0, this.terrain.height || 0);
    const prevDeg = this.terrain.isSlope ? this.terrain.slopeDegrees : 0;
    const nextD = Math.max(TERRAIN_SIZE_MIN, +value || TERRAIN_SIZE_MIN);
    this.terrain.depth = nextD;
    if (this.lockAspectRatio && prevD > 1e-9) {
      const scale = nextD / prevD;
      this.terrain.width = this.roundSize(Math.max(TERRAIN_SIZE_MIN, prevW * scale));
      this.terrain.height = this.roundSize(Math.max(0, prevH * scale));
    }
    if (this.lockSlopeDegrees && this.terrain.isSlope && prevDeg >= SLOPE_DEG_MIN) {
      this.terrain.setSlopeDegrees(prevDeg);
    }
    this.changeDetector.markForCheck();
  }

  onHeightChange(value: number) {
    if (!this.terrain || this.GuestMode()) return;
    const prevW = Math.max(TERRAIN_SIZE_MIN, this.terrain.width || TERRAIN_SIZE_MIN);
    const prevD = Math.max(TERRAIN_SIZE_MIN, this.terrain.depth || TERRAIN_SIZE_MIN);
    const prevH = Math.max(0, this.terrain.height || 0);
    const nextH = Math.max(0, +value || 0);
    this.terrain.height = nextH;
    // Flat (height 0) cannot define a scale; only lock when leaving a positive height.
    if (this.lockAspectRatio && prevH > 1e-9 && nextH > 1e-9) {
      const scale = nextH / prevH;
      this.terrain.width = this.roundSize(Math.max(TERRAIN_SIZE_MIN, prevW * scale));
      this.terrain.depth = this.roundSize(Math.max(TERRAIN_SIZE_MIN, prevD * scale));
    }
    this.changeDetector.markForCheck();
  }

  private roundSize(n: number): number {
    return Math.round(n * 100) / 100;
  }

  facePreviewUrl(face: TerrainFaceName): string {
    if (!this.terrain) return '';
    // Own override if set, else fallback face (wall/floor) via Terrain.faceImage.
    return this.terrain.faceImage(face)?.url || '';
  }

  faceIsOverride(face: TerrainFaceName): boolean {
    return !!this.terrain?.hasOwnFaceImage(face);
  }

  get hasBakeCrop(): boolean {
    return this.bakeCrop.hasSources(this.terrain);
  }

  async openBakeCrop() {
    if (!this.terrain || this.GuestMode() || !this.hasBakeCrop) return;
    await this.bakeCrop.openEdit(this.terrain);
    this.changeDetector.markForCheck();
  }

  openImage(name: TerrainFaceName) {
    if (!this.terrain || this.GuestMode()) return;
    this.terrain.ensureFaceImageElements();
    const current = this.terrain.imageDataElement?.getFirstElementByName(name)?.value + '' || '';
    this.modalService.open<string>(FileSelecterComponent, {
      isAllowedEmpty: true,
      currentImageIdentifires: current && current !== 'null' ? [current] : []
    }).then(value => {
      if (!this.terrain || value == null) return;
      this.terrain.setFaceImage(name, value);
      this.changeDetector.markForCheck();
    });
  }

  async saveToXML() {
    if (!this.terrain || this.isSaveing) return;
    this.isSaveing = true;
    this.progresPercent = 0;
    await this.saveDataService.saveGameObjectAsync(this.terrain, 'fly_xml_' + (this.terrain.name || 'terrain'), percent => {
      this.progresPercent = percent;
      this.changeDetector.markForCheck();
    });
    setTimeout(() => {
      this.isSaveing = false;
      this.progresPercent = 0;
      this.changeDetector.markForCheck();
    }, 500);
  }

  get bakeGroupTerrains(): Terrain[] {
    if (!this.terrain?.bakeGroupId) return [];
    return terrainsInBakeGroup(this.terrain.bakeGroupId);
  }

  get canExportBakeGroup(): boolean {
    const parts = this.bakeGroupTerrains;
    return isBakeGroupComplete(parts);
  }

  async saveGroupToXML() {
    const parts = this.bakeGroupTerrains;
    if (!parts.length || this.isSaveing) return;
    this.isSaveing = true;
    this.progresPercent = 0;
    const base = this.terrain.name || 'terrain';
    await this.saveDataService.saveGameObjectsAsync(parts, 'fly_xml_group_' + base, percent => {
      this.progresPercent = percent;
      this.changeDetector.markForCheck();
    });
    setTimeout(() => {
      this.isSaveing = false;
      this.progresPercent = 0;
      this.changeDetector.markForCheck();
    }, 500);
  }

  importXml() {
    if (this.GuestMode()) return;
    this.saveDataService.pickAndLoadXmlOrZip();
  }

  setMode(value: number) {
    if (!this.terrain || this.GuestMode()) return;
    this.terrain.mutateAppearance(() => { this.terrain.mode = value; });
    this.changeDetector.markForCheck();
  }

  setSlopeDirection(value: number) {
    if (!this.terrain || this.GuestMode()) return;
    const prevDeg = this.terrain.isSlope ? this.terrain.slopeDegrees : 0;
    this.terrain.mutateAppearance(() => {
      this.terrain.slopeDirection = value;
      this.terrain.isSlope = value !== SlopeDirection.NONE;
    });
    if (value !== SlopeDirection.NONE && this.lockSlopeDegrees && prevDeg >= SLOPE_DEG_MIN) {
      this.terrain.setSlopeDegrees(prevDeg);
    }
    this.changeDetector.markForCheck();
  }

  setNeonType(value: number) {
    if (!this.terrain || this.GuestMode()) return;
    this.terrain.mutateAppearance(() => { this.terrain.neonType = value; });
    this.changeDetector.markForCheck();
  }

  setNeonColor(value: string) {
    if (!this.terrain || this.GuestMode()) return;
    this.terrain.mutateAppearance(() => { this.terrain.neonColor = value || ''; });
    this.changeDetector.markForCheck();
  }

  get neonColorInput(): string {
    return (this.terrain?.neonColor || '').trim() || this.neonDefaultColor;
  }

  setAppearanceFlag(key:
    'isSlope' | 'isSurfaceShading' | 'isDropShadow' | 'isInteract' |
    'affectsLight' | 'isLocked' | 'isAltitudeIndicate' | 'mirrorWallTop' | 'mirrorWallLeft' |
    'neonOnWalls' | 'neonOnFloor', value: boolean) {
    if (!this.terrain || this.GuestMode()) return;
    this.terrain.mutateAppearance(() => {
      (this.terrain as any)[key] = value;
      if (key === 'isSlope' && !value) this.terrain.slopeDirection = SlopeDirection.NONE;
    });
    this.changeDetector.markForCheck();
  }

  private refreshTitle() {
    if (!this.terrain) return;
    let title = this.i18n.t('terrain.panelTitle');
    if (this.terrain.name?.length) title += ' - ' + this.terrain.name;
    this.panelService.title = title;
  }
}
