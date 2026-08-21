import { formatJukeboxImportRejectLines, partitionJukeboxImportFiles } from './jukebox-import-files';

function fakeFile(name: string, size: number, type = 'audio/mpeg'): File {
  const blob = new Blob([new Uint8Array(Math.min(size, 8))], { type });
  return new File([blob], name, { type });
}

describe('partitionJukeboxImportFiles', () => {
  const max = 20 * 1024 * 1024;

  it('accepts audio under the size cap', () => {
    const ok = fakeFile('a.mp3', 1000);
    const { accepted, rejected } = partitionJukeboxImportFiles([ok], max);
    expect(accepted).toEqual([ok]);
    expect(rejected).toEqual([]);
  });

  it('rejects oversized audio', () => {
    const big = fakeFile('big.mp3', max + 1);
    Object.defineProperty(big, 'size', { value: max + 1 });
    const { accepted, rejected } = partitionJukeboxImportFiles([big], max);
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([{ name: 'big.mp3', reason: 'tooLarge' }]);
  });

  it('rejects non-audio', () => {
    const img = fakeFile('x.png', 100, 'image/png');
    const { accepted, rejected } = partitionJukeboxImportFiles([img], max);
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([{ name: 'x.png', reason: 'notAudio' }]);
  });
});

describe('formatJukeboxImportRejectLines', () => {
  it('formats reasons with i18n params', () => {
    const lines = formatJukeboxImportRejectLines(
      [
        { name: 'a.mp3', reason: 'tooLarge' },
        { name: 'b.png', reason: 'notAudio' },
      ],
      (key, params) => `${key}:${params?.['name']}:${params?.['max'] ?? ''}`,
      20,
    );
    expect(lines[0]).toContain('jukebox.reject.tooLarge');
    expect(lines[0]).toContain('a.mp3');
    expect(lines[0]).toContain('20');
    expect(lines[1]).toContain('jukebox.reject.notAudio');
  });
});
