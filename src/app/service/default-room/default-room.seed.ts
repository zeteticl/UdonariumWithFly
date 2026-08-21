/**
 * Active default-room seed: 3D battle map (BNZ fly_data layout) + 2D clue board.
 * Story-theatre variant is kept in default-room.story-theatre.seed.ts.bak
 * (rename / swap to restore that layout).
 */
import { ClueLink } from '@udonarium/clue-link';
import { CharacterToken } from '@udonarium/character-token';
import { ImageContext, ImageFile } from '@udonarium/core/file-storage/image-file';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem } from '@udonarium/core/system';
import { GameCharacter } from '@udonarium/game-character';
import { GameTable, GridType } from '@udonarium/game-table';
import { GameTableMask } from '@udonarium/game-table-mask';
import { ImageTag } from '@udonarium/image-tag';
import { setStatusFlag, stringifyStatuses } from '@udonarium/table-fx/character-status';
import { TokenFrameStyle } from '@udonarium/table-fx/push-pin.util';
import { TableSelecter } from '@udonarium/table-selecter';
import { TabletopObject } from '@udonarium/tabletop-object';
import { Terrain } from '@udonarium/terrain';
import { TextNote } from '@udonarium/text-note';
import { reconcileLayerStack } from '@udonarium/tabletop-object-util';

import {
  CLUE_BOARD_BG_URL,
  CLUE_STICKY_YELLOW,
  DEFAULT_BG_2D_IMAGE_ID,
  DEFAULT_BG_3D_IMAGE_ID,
  DEFAULT_TABLE_2D_ID,
  DEFAULT_TABLE_3D_ID,
  DefaultRoomTranslate,
} from './default-room.ids';

/**
 * Ensure the built-in clue-board image slot points at the current redboard art.
 * Safe for rooms that still reference the old procedural corkboard URL.
 */
export function ensureClueBoardBackground(t: DefaultRoomTranslate): void {
  const redboardUrl = CLUE_BOARD_BG_URL;
  const prev = ImageStorage.instance.get(DEFAULT_BG_2D_IMAGE_ID);
  if (prev?.url === redboardUrl) return;
  if (prev) ImageStorage.instance.delete(DEFAULT_BG_2D_IMAGE_ID);
  const bg2dCtx = ImageFile.createEmpty(DEFAULT_BG_2D_IMAGE_ID).toContext();
  bg2dCtx.url = redboardUrl;
  const bg2d = ImageStorage.instance.add(bg2dCtx);
  if (!ImageTag.get(bg2d.identifier)) {
    ImageTag.create(bg2d.identifier).tag = '*default ' + t('sample.clue.tableName');
  }
}

/** Create the two default maps and select the 3D battle map. */
export function makeDefaultTables(t: DefaultRoomTranslate): void {
  const bg3dCtx = ImageFile.createEmpty(DEFAULT_BG_3D_IMAGE_ID).toContext();
  bg3dCtx.url = './assets/images/BG10a_80.jpg';
  const bg3d = ImageStorage.instance.add(bg3dCtx);
  ImageTag.create(bg3d.identifier).tag = '*default ' + t('char.table');

  const table3d = new GameTable(DEFAULT_TABLE_3D_ID);
  table3d.name = t('sample.battle.tableName');
  table3d.imageIdentifier = bg3d.identifier;
  table3d.width = 20;
  table3d.height = 15;
  table3d.is2DMode = false;
  table3d.initialize();

  ensureClueBoardBackground(t);
  const bg2d = ImageStorage.instance.get(DEFAULT_BG_2D_IMAGE_ID);

  const table2d = new GameTable(DEFAULT_TABLE_2D_ID);
  table2d.name = t('sample.clue.tableName');
  table2d.imageIdentifier = bg2d.identifier;
  table2d.width = 31;
  table2d.height = 17;
  table2d.is2DMode = true;
  table2d.gridType = GridType.NONE;
  table2d.gridColor = '#3a201880';
  table2d.isShowNumber = false;
  table2d.weatherType = 'none';
  table2d.weatherIntensity = 0.5;
  table2d.initialize();

  table3d.selected = true;
  table2d.selected = false;
  TableSelecter.instance.viewTableIdentifier = table3d.identifier;
  TableSelecter.instance.viewedTableIdentifier = table3d.identifier;
  EventSystem.trigger('SELECT_GAME_TABLE', { identifier: table3d.identifier });
}

/** Seed classic 3D tokens + 2D clue-board demo. */
export function seedDefaultRoomObjects(t: DefaultRoomTranslate): void {
  seedClassicBattleObjects(DEFAULT_TABLE_3D_ID, t);
  seedClueBoardObjects(DEFAULT_TABLE_2D_ID, t);
  TabletopObject.migrateUnboundTablePieces(DEFAULT_TABLE_3D_ID);
  // Densify both maps: seed runs while viewing 3D, so 2D peers would stay at z=0
  // (mask would paint over Tokens by DOM id order).
  reconcileLayerStack();
  const prevView = TableSelecter.instance.viewedTableIdentifier;
  TableSelecter.instance.viewedTableIdentifier = DEFAULT_TABLE_2D_ID;
  reconcileLayerStack();
  TableSelecter.instance.viewedTableIdentifier = prevView || DEFAULT_TABLE_3D_ID;
  reconcileLayerStack();
}

/**
 * 3D battle map layout from room dump (BNZ fly_data.xml).
 * Keeps testCharacter_* ids for 2D clue-board dual placement.
 */
function seedClassicBattleObjects(tableId: string, t: DefaultRoomTranslate): void {
  const table = ObjectStore.instance.get<GameTable>(tableId);
  let testFile: ImageFile = null;
  let fileContext: ImageContext = null;

  // Locked demo terrain (tex.jpg), as in the dump.
  const texId = ensureDefaultTerrainTexture(t);
  const terrain = Terrain.create(t('action.terrainName'), 2, 2, 2, texId, texId, 'battleTerrain_demo');
  terrain.location.x = 725;
  terrain.location.y = 300;
  terrain.isLocked = true;
  terrain.moveToTableOnly(tableId);
  if (table) table.appendChild(terrain);

  const ch1 = new GameCharacter('testCharacter_1');
  fileContext = ImageFile.createEmpty('testCharacter_1_image').toContext();
  fileContext.url = './assets/images/mon_052.gif';
  testFile = ImageStorage.instance.add(fileContext);
  ImageTag.create(testFile.identifier).tag = '*default ' + t('action.newCharacter');
  ch1.location.x = 250;
  ch1.location.y = 450;
  ch1.initialize();
  ch1.createTestGameDataElement(t('sample.monsterA'), 1, testFile.identifier);
  ch1.moveToTableOnly(tableId);

  const ch2 = new GameCharacter('testCharacter_2');
  ch2.location.x = 375;
  ch2.location.y = 375;
  ch2.initialize();
  ch2.createTestGameDataElement(t('sample.monsterB'), 1, testFile.identifier);
  ch2.aura = 4; // red
  ch2.moveToTableOnly(tableId);

  const ch3 = new GameCharacter('testCharacter_3');
  fileContext = ImageFile.createEmpty('testCharacter_3_image').toContext();
  fileContext.url = './assets/images/mon_128.gif';
  testFile = ImageStorage.instance.add(fileContext);
  ImageTag.create(testFile.identifier).tag = '*default ' + t('action.newCharacter');
  ch3.location.x = 175;
  ch3.location.y = 225;
  ch3.initialize();
  ch3.createTestGameDataElement(t('sample.monsterC'), 3, testFile.identifier);
  ch3.pushPin = true;
  ch3.pushPinAngle = 13;
  ch3.pushPinStyle = 2;
  ch3.moveToTableOnly(tableId);

  const ch4 = new GameCharacter('testCharacter_4');
  fileContext = ImageFile.createEmpty('testCharacter_4_image').toContext();
  fileContext.url = './assets/images/mon_150.gif';
  testFile = ImageStorage.instance.add(fileContext);
  ImageTag.create(testFile.identifier).tag = '*default ' + t('action.newCharacter');
  ch4.location.x = 550;
  ch4.location.y = 275;
  ch4.rotate = -180;
  ch4.initialize();
  ch4.createTestGameDataElement(t('sample.characterA'), 1, testFile.identifier);
  ch4.moveToTableOnly(tableId);

  const ch5 = new GameCharacter('testCharacter_5');
  fileContext = ImageFile.createEmpty('testCharacter_5_image').toContext();
  fileContext.url = './assets/images/mon_211.gif';
  testFile = ImageStorage.instance.add(fileContext);
  ImageTag.create(testFile.identifier).tag = '*default ' + t('action.newCharacter');
  ch5.location.x = 825;
  ch5.location.y = 375;
  ch5.rotate = 180;
  ch5.initialize();
  ch5.createTestGameDataElement(t('sample.characterB'), 1, testFile.identifier);
  ch5.statusesJson = stringifyStatuses(setStatusFlag([], 'incapacitated', true));
  ch5.moveToTableOnly(tableId);

  const ch6 = new GameCharacter('testCharacter_6');
  fileContext = ImageFile.createEmpty('testCharacter_6_image').toContext();
  fileContext.url = './assets/images/mon_135.gif';
  testFile = ImageStorage.instance.add(fileContext);
  ImageTag.create(testFile.identifier).tag = '*default ' + t('action.newCharacter');
  ch6.location.x = 500;
  ch6.location.y = 475;
  ch6.rotate = 180;
  ch6.initialize();
  ch6.createTestGameDataElement(t('sample.characterC'), 1, testFile.identifier);
  ch6.floorRing = 'fire';
  ch6.moveToTableOnly(tableId);

  // Red strings on the 3D battle map (monster C ↔ A / B) — store Token ids.
  const tokC = CharacterToken.focusTokenForCharacter(ch3.identifier, tableId)
    || CharacterToken.tokensOnTable(ch3.identifier, tableId)[0];
  const tokA = CharacterToken.focusTokenForCharacter(ch1.identifier, tableId)
    || CharacterToken.tokensOnTable(ch1.identifier, tableId)[0];
  const tokB = CharacterToken.focusTokenForCharacter(ch2.identifier, tableId)
    || CharacterToken.tokensOnTable(ch2.identifier, tableId)[0];
  if (tokC && tokA) {
    ClueLink.create(tokC.identifier, tokA.identifier, {
      sag: 0.22, tableIdentifier: tableId, identifier: 'battleClueLink_1',
    });
  }
  if (tokC && tokB) {
    ClueLink.create(tokC.identifier, tokB.identifier, {
      sag: 0.22, tableIdentifier: tableId, identifier: 'battleClueLink_2',
    });
  }
}

function ensureDefaultTerrainTexture(t: DefaultRoomTranslate): string {
  const url = './assets/images/tex.jpg';
  let image = ImageStorage.instance.get(url);
  if (!image) {
    image = ImageStorage.instance.add(url);
    if (!ImageTag.get(image.identifier)) {
      ImageTag.create(image.identifier).tag = '*default ' + t('action.terrainName');
    }
  }
  return image.identifier;
}

/**
 * Default 2D clue-board layout (from HKTRPG_2026-08-10_1009.zip 2D map).
 * Monster C also sits under the yellow standing mask; rumour stays in common.
 */
function seedClueBoardObjects(tableId: string, t: DefaultRoomTranslate): void {
  const monsterC = ObjectStore.instance.get<GameCharacter>('testCharacter_3');
  if (monsterC) {
    monsterC.pushPin = true;
    monsterC.pushPinAngle = 13;
    monsterC.pushPinStyle = 2;
    // Explicit second Token on the clue board (do not rely on body.addToTable while viewing 3D).
    CharacterToken.create(monsterC.identifier, { x: 175, y: 400, posZ: 0 }, {
      tableId,
      copyAppearanceFrom: monsterC,
      major: true,
    });
  }

  const clueA = seedClueCharacter('clueCharacter_1', './assets/images/mon_150.gif',
    t('sample.clue.suspectA'), 829, 304, tableId, 'polaroid', -8, 6, -8, t);
  const clueB = seedClueCharacter('clueCharacter_2', './assets/images/mon_211.gif',
    t('sample.clue.suspectB'), 573, 373, tableId, 'photo', 12, 6, -7, t);
  const clueC = seedClueCharacter('clueCharacter_3', './assets/images/mon_135.gif',
    t('sample.clue.evidence'), 500, 480, tableId, 'card', -15, 2, -6, t);
  const clueD = seedClueCharacter('clueCharacter_4', './assets/images/mon_052.gif',
    t('sample.clue.witness'), 655, 632, tableId, 'polaroid', 6, 2, -5, t);

  const noteA4 = TextNote.create(
    t('sample.clue.caseTitle'),
    t('sample.clue.caseBody'),
    12, 6, 6, 'clueNote_a4');
  noteA4.location.x = 1225;
  noteA4.location.y = 625;
  noteA4.rotate = -4;
  noteA4.isUpright = false;
  noteA4.applyPaperStyle('a4');
  noteA4.pushPin = true;
  noteA4.pushPinAngle = -22;
  noteA4.pushPinStyle = 7;
  noteA4.moveToTableOnly(tableId);

  const sticky = TextNote.create(
    t('sample.clue.stickyTitle'),
    t('sample.clue.stickyBody'),
    14, 2.5, 2.5, 'clueNote_sticky');
  sticky.location.x = 981;
  sticky.location.y = 711;
  sticky.rotate = 7;
  sticky.isUpright = false;
  sticky.applyPaperStyle('sticky');
  sticky.pushPin = true;
  sticky.pushPinAngle = -25;
  sticky.pushPinStyle = 6;
  sticky.moveToTableOnly(tableId);

  const rumours = TextNote.create(
    t('sample.clue.rumourTitle'),
    t('sample.clue.rumourBody'),
    14, 4, 3, 'clueNote_rumour');
  rumours.location.x = 1259;
  rumours.location.y = 698;
  rumours.rotate = 0;
  rumours.isUpright = false;
  rumours.isLocked = true;
  rumours.textAlign = 'center';
  rumours.tableIdentifier = tableId;
  rumours.location.name = 'common';
  rumours.update();

  const mask = GameTableMask.create(
    t('sample.clue.maskName'), 5, 7, 100, 'clueMask_org');
  mask.location.x = 126;
  mask.location.y = 229;
  mask.isLock = true;
  mask.borderType = 0;
  mask.text = t('sample.clue.maskText');
  mask.fontsize = 18;
  mask.textPosition = 'top-center';
  mask.color = '#555555';
  mask.bgcolor = CLUE_STICKY_YELLOW;
  mask.tokenFxPassive = true;
  mask.tokenFxPassiveConfig = {
    isInverse: false,
    isHollow: false,
    isBlackPaint: true,
    isGrayscale: false,
    isSepia: false,
    isWhitePaint: false,
    isMatrix: false,
    isFlipVertical: false,
    isContrast: false,
    altitudeMode: 'none',
    altitude: 0,
  };
  mask.setEnabledClickActions(['note', 'tokenFx']);
  mask.clickNoteId = rumours.identifier;
  mask.moveToTableOnly(tableId);
  const clueTable = ObjectStore.instance.get<GameTable>(tableId);
  if (clueTable) clueTable.appendChild(mask);

  ClueLink.create(clueA.identifier, clueB.identifier, { sag: 0.28, tableIdentifier: tableId, identifier: 'clueLink_1' });
  ClueLink.create(clueB.identifier, clueC.identifier, { sag: 0.2, tableIdentifier: tableId, identifier: 'clueLink_2' });
  ClueLink.create(clueA.identifier, noteA4.identifier, { sag: 0.32, tableIdentifier: tableId, identifier: 'clueLink_3' });
  ClueLink.create(clueD.identifier, sticky.identifier, { sag: 0.18, tableIdentifier: tableId, identifier: 'clueLink_4' });
  ClueLink.create(clueC.identifier, clueD.identifier, { sag: 0.25, tableIdentifier: tableId, identifier: 'clueLink_5' });
}

function seedClueCharacter(
  id: string,
  imageUrl: string,
  name: string,
  x: number,
  y: number,
  tableId: string,
  frame: TokenFrameStyle,
  rotate: number,
  pinStyle: number,
  pinAngle: number,
  t: DefaultRoomTranslate,
): GameCharacter {
  const fileContext = ImageFile.createEmpty(id + '_image').toContext();
  fileContext.url = imageUrl;
  const testFile = ImageStorage.instance.add(fileContext);
  ImageTag.create(testFile.identifier).tag = '*default ' + t('action.newCharacter');
  const ch = new GameCharacter(id);
  ch.location.x = x;
  ch.location.y = y;
  ch.rotate = rotate;
  ch.initialize();
  ch.createTestGameDataElement(name, 1, testFile.identifier);
  ch.tokenFrame = frame;
  ch.tokenFrameCaption = name;
  ch.isShowName = true;
  ch.pushPin = true;
  ch.pushPinAngle = pinAngle;
  ch.pushPinStyle = pinStyle;
  ch.moveToTableOnly(tableId);
  return ch;
}
