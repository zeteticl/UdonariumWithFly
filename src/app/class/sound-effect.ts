import { ChatMessage } from './chat-message';
import { AudioFile } from './core/file-storage/audio-file';
import { AudioPlayer } from './core/file-storage/audio-player';
import { AudioStorage } from './core/file-storage/audio-storage';
import { SyncObject } from './core/synchronize-object/decorator';
import { GameObject } from './core/synchronize-object/game-object';
import { ObjectStore } from './core/synchronize-object/object-store';
import { EventSystem, Network } from './core/system';

export class PresetSound {
  static dicePick: string = '';
  static dicePut: string = '';
  static diceRoll1: string = '';
  static diceRoll2: string = '';
  static cardDraw: string = '';
  static cardPick: string = '';
  static cardPut: string = '';
  static cardShuffle: string = '';
  static piecePick: string = '';
  static piecePut: string = '';
  static blockPick: string = '';
  static blockPut: string = '';
  static lock: string = '';
  static unlock: string = '';
  static sweep: string = '';
  static puyon: string = '';
  static surprise: string = '';
  static coinToss: string = '';
  static selectionStart: string = '';
  static ping: string = '';
}

@SyncObject('sound-effect')
export class SoundEffect extends GameObject {
  // GameObject Lifecycle
  onStoreAdded() {
    super.onStoreAdded();
    EventSystem.register(this)
      .on<string>('SOUND_EFFECT', event => {
        // Playback only — each peer honors its own chat/jukebox SE mute.
        AudioPlayer.playSoundEffect(AudioStorage.instance.get(event.data));
      })
      .on<string>('SOUND_BOARD', event => {
        AudioPlayer.playSoundboard(AudioStorage.instance.get(event.data));
      })
      .on('SOUND_BOARD_STOP', () => {
        AudioPlayer.stopSoundboard();
      })
      .on('SEND_MESSAGE', event => {
        let chatMessage = ObjectStore.instance.get<ChatMessage>(event.data.messageIdentifier);
        if (!chatMessage || !chatMessage.isSendFromSelf || chatMessage.isEmptyDice) return;
        if (Math.random() < 0.5) {
          SoundEffect.play(PresetSound.diceRoll1);
        } else {
          SoundEffect.play(PresetSound.diceRoll2);
        }
      });
  }

  // GameObject Lifecycle
  onStoreRemoved() {
    super.onStoreRemoved();
    EventSystem.unregister(this);
  }

  play(identifier: string)
  play(audio: AudioFile)
  play(arg: any) {
    SoundEffect.play(arg);
  }

  static play(identifier: string)
  static play(audio: AudioFile)
  static play(arg: any) {
    let identifier = '';
    if (typeof arg === 'string') {
      identifier = arg;
    } else {
      identifier = arg.identifier;
    }
    SoundEffect._play(identifier);
  }

  /** Broadcast to room. Never gated by local mute (mute is playback-only per peer). */
  private static _play(identifier: string) {
    if (!identifier) return;
    // Play immediately under the user gesture. Network.send broadcasts are
    // echoed back asynchronously via setZeroTimeout and can miss autoplay unlock.
    EventSystem.trigger('SOUND_EFFECT', identifier);
    for (const peerId of Network.peerIds) {
      EventSystem.call('SOUND_EFFECT', identifier, peerId);
    }
  }

  static playLocal(identifier: string)
  static playLocal(audio: AudioFile)
  static playLocal(arg: any) {
    let identifier = '';
    if (typeof arg === 'string') {
      identifier = arg;
    } else {
      identifier = arg.identifier;
    }
    SoundEffect._playLocal(identifier);
  }

  /** This client only. Still respects local SE mute on playback. */
  private static _playLocal(identifier: string) {
    if (!identifier) return;
    EventSystem.trigger('SOUND_EFFECT', identifier);
  }

  /** Soundboard pad — separate local channel from system SE. Room-synced. */
  static playPad(identifier: string)
  static playPad(audio: AudioFile)
  static playPad(arg: any) {
    const identifier = typeof arg === 'string' ? arg : arg?.identifier;
    SoundEffect._playPad(identifier);
  }

  static playPadLocal(identifier: string)
  static playPadLocal(audio: AudioFile)
  static playPadLocal(arg: any) {
    const identifier = typeof arg === 'string' ? arg : arg?.identifier;
    SoundEffect._playPadLocal(identifier);
  }

  private static _playPad(identifier: string) {
    if (!identifier) return;
    EventSystem.trigger('SOUND_BOARD', identifier);
    for (const peerId of Network.peerIds) {
      EventSystem.call('SOUND_BOARD', identifier, peerId);
    }
  }

  private static _playPadLocal(identifier: string) {
    if (!identifier) return;
    EventSystem.trigger('SOUND_BOARD', identifier);
  }

  /** Force-stop all soundboard one-shots for the whole room. */
  static stopPads() {
    EventSystem.trigger('SOUND_BOARD_STOP', null);
    for (const peerId of Network.peerIds) {
      EventSystem.call('SOUND_BOARD_STOP', null, peerId);
    }
  }

  /** Force-stop soundboard one-shots on this client only. */
  static stopPadsLocal() {
    EventSystem.trigger('SOUND_BOARD_STOP', null);
  }
}
