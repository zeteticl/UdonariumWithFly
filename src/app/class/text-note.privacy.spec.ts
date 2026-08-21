import { Network } from './core/system';
import { TextNote } from './text-note';
import {
  makeTable,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('TextNote self-only privacy', () => {
  let peerUserId: string;

  beforeEach(() => {
    resetTabletopStore();
    peerUserId = 'me';
    spyOnProperty(Network, 'peer', 'get').and.callFake(() => ({ userId: peerUserId } as any));
  });
  afterEach(() => resetTabletopStore());

  it('isSelfOnly follows visibleOwner', () => {
    const note = TextNote.create('t', 'body', 16, 1, 1, 'note1');
    expect(note.isSelfOnly).toBeFalse();
    note.visibleOwner = 'userA';
    expect(note.isSelfOnly).toBeTrue();
  });

  it('canSeeSelfOnly is true for public notes and owner only', () => {
    const note = TextNote.create('t', 'body', 16, 1, 1, 'note2');
    expect(note.canSeeSelfOnly).toBeTrue();

    note.visibleOwner = 'ownerId';
    peerUserId = 'ownerId';
    expect(note.canSeeSelfOnly).toBeTrue();

    peerUserId = 'other';
    expect(note.canSeeSelfOnly).toBeFalse();
  });

  it('setSelfOnly assigns Network.peer.userId as owner', () => {
    peerUserId = 'me';
    const note = TextNote.create('t', 'body', 16, 1, 1, 'note3');
    note.setSelfOnly(true);
    expect(note.visibleOwner).toBe('me');
    expect(note.isVisible).toBeFalse();
    note.setSelfOnly(false);
    expect(note.visibleOwner).toBe('');
    expect(note.isVisible).toBeTrue();
  });

  it('room-scoped notes stay visible across maps via isVisibleOnTable', () => {
    makeTable('mapA');
    makeTable('mapB');
    viewTables('mapA');
    const note = TextNote.create('roomNote', 'x', 16, 1, 1, 'noteRoom');
    note.location = { name: 'table', x: 0, y: 0 };
    note.scope = 'room';
    note.addToTable('mapA', { x: 0, y: 0, posZ: 0 }, true);

    viewTables('mapB');
    expect(note.isVisibleOnTable).toBeTrue();
  });
});
