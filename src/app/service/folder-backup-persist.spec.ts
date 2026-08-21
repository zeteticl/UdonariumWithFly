import { shouldPersistLeaveFlush } from './folder-backup-persist';

describe('folder backup leave flush gate', () => {
  it('blocks leave flush of join-quarantine / uncleared tabletop', () => {
    expect(shouldPersistLeaveFlush(false, false)).toBeFalse();
  });

  it('allows leave flush after the house was trusted', () => {
    expect(shouldPersistLeaveFlush(true, false)).toBeTrue();
  });

  it('allows switch flush that carries an explicit pre-clear snapshot', () => {
    expect(shouldPersistLeaveFlush(false, true)).toBeTrue();
  });
});
