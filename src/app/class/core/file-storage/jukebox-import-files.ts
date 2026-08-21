import { MimeType } from './mime-type';

export type JukeboxImportRejectReason = 'tooLarge' | 'notAudio';

export type JukeboxImportReject = {
  name: string;
  reason: JukeboxImportRejectReason;
};

/** Split OS file drops into audio that FileArchiver may import vs. skipped files. */
export function partitionJukeboxImportFiles(
  files: File[],
  maxAudioBytes: number,
): { accepted: File[]; rejected: JukeboxImportReject[] } {
  const accepted: File[] = [];
  const rejected: JukeboxImportReject[] = [];
  for (const file of files) {
    if (!MimeType.isAudioFile(file)) {
      rejected.push({ name: file.name, reason: 'notAudio' });
      continue;
    }
    if (file.size > maxAudioBytes) {
      rejected.push({ name: file.name, reason: 'tooLarge' });
      continue;
    }
    accepted.push(file);
  }
  return { accepted, rejected };
}

export function formatJukeboxImportRejectLines(
  rejects: JukeboxImportReject[],
  t: (key: string, params?: { [key: string]: string | number }) => string,
  maxMb: number,
): string[] {
  return rejects.map(r => {
    if (r.reason === 'tooLarge') {
      return t('jukebox.reject.tooLarge', { name: r.name, max: maxMb });
    }
    return t('jukebox.reject.notAudio', { name: r.name });
  });
}
