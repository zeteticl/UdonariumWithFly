import { CharacterToken } from '@udonarium/character-token';
import { ChatTab } from '@udonarium/chat-tab';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { CutIn } from '@udonarium/cut-in';
import { GameTable } from '@udonarium/game-table';
import { GameTableMask } from '@udonarium/game-table-mask';
import { Jukebox } from '@udonarium/Jukebox';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ScenePreset } from '@udonarium/scene-preset';
import { ScenePresetList } from '@udonarium/scene-preset-list';
import { applyMaskTokenFxToCharacter } from '@udonarium/table-fx/mask-token-fx-apply';
import { tokenFxConfigHasWork } from '@udonarium/table-fx/mask-appearance';
import { charactersOnMask } from '@udonarium/table-fx/mask-token-overlap';
import { TableSelecter } from '@udonarium/table-selecter';
import { TextNote } from '@udonarium/text-note';
import { ChatWindowComponent } from 'component/chat-window/chat-window.component';
import { buildNoteHandoutPayload } from 'component/note-handout/note-handout.component';
import { ChatMessageService } from 'service/chat-message.service';

export type TabletopClickAction =
  | 'none'
  | 'chat'
  | 'table'
  | 'preset'
  | 'music'
  | 'cutin'
  | 'note'
  | 'toggleAppearance'
  | 'tokenFx';

export type TabletopClickTabMode = 'current' | 'specified';

export const TABLETOP_CLICK_ACTION_IDS: Exclude<TabletopClickAction, 'none'>[] = [
  'chat',
  'music',
  'cutin',
  'note',
  'table',
  'preset',
  'toggleAppearance',
  'tokenFx',
];

export interface TabletopClickActionHost {
  clickAction: TabletopClickAction;
  clickActionsJson?: string;
  clickPayload: string;
  clickGameType: string;
  clickTabMode?: TabletopClickTabMode;
  clickTabId?: string;
  clickMusicTrack?: number;
  clickMusicLoop?: boolean;
  clickMusicId?: string;
  clickCutinId?: string;
  clickNoteId?: string;
  clickTableId?: string;
  clickPresetId?: string;
}

/** Actions that mutate room/shared state; blocked in Guest mode. */
const MUTATING_ACTIONS: TabletopClickAction[] = [
  'table',
  'preset',
  'music',
  'cutin',
  'note',
  'toggleAppearance',
  'tokenFx',
];

export function parseClickActionsJson(json: string): TabletopClickAction[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    const out: TabletopClickAction[] = [];
    for (const a of arr) {
      if (typeof a !== 'string' || a === 'none') continue;
      if ((TABLETOP_CLICK_ACTION_IDS as string[]).indexOf(a) < 0) continue;
      if (out.indexOf(a as TabletopClickAction) < 0) out.push(a as TabletopClickAction);
    }
    return out;
  } catch {
    return [];
  }
}

export function stringifyClickActions(actions: TabletopClickAction[]): string {
  const uniq: TabletopClickAction[] = [];
  for (const a of actions || []) {
    if (!a || a === 'none') continue;
    if ((TABLETOP_CLICK_ACTION_IDS as string[]).indexOf(a) < 0) continue;
    if (uniq.indexOf(a) < 0) uniq.push(a);
  }
  return JSON.stringify(uniq);
}

/** Enabled actions (multi). Falls back to legacy single clickAction. */
export function resolveEnabledClickActions(host: TabletopClickActionHost): TabletopClickAction[] {
  if (!host) return [];
  const multi = parseClickActionsJson(host.clickActionsJson || '');
  if (multi.length) return multi;
  if (host.clickAction && host.clickAction !== 'none') return [host.clickAction];
  return [];
}

export function hostHasClickAction(host: TabletopClickActionHost): boolean {
  return resolveEnabledClickActions(host).length > 0;
}

export function hostHasClickActionKind(host: TabletopClickActionHost, action: TabletopClickAction): boolean {
  if (!action || action === 'none') return false;
  return resolveEnabledClickActions(host).indexOf(action) >= 0;
}

function legacyPayload(host: TabletopClickActionHost, action: TabletopClickAction): string {
  if (host.clickAction === action) return (host.clickPayload || '').trim();
  return '';
}

function resolveChatText(host: TabletopClickActionHost): string {
  return (host.clickPayload || '').trim();
}

function resolveMusicId(host: TabletopClickActionHost): string {
  return (host.clickMusicId || '').trim() || legacyPayload(host, 'music');
}

function resolveCutinId(host: TabletopClickActionHost): string {
  return (host.clickCutinId || '').trim() || legacyPayload(host, 'cutin');
}

function resolveNoteId(host: TabletopClickActionHost): string {
  return (host.clickNoteId || '').trim() || legacyPayload(host, 'note');
}

function resolveTableId(host: TabletopClickActionHost): string {
  return (host.clickTableId || '').trim() || legacyPayload(host, 'table');
}

function resolvePresetId(host: TabletopClickActionHost): string {
  return (host.clickPresetId || '').trim() || legacyPayload(host, 'preset');
}

export { tokenFxConfigHasWork } from '@udonarium/table-fx/mask-appearance';

export function resolveActiveChatTab(chatMessageService: ChatMessageService): ChatTab {
  const id = ChatWindowComponent.activeChatTabIdentifier;
  const tab = id ? ObjectStore.instance.get<ChatTab>(id) : null;
  if (tab) return tab;
  return chatMessageService.chatTabs[0] || null;
}

export function resolveClickChatTab(
  host: TabletopClickActionHost,
  chatMessageService: ChatMessageService
): ChatTab {
  if (host?.clickTabMode === 'specified') {
    const id = (host.clickTabId || '').trim();
    if (id) {
      const tab = ObjectStore.instance.get<ChatTab>(id);
      if (tab instanceof ChatTab) return tab;
    }
  }
  return resolveActiveChatTab(chatMessageService);
}

function runOne(
  action: TabletopClickAction,
  host: TabletopClickActionHost,
  chatMessageService: ChatMessageService
): boolean {
  if (Network.GuestMode() && MUTATING_ACTIONS.indexOf(action) >= 0) return false;

  switch (action) {
    case 'chat': {
      const text = resolveChatText(host);
      if (!text) return false;
      const tab = resolveClickChatTab(host, chatMessageService);
      const peer = PeerCursor.myCursor;
      if (!tab || !peer) return false;
      const gameType = (host.clickGameType || 'DiceBot').trim() || 'DiceBot';
      chatMessageService.sendMessage(tab, text, gameType, peer.identifier, null, peer.color);
      return true;
    }
    case 'table': {
      const tableId = resolveTableId(host);
      if (!tableId) return false;
      const table = ObjectStore.instance.get<GameTable>(tableId);
      if (!(table instanceof GameTable)) return false;
      const selecter = TableSelecter.instance;
      if (PeerCursor.myCursor?.isGMMode) selecter.activateTable(table.identifier);
      else if (table.playerCanView) selecter.viewTableLocal(table.identifier);
      return true;
    }
    case 'preset': {
      const presetId = resolvePresetId(host);
      if (!presetId) return false;
      const preset = ObjectStore.instance.get<ScenePreset>(presetId);
      if (!(preset instanceof ScenePreset)) return false;
      ScenePresetList.instance.applyPreset(preset, { chatTab: resolveClickChatTab(host, chatMessageService) });
      return true;
    }
    case 'music': {
      const audioId = resolveMusicId(host);
      if (!audioId) return false;
      const jukebox = ObjectStore.instance.get<Jukebox>('Jukebox');
      if (!jukebox) return false;
      const track = Math.max(0, Math.min(3, Number(host.clickMusicTrack) || 0));
      const loop = host.clickMusicLoop !== false;
      jukebox.playTrack(track, audioId, loop);
      return true;
    }
    case 'cutin': {
      const id = resolveCutinId(host);
      if (!id) return false;
      const cutIn = ObjectStore.instance.get<CutIn>(id);
      if (!(cutIn instanceof CutIn)) return false;
      EventSystem.call('PLAY_CUT_IN', {
        identifier: cutIn.identifier,
        secret: false,
        sender: PeerCursor.myCursor?.peerId,
      });
      return true;
    }
    case 'note': {
      const id = resolveNoteId(host);
      if (!id) return false;
      const note = ObjectStore.instance.get<TextNote>(id);
      if (!(note instanceof TextNote)) return false;
      // Never hand out notes this peer cannot see (other players' self-only).
      if (!note.canSeeSelfOnly) return false;
      const data = buildNoteHandoutPayload(note, note.title || '');
      if (!data.imageUrl && !data.pdfIdentifier && !data.videoUrl && !data.videoIdentifier && !data.text) return false;
      // Self-only content must not be broadcast to the room.
      if (note.isSelfOnly) {
        EventSystem.trigger('SHOW_NOTE_HANDOUT', data);
        return true;
      }
      EventSystem.call('SHOW_NOTE_HANDOUT', data);
      EventSystem.trigger('SHOW_NOTE_HANDOUT', data);
      return true;
    }
    case 'toggleAppearance': {
      if (!(host instanceof GameTableMask)) return false;
      return host.toggleAppearanceSets();
    }
    case 'tokenFx': {
      if (!(host instanceof GameTableMask)) return false;
      const cfg = host.tokenFxConfig;
      if (!tokenFxConfigHasWork(cfg)) return false;
      // On-table pieces are CharacterTokens (bodies stay off-table).
      const tokens = ObjectStore.instance.getObjects(CharacterToken).filter(t => t.isVisibleOnTable);
      const targets = charactersOnMask(tokens, host);
      if (!targets.length) return false;
      for (const tok of targets) {
        applyMaskTokenFxToCharacter(tok, cfg);
      }
      // Keep leave-restore in sync on all peers so walking off won't undo click FX.
      const adopt = { characterIds: targets.map(tok => tok.identifier) };
      EventSystem.call('MASK_TOKEN_FX_ADOPT', adopt);
      EventSystem.trigger('MASK_TOKEN_FX_ADOPT', adopt);
      return true;
    }
    default:
      return false;
  }
}

/** Run all enabled actions that have written targets. Returns true if any ran. */
export function executeTabletopClickAction(
  host: TabletopClickActionHost,
  chatMessageService: ChatMessageService
): boolean {
  const actions = resolveEnabledClickActions(host);
  if (!actions.length) return false;
  let any = false;
  for (const action of actions) {
    if (runOne(action, host, chatMessageService)) any = true;
  }
  return any;
}
