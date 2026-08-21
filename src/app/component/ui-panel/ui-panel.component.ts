import { animate, keyframes, style, transition, trigger } from '@angular/animations';
import { Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, ViewChild, ViewContainerRef } from '@angular/core';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ChatWindowComponent } from 'component/chat-window/chat-window.component';
import { MobileLayoutService, MobileSheetSnap } from 'service/mobile-layout.service';
import { MobileSheetChrome } from 'service/mobile-sheet-chrome';
import { PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';

@Component({
    selector: 'ui-panel',
    templateUrl: './ui-panel.component.html',
    styleUrls: ['./ui-panel.component.css'],
    providers: [
        PanelService,
    ],
    animations: [
        trigger('flyInOut', [
            transition('void => *', [
                animate('100ms ease-out', keyframes([
                    style({ transform: 'scale(0.8, 0.8)', opacity: '0', offset: 0 }),
                    style({ transform: 'scale(1.0, 1.0)', opacity: '1', offset: 1.0 })
                ]))
            ]),
            transition('* => void', [
                animate(100, style({ transform: 'scale(0, 0)' }))
            ])
        ])
    ],
    standalone: false
})
export class UIPanelComponent implements OnInit, OnDestroy {
  @ViewChild('draggablePanel', { static: true }) draggablePanel: ElementRef<HTMLElement>;
  @ViewChild('scrollablePanel', { static: true }) scrollablePanel: ElementRef<HTMLDivElement>;
  @ViewChild('content', { read: ViewContainerRef, static: true }) content: ViewContainerRef;
  @ViewChild('titleBar', { static: true }) titleBar: ElementRef<HTMLDivElement>;

  @Input() set title(title: string) { this.panelService.title = title; }
  @Input() set left(left: number) { this.panelService.left = left; }
  @Input() set top(top: number) { this.panelService.top = top; }
  @Input() set width(width: number) { this.panelService.width = width; }
  @Input() set height(height: number) { this.panelService.height = height; }
  @Input() set isAbleMinimizeButton(isAbleMinimizeButton: boolean) { this.panelService.isAbleMinimizeButton = isAbleMinimizeButton; }
  @Input() set isAbleFullScreenButton(isAbleFullScreenButton: boolean) { this.panelService.isAbleFullScreenButton = isAbleFullScreenButton; }
  @Input() set isAbleCloseButton(isAbleCloseButton: boolean) { this.panelService.isAbleCloseButton = isAbleCloseButton; }
  @Input() set isAbleRotateButton(isAbleRotateButton: boolean) { this.panelService.isAbleRotateButton = isAbleRotateButton; }
  /** Persist size under this key (fixed left menu, etc.). */
  @Input() set geometryKey(key: string) {
    this.panelService.geometryKey = key || null;
    const g = key ? PanelService.getGeometry(key) : null;
    if (g && g.width >= 100 && g.height >= 100) {
      this.panelService.width = g.width;
      this.panelService.height = g.height;
    }
  }

  @Output() rotateEvent = new EventEmitter<boolean>();

  @Input() showTitleButtons: boolean = true;

  get title(): string { return this.panelService.title; }
  get left() { return this.panelService.left; }
  get top() { return this.panelService.top; }
  get width() { return this.panelService.width; }
  get height() { return this.panelService.height; }
  get isAbleMinimizeButton() { return this.panelService.isAbleMinimizeButton; }
  get isAbleFullScreenButton() { return this.panelService.isAbleFullScreenButton; }
  get isAbleCloseButton() { return this.panelService.isAbleCloseButton; }
  get isAbleRotateButton() { return this.panelService.isAbleRotateButton; }
  
  get isGMMode(): boolean{ return PeerCursor.myCursor ? PeerCursor.myCursor.isGMMode : false; }

  private preLeft: number = 0;
  private preTop: number = 0;
  private preWidth: number = 100;
  private preHeight: number = 100;

  // 目前只有選單，暫且如此
  private horizontalWidth: number = 1092;
  private horizontalHeight: number = 100;
  private verticalWidth: number = 0;
  private verticalHeight: number = 0;

  isMinimized: boolean = false;
  isFullScreen: boolean = false;
  isHorizontal: boolean = false;
  /** Set by PanelService.open on phone/tablet sheets. Desktop panels stay false. */
  isMobileSheet: boolean = false;
  /** Bottom half-sheet (e.g. chat) — leaves map visible above. Always true on mobile. */
  isMobileSheetHalf: boolean = false;
  private readonly sheetChrome: MobileSheetChrome;

  /** peek | half — only meaningful when isMobileSheet (no fullscreen). */
  get mobileSheetSnap(): MobileSheetSnap { return this.sheetChrome.snap; }
  set mobileSheetSnap(v: MobileSheetSnap) { this.sheetChrome.snap = v; }
  /** True after user drags sheet height away from peek/half snaps. */
  get isSheetCustomHeight(): boolean { return this.sheetChrome.isCustomHeight; }
  set isSheetCustomHeight(v: boolean) { this.sheetChrome.isCustomHeight = v; }

  get isPointerDragging(): boolean { return this.pointerDeviceService.isDragging || this.pointerDeviceService.isTablePickGesture; }

  constructor(
    public panelService: PanelService,
    private pointerDeviceService: PointerDeviceService,
    private mobileLayout: MobileLayoutService,
  ) {
    this.sheetChrome = new MobileSheetChrome(this.mobileLayout, {
      heightForSnap: (snap) => this.mobileLayout.sheetHeightPx(snap),
      applyHeight: (h) => {
        this.height = h;
        this.top = Math.max(0, this.mobileLayout.viewportHeight - h - this.mobileLayout.bottomChromePx);
        this.isMobileSheetHalf = true;
      },
      currentHeight: () => this.draggablePanel?.nativeElement?.offsetHeight || this.height,
      onResizeEnd: () => this.syncMobileSheetGeometryAfterResize(),
    });
  }

  ngOnInit() {
    this.panelService.scrollablePanel = this.scrollablePanel.nativeElement;
  }

  ngOnDestroy() {
    this.sheetChrome.destroy();
  }

  /** Suppress browser context menu on panels (custom menus handle right-click). */
  @HostListener('contextmenu', ['$event'])
  onHostContextMenu(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (target?.closest('textarea, [contenteditable="true"]')) return;
    if (target instanceof HTMLInputElement) {
      const type = (target.type || 'text').toLowerCase();
      if (type !== 'range' && type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit' && type !== 'color' && type !== 'file') {
        return;
      }
    }
    e.preventDefault();
  }

  toggleMinimize(e: Event = null) {
    if (this.isMobileSheet) {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      // − collapses to peek; restore expands to half (same as title snap).
      this.sheetChrome.toggleSnap();
      return;
    }
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }

    const panel = this.draggablePanel.nativeElement;
    const cntent = this.scrollablePanel.nativeElement;
    panel.style.transition = 'width 0.1s ease-in-out, height 0.1s ease-in-out';
    cntent.style.overflowY = 'hidden';
    setTimeout(() => {
      panel.style.transition = null;
      cntent.style.overflowY = null;
    }, 100);
 
    if (!this.isMinimized && !this.isFullScreen) {
      const saveWidth = panel.offsetWidth;
      const saveHeight = panel.offsetHeight;
      if (this.isHorizontal) {
        this.horizontalWidth = saveWidth;
        this.horizontalHeight = saveHeight;
      } else {
        this.verticalWidth = saveWidth;
        this.verticalHeight = saveHeight;
      }
    }
    this.isMinimized = !this.isMinimized;
    this.isFullScreen = false;
  }

  toggleFullScreen(e: Event = null) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }

    const panel = this.draggablePanel.nativeElement;
    const cntent = this.scrollablePanel.nativeElement;
    panel.style.transition = 'width 0.1s ease-in-out, height 0.1s ease-in-out';
    cntent.style.overflowY = 'hidden';
    setTimeout(() => {
      panel.style.transition = null;
      cntent.style.overflowY = null;
    }, 100);
    //this.isMinimized = false;
    if (!this.isMinimized && !this.isFullScreen) {
      const saveWidth = panel.offsetWidth;
      const saveHeight = panel.offsetHeight;
      if (this.isHorizontal) {
        this.horizontalWidth = saveWidth;
        this.horizontalHeight = saveHeight;
      } else {
        this.verticalWidth = saveWidth;
        this.verticalHeight = saveHeight;
      }
    }
    this.isFullScreen = !this.isFullScreen;
    /*
    if (panel.offsetLeft <= 0
      && panel.offsetTop <= 0
      && panel.offsetWidth >= window.innerWidth
      && panel.offsetHeight >= window.innerHeight) {
      this.isFullScreen = false;
    } else {
      this.isFullScreen = true;
    }
    */
   /*
    if (this.isFullScreen) {
      this.preLeft = panel.offsetLeft;
      this.preTop = panel.offsetTop;
      //this.preWidth = panel.offsetWidth;
      //this.preHeight = panel.offsetHeight;

      this.left = 0;
      this.top = 0;
      //this.width = window.innerWidth;
      //this.height = window.innerHeight;

      panel.style.left = this.left + 'px';
      panel.style.top = this.top + 'px';
      //panel.style.width = this.width + 'px';
      //panel.style.height = this.height + 'px';
    } else {
      this.left = this.preLeft;
      this.top = this.preTop;
      //this.width = this.preWidth;
      //this.height = this.preHeight;
    }
    */
  }

  toggleRotate(e: Event = null) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }

    //if (this.isMinimized) return;
    const panel = this.draggablePanel.nativeElement;
    const cntent = this.scrollablePanel.nativeElement;
    panel.style.transition = 'width 0.1s ease-in-out, height 0.1s ease-in-out';
    cntent.style.overflowY = 'hidden';
    setTimeout(() => {
      panel.style.transition = null;
      cntent.style.overflowY = null;
    }, 500);

    const saveWidth = panel.offsetWidth;
    const saveHeight = panel.offsetHeight;
    if (this.isHorizontal) {
      this.isHorizontal = false;
      panel.style.width = (this.verticalWidth < 100 ? 100 : this.verticalWidth) + 'px';
      panel.style.height = (this.verticalHeight < 100 ? 100 : this.verticalHeight) + 'px';
      if (!this.isMinimized && !this.isFullScreen) {
        this.horizontalWidth = saveWidth;
        this.horizontalHeight = saveHeight;
      }
    } else {
      this.isHorizontal = true;
      panel.style.width = (this.horizontalWidth < 100 ? 100 : this.horizontalWidth) + 'px';
      panel.style.height = (this.horizontalHeight < 100 ? 100 : this.horizontalHeight) + 'px';
      if (!this.isMinimized && !this.isFullScreen) {
        this.verticalWidth = saveWidth;
        this.verticalHeight = saveHeight;
      }
    }
    this.isMinimized = false;
    this.isFullScreen = false;
    this.rotateEvent.emit(this.isHorizontal);

    return false;
  }

  close(e: Event = null) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (this.panelService) this.panelService.close();
  }

  /** Desktop: dblclick title minimizes/restores. Mobile sheets: no-op (minimize chrome is hidden). */
  onTitleDblClick(e: Event) {
    if (this.isMobileSheet) {
      this.notOperaion(e);
      return;
    }
    if (this.isFullScreen) this.toggleFullScreen(e);
    else this.toggleMinimize(e);
  }

  /** Mobile: tap title toggles peek ↔ half (skip if user just dragged the resize handle). */
  onMobileTitleTap(e: Event) {
    if (!this.isMobileSheet) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('button, .sheet-resize-bar')) return;
    if (this.sheetChrome.didDrag) {
      this.sheetChrome.didDrag = false;
      return;
    }
    e.stopPropagation();
    this.sheetChrome.toggleSnap();
  }

  /** Drag the top handle to set a custom sheet height (bottom-anchored). */
  startSheetResize(e: PointerEvent) {
    if (!this.isMobileSheet) return;
    this.sheetChrome.startResize(e);
  }

  /** Enter custom-height mode before drag so snap CSS !important does not block resize. */
  onPanelResizeStart() {
    if (!this.isMobileSheet) return;
    const panel = this.draggablePanel?.nativeElement;
    if (panel) this.height = panel.offsetHeight;
    this.isSheetCustomHeight = true;
  }

  /** After sheet handle resize — clamp + lock fit (geometry persistence is desktop-only). */
  private syncMobileSheetGeometryAfterResize() {
    if (!this.isMobileSheet || this.isMinimized || this.isFullScreen) return;
    const panel = this.draggablePanel?.nativeElement;
    if (!panel) return;
    const prevH = this.height;
    const clamped = this.sheetChrome.clamp(panel.offsetHeight);
    this.isSheetCustomHeight = true;
    this.height = clamped;
    this.top = Math.max(0, this.mobileLayout.viewportHeight - clamped - this.mobileLayout.bottomChromePx);
    if (clamped !== prevH) this.panelService.lockFitToContent();
  }

  /** Sync Angular bindings after drag/resize so CD does not snap size back; persist panel geometry. */
  onPanelGeometryEnd() {
    if (this.isMinimized || this.isFullScreen) return;
    const panel = this.draggablePanel?.nativeElement;
    if (!panel) return;
    const prevW = this.width;
    const prevH = this.height;
    if (this.isMobileSheet) {
      const clamped = this.sheetChrome.clamp(panel.offsetHeight);
      this.isSheetCustomHeight = true;
      this.height = clamped;
      this.top = Math.max(0, this.mobileLayout.viewportHeight - clamped - this.mobileLayout.bottomChromePx);
      // Only lock content-fit when the user actually changed size (not mere drag-move).
      if (clamped !== prevH) this.panelService.lockFitToContent();
      return;
    }
    this.left = panel.offsetLeft;
    this.top = panel.offsetTop;
    this.width = panel.offsetWidth;
    this.height = panel.offsetHeight;
    if (this.width !== prevW || this.height !== prevH) {
      this.panelService.lockFitToContent();
    }
    if (this.panelService.tourPanelId === 'menu.chat') {
      ChatWindowComponent.saveGeometry(this.width, this.height, this.left, this.top);
      return;
    }
    const key = this.panelService.geometryKey || this.panelService.tourPanelId;
    if (key) {
      PanelService.saveGeometry(key, this.width, this.height, this.left, this.top);
    }
  }

  notOperaion(e: Event = null) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    return false;
  }
}
