import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ConnectionBusyService } from 'service/connection-busy.service';
import { I18nService } from 'service/i18n.service';

@Component({
  selector: 'connection-busy-overlay',
  templateUrl: './connection-busy-overlay.component.html',
  styleUrls: ['./connection-busy-overlay.component.css'],
  standalone: false,
})
export class ConnectionBusyOverlayComponent implements OnInit, OnDestroy {
  private unsub: (() => void) | null = null;

  constructor(
    private busy: ConnectionBusyService,
    private i18n: I18nService,
    private changeDetector: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.unsub = this.busy.onChange(() => this.changeDetector.detectChanges());
  }

  ngOnDestroy() {
    this.unsub?.();
    this.unsub = null;
  }

  get visible(): boolean {
    return this.busy.busy;
  }

  get message(): string {
    return this.i18n.t(this.busy.messageKey);
  }
}
