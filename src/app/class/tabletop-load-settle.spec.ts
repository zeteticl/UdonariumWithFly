import { TabletopLoadSettle } from './tabletop-load-settle';

describe('TabletopLoadSettle', () => {
  beforeEach(() => {
    TabletopLoadSettle.forceRelease();
  });

  afterEach(() => {
    TabletopLoadSettle.forceRelease();
  });

  it('keeps gate up after identity remount when archive is pending', () => {
    jasmine.clock().install();
    TabletopLoadSettle.begin({ expectArchive: true });
    expect(TabletopLoadSettle.skipEnterAnimation).toBeTrue();

    TabletopLoadSettle.noteIdentityRemountDone(50);
    jasmine.clock().tick(100);
    expect(TabletopLoadSettle.busy).toBeTrue();

    TabletopLoadSettle.afterArchiveSettle(50);
    jasmine.clock().tick(49);
    expect(TabletopLoadSettle.busy).toBeTrue();
    jasmine.clock().tick(2);
    expect(TabletopLoadSettle.busy).toBeFalse();
    jasmine.clock().uninstall();
  });

  it('releases after identity remount when no archive is expected', () => {
    jasmine.clock().install();
    TabletopLoadSettle.begin();
    TabletopLoadSettle.noteIdentityRemountDone(50);
    jasmine.clock().tick(51);
    expect(TabletopLoadSettle.busy).toBeFalse();
    jasmine.clock().uninstall();
  });
});
