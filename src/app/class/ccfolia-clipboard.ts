/**
 * CCFOLIA Clipboard API (beta) — character paste/export format.
 * @see https://docs.ccfolia.com/developer-api/clipboard-api
 */
import { ChatPalette } from './chat-palette';
import { DataElement } from './data-element';
import { GameCharacter } from './game-character';
import { Network } from './core/system';

/** Official CCFOLIA clipboard wrapper. */
export type CharacterClipboardData = {
  kind: 'character';
  data: Partial<CcfoliaCharacter>;
};

/** Official CCFOLIA Character fields (Partial on paste). */
export type CcfoliaCharacter = {
  name: string;
  memo: string;
  initiative: number;
  externalUrl: string;
  status: { label: string; value: number; max: number }[];
  params: { label: string; value: string }[];
  iconUrl: string | null;
  faces: { iconUrl: string | null; label: string }[];
  x: number;
  y: number;
  angle: number;
  width: number;
  height: number;
  active: boolean;
  secret: boolean;
  invisible: boolean;
  hideStatus: boolean;
  color: string;
  commands: string;
  owner: string | null;
};

export type PointerPose = { x: number; y: number; z?: number };

/** Parse OS clipboard text as CCFOLIA character JSON; null if not that format. */
export function tryParseCcfoliaCharacter(text: string): CharacterClipboardData | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.kind !== 'character') return null;
  if (obj.data == null || typeof obj.data !== 'object' || Array.isArray(obj.data)) return null;
  return { kind: 'character', data: obj.data as Partial<CcfoliaCharacter> };
}

/**
 * Build a table token from CCFOLIA clipboard data.
 * Ignores iconUrl / faces[].iconUrl / x / y / active per API [!] notes.
 */
export function createGameCharacterFromCcfolia(
  clipboard: CharacterClipboardData,
  position: PointerPose
): GameCharacter {
  const data = clipboard.data || {};
  const name = (data.name != null && String(data.name).length > 0) ? String(data.name) : 'Character';
  const size = resolveSize(data);

  const character = GameCharacter.createEmpty(name, size);

  applyDetailFromCcfolia(character, data);

  if (typeof data.angle === 'number' && !Number.isNaN(data.angle)) {
    character.rotate = data.angle;
  }

  if (data.secret) {
    const userId = Network.peer?.userId;
    if (userId) character.owner = userId;
  }

  if (typeof data.commands === 'string' && data.commands.length > 0) {
    character.ensureChatPalette(data.commands);
  } else {
    character.ensureChatPalette('');
  }

  const palette = character.findChatPalette();
  if (palette && typeof data.color === 'string' && data.color.length > 0) {
    palette.color = data.color;
  }

  character.location.x = position.x - 25;
  character.location.y = position.y - 25;
  character.posZ = position.z ?? 0;
  character.setLocation('table');
  return character;
}

/** Export a GameCharacter as official CCFOLIA clipboard JSON object. */
export function toCcfoliaClipboardJson(character: GameCharacter): CharacterClipboardData {
  const data: Partial<CcfoliaCharacter> = {
    name: character.name || '',
    memo: '',
    initiative: 0,
    externalUrl: '',
    status: [],
    params: [],
    iconUrl: null,
    faces: [],
    angle: character.rotate || 0,
    width: character.size || 1,
    height: character.size || 1,
    secret: !!character.owner,
    invisible: false,
    hideStatus: false,
    color: '',
    commands: '',
    owner: null,
  };

  const detail = character.detailDataElement;
  if (detail) {
    const notes = detail.getElementsByType('note');
    if (notes.length > 0) {
      data.memo = notes.map(n => String(n.value ?? '')).filter(Boolean).join('\n\n');
    }

    const urls = detail.getElementsByType('url');
    if (urls.length > 0) {
      data.externalUrl = String(urls[0].value ?? '');
    }

    const resources = detail.getElementsByType('numberResource');
    data.status = resources.map(el => ({
      label: el.name || '',
      value: toFiniteNumber(el.currentValue, 0),
      max: toFiniteNumber(el.value, 0),
    }));

    data.params = collectParams(detail);
  }

  const common = character.commonDataElement;
  if (common) {
    const initiative = common.getFirstElementByName('initiative')
      || detail?.getFirstElementByName('initiative');
    if (initiative) {
      data.initiative = toFiniteNumber(initiative.value, 0);
    }
  }

  const palette = character.findChatPalette();
  if (palette) {
    data.commands = paletteSource(palette);
    if (palette.paletteColor) data.color = palette.paletteColor;
  }

  return { kind: 'character', data };
}

export function stringifyCcfoliaClipboard(character: GameCharacter): string {
  return JSON.stringify(toCcfoliaClipboardJson(character), null, 2);
}

function resolveSize(data: Partial<CcfoliaCharacter>): number {
  const w = typeof data.width === 'number' ? data.width : NaN;
  const h = typeof data.height === 'number' ? data.height : NaN;
  const raw = !Number.isNaN(w) && w > 0 ? w : (!Number.isNaN(h) && h > 0 ? h : 1);
  const size = Math.round(raw);
  return size > 0 ? size : 1;
}

function applyDetailFromCcfolia(character: GameCharacter, data: Partial<CcfoliaCharacter>) {
  const detail = character.detailDataElement;
  if (!detail) return;

  const statusList = Array.isArray(data.status) ? data.status : [];
  if (statusList.length > 0) {
    const group = DataElement.create('Status', '', {}, 'ccfolia_status_' + character.identifier);
    detail.appendChild(group);
    statusList.forEach((s, i) => {
      if (!s || typeof s !== 'object') return;
      const label = s.label != null ? String(s.label) : `status${i + 1}`;
      const max = toFiniteNumber(s.max, 0);
      const value = toFiniteNumber(s.value, max);
      group.appendChild(DataElement.create(
        label,
        max,
        { type: 'numberResource', currentValue: String(value) },
        `ccfolia_status_${i}_` + character.identifier
      ));
    });
  }

  const paramsList = Array.isArray(data.params) ? data.params : [];
  const hasInitiative = typeof data.initiative === 'number' && !Number.isNaN(data.initiative);
  if (paramsList.length > 0 || hasInitiative) {
    const group = DataElement.create('Params', '', {}, 'ccfolia_params_' + character.identifier);
    detail.appendChild(group);
    if (hasInitiative) {
      group.appendChild(DataElement.create(
        'initiative',
        data.initiative,
        { type: 'simpleNumber' },
        'ccfolia_initiative_' + character.identifier
      ));
    }
    paramsList.forEach((p, i) => {
      if (!p || typeof p !== 'object') return;
      const label = p.label != null ? String(p.label) : `param${i + 1}`;
      if (label.toLowerCase() === 'initiative' && hasInitiative) return;
      group.appendChild(DataElement.create(
        label,
        p.value != null ? String(p.value) : '',
        {},
        `ccfolia_param_${i}_` + character.identifier
      ));
    });
  }

  const memo = data.memo != null ? String(data.memo) : '';
  const externalUrl = data.externalUrl != null ? String(data.externalUrl) : '';
  if (memo || externalUrl) {
    const group = DataElement.create('Info', '', {}, 'ccfolia_info_' + character.identifier);
    detail.appendChild(group);
    if (memo) {
      group.appendChild(DataElement.create(
        'memo',
        memo,
        { type: 'note' },
        'ccfolia_memo_' + character.identifier
      ));
    }
    if (externalUrl) {
      group.appendChild(DataElement.create(
        'externalUrl',
        externalUrl,
        { type: 'url' },
        'ccfolia_url_' + character.identifier
      ));
    }
  }
}

function collectParams(detail: DataElement): { label: string; value: string }[] {
  const params: { label: string; value: string }[] = [];
  const skipNames = new Set(['memo', 'externalUrl']);

  const walk = (el: DataElement) => {
    for (const child of el.children) {
      if (!(child instanceof DataElement)) continue;
      const hasNested = child.children.some(c => c instanceof DataElement);
      if (hasNested) {
        walk(child);
        continue;
      }
      if (child.isNumberResource || child.isNote || child.isUrl || child.isCheckProperty) continue;
      if (child.type === 'image') continue;
      const name = child.name || '';
      if (!name || skipNames.has(name)) continue;
      params.push({ label: name, value: child.value == null ? '' : String(child.value) });
    }
  };
  walk(detail);
  return params;
}

function paletteSource(palette: ChatPalette): string {
  if (palette.value != null && String(palette.value).length > 0) {
    return String(palette.value);
  }
  return palette.getPalette().join('\n');
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
