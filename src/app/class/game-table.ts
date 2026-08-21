import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { ObjectNode } from './core/synchronize-object/object-node';
import { EventSystem } from './core/system';
import { GameTableMask } from './game-table-mask';
import { TableDrawing } from './table-fx/table-drawing';
import { TableLight } from './table-fx/table-light';
import { TableWall } from './table-fx/table-wall';
import { Terrain } from './terrain';
import { translate } from 'i18n';

export enum GridType {
  NONE = -1,
  SQUARE = 0,
  HEX_VERTICAL = 1,
  HEX_HORIZONTAL = 2,
}

export enum FilterType {
  NONE = '',
  WHITE = 'white',
  BLACK = 'black',
}

export type WeatherType = 'none' | 'rain' | 'snow' | 'fog' | 'sandstorm' | 'wind' | 'thunderstorm' | 'rainbow' | 'aurora' | 'burning' | 'sakura' | 'maple';

@SyncObject('game-table')
export class GameTable extends ObjectNode {
  @SyncVar() name: string = translate('alias.game-table');
  @SyncVar() width: number = 20;
  @SyncVar() height: number = 20;
  @SyncVar() gridSize: number = 50;
  @SyncVar() imageIdentifier: string = 'imageIdentifier';
  @SyncVar() backgroundImageIdentifier: string = 'imageIdentifier';
  @SyncVar() backgroundImageIdentifier2: string = 'imageIdentifier';
  @SyncVar() backgroundFilterType: FilterType = FilterType.NONE;
  @SyncVar() selected: boolean = false;
  @SyncVar() gridType: GridType = GridType.SQUARE;
  @SyncVar() gridColor: string = '#000000e6';
  @SyncVar() isShowNumber: boolean = true;

  @SyncVar() darkness: number = 0;
  /** Ambient fill that softens the darkness overlay (0–1). Not Foundry GI. */
  @SyncVar() globalIllumination: number = 1;
  /**
   * Foundry-style Global Illumination: when true (and threshold allows), tokens with
   * vision see everything in line-of-sight as brightly lit without needing lights.
   * When false, vision only reveals areas that are also illuminated.
   */
  @SyncVar() globalIlluminationEnabled: boolean = true;
  /**
   * Auto-disable GI when darkness >= this value. Negative = threshold off
   * (GI follows globalIlluminationEnabled only).
   */
  @SyncVar() globalIlluminationThreshold: number = -1;
  @SyncVar() weatherType: WeatherType = 'none';
  @SyncVar() weatherIntensity: number = 0.5;
  @SyncVar() visionEnabled: boolean = false;
  /** Room-wide top-down view: lock camera pitch and lay tokens flat (note-like). */
  @SyncVar() is2DMode: boolean = false;

  /** Show this table in the top scene navigation bar. */
  @SyncVar() showInNavigation: boolean = true;
  /** Non-GM players may View this table (Foundry-style scene access). */
  @SyncVar() playerCanView: boolean = true;

  gridHeight: number = 0;
  gridClipRect: {top: number, right: number, bottom: number, left: number} = null;

  get terrains(): Terrain[] {
    let terrains: Terrain[] = [];
    this.children.forEach(object => {
      if (object instanceof Terrain) terrains.push(object);
    });
    return terrains;
  }

  get masks(): GameTableMask[] {
    let masks: GameTableMask[] = [];
    this.children.forEach(object => {
      if (object instanceof GameTableMask) masks.push(object);
    });
    return masks;
  }

  get walls(): TableWall[] {
    return this.children.filter(object => object instanceof TableWall) as TableWall[];
  }

  get lights(): TableLight[] {
    return this.children.filter(object => object instanceof TableLight) as TableLight[];
  }

  get drawings(): TableDrawing[] {
    return this.children.filter(object => object instanceof TableDrawing) as TableDrawing[];
  }

  // GameObject Lifecycle
  onStoreAdded() {
    super.onStoreAdded();
    if (this.selected) {
      // Catalog / local rehydrate only — TableSelecter must NOT broadcast Activate.
      EventSystem.trigger('SELECT_GAME_TABLE', { identifier: this.identifier, _fromCatalog: true });
    }
  }
}
