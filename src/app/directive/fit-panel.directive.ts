import { AfterViewInit, Directive, ElementRef, Input, OnDestroy } from '@angular/core';

import { PanelService } from 'service/panel.service';

/**
 * Fit the owning UI panel height to this element's content on open / when
 * content structure changes. Use on settings form roots: `appFitPanel`.
 */
@Directive({
  selector: '[appFitPanel]',
  standalone: false,
})
export class FitPanelDirective implements AfterViewInit, OnDestroy {
  /** Minimum panel height (px). */
  @Input() fitMinHeight = 200;
  /** Cap height so list-heavy panels do not become floor-to-ceiling. 0 = viewport. */
  @Input() fitMaxHeight = 0;

  private mo: MutationObserver = null;
  private debounceTimer: ReturnType<typeof setTimeout> = null;

  constructor(
    private hostRef: ElementRef<HTMLElement>,
    private panelService: PanelService,
  ) { }

  ngAfterViewInit() {
    // Embedded editors live inside another panel — do not resize the parent.
    if (this.hostRef.nativeElement.classList.contains('is-embedded')) return;
    if (!this.hostRef.nativeElement.closest('.draggable-panel')) return;
    this.refit();
    if (typeof MutationObserver !== 'undefined') {
      this.mo = new MutationObserver(() => this.debounceRefit());
      this.mo.observe(this.hostRef.nativeElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  }

  ngOnDestroy() {
    this.mo?.disconnect();
    this.mo = null;
    if (this.debounceTimer != null) clearTimeout(this.debounceTimer);
    this.panelService.cancelFitToContent();
  }

  /** Re-run fit (e.g. after switching note content mode). */
  refit() {
    const host = this.hostRef.nativeElement;
    if (!host?.isConnected) return;
    if (host.classList.contains('is-embedded')) return;
    const panel = host.closest('.draggable-panel');
    if (!panel) return;
    // Mobile sheets keep snap height; MutationObserver must not resize on lobby list updates.
    if (panel.classList.contains('is-mobile-sheet')) return;
    const maxHeight = this.fitMaxHeight > 0
      ? this.fitMaxHeight
      : Math.max(200, window.innerHeight - 16);
    this.panelService.scheduleFitToContent(host, {
      minHeight: this.fitMinHeight,
      maxHeight,
    });
  }

  private debounceRefit() {
    if (this.hostRef.nativeElement.classList.contains('is-embedded')) return;
    if (this.debounceTimer != null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.refit();
    }, 60);
  }
}
