import {
  isRecoverableNetworkError,
  RECOVERABLE_NETWORK_ERROR_TYPES,
  shouldAttemptRoomReopen,
} from './room-reconnect.util';
import { Network } from './core/system';

describe('room-reconnect.util', () => {
  it('treats SkyWay internal / default as recoverable after cable drop', () => {
    expect(isRecoverableNetworkError('internal')).toBeTrue();
    expect(isRecoverableNetworkError('default')).toBeTrue();
    expect(isRecoverableNetworkError('disconnected')).toBeTrue();
    expect(isRecoverableNetworkError('socket-error')).toBeTrue();
    expect(isRecoverableNetworkError('unavailable-id')).toBeTrue();
  });

  it('does not treat auth / backend failures as simple recoverable', () => {
    expect(isRecoverableNetworkError('server-error')).toBeFalse();
    expect(isRecoverableNetworkError('authentication')).toBeFalse();
    expect(isRecoverableNetworkError('token-expired')).toBeFalse();
    expect(isRecoverableNetworkError('peer-unavailable')).toBeFalse();
  });

  it('still attempts room reopen for token / auth / server errors', () => {
    expect(shouldAttemptRoomReopen('internal')).toBeTrue();
    expect(shouldAttemptRoomReopen('token-expired')).toBeTrue();
    expect(shouldAttemptRoomReopen('authentication')).toBeTrue();
    expect(shouldAttemptRoomReopen('server-error')).toBeTrue();
    expect(shouldAttemptRoomReopen('peer-unavailable')).toBeFalse();
  });

  it('RECOVERABLE_NETWORK_ERROR_TYPES includes internal', () => {
    expect(RECOVERABLE_NETWORK_ERROR_TYPES).toContain('internal');
  });
});

describe('Network lastRoomSession', () => {
  afterEach(() => {
    Network.clearLastRoomSession();
  });

  it('remembers and returns a copy of the room session', () => {
    Network.rememberRoomSession({
      userId: 'u1',
      roomId: 'Ab1',
      roomName: 'TestRoom',
      meshPassword: 'mesh',
    });
    const a = Network.getLastRoomSession();
    const b = Network.getLastRoomSession();
    expect(a).toEqual({
      userId: 'u1',
      roomId: 'Ab1',
      roomName: 'TestRoom',
      meshPassword: 'mesh',
    });
    expect(a).not.toBe(b);
    a!.roomId = 'mutated';
    expect(Network.getLastRoomSession()?.roomId).toBe('Ab1');
  });

  it('ignores incomplete room sessions', () => {
    Network.rememberRoomSession({
      userId: 'u1',
      roomId: '',
      roomName: 'x',
      meshPassword: '',
    });
    expect(Network.getLastRoomSession()).toBeNull();
  });

  it('clearLastRoomSession drops stored credentials', () => {
    Network.rememberRoomSession({
      userId: 'u1',
      roomId: 'Ab1',
      roomName: 'TestRoom',
      meshPassword: '',
    });
    Network.clearLastRoomSession();
    expect(Network.getLastRoomSession()).toBeNull();
  });
});
