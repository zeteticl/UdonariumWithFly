import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';

import { EventSystem, Network } from '@udonarium/core/system';
import { RangeArea } from '@udonarium/range';

import { I18nService } from 'service/i18n.service';
import { PanelService } from 'service/panel.service';
import { SaveDataService } from 'service/save-data.service';

@Component({
  selector: 'range-settings',
  templateUrl: './range-settings.component.html',
  styleUrls: ['../shared/settings-ui.css', '../shared/object-settings.css', './range-settings.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class RangeSettingsComponent implements OnInit, OnChanges, OnDestroy {
  @Input() range: RangeArea = null;

  isSaveing = false;
  progresPercent = 0;

  readonly typeOptions = [
    { value: 'CORN', labelKey: 'range.settings.typeCorn' },
    { value: 'LINE', labelKey: 'range.settings.typeLine' },
    { value: 'CIRCLE', labelKey: 'range.settings.typeCircle' },
    { value: 'SQUARE', labelKey: 'range.settings.typeSquare' },
    { value: 'DIAMOND', labelKey: 'range.settings.typeDiamond' },
  ];

  readonly fillOptions = [
    { value: 0, labelKey: 'range.settings.fill0' },
    { value: 1, labelKey: 'range.settings.fill1' },
    { value: 2, labelKey: 'range.settings.fill2' },
    { value: 3, labelKey: 'range.settings.fill3' },
    { value: 4, labelKey: 'range.settings.fill4' },
  ];

  constructor(
    private changeDetector: ChangeDetectorRef,
    private panelService: PanelService,
    private saveDataService: SaveDataService,
    private i18n: I18nService
  ) { }

  GuestMode() { return Network.GuestMode(); }

  get rangeName(): string { return this.range?.name ?? ''; }
  set rangeName(value: string) {
    const el = this.range?.commonDataElement?.getFirstElementByName('name');
    if (el) el.value = value;
  }

  get length(): number { return this.range?.length ?? 1; }
  set length(value: number) {
    this.range?.mutateAppearance(() => {
      const el = this.range?.commonDataElement?.getFirstElementByName('length');
      if (el) el.value = value;
    });
  }

  get width(): number { return this.range?.width ?? 1; }
  set width(value: number) {
    this.range?.mutateAppearance(() => {
      const el = this.range?.commonDataElement?.getFirstElementByName('width');
      if (el) el.value = value;
    });
  }

  get opacityPercent(): number {
    if (!this.range) return 100;
    return Math.round((this.range.opacity || 0) * 100);
  }
  set opacityPercent(value: number) {
    const el = this.range?.commonDataElement?.getFirstElementByName('opacity');
    if (!el) return;
    const max = Number(el.value) || 100;
    el.currentValue = Math.max(0, Math.min(max, (Number(value) || 0) / 100 * max));
  }

  get followName(): string {
    return this.range?.followingCharactor?.name || '';
  }

  ngOnInit() {
    EventSystem.register(this)
      .on('DELETE_GAME_OBJECT', event => {
        if (this.range && event.data?.identifier === this.range.identifier) this.panelService.close();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        if (this.range && event.data?.identifier === this.range.identifier) {
          this.refreshTitle();
          this.changeDetector.markForCheck();
        }
      })
      .on('LOCALE_CHANGED', () => this.refreshTitle());
    this.refreshTitle();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['range'] && this.range) this.refreshTitle();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  clearFollow() {
    if (!this.range || this.GuestMode()) return;
    this.range.followingCharactor = null;
    this.changeDetector.markForCheck();
  }

  async saveToXML() {
    if (!this.range || this.isSaveing) return;
    this.isSaveing = true;
    this.progresPercent = 0;
    await this.saveDataService.saveGameObjectAsync(this.range, 'fly_xml_' + (this.range.name || 'range'), percent => {
      this.progresPercent = percent;
      this.changeDetector.markForCheck();
    });
    setTimeout(() => {
      this.isSaveing = false;
      this.progresPercent = 0;
      this.changeDetector.markForCheck();
    }, 500);
  }

  importXml() {
    if (this.GuestMode()) return;
    this.saveDataService.pickAndLoadXmlOrZip();
  }

  private refreshTitle() {
    if (!this.range) return;
    let title = this.i18n.t('range.panelTitle');
    if (this.range.name?.length) title += ' - ' + this.range.name;
    this.panelService.title = title;
  }
}
