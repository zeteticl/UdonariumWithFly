import { classifyNoteFile, NOTE_FILE_ACCEPT } from './note-file-kind';

function fakeFile(name: string, type = ''): File {
  return new File([new Blob(['x'])], name, { type });
}

describe('classifyNoteFile', () => {
  it('classifies pdf by MIME or extension', () => {
    expect(classifyNoteFile(fakeFile('a.pdf', 'application/pdf'))).toBe('pdf');
    expect(classifyNoteFile(fakeFile('a.PDF'))).toBe('pdf');
  });

  it('classifies images including apng ico jfif', () => {
    expect(classifyNoteFile(fakeFile('x.png', 'image/png'))).toBe('image');
    expect(classifyNoteFile(fakeFile('x.apng'))).toBe('image');
    expect(classifyNoteFile(fakeFile('x.ico'))).toBe('image');
    expect(classifyNoteFile(fakeFile('x.jfif'))).toBe('image');
  });

  it('classifies video extensions and video/ogg MIME', () => {
    expect(classifyNoteFile(fakeFile('a.mp4', 'video/mp4'))).toBe('video');
    expect(classifyNoteFile(fakeFile('a.ogv'))).toBe('video');
    expect(classifyNoteFile(fakeFile('a.ogg', 'video/ogg'))).toBe('video');
  });

  it('does not treat audio/ogg as note video', () => {
    expect(classifyNoteFile(fakeFile('a.ogg', 'audio/ogg'))).toBeNull();
    expect(classifyNoteFile(fakeFile('a.ogg'))).toBeNull();
  });

  it('classifies expanded text extensions', () => {
    expect(classifyNoteFile(fakeFile('a.md'))).toBe('text');
    expect(classifyNoteFile(fakeFile('a.markdown'))).toBe('text');
    expect(classifyNoteFile(fakeFile('a.yaml'))).toBe('text');
    expect(classifyNoteFile(fakeFile('a.yml'))).toBe('text');
    expect(classifyNoteFile(fakeFile('a.tsv'))).toBe('text');
    expect(classifyNoteFile(fakeFile('a.log'))).toBe('text');
    expect(classifyNoteFile(fakeFile('a.rtf'))).toBe('text');
    expect(classifyNoteFile(fakeFile('a.json', 'application/json'))).toBe('text');
  });

  it('rejects unknown binaries', () => {
    expect(classifyNoteFile(fakeFile('a.exe'))).toBeNull();
    expect(classifyNoteFile(fakeFile('a.docx'))).toBeNull();
  });

  it('exports a non-empty accept string', () => {
    expect(NOTE_FILE_ACCEPT.indexOf('.markdown')).toBeGreaterThan(-1);
    expect(NOTE_FILE_ACCEPT.indexOf('.apng')).toBeGreaterThan(-1);
  });
});
