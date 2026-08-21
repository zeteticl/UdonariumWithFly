import {
  LAYER_TIER_RANK,
  STACK_TRANSLATE_Z_STEP_PX,
  isManualLayerOrder,
  moveToBackmost,
  moveToTopmost,
  moveToTopmostInTier,
  reconcileLayerStack,
  stackTranslateZPx,
} from './tabletop-object-util';
import { GameCharacter } from './game-character';
import {
  makeCard,
  makeCharacter,
  makeMask,
  makeTable,
  makeTextNote,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('shared LAYER_STACK [ ] peers', () => {
  beforeEach(() => {
    resetTabletopStore();
    GameCharacter.allowLegacyBodyOnTable = true;
  });
  afterEach(() => resetTabletopStore());

  function placeDeskAndMask() {
    const table = makeTable('tableA');
    viewTables('tableA');

    const note = makeTextNote('note_x');
    note.location = { name: 'table', x: 0, y: 0 };
    note.addToTable('tableA', { x: 0, y: 0, posZ: 0, zindex: 0 }, true);
    note.hydratePoseForView('tableA');

    const card = makeCard('card_x');
    card.location = { name: 'table', x: 10, y: 10 };
    card.addToTable('tableA', { x: 10, y: 10, posZ: 0, zindex: 0 }, true);
    card.hydratePoseForView('tableA');

    const mask = makeMask('mask_x');
    mask.location = { name: 'table', x: 20, y: 20 };
    table.appendChild(mask);

    reconcileLayerStack();
    return { table, note, card, mask };
  }

  it('reconcile densifies desk < mask < character', () => {
    const { note, card, mask } = placeDeskAndMask();
    const ch = makeCharacter('char_x');
    ch.location = { name: 'table', x: 5, y: 5 };
    ch.addToTable('tableA', { x: 5, y: 5, posZ: 0 }, true);
    ch.hydratePoseForView('tableA');
    reconcileLayerStack();

    expect(note.zindex).toBeLessThan(mask.zindex);
    expect(card.zindex).toBeLessThan(mask.zindex);
    expect(mask.zindex).toBeLessThan(ch.zindex);
    expect(isManualLayerOrder()).toBeFalse();
  });

  it('moveToTopmost raises a note above a card and a mask', () => {
    const { note, card, mask } = placeDeskAndMask();

    expect(moveToTopmost(note)).toBeTrue();
    expect(note.zindex).toBeGreaterThan(card.zindex);
    expect(note.zindex).toBeGreaterThan(mask.zindex);
    expect(isManualLayerOrder()).toBeTrue();

    expect(moveToTopmost(mask)).toBeTrue();
    expect(mask.zindex).toBeGreaterThan(note.zindex);
    expect(mask.zindex).toBeGreaterThan(card.zindex);

    expect(moveToBackmost(mask)).toBeTrue();
    expect(mask.zindex).toBeLessThan(note.zindex);
  });

  it('moveToTopmostInTier keeps desk pieces below characters and masks', () => {
    const table = makeTable('tableA');
    viewTables('tableA');

    const note = makeTextNote('note_tier');
    note.location = { name: 'table', x: 0, y: 0 };
    note.addToTable('tableA', { x: 0, y: 0, posZ: 0, zindex: 0 }, true);
    note.hydratePoseForView('tableA');

    const card = makeCard('card_tier');
    card.location = { name: 'table', x: 10, y: 10 };
    card.addToTable('tableA', { x: 10, y: 10, posZ: 0, zindex: 0 }, true);
    card.hydratePoseForView('tableA');

    const mask = makeMask('mask_tier');
    mask.location = { name: 'table', x: 20, y: 20 };
    table.appendChild(mask);

    const ch = makeCharacter('char_tier');
    ch.location = { name: 'table', x: 5, y: 5 };
    ch.addToTable('tableA', { x: 5, y: 5, posZ: 0 }, true);
    ch.hydratePoseForView('tableA');
    reconcileLayerStack();

    // Raise card within desk tier — must stay below mask/character.
    moveToTopmostInTier(card);
    expect(card.zindex).toBeGreaterThan(note.zindex);
    expect(card.zindex).toBeLessThan(mask.zindex);
    expect(card.zindex).toBeLessThan(ch.zindex);

    moveToTopmostInTier(note);
    expect(note.zindex).toBeGreaterThan(card.zindex);
    expect(note.zindex).toBeLessThan(mask.zindex);
    expect(note.zindex).toBeLessThan(ch.zindex);
  });

  it('moveToTopmost raises one note above another (paint order, densified)', () => {
    makeTable('tableA');
    viewTables('tableA');

    const noteA = makeTextNote('note_a');
    noteA.location = { name: 'table', x: 0, y: 0 };
    noteA.addToTable('tableA', { x: 0, y: 0, posZ: 0, zindex: 0 }, true);
    noteA.hydratePoseForView('tableA');

    const noteB = makeTextNote('note_b');
    noteB.location = { name: 'table', x: 10, y: 10 };
    noteB.addToTable('tableA', { x: 10, y: 10, posZ: 0, zindex: 0 }, true);
    noteB.hydratePoseForView('tableA');
    reconcileLayerStack();

    expect(moveToTopmost(noteA)).toBeTrue();
    expect(noteA.zindex).toBeGreaterThan(noteB.zindex);

    expect(moveToTopmost(noteB)).toBeTrue();
    expect(noteB.zindex).toBeGreaterThan(noteA.zindex);

    expect(moveToTopmost(noteB)).toBeFalse();
    expect(noteB.zindex).toBeGreaterThan(noteA.zindex);
  });

  it('defaults: character > desk; [ ] can raise a note above a character', () => {
    makeTable('tableA');
    viewTables('tableA');

    const note = makeTextNote('note_ch');
    note.location = { name: 'table', x: 0, y: 0 };
    note.addToTable('tableA', { x: 0, y: 0, posZ: 0, zindex: 0 }, true);
    note.hydratePoseForView('tableA');

    const ch = makeCharacter('char_layer');
    ch.location = { name: 'table', x: 5, y: 5 };
    ch.addToTable('tableA', { x: 5, y: 5, posZ: 0 }, true);
    ch.hydratePoseForView('tableA');
    reconcileLayerStack();

    expect(ch.zindex).toBeGreaterThan(note.zindex);
    expect(moveToTopmost(note)).toBeTrue();
    expect(note.zindex).toBeGreaterThan(ch.zindex);
  });

  it('after [ ], click raise is a no-op so cards are not yanked to absolute top', () => {
    makeTable('tableA');
    viewTables('tableA');

    const note = makeTextNote('note_after_bracket');
    note.location = { name: 'table', x: 0, y: 0 };
    note.addToTable('tableA', { x: 0, y: 0, posZ: 0, zindex: 0 }, true);
    note.hydratePoseForView('tableA');

    const card = makeCard('card_after_bracket');
    card.location = { name: 'table', x: 10, y: 10 };
    card.addToTable('tableA', { x: 10, y: 10, posZ: 0, zindex: 0 }, true);
    card.hydratePoseForView('tableA');

    const ch = makeCharacter('char_after_bracket');
    ch.location = { name: 'table', x: 5, y: 5 };
    ch.addToTable('tableA', { x: 5, y: 5, posZ: 0 }, true);
    ch.hydratePoseForView('tableA');
    reconcileLayerStack();

    expect(moveToTopmost(note)).toBeTrue();
    expect(note.zindex).toBeGreaterThan(ch.zindex);
    expect(isManualLayerOrder()).toBeTrue();

    const noteZ = note.zindex;
    const cardZ = card.zindex;
    const chZ = ch.zindex;
    expect(moveToTopmostInTier(card)).toBeFalse();
    expect(note.zindex).toBe(noteZ);
    expect(card.zindex).toBe(cardZ);
    expect(ch.zindex).toBe(chZ);
  });

  it('stackTranslateZPx uses a tiny step so [ ] can paint in 3D without DOM reorder', () => {
    expect(stackTranslateZPx(0)).toBe(0);
    expect(stackTranslateZPx(8)).toBe(8 * STACK_TRANSLATE_Z_STEP_PX);
    expect(stackTranslateZPx(8)).toBeLessThan(1);
    expect(STACK_TRANSLATE_Z_STEP_PX).toBe(0.02);
    expect(stackTranslateZPx(10_000)).toBe(1.5);
    expect(LAYER_TIER_RANK.CHARACTER).toBeGreaterThan(LAYER_TIER_RANK.MASK);
  });

  it('moveToTopmost raises a table-child mask above a note (no addToTable)', () => {
    const table = makeTable('tableA');
    viewTables('tableA');

    const note = makeTextNote('note_vs_mask');
    note.location = { name: 'table', x: 0, y: 0 };
    note.addToTable('tableA', { x: 0, y: 0, posZ: 0, zindex: 0 }, true);
    note.hydratePoseForView('tableA');

    const mask = makeMask('mask_child_only');
    mask.location = { name: 'table', x: 20, y: 20 };
    table.appendChild(mask);
    reconcileLayerStack();

    expect(mask.isVisibleOnTable).toBeTrue();
    expect(mask.zindex).toBeGreaterThan(note.zindex);
    // Already top after reconcile — moveToTopmost is a no-op.
    expect(moveToTopmost(mask)).toBeFalse();
    expect(mask.zindex).toBeGreaterThan(note.zindex);
  });
});