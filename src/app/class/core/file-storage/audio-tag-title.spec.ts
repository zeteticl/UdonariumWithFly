import { looksLikeUtf8, audioFileBaseName } from './audio-tag-title';

describe('audio-tag-title encoding', () => {
  it('audioFileBaseName strips path and extension', () => {
    expect(audioFileBaseName('C:\\music\\theme.mp3')).toBe('theme');
    expect(audioFileBaseName('曲名.ogg')).toBe('曲名');
  });

  it('detects UTF-8 CJK mislabelled as Latin-1 bytes', () => {
    // UTF-8 for 変な画面
    const utf8 = new TextEncoder().encode('変な画面');
    expect(looksLikeUtf8(utf8)).toBe(true);
    // Same bytes are NOT valid as needing latin1-only path when we prefer utf8
    const latin1Mojibake = new TextDecoder('latin1').decode(utf8);
    expect(latin1Mojibake).toContain('å');
  });

  it('rejects typical Shift_JIS lead bytes as UTF-8', () => {
    // Shift_JIS "音楽" ≈ 0x89 0xB9 0x8A 0x79 — often invalid UTF-8
    const sjis = new Uint8Array([0x89, 0xb9, 0x8a, 0x79]);
    expect(looksLikeUtf8(sjis)).toBe(false);
  });

  it('accepts ASCII as UTF-8', () => {
    expect(looksLikeUtf8(new TextEncoder().encode('Theme Song'))).toBe(true);
  });
});

describe('decodeLegacy via ID3 TIT2 frame', () => {
  async function titleFromId3v23(titleBytes: Uint8Array, encodingByte: number): Promise<string> {
    const { readAudioTagTitle } = await import('./audio-tag-title');
    // Build minimal ID3v2.3 with TIT2
    const frameBody = new Uint8Array(1 + titleBytes.length);
    frameBody[0] = encodingByte;
    frameBody.set(titleBytes, 1);
    const frameSize = frameBody.length;
    const header = new Uint8Array(10 + 10 + frameSize);
    // ID3 v2.3.0
    header.set([0x49, 0x44, 0x33, 3, 0, 0], 0);
    const tagSize = 10 + frameSize; // one frame header + body
    // synchsafe size of tag body (frames only)
    const ss = tagSize;
    header[6] = (ss >> 21) & 0x7f;
    header[7] = (ss >> 14) & 0x7f;
    header[8] = (ss >> 7) & 0x7f;
    header[9] = ss & 0x7f;
    // TIT2 frame
    header.set([0x54, 0x49, 0x54, 0x32], 10); // TIT2
    header[14] = (frameSize >> 24) & 0xff;
    header[15] = (frameSize >> 16) & 0xff;
    header[16] = (frameSize >> 8) & 0xff;
    header[17] = frameSize & 0xff;
    header[18] = 0;
    header[19] = 0;
    header.set(frameBody, 20);
    const blob = new Blob([header]);
    return readAudioTagTitle(blob);
  }

  it('reads UTF-8 title marked as ISO-8859-1 (encoding 0)', async () => {
    const utf8 = new TextEncoder().encode('変な画面');
    await expectAsync(titleFromId3v23(utf8, 0)).toBeResolvedTo('変な画面');
  });

  it('reads UTF-8 title with encoding 3', async () => {
    const utf8 = new TextEncoder().encode('バトルテーマ');
    await expectAsync(titleFromId3v23(utf8, 3)).toBeResolvedTo('バトルテーマ');
  });
});
