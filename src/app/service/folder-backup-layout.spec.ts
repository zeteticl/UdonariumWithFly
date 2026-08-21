import {
  STATE_FILE_NAMES,
  computeStateFingerprint,
  isMediaFileName,
  mediaHashFromName,
  sha256Hex,
  shouldSkipStateZipWrite,
} from './folder-backup-layout';

describe('folder-backup-layout', () => {
  it('STATE_FILE_NAMES includes fly_data.xml and scene files', () => {
    expect(STATE_FILE_NAMES.has('fly_data.xml')).toBeTrue();
    expect(STATE_FILE_NAMES.has('fly_scenePerm.xml')).toBeTrue();
    expect(STATE_FILE_NAMES.has('fly_scenarioText.xml')).toBeTrue();
    expect(STATE_FILE_NAMES.has('fly_scenePreset.xml')).toBeTrue();
  });

  it('isMediaFileName rejects state files and accepts content-hash blobs', () => {
    expect(isMediaFileName('fly_data.xml')).toBeFalse();
    expect(isMediaFileName('manifest.json')).toBeFalse();
    expect(isMediaFileName('preview.jpg')).toBeFalse();
    const hash = 'a'.repeat(64);
    expect(isMediaFileName(`${hash}.png`)).toBeTrue();
    expect(isMediaFileName('not-a-hash.png')).toBeFalse();
  });

  it('mediaHashFromName strips extension', () => {
    const hash = 'b'.repeat(64);
    expect(mediaHashFromName(`${hash}.jpg`)).toBe(hash);
  });

  it('sha256Hex is stable for the same payload (fingerprint skip input)', async () => {
    const a = await sha256Hex('fly_data.xml-content');
    const b = await sha256Hex('fly_data.xml-content');
    const c = await sha256Hex('fly_data.xml-changed');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.length).toBe(64);
  });

  it('computeStateFingerprint is order-independent and stable', async () => {
    const a = await computeStateFingerprint({
      'fly_chat.xml': 'aaa',
      'fly_data.xml': 'bbb',
    });
    const b = await computeStateFingerprint({
      'fly_data.xml': 'bbb',
      'fly_chat.xml': 'aaa',
    });
    const c = await computeStateFingerprint({
      'fly_chat.xml': 'aaa',
      'fly_data.xml': 'CHANGED',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('shouldSkipStateZipWrite only when fingerprints match', () => {
    expect(shouldSkipStateZipWrite('abc', 'abc')).toBeTrue();
    expect(shouldSkipStateZipWrite('abc', 'xyz')).toBeFalse();
    expect(shouldSkipStateZipWrite('abc', '')).toBeFalse();
    expect(shouldSkipStateZipWrite('', '')).toBeFalse();
  });
});
