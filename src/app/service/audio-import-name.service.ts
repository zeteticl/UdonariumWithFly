import { Injectable, NgZone } from '@angular/core';
import * as localForage from 'localforage';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { audioFileBaseName, readAudioTagTitle } from '@udonarium/core/file-storage/audio-tag-title';
import { I18nService } from './i18n.service';
import { ModalService } from './modal.service';

export type AudioImportNameChoice = 'filename' | 'tag';

export interface AudioImportNameResult {
  choice: AudioImportNameChoice;
  remember: boolean;
}

const STORAGE_KEY = 'AudioImportName.preference.v1';

@Injectable({ providedIn: 'root' })
export class AudioImportNameService {
  /** Set from DI so FileArchiver (non-Angular) can resolve names. */
  static instance: AudioImportNameService | null = null;

  private remembered: AudioImportNameChoice | null | undefined = undefined;
  /** Applies to remaining files in the current FileArchiver.load() batch when not remembered. */
  private batchChoice: AudioImportNameChoice | null = null;
  private askLock: Promise<void> = Promise.resolve();

  constructor(
    private modalService: ModalService,
    private i18n: I18nService,
    private ngZone: NgZone,
  ) {
    AudioImportNameService.instance = this;
  }

  beginBatch() {
    this.batchChoice = null;
  }

  endBatch() {
    this.batchChoice = null;
  }

  async resolveDisplayName(file: File): Promise<string> {
    const fileName = audioFileBaseName(file.name);
    const tagTitle = (await readAudioTagTitle(file)).trim();
    const remembered = await this.getRemembered();
    if (remembered === 'filename') return fileName;
    if (remembered === 'tag') return tagTitle || fileName;
    if (this.batchChoice === 'filename') return fileName;
    if (this.batchChoice === 'tag') return tagTitle || fileName;

    // Nothing to choose — keep filename silently.
    if (!tagTitle || tagTitle === fileName) return fileName;

    const result = await this.askUser(fileName, tagTitle);
    if (!result) return fileName;
    if (result.remember) {
      await this.setRemembered(result.choice);
    } else if (!this.batchChoice) {
      this.batchChoice = result.choice;
    }
    return result.choice === 'tag' ? tagTitle : fileName;
  }

  private async getRemembered(): Promise<AudioImportNameChoice | null> {
    if (this.remembered !== undefined) return this.remembered;
    try {
      const v = await localForage.getItem<string>(STORAGE_KEY);
      this.remembered = (v === 'filename' || v === 'tag') ? v : null;
    } catch {
      this.remembered = null;
    }
    return this.remembered;
  }

  private async setRemembered(choice: AudioImportNameChoice) {
    this.remembered = choice;
    try {
      await localForage.setItem(STORAGE_KEY, choice);
    } catch { /* ignore */ }
  }

  /** Clear remembered preference (settings / debug). */
  async clearRemembered() {
    this.remembered = null;
    this.batchChoice = null;
    try {
      await localForage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }

  private askUser(fileName: string, tagTitle: string): Promise<AudioImportNameResult | null> {
    // Serialize dialogs; after the first choice, later files reuse batch/remembered prefs.
    const run = this.askLock.then(async () => {
      const remembered = await this.getRemembered();
      if (remembered === 'filename' || remembered === 'tag') {
        return { choice: remembered, remember: false };
      }
      if (this.batchChoice === 'filename' || this.batchChoice === 'tag') {
        return { choice: this.batchChoice, remember: false };
      }
      return this.openAskDialog(fileName, tagTitle);
    });
    this.askLock = run.then(() => undefined, () => undefined);
    return run;
  }

  private openAskDialog(fileName: string, tagTitle: string): Promise<AudioImportNameResult | null> {
    return this.ngZone.run(async () => {
      if (!ModalService.defaultParentViewContainerRef) return null;
      const result = await this.modalService.open<AudioImportNameResult | false>(ConfirmationComponent, {
        title: this.i18n.t('jukebox.importName.title'),
        text: this.i18n.t('jukebox.importName.text'),
        help: this.i18n.t('jukebox.importName.help', { file: fileName, tag: tagTitle }),
        materialIcon: 'audio_file',
        type: ConfirmationType.OK_CANCEL,
        okLabel: this.i18n.t('confirm.ok'),
        cancelLabel: this.i18n.t('confirm.cancel'),
        choices: [
          { id: 'filename', label: this.i18n.t('jukebox.importName.useFilename', { name: fileName }) },
          { id: 'tag', label: this.i18n.t('jukebox.importName.useTag', { name: tagTitle }) },
        ],
        choiceValue: 'tag',
        rememberLabel: this.i18n.t('jukebox.importName.remember'),
        rememberValue: false,
      });
      if (!result || typeof result !== 'object') return null;
      if (result.choice !== 'filename' && result.choice !== 'tag') return null;
      return { choice: result.choice, remember: !!result.remember };
    });
  }
}
