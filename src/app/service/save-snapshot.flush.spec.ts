import { TabletopObject } from '@udonarium/tabletop-object';
import {
  makeCharacter,
  makeTable,
  makeToken,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

/**
 * Save-path flush behavior (core of prepareRoomSnapshotForSave).
 * Full SaveDataService DI is heavy; assert the public flush API used by snapshot prep.
 */
describe('Save snapshot pose flush', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('flushLivePosesToView persists dragged Token coords before XML would be built', () => {
    makeTable('gameTable');
    viewTables('gameTable');

    const body = makeCharacter('dragged');
    body.location = { name: 'common', x: 0, y: 0 };
    const tok = makeToken(body, { x: 100, y: 100, posZ: 0 }, 'gameTable');
    tok.hydratePoseForView('gameTable');

    // Simulate drag without writing placements yet.
    tok.location.x = 333;
    tok.location.y = 444;

    TabletopObject.flushLivePosesToView('gameTable');

    expect(tok.getPoseForTable('gameTable')).toEqual(jasmine.objectContaining({ x: 333, y: 444, posZ: 0 }));
    expect(body.location.name).not.toBe('table');
  });
});
