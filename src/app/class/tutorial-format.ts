/** Segment of a tutorial help line (plain text, keyboard badge, link, or version). */
export type TutorialSeg =
  | { kind: 'text'; text: string }
  | { kind: 'kbd'; text: string }
  | { kind: 'sep'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'ver'; text: string };

export interface TutorialLineView {
  segs: TutorialSeg[];
  isBullet: boolean;
  /**
   * Foundry-style two columns: label (left) | control / link (right).
   * @see https://foundryvtt.com/article/controls/
   */
  columns?: { label: TutorialSeg[]; control: TutorialSeg[] };
}

const MOD = 'Ctrl|Alt|Shift|Cmd|Command|Meta';
const SHORT_KEY = '[A-Za-z\\[\\]←→↑↓]';
const MOUSE_KEY =
  '左鍵|右鍵|中鍵|滾輪|双击|雙擊|' +
  'Left[- ]Click|Right[- ]Click|Middle[- ]Click|Mouse[- ]Wheel|Wheel|Double[- ]Click|Drag|Drop';
const NAMED_KEY =
  'PageUp|PageDown|Delete|Backspace|Enter|Return|Escape|Esc|Space|Tab|Home|End|Insert|' +
  `${MOUSE_KEY}|` +
  '方向鍵|箭头键|矢印|WASD|Numpad\\+|Numpad-|' +
  '1[–-]9|↑|↓|←|→|\\[|\\]';
const KEY_ATOM = `(?:${NAMED_KEY}|${SHORT_KEY}|[0-9])`;
const MOUSE_KEY_ONLY = new RegExp(`^(?:${MOUSE_KEY})$`);

/** Semver / product version — must never become gray keycaps. */
const VERSION_RE = /(?:BCDice\s+)?\d+\.\d+(?:\.\d+)?[a-zA-Z]?(?:\b|(?=[\s）】\]）,，。]|$))/g;

/**
 * Expand Mod＋A／B／C → Mod＋A　Mod＋B　Mod＋C (Foundry-style separate chords).
 * Mouse-button alternatives (左鍵／右鍵) stay one gesture — do not split into two Ctrl rows.
 * @see https://foundryvtt.com/article/controls/
 */
export function expandChordLists(input: string): string {
  if (!input) return '';
  let text = input;

  text = text.replace(
    new RegExp(
      `((?:(?:${MOD})(?:\\s*[＋+]\\s*(?:${MOD}))*)\\s*[＋+]\\s*)` +
        `(${KEY_ATOM})` +
        `((?:\\s*[／/]\\s*${KEY_ATOM})+)`,
      'g'
    ),
    (full, prefix: string, first: string, rest: string) => {
      const keys = [first, ...rest.split(/\s*[／/]\s*/).filter(Boolean)];
      if (keys.every(k => MOUSE_KEY_ONLY.test(k))) return full;
      return keys.map(k => `${String(prefix).replace(/\s*$/, '')}${k}`).join('　');
    }
  );

  text = text.replace(
    new RegExp(`(${NAMED_KEY})(?:\\s*[／/]\\s*(${NAMED_KEY}))+`, 'g'),
    (full) => {
      const parts = full.split(/\s*[／/]\s*/);
      if (parts.some(p => new RegExp(`^(?:${MOD})$`).test(p))) return full;
      if (parts.every(p => MOUSE_KEY_ONLY.test(p))) return full;
      return parts.join('　');
    }
  );

  text = text.replace(
    /(?<![A-Za-z])([A-Za-z\[\]])(?:\s*[／/]\s*([A-Za-z\[\]]))+(?![A-Za-z])/g,
    (full) => full.split(/\s*[／/]\s*/).join('　')
  );

  return text;
}

/**
 * Tokenize a help line into text / kbd / link / version segments.
 * Version numbers (1.13.2, BCDice 4.9.0) stay as soft ver chips — never gray kbd.
 */
export function tokenizeTutorialLine(raw: string): TutorialSeg[] {
  const line = expandChordLists((raw || '').trim());
  if (!line) return [];

  const { masked, versions } = maskVersions(line);
  const { masked: masked2, urls } = maskUrls(masked);

  const chordRe = new RegExp(
    [
      // Modifier chords: Ctrl＋C, Alt＋滾輪, Ctrl＋左鍵／右鍵, Ctrl＋Shift＋D
      `(?:(?:${MOD})(?:\\s*[＋+]\\s*(?:${MOD}))*(?:\\s*[＋+]\\s*${KEY_ATOM}(?:\\s*[／/]\\s*${KEY_ATOM})*)+)`,
      // Named keys including 1–9 range (and 左鍵／右鍵 kept together)
      `(?:${NAMED_KEY}(?:\\s*[／/]\\s*${NAMED_KEY})*)`,
      // Isolated hotkeys / brackets only — NEVER lone digits (avoids 1.13.2 / 4.9.0)
      // Restrict letters so placeholders like「第 N 個」stay plain text
      `(?<![A-Za-z0-9.])(?:[WASDQERFLHZYCXV\\[\\]])(?![A-Za-z0-9.])`,
    ].join('|'),
    'g'
  );

  const segs: TutorialSeg[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = chordRe.exec(masked2)) !== null) {
    const start = match.index;
    const token = match[0];
    if (start > last) pushText(segs, masked2.slice(last, start));
    pushChord(segs, token);
    last = start + token.length;
  }
  if (last < masked2.length) pushText(segs, masked2.slice(last));

  let result: TutorialSeg[] = segs.length ? segs : [{ kind: 'text', text: masked2 }];
  result = unmaskPlaceholders(result, urls, 'link');
  result = unmaskPlaceholders(result, versions, 'ver');
  return mergeAdjacentText(result);
}

/** Build a scannable line: Foundry-style label | control columns when possible. */
export function buildTutorialLineView(raw: string, isBullet: boolean): TutorialLineView {
  const cleaned = isBullet ? bulletText(raw) : raw;
  const split = splitActionMeaning(cleaned);
  if (split) {
    if (split.kind === 'control') {
      // 動作＝說明 → label=說明, control=動作 (Foundry order)
      return {
        segs: [],
        isBullet,
        columns: {
          label: tokenizeTutorialLine(split.right),
          control: tokenizeTutorialLine(split.left),
        },
      };
    }
    // 標籤：URL → label=標籤, control=URL
    return {
      segs: [],
      isBullet,
      columns: {
        label: tokenizeTutorialLine(split.left),
        control: tokenizeTutorialLine(split.right),
      },
    };
  }
  return { segs: tokenizeTutorialLine(cleaned), isBullet };
}

function splitActionMeaning(
  text: string
): { left: string; right: string; kind: 'control' | 'link' } | null {
  const eq = text.search(/[＝=]/);
  if (eq > 0 && eq < text.length - 1) {
    const left = text.slice(0, eq).trim();
    const right = text.slice(eq + 1).trim();
    if (left && right && !/^https?:\/\//i.test(left)) {
      return { left, right, kind: 'control' };
    }
  }
  // Link rows: 本站：https://…
  const colon = text.search(/[：:]/);
  if (colon > 0 && colon < text.length - 1) {
    const left = text.slice(0, colon).trim();
    const right = text.slice(colon + 1).trim();
    if (left && /^https?:\/\//i.test(right)) {
      return { left, right, kind: 'link' };
    }
  }
  return null;
}

function maskVersions(text: string): { masked: string; versions: string[] } {
  const versions: string[] = [];
  const masked = text.replace(VERSION_RE, (m) => {
    const i = versions.length;
    versions.push(m);
    return `\uE000V${i}\uE001`;
  });
  return { masked, versions };
}

function maskUrls(text: string): { masked: string; urls: string[] } {
  const urls: string[] = [];
  const masked = text.replace(/https?:\/\/[^\s<>"']+/gi, (m) => {
    let raw = m;
    let trail = '';
    const trim = raw.match(/^(.*?)([.,;:!?。，、；：！？）】〉》」』]+)$/u);
    if (trim) {
      raw = trim[1];
      trail = trim[2];
    }
    const i = urls.length;
    urls.push(raw);
    return `\uE000U${i}\uE001${trail}`;
  });
  return { masked, urls };
}

function unmaskPlaceholders(
  segs: TutorialSeg[],
  values: string[],
  kind: 'link' | 'ver'
): TutorialSeg[] {
  if (!values.length) return segs;
  const out: TutorialSeg[] = [];
  const re = kind === 'link' ? /\uE000U(\d+)\uE001/g : /\uE000V(\d+)\uE001/g;
  for (const seg of segs) {
    if (seg.kind !== 'text') {
      out.push(seg);
      continue;
    }
    let last = 0;
    let m: RegExpExecArray | null;
    const text = seg.text;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
      const val = values[Number(m[1])];
      if (kind === 'link') out.push({ kind: 'link', text: val, href: val });
      else out.push({ kind: 'ver', text: val });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  }
  return out.length ? out : segs;
}

function mergeAdjacentText(segs: TutorialSeg[]): TutorialSeg[] {
  const out: TutorialSeg[] = [];
  for (const seg of segs) {
    const last = out[out.length - 1];
    if (seg.kind === 'text' && last?.kind === 'text') last.text += seg.text;
    else out.push({ ...seg });
  }
  return out;
}

export function linkifyPlainText(text: string): TutorialSeg[] {
  return tokenizeTutorialLine(text);
}

function pushChord(segs: TutorialSeg[], token: string) {
  const parts = token.split(/\s*[＋+]\s*/).filter(Boolean);
  if (parts.length <= 1) {
    pushKeyOrAlt(segs, token);
    return;
  }
  parts.forEach((part, i) => {
    if (i > 0) segs.push({ kind: 'sep', text: '+' });
    pushKeyOrAlt(segs, part);
  });
}

/** Mouse-button alternatives stay one chord: 左鍵／右鍵 → kbd / kbd */
function pushKeyOrAlt(segs: TutorialSeg[], token: string) {
  const alts = token.split(/\s*[／/]\s*/).filter(Boolean);
  if (alts.length > 1 && alts.every(a => MOUSE_KEY_ONLY.test(a))) {
    alts.forEach((a, i) => {
      if (i > 0) segs.push({ kind: 'sep', text: '/' });
      segs.push({ kind: 'kbd', text: normalizeKeyLabel(a) });
    });
    return;
  }
  segs.push({ kind: 'kbd', text: normalizeKeyLabel(token) });
}

function normalizeKeyLabel(key: string): string {
  const map: Record<string, string> = {
    Escape: 'Esc',
    escape: 'Esc',
    Return: 'Enter',
    'Left Click': 'Left Click',
    'Left-Click': 'Left Click',
    'Right Click': 'Right Click',
    'Right-Click': 'Right Click',
    'Middle Click': 'Middle Click',
    'Middle-Click': 'Middle Click',
    'Mouse Wheel': 'Wheel',
    'Mouse-Wheel': 'Wheel',
    Wheel: 'Wheel',
  };
  return map[key] || key;
}

function pushText(segs: TutorialSeg[], text: string) {
  if (!text) return;
  const last = segs[segs.length - 1];
  if (last?.kind === 'text') last.text += text;
  else segs.push({ kind: 'text', text });
}

/** Expand one physical line that packs several「動作＝說明」chunks. */
export function expandPackedActionLines(line: string): string[] {
  if (!line) return [];
  const bullet = isBulletLine(line);
  const body = bullet ? bulletText(line) : line;
  const parts = body.split(/　+|\s{2,}/).map(s => s.trim()).filter(Boolean);
  const isActionChunk = (p: string) => {
    const eq = p.search(/[＝=]/);
    return eq > 0 && eq < p.length - 1;
  };
  if (parts.length > 1 && parts.every(isActionChunk)) {
    return parts.map(p => (bullet ? `・${p}` : p));
  }
  // Also allow packing with 「；」 when every segment is action＝meaning
  const semiParts = body.split(/[；;]/).map(s => s.trim()).filter(Boolean);
  if (semiParts.length > 1 && semiParts.every(isActionChunk)) {
    return semiParts.map(p => (bullet ? `・${p}` : p));
  }
  return [line];
}

export function isBulletLine(line: string): boolean {
  return /^[・•●▪◦\-–—]/.test(line);
}

export function bulletText(line: string): string {
  return line.replace(/^[・•●▪◦\-–—]\s*/, '');
}
