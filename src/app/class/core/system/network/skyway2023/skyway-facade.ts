import {
  Channel,
  LocalDataStream,
  LocalPerson,
  Logger,
  Publication,
  SkyWayChannel,
  SkyWayContext,
  SkyWayError,
  SkyWayStreamFactory,
  Subscription
} from '@skyway-sdk/core';
import { CryptoUtil } from '../../util/crypto-util';
import { IPeerContext, PeerContext } from '../peer-context';
import { SkyWayBackend } from './skyway-backend';
import { installSkyWayQuietLogger } from './skyway-log';
import { translate } from 'i18n';

export class SkyWayFacade {
  /** Lobby/room membership TTL. Prefer fewer false fatals over slightly stickier ghosts; leave/close drops membership promptly. */
  private static readonly MEMBER_KEEPALIVE_SEC = 30;
  url = '';
  context: SkyWayContext;
  private lobby: Channel;
  private lobbyPerson: LocalPerson;
  room: Channel;
  roomPerson: LocalPerson;

  publication: Publication<LocalDataStream>;

  peer: PeerContext = PeerContext.parse('???');
  get isOpen(): boolean { return this.peer.isOpen };
  private isDestroyed = false;

  onOpen: (peer: IPeerContext) => void;
  onClose: (peer: IPeerContext) => void;
  onFatalError: (peer: IPeerContext, errorType: string, errorMessage: string, errorObject: any) => void;
  onSubscribed: (peer: IPeerContext, subscription: Subscription) => void;
  onRoomRestore: (peer: IPeerContext) => void;

  async open(peer: IPeerContext) {
    if (this.isOpen) await this.close();
    try {
      this.peer = PeerContext.parse(peer.peerId);
      this.peer.userId = peer.userId;
      this.peer.password = peer.password;
      this.peer.meshPassword = peer.meshPassword || '';
      this.isDestroyed = false;

      await this.createContext();
      await this.joinRoom();
      await this.joinLobby();

      this.peer.isOpen = true;

      if (this.onOpen) this.onOpen(this.peer);
    } catch (err) {
      console.error(err);
      const fatal = this.formatFatalError(err);
      if (this.onFatalError) this.onFatalError(this.peer, fatal.type, fatal.message, err);
    }
  }

  async close() {
    try {
      this.peer = PeerContext.parse('???');
      this.isDestroyed = true;

      // Leave membership first so the lobby listing drops even if the tab dies mid-close.
      await Promise.all([
        this.leaveLobbyPerson().catch(() => { /* unload */ }),
        this.leaveRoomPerson().catch(() => { /* unload */ }),
      ]);
      await this.closeRoomDataStream().catch(() => { /* unload */ });
      await Promise.all([
        this.leaveLobbyChannel().catch(() => { /* unload */ }),
        this.leaveRoomChannel().catch(() => { /* unload */ }),
      ]);
      await this.disposeContext();
    } catch (err) {
      console.error(err);
    }
  }

  private async createContext() {
    await this.disposeContext();
    if (this.isDestroyed) return;

    installSkyWayQuietLogger();

    let backend = new SkyWayBackend(this.url);
    let channelName = this.peer.isRoom
      ? CryptoUtil.sha256Base64Url(this.peer.roomId + this.peer.roomName + this.peer.channelPassword)
      : this.peer.peerId;

    let authToken = await backend.createSkyWayAuthToken(channelName, this.peer.peerId);
    if (authToken.length < 1) {
      let message = translate('skyway.backendUnavailable', { url: backend.url });
      const err = new Error(message);
      err.name = 'server-error';
      throw err;
    }

    let context = await SkyWayContext.Create(authToken);
    context.onTokenUpdateReminder.add(async () => {
      console.log(`skyWay onTokenUpdateReminder ${new Date().toISOString()}`);
      let authToken = await backend.createSkyWayAuthToken(channelName, this.peer.peerId);
      if (authToken.length < 1) {
        let message = translate('skyway.backendUnavailableShort', { url: backend.url });
        if (this.onFatalError) this.onFatalError(this.peer, 'server-error', message, new Error(message));
        return;
      }
      context.updateAuthToken(authToken);
    });

    context.onTokenExpired.add(() => {
      console.error('skyWay onTokenExpired');
      if (this.isOpen) {
        this.close();
        if (this.onClose) this.onClose(this.peer);
      }
      let message = translate('skyway.tokenExpired');
      if (this.onFatalError) this.onFatalError(this.peer, 'token-expired', message, new Error(message));
    });

    context.onFatalError.add(err => {
      console.error('skyWay onFatalError', err);
      if (this.isOpen) {
        this.close();
        if (this.onClose) this.onClose(this.peer);
      }
      const fatal = this.formatFatalError(err);
      if (this.onFatalError) this.onFatalError(this.peer, fatal.type, fatal.message, err);
    });

    this.context = context;
  }

  private async joinLobby() {
    await this.joinLobbyChannel();
    await this.joinLobbyPerson();
  }

  private async joinLobbyChannel() {
    await this.leaveLobbyChannel();
    if (this.isDestroyed || !this.peer.isRoom || !this.context || this.context?.disposed) return;

    let lobbys: Channel[] = [];
    for (let lobbyName of this.getLobbyNames()) {
      let lobby = await SkyWayChannel.FindOrCreate(this.context, {
        name: lobbyName,
      });
      lobbys.push(lobby);
      if (lobby.members.length < 300) break;
    }

    let min = 9999;
    let joinLobby: Channel = null;
    lobbys.forEach(lobby => {
      if (min <= lobby.members.length) return;
      min = lobby.members.length;
      joinLobby = lobby;
    });

    lobbys.forEach(lobby => {
      if (lobby !== joinLobby) lobby.dispose();
    });

    joinLobby.onClosed.add(() => {
      this.joinLobby();
    });

    this.lobby = joinLobby;
  }

  private async joinLobbyPerson() {
    await this.leaveLobbyPerson();
    if (this.isDestroyed || !this.peer.isRoom || !this.context || this.context?.disposed || this.lobby == null) return;

    let lobbyPerson = await this.lobby.join({
      name: this.peer.peerId,
      keepaliveIntervalSec: SkyWayFacade.MEMBER_KEEPALIVE_SEC,
    });

    lobbyPerson.onFatalError.add(async err => {
      console.error('lobbyPerson onFatalError', err);
      // Lobby membership is what listAllPeers uses — try rejoin without tearing down the room.
      if (this.isOpen && this.peer.isRoom && !this.isDestroyed) {
        try {
          await this.joinLobby();
          return;
        } catch (rejoinErr) {
          console.error('lobbyPerson rejoin failed', rejoinErr);
        }
      }
      const fatal = this.formatFatalError(err);
      if (this.onFatalError) this.onFatalError(this.peer, fatal.type, fatal.message, err);
    });

    this.lobbyPerson = lobbyPerson;
  }

  private async joinRoom() {
    await this.joinRoomChannel();
    await this.joinRoomPerson();
    await this.createRoomDataStream();
  }

  private async joinRoomChannel() {
    await this.leaveRoomChannel();
    if (this.isDestroyed || !this.peer.isRoom || !this.context || this.context?.disposed) return;

    let roomName = CryptoUtil.sha256Base64Url(this.peer.roomId + this.peer.roomName + this.peer.channelPassword);

    let room = await SkyWayChannel.FindOrCreate(this.context, {
      name: roomName,
    });

    room.onClosed.add(async () => {
      await this.joinRoom();
      if (this.onRoomRestore) this.onRoomRestore(this.peer);
    });

    this.room = room;
  }

  private async joinRoomPerson() {
    await this.leaveRoomPerson();
    if (this.isDestroyed || !this.peer.isRoom || !this.context || this.context?.disposed || this.room == null) return;

    let roomPerson = await this.room.join({
      name: this.peer.peerId,
      keepaliveIntervalSec: SkyWayFacade.MEMBER_KEEPALIVE_SEC,
    });

    roomPerson.onFatalError.add(err => {
      console.error('roomPerson onFatalError', err);
      if (this.isOpen) {
        this.close();
        if (this.onClose) this.onClose(this.peer);
      }
      const fatal = this.formatFatalError(err);
      if (this.onFatalError) this.onFatalError(this.peer, fatal.type, fatal.message, err);
    });

    this.roomPerson = roomPerson;
  }

  private async createRoomDataStream() {
    if (this.isDestroyed || !this.peer.isRoom || !this.context || this.context?.disposed || this.roomPerson == null) return;
    let dataStream = await SkyWayStreamFactory.createDataStream();
    let publication = await this.roomPerson.publish(dataStream, { metadata: 'udonarium-data-stream' });

    publication.onSubscribed.add(event => {
      let peerId = event.subscription.subscriber.name;
      if (peerId == null) {
        event.subscription.cancel();
        return;
      }

      let peer = PeerContext.parse(event.subscription.subscriber.name);
      if (this.onSubscribed) this.onSubscribed(peer, event.subscription);
    });

    this.publication = publication;
  }

  private async disposeContext() {
    let context = this.context;
    this.context = null;
    if (!context) return;
    context.dispose();
  }

  private async leaveLobby() {
    await this.leaveLobbyPerson();
    await this.leaveLobbyChannel();
  }

  private async leaveLobbyChannel() {
    let lobby = this.lobby;
    this.lobby = null;

    if (!lobby) return;
    lobby.dispose();
  }

  private async leaveLobbyPerson() {
    let lobbyPerson = this.lobbyPerson;
    this.lobbyPerson = null;

    if (!lobbyPerson || lobbyPerson.state === 'left') return;
    lobbyPerson.onLeft.removeAllListeners();
    lobbyPerson.onFatalError.removeAllListeners();
    await lobbyPerson.leave();
  }

  private async leaveRoom() {
    await this.closeRoomDataStream();
    await this.leaveRoomPerson();
    await this.leaveRoomChannel();
  }

  private async leaveRoomChannel() {
    let room = this.room;
    this.room = null;

    if (!room) return;
    room.onMemberJoined.removeAllListeners();
    room.onMemberLeft.removeAllListeners();
    room.onMemberListChanged.removeAllListeners();
    room.onStreamPublished.removeAllListeners();
    room.onClosed.removeAllListeners();
    room.dispose();
  }

  private async leaveRoomPerson() {
    let roomPerson = this.roomPerson;
    this.roomPerson = null;

    if (!roomPerson || roomPerson.state === 'left') return;
    roomPerson.onLeft.removeAllListeners();
    roomPerson.onFatalError.removeAllListeners();
    await roomPerson.leave();
  }

  private async closeRoomDataStream() {
    let publication = this.publication;
    this.publication = null;

    if (!publication) return;
    await publication.cancel();
  }

  async listAllPeers(): Promise<string[]> {
    if (this.isDestroyed || !this.isOpen || !this.context) return [];

    let lobbys: Channel[] = [];
    for (let lobbyName of this.getLobbyNames()) {
      if (this.isDestroyed || !this.context) break;
      let level = Logger.level;
      Logger.level = 'disable';
      try {
        let lobby = this.lobby?.name === lobbyName ? this.lobby : await SkyWayChannel.Find(this.context, { name: lobbyName });
        if (this.isDestroyed || !this.context) {
          if (lobby && lobby.name !== this.lobby?.name) {
            try { lobby.dispose(); } catch { /* disposed */ }
          }
          break;
        }
        lobbys.push(lobby);
      } catch (error) {
        // Close/dispose races leave context null; Find then throws on `_api`.
        if (this.isDestroyed || !this.context || error instanceof TypeError) {
          break;
        }
        if (error instanceof SkyWayError) {
          if (error.name != 'channelNotFound') console.error(`${error.name} ${error.message}`);
        } else {
          console.error(error);
        }
      } finally {
        Logger.level = level;
      }
    }

    if (this.isDestroyed || !this.context) {
      lobbys.forEach(lobby => {
        if (lobby.name !== this.lobby?.name) {
          try { lobby.dispose(); } catch { /* disposed */ }
        }
      });
      return [];
    }

    let allPeerIds = lobbys.flatMap(lobby => lobby.members.map(member => member.name ?? '???'));

    lobbys.forEach(lobby => {
      if (lobby.name !== this.lobby?.name) lobby.dispose();
    });
    return allPeerIds;
  }

  private getLobbyNames(): string[] {
    let names: Set<string> = new Set();
    let wildcards: Set<string> = new Set();
    let maxLobbySize = 0;

    // udonarium-lobby-* -> udonarium-lobby-1, udonarium-lobby-2, ...
    // udonarium-lobby-*-of-4 -> udonarium-lobby-1-of-4, udonarium-lobby-2-of-4, ...
    for (let channel of this.context?.authToken.scope.app.channels ?? []) {
      let name = channel.name ?? '';
      if (name.startsWith('udonarium-lobby-')) {
        if (name.includes('*')) {
          wildcards.add(name);
        } else {
          names.add(name);
        }
        try {
          let regArray = /-(\d+)$/.exec(name);
          let lobbySize = regArray && 1 < regArray.length ? Number(regArray[1]) : 0;
          if (isNaN(lobbySize)) lobbySize = 0;
          if (maxLobbySize < lobbySize) maxLobbySize = lobbySize;
        } catch (e) {
          console.warn(e);
        }
      }
    }

    for (let wildcard of wildcards) {
      [...Array(maxLobbySize)].map((value, index) => names.add(wildcard.replace('*', `${index + 1}`)));
    }

    let sorted = Array.from(names).sort((a, b) => {
      let aIndex = a.replace(/\d+/g, m => m.padStart(10, '0'));
      let bIndex = b.replace(/\d+/g, m => m.padStart(10, '0'));
      return aIndex < bIndex ? -1 : aIndex > bIndex ? 1 : 0;
    });

    return sorted;
  }

  /** Map SDK errors to localized user-facing text; keep raw details in console only. */
  private formatFatalError(err: any): { type: string; message: string } {
    const rawType = String(err?.name || err?.type || 'default');
    const kebab = rawType
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase();
    const candidates = [`skyway.${rawType}`, `skyway.${kebab}`, `skyway.${rawType.toLowerCase()}`];
    for (const key of candidates) {
      const text = translate(key);
      if (text !== key) return { type: kebab || rawType, message: text };
    }
    return { type: kebab || 'default', message: translate('skyway.default') };
  }
}
