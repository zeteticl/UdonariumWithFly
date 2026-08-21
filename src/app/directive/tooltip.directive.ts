import {
  AfterViewInit,
  ComponentRef,
  Directive,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  ViewContainerRef
} from '@angular/core';
import { CardState } from '@udonarium/card';
import { EventSystem } from '@udonarium/core/system';
import { MathUtil } from '@udonarium/core/system/util/math-util';
import { TabletopObject } from '@udonarium/tabletop-object';
import { OverviewPanelComponent } from 'component/overview-panel/overview-panel.component';
import { ContextMenuService } from 'service/context-menu.service';
import { MobileLayoutService } from 'service/mobile-layout.service';
import { PointerDeviceService } from 'service/pointer-device.service';

@Directive({
    selector: '[appTooltip]',
    standalone: false
})
export class TooltipDirective implements AfterViewInit, OnDestroy {
  private static activeTooltips: ComponentRef<OverviewPanelComponent>[] = [];

  @Input('appTooltip') tabletopObject: TabletopObject;
  @Input('cardState') cardState: CardState;

  private callbackOnMouseEnter = (e) => this.onMouseEnter(e);
  private callbackOnMouseLeave = (e) => this.onMouseLeave(e);
  private callbackOnMouseDown = (e) => this.onMouseDown(e);
  private callbackOnPick = (e) => {
    if (this.isPinned) return;
    this.ngZone.run(() => this.closeUnpinned());
  };

  private openTooltipTimer: NodeJS.Timeout;
  private closeTooltipTimer: NodeJS.Timeout;

  private tooltipComponentRef: ComponentRef<OverviewPanelComponent>
  private isPinned = false;

  constructor(
    private ngZone: NgZone,
    private viewContainerRef: ViewContainerRef,
    private pointerDeviceService: PointerDeviceService,
    private mobileLayout: MobileLayoutService,
  ) { }

  ngAfterViewInit() {
    this.addEventListeners(this.viewContainerRef.element.nativeElement);
  }

  ngOnDestroy() {
    try {
      this.removeEventListeners(this.viewContainerRef.element.nativeElement);
    } catch { /* host may already be detached */ }
    this.clearTimer();
    // Characters go to graveyard (no DELETE_GAME_OBJECT) — always force-close this object's panels.
    this.forceCloseForObject(this.tabletopObject?.identifier);
  }

  private onMouseEnter(e: any) {
    // Mobile synthesizes sticky hover after tap; overview cards block the map.
    if (this.mobileLayout.isMobile) return;
    this.clearTimer();
    if (!this.tooltipComponentRef) this.startOpenTimer();
  }

  private onMouseLeave(e: any) {
    this.clearTimer();
    if (this.isPinned) return;
    if (this.tooltipComponentRef) this.startCloseTimer();
  }

  private onMouseDown(e: any) {
    if (!this.tooltipComponentRef) return;
    if (this.isPinned) return;
    if (!this.tooltipComponentRef.location.nativeElement.contains(e.target)
      && !this.viewContainerRef.element.nativeElement.contains(e.target)) {
      this.ngZone.run(() => this.closeUnpinned());
    }
  }

  private startOpenTimer() {
    let prevPointer = this.pointerDeviceService.pointer;

    this.openTooltipTimer = setTimeout(() => {
      this.openTooltipTimer = null;
      let magnitude = MathUtil.sqrMagnitude(prevPointer, this.pointerDeviceService.pointer);
      if (4 < magnitude) {
        this.startOpenTimer();
      } else {
        this.ngZone.run(() => this.open());
      }
    }, 100);
  }

  private startCloseTimer() {
    // Stay visible 0.5s after leave, then fade out.
    this.closeTooltipTimer = setTimeout(() => {
      this.closeTooltipTimer = null;
      if (this.isPinned) return;
      if (this.tooltipComponentRef && this.tooltipComponentRef.location.nativeElement.contains(document.activeElement)) {
        this.startCloseTimer();
      } else {
        this.ngZone.run(() => this.closeSelf());
      }
    }, 500);
  }

  private clearTimer() {
    if (this.closeTooltipTimer) clearTimeout(this.closeTooltipTimer);
    if (this.openTooltipTimer) clearTimeout(this.openTooltipTimer);
    this.closeTooltipTimer = this.openTooltipTimer = null;
  }

  private open() {
    if (this.mobileLayout.isMobile) return;
    // Keep pinned cards; only dismiss other hover previews.
    this.closeUnpinned();
    if (this.tooltipComponentRef) return;
    if (this.pointerDeviceService.isDragging || this.pointerDeviceService.isTablePickGesture) return;

    let parentViewContainerRef = ContextMenuService.defaultParentViewContainerRef;

    const injector = parentViewContainerRef.injector;
    this.tooltipComponentRef = parentViewContainerRef.createComponent(OverviewPanelComponent, { index: parentViewContainerRef.length, injector: injector });

    this.isPinned = false;
    const objectId = this.tabletopObject.identifier;
    this.tooltipComponentRef.instance.tabletopObject = this.tabletopObject;
    this.tooltipComponentRef.instance.left = this.pointerDeviceService.pointerX;
    this.tooltipComponentRef.instance.top = this.pointerDeviceService.pointerY;
    this.tooltipComponentRef.instance.cardState = this.cardState;
    this.tooltipComponentRef.instance.onPinnedChange = (pinned) => {
      this.isPinned = pinned;
      if (!pinned) this.clearTimer();
    };

    this.addEventListeners(this.tooltipComponentRef.location.nativeElement);
    this.ngZone.runOutsideAngular(() => {
      document.body.addEventListener('touchstart', this.callbackOnMouseDown, true);
      document.body.addEventListener('mousedown', this.callbackOnMouseDown, true);
      document.addEventListener('pickstart', this.callbackOnPick, true);
      document.addEventListener('pickobject', this.callbackOnPick, true);
      document.addEventListener('pickregion', this.callbackOnPick, true);
    });

    EventSystem.register(this)
      .on(`UPDATE_GAME_OBJECT/identifier/${objectId}`, event => {
        // Delete key moves characters to graveyard (UPDATE, not DELETE).
        if (!this.tabletopObject?.isVisibleOnTable) {
          this.ngZone.run(() => this.forceCloseForObject(objectId));
          return;
        }
        if (this.isPinned) return;
        if (this.pointerDeviceService.isDragging) this.ngZone.run(() => this.closeSelf());
      })
      .on('UPDATE_SELECTION', event => {
        if (this.isPinned) return;
        if (this.pointerDeviceService.isDragging) this.ngZone.run(() => this.closeSelf());
      })
      .on('DELETE_GAME_OBJECT', event => {
        if (event.data.identifier === objectId) {
          this.ngZone.run(() => this.forceCloseForObject(objectId));
        }
      });

    const panelElement = this.tooltipComponentRef.location.nativeElement;
    this.tooltipComponentRef.onDestroy(() => {
      try {
        this.removeEventListeners(panelElement);
      } catch { /* ignore */ }
      document.body.removeEventListener('touchstart', this.callbackOnMouseDown, true);
      document.body.removeEventListener('mousedown', this.callbackOnMouseDown, true);
      document.removeEventListener('pickstart', this.callbackOnPick, true);
      document.removeEventListener('pickobject', this.callbackOnPick, true);
      document.removeEventListener('pickregion', this.callbackOnPick, true);
      this.clearTimer();
      this.isPinned = false;
      if (this.tooltipComponentRef?.location?.nativeElement === panelElement) {
        this.tooltipComponentRef = null;
      }
      EventSystem.unregister(this);
    });
    TooltipDirective.activeTooltips.push(this.tooltipComponentRef);

    let onChanges = this.tooltipComponentRef.instance as OnChanges;
    if (onChanges?.ngOnChanges != null) {
      queueMicrotask(() => {
        if (this.tooltipComponentRef?.instance) onChanges?.ngOnChanges({});
      });
    }
  }

  private close() {
    if (!this.tooltipComponentRef) return;
    const ref = this.tooltipComponentRef;
    this.tooltipComponentRef = null;
    this.isPinned = false;
    void this.destroyRef(ref, true);
  }

  /** Close only this tooltip if it is not pinned. */
  private closeSelf() {
    if (this.isPinned) return;
    this.close();
  }

  /** Force-close every overview panel for this object (pinned or not). */
  private forceCloseForObject(objectId: string | undefined) {
    if (!objectId) {
      this.close();
      return;
    }
    for (const ref of [...TooltipDirective.activeTooltips]) {
      if (ref.instance?.tabletopObject?.identifier !== objectId) continue;
      void this.destroyRef(ref, true);
    }
    if (this.tabletopObject?.identifier === objectId) {
      this.tooltipComponentRef = null;
      this.isPinned = false;
    }
  }

  /** Close hover (unpinned) tooltips; leave pinned ones open. */
  private closeUnpinned() {
    for (const ref of [...TooltipDirective.activeTooltips]) {
      if (ref.instance?.isPinned) continue;
      void this.destroyRef(ref, true);
    }
    if (this.tooltipComponentRef && !this.isPinned) {
      this.tooltipComponentRef = null;
    }
  }

  private async destroyRef(ref: ComponentRef<OverviewPanelComponent>, withFade: boolean) {
    const idx = TooltipDirective.activeTooltips.indexOf(ref);
    if (0 <= idx) TooltipDirective.activeTooltips.splice(idx, 1);
    if (ref.instance) ref.instance.isPinned = false;
    if (this.tooltipComponentRef === ref) {
      this.tooltipComponentRef = null;
      this.isPinned = false;
    }
    try {
      if (withFade && ref.instance && !ref.hostView.destroyed) {
        await ref.instance.beginFadeOut(300);
      }
    } catch { /* ignore */ }
    if (!ref.hostView.destroyed) ref.destroy();
  }

  private addEventListeners(element: Element) {
    this.ngZone.runOutsideAngular(() => {
      element.addEventListener('mouseenter', this.callbackOnMouseEnter, false);
      element.addEventListener('mouseleave', this.callbackOnMouseLeave, false);
    });
  }

  private removeEventListeners(element: Element) {
    element.removeEventListener('mouseenter', this.callbackOnMouseEnter, false);
    element.removeEventListener('mouseleave', this.callbackOnMouseLeave, false);
  }
}
