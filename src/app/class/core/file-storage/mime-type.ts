export namespace MimeType {
  const types = {
    avif: 'image/avif',
    gif: 'image/gif',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    jpe: 'image/jpeg',
    jfif: 'image/jpeg',
    pjpeg: 'image/jpeg',
    pjp: 'image/jpeg',
    png: 'image/png',
    apng: 'image/apng',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    svgz: 'image/svg+xml',
    ico: 'image/x-icon',
    cur: 'image/x-icon',
    bmp: 'image/bmp',
    html: 'text/html',
    htm: 'text/html',
    shtml: 'text/html',
    xml: 'text/xml',
    yml: 'text/yaml',
    yaml: 'text/yaml',
    json: 'application/json',
    map: 'application/json',
    zip: 'application/zip',
    pdf: 'application/pdf',
    // Audio — extensions here must round-trip to audio/* via type(), never video/*.
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    opus: 'audio/opus',
    flac: 'audio/flac',
    weba: 'audio/webm',
    // Video
    mpg: 'video/mpeg',
    mpeg: 'video/mpeg',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    m4v: 'video/mp4',
    ogv: 'video/ogg',
  };

  /** Subtypes / aliases that must never be used as on-disk audio extensions. */
  const VIDEO_COLLIDING_AUDIO_SUBTYPES: { [subtype: string]: string } = {
    mpeg: 'mp3',
    mp3: 'mp3',
    mp4: 'm4a',
    webm: 'weba',
  };

  /** Canonical MIME (no parameters) → safe audio file extension. */
  const AUDIO_EXT_BY_MIME: { [mime: string]: string } = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/ogg': 'ogg',
    'audio/vorbis': 'ogg',
    'audio/opus': 'opus',
    'audio/aac': 'aac',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/webm': 'weba',
  };

  const AUDIO_EXTS = new Set([
    'mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'weba',
  ]);

  export function type(fileName: string): string {
    let ext = fileName.replace(/.*[\.\/\\]/, '').toLowerCase();
    return types[ext] ? types[ext] : '';
  }

  export function extension(mimeType: string): string {
    const normalized = stripMimeParams(mimeType);
    if (normalized.indexOf('audio/') === 0) {
      return audioExtension(normalized);
    }
    for (let key in types) {
      if (types[key] === normalized) {
        return key;
      }
    }
    return normalized.split('/')[1] || '';
  }

  /**
   * Extension used when packing AudioStorage blobs into ZIP / folder media.
   * Never returns mpeg/mpg/mp4/webm (those reload as video/*).
   */
  export function audioExtension(mimeType: string): string {
    const normalized = stripMimeParams(mimeType);
    if (AUDIO_EXT_BY_MIME[normalized]) return AUDIO_EXT_BY_MIME[normalized];
    if (normalized.indexOf('audio/') === 0) {
      const subtype = normalized.slice('audio/'.length).replace(/^x-/, '');
      if (VIDEO_COLLIDING_AUDIO_SUBTYPES[subtype]) {
        return VIDEO_COLLIDING_AUDIO_SUBTYPES[subtype];
      }
      if (subtype && /^[a-z0-9]+$/i.test(subtype)) return subtype;
    }
    return 'mp3';
  }

  /** MIME to store on the packed File (always audio/* for known audio). */
  export function audioMimeForExtension(ext: string): string {
    const e = (ext || '').toLowerCase();
    if (types[e] && String(types[e]).indexOf('audio/') === 0) return types[e];
    return 'audio/mpeg';
  }

  export function isAudioMime(mimeType: string): boolean {
    return stripMimeParams(mimeType).indexOf('audio/') === 0;
  }

  export function isAudioExtension(ext: string): boolean {
    return AUDIO_EXTS.has((ext || '').toLowerCase());
  }

  export function fileBaseName(fileName: string): string {
    return (fileName || '').split(/[\\/]/).pop() || '';
  }

  export function fileExtension(fileName: string): string {
    const base = fileBaseName(fileName);
    const i = base.lastIndexOf('.');
    return i >= 0 ? base.slice(i + 1).toLowerCase() : '';
  }

  /**
   * Legacy buggy saves: browser MP3 (audio/mpeg) was written as "<sha256>.mpeg",
   * which MimeType.type maps to video/mpeg. Only this hashed form is recovered as audio.
   */
  export function isLegacyMisnamedAudioFile(fileName: string): boolean {
    return /^[a-f0-9]{64}\.mpeg$/i.test(fileBaseName(fileName));
  }

  /**
   * Room ZIP / folder media blobs are stored as "<sha256>.<ext>".
   * These must restore via fly_audioLibrary.xml — not re-run the import-name picker.
   */
  export function isRoomPackedAudioFileName(fileName: string): boolean {
    return /^[a-f0-9]{64}\.[A-Za-z0-9]+$/i.test(fileBaseName(fileName));
  }

  /** True when ZIP / drop / folder restore should import this file as jukebox audio. */
  export function isAudioFile(file: { name?: string; type?: string }): boolean {
    if (isAudioMime(file?.type || '')) return true;
    if (isAudioExtension(fileExtension(file?.name || ''))) return true;
    if (isLegacyMisnamedAudioFile(file?.name || '')) return true;
    return false;
  }

  function stripMimeParams(mimeType: string): string {
    return (mimeType || '').toLowerCase().split(';')[0].trim();
  }
}
