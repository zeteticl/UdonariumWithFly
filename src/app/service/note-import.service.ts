import { Injectable } from '@angular/core';

import { IMAGE_SOURCE_MAX_BYTES } from '@udonarium/core/file-storage/image-normalize';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { PdfStorage } from '@udonarium/core/file-storage/pdf-storage';
import { VideoStorage } from '@udonarium/core/file-storage/video-storage';
import { classifyNoteFile } from '@udonarium/note-file-kind';
import { a4HeightForWidth } from '@udonarium/table-fx/push-pin.util';
import { TableSelecter } from '@udonarium/table-selecter';
import { TextNote } from '@udonarium/text-note';

import { PointerCoordinate } from 'service/pointer-device.service';

const MEGA = 1024 * 1024;
/** Tabletop PDF paper width in grids — small enough to place, large enough to read mid-zoom. */
const PDF_NOTE_DEFAULT_WIDTH = 10;

@Injectable({ providedIn: 'root' })
export class NoteImportService {
  async importFiles(files: FileList | File[], options?: {
    addToTable?: boolean;
    position?: PointerCoordinate;
  }): Promise<TextNote[]> {
    const list = Array.from(files || []);
    const created: TextNote[] = [];
    let placed = 0;
    const flatOnTable = !!TableSelecter.instance.viewTable?.is2DMode;
    for (const file of list) {
      const note = await this.importOne(file);
      if (!note) continue;
      if (flatOnTable) note.isUpright = false;
      if (options?.addToTable !== false) {
        if (options?.position) {
          const col = placed % 5;
          const row = Math.floor(placed / 5);
          note.location.x = options.position.x + col * 50;
          note.location.y = options.position.y + row * 50;
          note.posZ = options.position.z;
          placed++;
        }
        note.addToTable();
      } else {
        note.setLocation('common');
      }
      created.push(note);
    }
    return created;
  }

  private async importOne(file: File): Promise<TextNote | null> {
    if (!file) return null;
    const name = (file.name || '').replace(/\.[^.]+$/, '') || 'Note';
    const kind = classifyNoteFile(file);
    if (!kind) return null;

    if (kind === 'pdf') {
      if (file.size > 20 * MEGA) return null;
      const pdf = await PdfStorage.instance.addAsync(file);
      const w = PDF_NOTE_DEFAULT_WIDTH;
      const note = TextNote.create(name, '', 14, w, a4HeightForWidth(w));
      note.setPdf(pdf.identifier);
      return note;
    }

    if (kind === 'video') {
      if (file.size > 50 * MEGA) return null;
      const video = await VideoStorage.instance.addAsync(file);
      const note = TextNote.create(name, '', 14, 5, 4);
      note.setVideo(video.identifier);
      return note;
    }

    if (kind === 'image') {
      if (file.size > IMAGE_SOURCE_MAX_BYTES) return null;
      const image = await ImageStorage.instance.addAsync(file);
      const note = TextNote.create(name, '', 14, 3, 3);
      note.setFrontImage(image.identifier);
      note.contentMode = 'image';
      return note;
    }

    const text = await file.text();
    return TextNote.create(name, text.slice(0, 20000), 14, 3, 3);
  }
}
