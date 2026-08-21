import { Component, OnDestroy, OnInit } from '@angular/core';
import { EventSystem } from '@udonarium/core/system';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

export interface DropCreateChoice {
  id: string;
  label: string;
  icon?: string;
  hint?: string;
}

@Component({
  selector: 'app-drop-create-chooser',
  templateUrl: './drop-create-chooser.component.html',
  styleUrls: ['../shared/settings-ui.css', './drop-create-chooser.component.css'],
  standalone: false,
})
export class DropCreateChooserComponent implements OnInit, OnDestroy {
  title = '';
  text = '';
  help = '';
  okLabel = '';
  cancelLabel = '';
  choices: DropCreateChoice[] = [];
  choiceValue = '';

  constructor(
    private modalService: ModalService,
    private panelService: PanelService,
    private i18n: I18nService,
  ) {
    const opt = modalService.option || {};
    this.title = opt.title || '';
    this.text = opt.text || '';
    this.help = opt.help || '';
    this.okLabel = opt.okLabel || '';
    this.cancelLabel = opt.cancelLabel || '';
    this.choices = Array.isArray(opt.choices) ? opt.choices : [];
    this.choiceValue = opt.choiceValue != null
      ? String(opt.choiceValue)
      : (this.choices[0]?.id || '');
  }

  ngOnInit() {
    // Defer title write so ModalComponent's first CD does not see a mid-cycle change (NG0100).
    Promise.resolve().then(() => this.refreshTitle());
    EventSystem.register(this).on('LOCALE_CHANGED', () => this.refreshTitle());
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  select(id: string) {
    this.choiceValue = id;
  }

  confirm(id?: string) {
    if (id) this.choiceValue = id;
    if (!this.choiceValue) return;
    this.modalService.resolve({ choice: this.choiceValue });
  }

  cancel() {
    this.modalService.resolve(false);
  }

  private refreshTitle() {
    const base = this.i18n.t('dropCreate.title');
    this.modalService.title = this.panelService.title = this.title
      ? `${base}〈${this.title}〉`
      : base;
  }
}
