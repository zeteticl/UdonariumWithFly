import { Injectable } from '@angular/core';
import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { ChatTab } from '@udonarium/chat-tab';
import { ChatTabList } from '@udonarium/chat-tab-list';
import { ClueLink } from '@udonarium/clue-link';
import { ObjectSerializer } from '@udonarium/core/synchronize-object/object-serializer';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem } from '@udonarium/core/system';
import { CutIn } from '@udonarium/cut-in';
import { CutInList } from '@udonarium/cut-in-list';
import { ScenePreset } from '@udonarium/scene-preset';
import { ScenePresetList } from '@udonarium/scene-preset-list';
import { ScenarioText } from '@udonarium/scenario-text';
import { ScenarioTextList } from '@udonarium/scenario-text-list';
import { DiceRollTable } from '@udonarium/dice-roll-table';
import { DiceRollTableList } from '@udonarium/dice-roll-table-list';
import { DiceSymbol } from '@udonarium/dice-symbol';
import { CharacterToken } from '@udonarium/character-token';
import { GameCharacter } from '@udonarium/game-character';
import { GameTable } from '@udonarium/game-table';
import { GameTableMask } from '@udonarium/game-table-mask';
import { PeerCursor } from '@udonarium/peer-cursor';
import { RangeArea } from '@udonarium/range';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TableSelecter } from '@udonarium/table-selecter';
import { TabletopObject } from '@udonarium/tabletop-object';
import { Terrain } from '@udonarium/terrain';
import { TextNote } from '@udonarium/text-note';
import { poseDebug } from '@udonarium/table-fx/pose-debug';
import { assembleBakeGroupAt, newBakeGroupId } from '@udonarium/terrain-model/bake-group';
import { parseBakeCropState, serializeBakeCropState } from '@udonarium/terrain-model/bake-crop';

import { CoordinateService } from './coordinate.service';
import { BatchService } from './batch.service';
import { TabletopSelectionService } from './tabletop-selection.service';

type ObjectIdentifier = string;
type ObjecNodeIndex = number;
type LocationName = string;

@Injectable()
export class TabletopService {
  private _emptyTable: GameTable = new GameTable('');
  get tableSelecter(): TableSelecter { return TableSelecter.instance; }
  get currentTable(): GameTable {
    let table = this.tableSelecter.viewTable;
    return table ? table : this._emptyTable;
  }

  private locationMap: Map<ObjectIdentifier, LocationName> = new Map();
  private parentMap: Map<ObjectIdentifier, ObjectIdentifier> = new Map();
  private indexMap: Map<ObjectIdentifier, ObjecNodeIndex> = new Map();
  private tableIdMap: Map<ObjectIdentifier, string> = new Map();
  private placementsMap: Map<ObjectIdentifier, string> = new Map();
  private characterTokenCache = new TabletopCache<CharacterToken>(() =>
    ObjectStore.instance.getObjects(CharacterToken)
      .filter(obj => obj.isVisibleOnTable)
      .sort((a, b) => a.identifier.localeCompare(b.identifier))
  );
  /** @deprecated Prefer {@link characterTokens} — bodies are no longer on-table pieces. */
  private characterCache = new TabletopCache<GameCharacter>(() =>
    ObjectStore.instance.getObjects(GameCharacter)
      .filter(obj => obj.isVisibleOnTable)
      .sort((a, b) => a.identifier.localeCompare(b.identifier))
  );
  private cardCache = new TabletopCache<Card>(() =>
    ObjectStore.instance.getObjects(Card)
      .filter(obj => obj.isVisibleOnTable)
      .sort((a, b) => a.identifier.localeCompare(b.identifier))
  );
  private cardStackCache = new TabletopCache<CardStack>(() =>
    ObjectStore.instance.getObjects(CardStack)
      .filter(obj => obj.isVisibleOnTable)
      .sort((a, b) => a.identifier.localeCompare(b.identifier))
  );
  private tableMaskCache = new TabletopCache<GameTableMask>(() => {
    let viewTable = this.tableSelecter.viewTable;
    const masks = viewTable ? viewTable.masks.slice() : [];
    return masks.sort((a, b) => a.identifier.localeCompare(b.identifier));
  });
  private rangeCache = new TabletopCache<RangeArea>(() => ObjectStore.instance.getObjects(RangeArea).filter(obj => obj.isVisibleOnTable));
  private terrainCache = new TabletopCache<Terrain>(() => {
    let viewTable = this.tableSelecter.viewTable;
    return viewTable ? viewTable.terrains : [];
  });
  // Location cache only; self-only filtered in game-table template.
  // Stable id order — paint uses CSS z-index / micro translateZ, not array order.
  private textNoteCache = new TabletopCache<TextNote>(() =>
    ObjectStore.instance.getObjects(TextNote)
      .filter(obj => obj.isVisibleOnTable)
      .sort((a, b) => a.identifier.localeCompare(b.identifier))
  );
  private diceSymbolCache = new TabletopCache<DiceSymbol>(() => ObjectStore.instance.getObjects(DiceSymbol).filter(obj => obj.isVisibleOnTable));
  private _clueLinks: ClueLink[] = [];
  private _clueLinksDirty = true;

  get characterTokens(): CharacterToken[] { return this.characterTokenCache.objects; }
  /** Bodies still marked visible on table (should be empty after migration). */
  get characters(): GameCharacter[] { return this.characterCache.objects; }
  get cards(): Card[] { return this.cardCache.objects; }
  get cardStacks(): CardStack[] { return this.cardStackCache.objects; }
  get tableMasks(): GameTableMask[] { return this.tableMaskCache.objects; }
  get ranges(): RangeArea[] { return this.rangeCache.objects; }
  get terrains(): Terrain[] { return this.terrainCache.objects; }
  get textNotes(): TextNote[] { return this.textNoteCache.objects; }
  get diceSymbols(): DiceSymbol[] { return this.diceSymbolCache.objects; }
  get clueLinks(): ClueLink[] {
    if (this._clueLinksDirty) {
      const viewId = this.tableSelecter.viewTable?.identifier || '';
      this._clueLinks = ObjectStore.instance.getObjects(ClueLink).filter(link => link.isValidOnTable(viewId));
      this._clueLinksDirty = false;
    }
    return this._clueLinks;
  }
  get peerCursors(): PeerCursor[] { return ObjectStore.instance.getObjects<PeerCursor>(PeerCursor); }

  private refreshClueLinks() { this._clueLinksDirty = true; }

  constructor(
    private coordinateService: CoordinateService,
    private batchService: BatchService,
    private selectionService: TabletopSelectionService,
  ) {
    this.initialize();
  }

  private initialize() {
    this.refreshCacheAll();
    TabletopObject.migrateUnboundTablePieces();
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', 900, event => {
        // After ObjectSynchronizer (prio 1000) applies remote SyncVars, restore this
        // client's view pose so dual-map appearance/coords stay per-map.
        // Altitude/height/size live on DataElement children — only reproject those
        // (and TabletopObject itself). Reprojecting every sheet field (HP…) storms CD/net.
        if (event.isSendFromSelf) return;
        const id = event.data?.identifier as string;
        if (!id) return;
        const tabletop = TabletopObject.resolveReprojectTarget(ObjectStore.instance.get(id));
        if (tabletop) {
          TabletopObject.reprojectForLocalView(tabletop);
        }
      })
      .on('BEFORE_VIEW_TABLE_CHANGE', () => {
        // Run deferred drag writes first; MovableDirective then pins _pos → placements.
        this.batchService.flushNow();
      })
      .on('PREPARE_VIEW_TABLE_CHANGE', () => {
        // Selected tokens skip self-hydrate UPDATEs — must clear before applying the new map pose.
        this.selectionService.clear();
      })
      .on('SELECT_GAME_TABLE', event => {
        // Do not migrateUnbound here — rebinding to the new view corrupted per-map poses.
        this.refreshCacheAll();
      })
      .on('ARCHIVE_LOAD_COMPLETE', () => {
        const viewId = TabletopObject.resolveViewTableIdentifier();
        this.refreshCacheAll();
        const chars = this.characters || [];
        const visible = chars.filter(c => c.isVisibleOnTable);
        poseDebug('event ARCHIVE_LOAD_COMPLETE (TabletopService)', {
          viewId: viewId || '(none)',
          viewed: this.tableSelecter.viewedTableIdentifier,
          active: this.tableSelecter.viewTableIdentifier,
          characterCache: chars.length,
          visibleOnTable: visible.length,
          sample: visible.slice(0, 5).map(c => {
            const p = c.getPoseForView();
            return {
              id: c.identifier,
              live: `${c.location.x | 0},${c.location.y | 0},${c.posZ | 0}`,
              poseForView: `${p.x | 0},${p.y | 0},${p.posZ | 0}`,
              placements: (c.tablePlacements || '').slice(0, 100),
            };
          }),
        });
        if (viewId) TabletopObject.hydrateAllForView(viewId, true);
        EventSystem.trigger('AFTER_VIEW_TABLE_CHANGE', { tableId: viewId || '' });
      })
      .on('UPDATE_GAME_OBJECT', event => {
        if (event.data.identifier === this.currentTable.identifier || event.data.identifier === this.tableSelecter.identifier) {
          this.refreshCache(GameTableMask.aliasName);
          this.refreshCache(Terrain.aliasName);
          return;
        }

        let object = ObjectStore.instance.get(event.data.identifier);
        if (!object || !(object instanceof TabletopObject)) {
          this.refreshCache(event.data.aliasName);
        } else if (
          // Keep caches fresh on peer updates (zindex / pose); paint order is not array order.
          object instanceof TextNote
          || object instanceof Card
          || object instanceof CardStack
          || object instanceof RangeArea
          || object instanceof GameTableMask
          || object instanceof GameCharacter
          || object instanceof CharacterToken
          || this.shouldRefreshCache(object)
        ) {
          this.refreshCache(event.data.aliasName);
          this.updateMap(object);
        }
      })
      .on('DELETE_GAME_OBJECT', event => {
        const deletedId = event.data.identifier as string;
        // Skip self-echo: after ZIP reload, syncIds are reused and cleanup would
        // destroy newly parsed clue links that still reference those endpoints.
        if (ClueLink.shouldCleanupOnEndpointDelete({
          isSendFromSelf: event.isSendFromSelf,
          aliasName: event.data.aliasName,
        }) && deletedId) {
          ClueLink.cleanupFor(deletedId);
        }
        let aliasName = event.data.aliasName;
        if (!aliasName) {
          this.refreshCacheAll();
        } else {
          this.refreshCache(aliasName);
          if (
            aliasName === GameCharacter.aliasName
            || aliasName === CharacterToken.aliasName
            || aliasName === TextNote.aliasName
            || aliasName === ClueLink.aliasName
          ) {
            this.refreshClueLinks();
          }
        }
      })
      .on('XML_LOADED', event => {
        let xmlElement: Element = event.data.xmlElement;
        if (this.tryPlaceTerrainGroup(xmlElement)) return;
        // todo: 拖放到立體地形上時的行為
        let gameObject = ObjectSerializer.instance.parseXml(xmlElement);
        if (gameObject instanceof TabletopObject) {
          let pointer = this.coordinateService.calcTabletopLocalCoordinate();
          gameObject.location.x = pointer.x - 25;
          gameObject.location.y = pointer.y - 25;
          gameObject.posZ = pointer.z;
          this.placeToTabletop(gameObject);
          SoundEffect.play(PresetSound.piecePut);
          /* TODO 是否讀取骰子機器人待評估
          if (gameObject instanceof GameCharacter && gameObject.chatPalette) {
            DiceBot.getHelpMessage(gameObject.chatPalette.dicebot).then(help => {
              console.log('onChangeGameType done\n' + help);
            });
          }
          */
        } else if (gameObject instanceof ChatTab) {
          ChatTabList.instance.addChatTab(gameObject);
        } else if (gameObject instanceof DiceRollTable) {
          DiceRollTableList.instance.addDiceRollTable(gameObject);
        }  else if (gameObject instanceof CutIn) {
          CutInList.instance.addCutIn(gameObject);
        } else if (gameObject instanceof ScenePreset) {
          ScenePresetList.instance.addPreset(gameObject);
        } else if (gameObject instanceof ScenarioText) {
          ScenarioTextList.instance.addItem(gameObject);
        }
      });
  }

  /** Import `<terrain-group>` ZIP/XML: place all parts and keep/rebuild bake GROUP. */
  private tryPlaceTerrainGroup(xmlElement: Element): boolean {
    if (!xmlElement || xmlElement.tagName !== 'terrain-group') return false;
    const terrains: Terrain[] = [];
    for (let i = 0; i < xmlElement.children.length; i++) {
      const child = xmlElement.children[i];
      const obj = ObjectSerializer.instance.parseXml(child);
      if (obj instanceof Terrain) terrains.push(obj);
    }
    if (!terrains.length) return true;

    const pointer = this.coordinateService.calcTabletopLocalCoordinate();
    if (terrains.length > 1) {
      const gid = newBakeGroupId();
      for (const t of terrains) {
        t.withSyncSuppressed(() => {
          t.bakeGroupId = gid;
          const state = parseBakeCropState(t.bakeCropJson);
          if (state) {
            state.groupSize = terrains.length;
            t.bakeCropJson = serializeBakeCropState(state);
          }
        });
        t.update();
      }
    }
    // Append once; assemble batches final size+pose (one UPDATE per part).
    for (const t of terrains) this.placeToTabletop(t);
    if (terrains.length > 1) {
      assembleBakeGroupAt(terrains, pointer);
    } else {
      terrains[0].location.x = pointer.x - 25;
      terrains[0].location.y = pointer.y - 25;
      terrains[0].posZ = pointer.z;
    }
    SoundEffect.play(PresetSound.piecePut);
    return true;
  }

  private findCache(aliasName: string): TabletopCache<any> {
    switch (aliasName) {
      case CharacterToken.aliasName:
        return this.characterTokenCache;
      case GameCharacter.aliasName:
        return this.characterCache;
      case Card.aliasName:
        return this.cardCache;
      case CardStack.aliasName:
        return this.cardStackCache;
      case GameTableMask.aliasName:
        return this.tableMaskCache;
      case Terrain.aliasName:
        return this.terrainCache;
      case TextNote.aliasName:
        return this.textNoteCache;
      case DiceSymbol.aliasName:
        return this.diceSymbolCache;
      case RangeArea.aliasName:
        return this.rangeCache;
      default:
        return null;
    }
  }

  private refreshCache(aliasName: string) {
    let cache = this.findCache(aliasName);
    if (cache) cache.refresh();
    // Endpoint moves / pin toggles refresh clue strings.
    if (
      aliasName === GameCharacter.aliasName
      || aliasName === CharacterToken.aliasName
      || aliasName === TextNote.aliasName
      || aliasName === ClueLink.aliasName
    ) {
      this.refreshClueLinks();
    }
  }

  private refreshCacheAll() {
    this.characterTokenCache.refresh();
    this.characterCache.refresh();
    this.cardCache.refresh();
    this.cardStackCache.refresh();
    this.tableMaskCache.refresh();
    this.terrainCache.refresh();
    this.textNoteCache.refresh();
    this.diceSymbolCache.refresh();
    this.rangeCache.refresh();
    this.refreshClueLinks();
    this.clearMap();
  }

  private shouldRefreshCache(object: TabletopObject): boolean {
    return this.locationMap.get(object.identifier) !== object.location.name
      || this.parentMap.get(object.identifier) !== object.parentId
      || this.tableIdMap.get(object.identifier) !== object.tableIdentifier
      || this.placementsMap.get(object.identifier) !== object.tablePlacements
      || (object.isVisibleOnTable && this.indexMap.get(object.identifier) !== object.index);
  }

  private updateMap(object: TabletopObject) {
    this.locationMap.set(object.identifier, object.location.name);
    this.parentMap.set(object.identifier, object.parentId);
    this.indexMap.set(object.identifier, object.index);
    this.tableIdMap.set(object.identifier, object.tableIdentifier);
    this.placementsMap.set(object.identifier, object.tablePlacements);
  }

  private clearMap() {
    this.locationMap.clear();
    this.parentMap.clear();
    this.indexMap.clear();
    this.tableIdMap.clear();
    this.placementsMap.clear();
  }

  private placeToTabletop(gameObject: TabletopObject) {
    switch (gameObject.aliasName) {
      case GameTableMask.aliasName:
        if (gameObject instanceof GameTableMask) { 
          gameObject.isLock = false;
          gameObject.isPreview = false;
        }
        // fallthrough
      case Terrain.aliasName:
        if (gameObject instanceof Terrain) gameObject.isLocked = false;
        if (!this.tableSelecter || !this.tableSelecter.viewTable) return;
        this.tableSelecter.viewTable.appendChild(gameObject);
        break;
      case Card.aliasName:
      case CardStack.aliasName:
      case RangeArea.aliasName:
      case TextNote.aliasName:
        if (gameObject instanceof Card || gameObject instanceof CardStack || gameObject instanceof RangeArea || gameObject instanceof TextNote) gameObject.isLocked = false;
        if (gameObject instanceof RangeArea) gameObject.followingCharctorIdentifier = null;
      default:
        gameObject.setLocation('table');
        break;
    }
  }
}

class TabletopCache<T extends TabletopObject> {
  private needsRefresh: boolean = true;

  private _objects: T[] = [];
  get objects(): T[] {
    if (this.needsRefresh) {
      this._objects = this.refreshCollector();
      this._objects = this._objects ? this._objects : [];
      this.needsRefresh = false;
    }
    return this._objects;
  }

  constructor(
    readonly refreshCollector: () => T[]
  ) { }

  refresh() {
    this.needsRefresh = true;
  }
}
