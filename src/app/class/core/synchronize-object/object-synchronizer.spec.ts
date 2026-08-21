import { EventSystem, Network } from '../system';
import { ObjectStore } from './object-store';
import { ObjectSynchronizer } from './object-synchronizer';

describe('ObjectSynchronizer peer-sync hold', () => {
  beforeEach(() => {
    ObjectSynchronizer.instance.initialize();
  });
  afterEach(() => {
    ObjectSynchronizer.instance.destroy();
  });

  it('queues CONNECT_PEER catalog until releasePeerSync', async () => {
    const sentTo: string[] = [];
    spyOn(EventSystem, 'call').and.callFake(((name: string, _data: unknown, sendTo?: string) => {
      if (name === 'SYNCHRONIZE_GAME_OBJECT' && sendTo) sentTo.push(sendTo);
    }) as typeof EventSystem.call);

    ObjectSynchronizer.instance.holdPeerSync();
    EventSystem.trigger('CONNECT_PEER', { peerId: 'peer-a' });
    await new Promise<void>(resolve => setTimeout(resolve, 30));
    expect(sentTo).toEqual([]);

    ObjectSynchronizer.instance.releasePeerSync();
    await new Promise<void>(resolve => setTimeout(resolve, 30));
    expect(sentTo).toContain('peer-a');
  });

  it('drops queued catalogs when releasePeerSync(false)', async () => {
    const sentTo: string[] = [];
    spyOn(EventSystem, 'call').and.callFake(((name: string, _data: unknown, sendTo?: string) => {
      if (name === 'SYNCHRONIZE_GAME_OBJECT' && sendTo) sentTo.push(sendTo);
    }) as typeof EventSystem.call);

    ObjectSynchronizer.instance.holdPeerSync();
    EventSystem.trigger('CONNECT_PEER', { peerId: 'peer-a' });
    ObjectSynchronizer.instance.releasePeerSync(false);
    await new Promise<void>(resolve => setTimeout(resolve, 30));
    expect(sentTo).toEqual([]);
  });

  it('does not apply inbound SYNCHRONIZE_GAME_OBJECT while held', () => {
    spyOn(ObjectStore.instance, 'isDeleted').and.returnValue(true);
    const callSpy = spyOn(EventSystem, 'call');

    ObjectSynchronizer.instance.holdPeerSync();
    EventSystem.trigger({
      eventName: 'SYNCHRONIZE_GAME_OBJECT',
      data: [{ identifier: 'gone', version: 1 }],
      sendFrom: 'peer-a',
    });
    expect(callSpy).not.toHaveBeenCalled();

    ObjectSynchronizer.instance.releasePeerSync(false);
    expect(callSpy).not.toHaveBeenCalled();
  });

  it('applies queued inbound SYNCHRONIZE_GAME_OBJECT on releasePeerSync(true)', () => {
    spyOn(ObjectStore.instance, 'isDeleted').and.returnValue(true);
    const callSpy = spyOn(EventSystem, 'call');

    ObjectSynchronizer.instance.holdPeerSync();
    EventSystem.trigger({
      eventName: 'SYNCHRONIZE_GAME_OBJECT',
      data: [{ identifier: 'gone', version: 1 }],
      sendFrom: 'peer-a',
    });
    ObjectSynchronizer.instance.releasePeerSync(true);
    const args = (callSpy as jasmine.Spy).calls.mostRecent().args as unknown[];
    expect(args[0]).toBe('DELETE_GAME_OBJECT');
    expect(args[1]).toEqual(jasmine.objectContaining({ identifier: 'gone' }));
    expect(args[2]).toBe('peer-a');
  });

  it('does not apply inbound UPDATE_GAME_OBJECT while held', () => {
    spyOn(ObjectStore.instance, 'get').and.returnValue(null);
    spyOn(ObjectStore.instance, 'isDeleted').and.returnValue(true);
    const callSpy = spyOn(EventSystem, 'call');

    ObjectSynchronizer.instance.holdPeerSync();
    EventSystem.trigger({
      eventName: 'UPDATE_GAME_OBJECT',
      data: {
        aliasName: 'game-table',
        identifier: 'hostTable',
        majorVersion: 1,
        minorVersion: 0,
        syncData: {},
      },
      sendFrom: 'peer-a',
    });
    expect(callSpy).not.toHaveBeenCalled();

    ObjectSynchronizer.instance.releasePeerSync(false);
    expect(callSpy).not.toHaveBeenCalled();
  });

  it('applies queued inbound UPDATE_GAME_OBJECT on releasePeerSync(true)', () => {
    spyOn(ObjectStore.instance, 'get').and.returnValue(null);
    spyOn(ObjectStore.instance, 'isDeleted').and.returnValue(true);
    const callSpy = spyOn(EventSystem, 'call');

    ObjectSynchronizer.instance.holdPeerSync();
    EventSystem.trigger({
      eventName: 'UPDATE_GAME_OBJECT',
      data: {
        aliasName: 'game-table',
        identifier: 'hostTable',
        majorVersion: 1,
        minorVersion: 0,
        syncData: {},
      },
      sendFrom: 'peer-a',
    });
    ObjectSynchronizer.instance.releasePeerSync(true);
    const args = (callSpy as jasmine.Spy).calls.mostRecent().args as unknown[];
    expect(args[0]).toBe('DELETE_GAME_OBJECT');
    expect(args[1]).toEqual(jasmine.objectContaining({ identifier: 'hostTable' }));
  });

  it('requests catalog objects while held during join fetch', async () => {
    spyOnProperty(Network, 'peers', 'get').and.returnValue([{ peerId: 'peer-a', isOpen: true } as any]);
    const requested: string[] = [];
    spyOn(EventSystem, 'call').and.callFake(((name: string, data?: unknown) => {
      if (name === 'REQUEST_GAME_OBJECT') requested.push(String(data));
    }) as typeof EventSystem.call);

    ObjectSynchronizer.instance.holdPeerSync();
    ObjectSynchronizer.instance.enableJoinFetch();
    EventSystem.trigger({
      eventName: 'SYNCHRONIZE_GAME_OBJECT',
      data: [{ identifier: 'gameTable', version: 99 }],
      sendFrom: 'peer-a',
    });
    await new Promise<void>(resolve => setTimeout(resolve, 30));
    expect(requested).toContain('gameTable');

    ObjectSynchronizer.instance.disableJoinFetch();
    ObjectSynchronizer.instance.releasePeerSync(false);
  });
});
