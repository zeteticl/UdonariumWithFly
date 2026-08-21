import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ContextMenuAction, ContextMenuService } from 'service/context-menu.service';
import { MobileLayoutService, MobileSheetSnap } from 'service/mobile-layout.service';
import { ACTION_SHEET_SNAP_KEY, MobileSheetChrome } from 'service/mobile-sheet-chrome';
import { PointerDeviceService } from 'service/pointer-device.service';
import { TabletopObject } from '@udonarium/tabletop-object';
import { PeerCursor } from '@udonarium/peer-cursor';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { Network } from '@udonarium/core/system';

@Component({
    selector: 'context-menu',
    templateUrl: './context-menu.component.html',
    styleUrls: ['./context-menu.component.css'],
    standalone: false
})
export class ContextMenuComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('root', { static: true }) rootElementRef: ElementRef<HTMLElement>;
  @ViewChild('altitudeSlider') altitudeSlider: ElementRef<HTMLElement>;

  @Input() title: string = '';
  @Input() actions: ContextMenuAction[] = [];
  @Input() titleColor: string = PeerCursor.CHAT_DEFAULT_COLOR;
  @Input() titleBold = false;

  @Input() isSubmenu: boolean = false;

  parentMenu: ContextMenuAction;
  subMenu: ContextMenuAction[];

  showSubMenuTimer: NodeJS.Timeout;
  hideSubMenuTimer: NodeJS.Timeout;

  private callbackOnOutsideClick = (e) => this.onOutsideClick(e);

  get altitudeHande(): TabletopObject { 
    for (let action of this.actions) {
      if (action && action.altitudeHande) return action.altitudeHande;
    }
    return null;
  }

  get isAltitudeDisabled(): boolean {
    return this.actions.some(action => action && action.altitudeDisabled);
  }

  get isIconsMenu(): boolean {
    for (let action of this.actions) {
      if(!action || !action.icon) return false;
    }
    return true;
  }
  get isPointerDragging(): boolean { return this.pointerDeviceService.isDragging || this.pointerDeviceService.isTablePickGesture; }

  /** Root mobile bottom action sheet (More / toolbox / token menu). */
  isMobileActionSheet = false;
  /**
   * More / toolbox sheet snaps sized to the icon grid (3-col):
   * half (default / restored) = 4 rows; peek (minimized) = 2 rows.
   */
  private readonly sheetChrome: MobileSheetChrome;
  private static readonly GRID_ROWS_HALF = 4;
  private static readonly GRID_ROWS_PEEK = 2;

  get sheetResizing(): boolean { return this.sheetChrome.resizing; }
  get sheetSnap(): MobileSheetSnap { return this.sheetChrome.snap; }
  get isSheetPeek(): boolean {
    return this.isMobileActionSheet && this.sheetChrome.isPeek;
  }

  /** Mobile dark chrome: skip default #444 so CSS muted title shows; keep custom peer colors. */
  get titleColorStyle(): string | null {
    if (!this.titleColor) return null;
    const mobile = typeof document !== 'undefined' && document.body.classList.contains('udon-mobile-layout');
    if (mobile && this.titleColor === PeerCursor.CHAT_DEFAULT_COLOR) return null;
    return this.titleColor;
  }

  constructor(
    private elementRef: ElementRef<HTMLElement>,
    public contextMenuService: ContextMenuService,
    private pointerDeviceService: PointerDeviceService,
    private mobileLayout: MobileLayoutService,
    private changeDetector: ChangeDetectorRef,
  ) {
    this.sheetChrome = new MobileSheetChrome(this.mobileLayout, {
      storageKey: ACTION_SHEET_SNAP_KEY,
      heightForSnap: (snap) => this.actionSheetHeightPx(snap),
      applyHeight: (h) => this.applyPanelHeight(h),
      currentHeight: () => {
        const panel = this.rootElementRef?.nativeElement;
        return panel ? panel.getBoundingClientRect().height : 0;
      },
      onResizeEnd: () => this.changeDetector.markForCheck(),
      minHeight: () => this.actionSheetHeightPx('peek'),
      maxHeight: () => this.sheetMaxHeight(),
    });
  }

  /** Mobile sheet: stack for drill-down (Weather / Cut-in / …) instead of nested flyouts. */
  private drillStack: { title: string; actions: ContextMenuAction[] }[] = [];

  get canDrillBack(): boolean {
    return this.isMobileActionSheet && this.drillStack.length > 0;
  }

  /** Mobile action sheet (More / toolbox / settings…): all levels as a 3-column button grid. */
  get showIconGrid(): boolean {
    return this.isMobileActionSheet && !this.isSubmenu;
  }

  GuestMode() {
    return Network.GuestMode();
  }


  ngOnInit() {
    if (!this.isSubmenu) {
      this.title = this.contextMenuService.title;
      this.actions = this.contextMenuService.actions;
      this.titleColor = this.contextMenuService.titleColor;
      this.titleBold = this.contextMenuService.titleBold;
    }
  }

  ngAfterViewInit() {
    if (!this.isSubmenu) {
      this.adjustPositionRoot();
      document.addEventListener('touchstart', this.callbackOnOutsideClick, true);
      document.addEventListener('mousedown', this.callbackOnOutsideClick, true);
    } else {
      this.adjustPositionSub();
    }
  }

  ngOnDestroy() {
    document.removeEventListener('touchstart', this.callbackOnOutsideClick, true);
    document.removeEventListener('mousedown', this.callbackOnOutsideClick, true);
    this.sheetChrome.destroy();
  }

  onOutsideClick(event) {
    if (this.rootElementRef.nativeElement.contains(event.target) === false) {
      const t = event.target as HTMLElement | null;
      // Let nav / HUD toggles close the menu themselves (mousedown would reopen otherwise).
      if (t?.closest?.('[data-tour-id="menu.more"], [data-tour-id="menu.toolbox"], [data-tour-id="menu.settings"], [data-tour-id="hud.add"]')) return;
      // Map HUD sits above the action sheet — using it should not dismiss toolbox/More.
      if (t?.closest?.('.map-action-hud, .map-zoom-hud')) return;
      this.close();
    }
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(e: Event) {
    e.stopPropagation();
    e.preventDefault();

    if (this.GuestMode()) return;
  }

  /** Menu labels must not be text-selectable while clicking / dragging. */
  @HostListener('selectstart', ['$event'])
  onSelectStart(e: Event) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
  }

  /** Single chrome control: − (half) ↔ □ (peek), same as ui-panel / note inventory. */
  toggleSheetSnap(event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    if (!this.isMobileActionSheet || this.isSubmenu) return;
    this.applySheetSnap(this.isSheetPeek ? 'half' : 'peek');
  }

  private applySheetSnap(snap: MobileSheetSnap) {
    this.sheetChrome.applySnap(snap);
    this.changeDetector.markForCheck();
    // Remeasure after grid paints — cell labels/separators can exceed the CSS min-height.
    queueMicrotask(() => {
      if (this.sheetChrome.snap !== snap || this.sheetChrome.isCustomHeight) return;
      this.sheetChrome.reapplyCurrentSnapHeight();
    });
  }

  private applyPanelHeight(height: number) {
    const panel = this.rootElementRef?.nativeElement;
    if (!panel) return;
    const h = this.sheetChrome.clamp(height);
    panel.classList.remove('is-sheet-fit');
    panel.style.height = `${h}px`;
    panel.style.maxHeight = `${h}px`;
  }

  startSheetResize(e: PointerEvent) {
    if (!this.isMobileActionSheet || this.isSubmenu) return;
    if (this.sheetChrome.startResize(e)) {
      this.changeDetector.markForCheck();
    }
  }

  /** Default = 4-row More height; restore last peek/half for this sheet family only. */
  private applySheetHeight(_panel: HTMLElement) {
    this.applySheetSnap(this.sheetChrome.readStoredSnap());
  }

  /** Keep height across drill; only re-apply snap if not custom. */
  private refreshSheetHeightIfFitting() {
    if (!this.isMobileActionSheet || this.isSubmenu) return;
    this.sheetChrome.reapplyCurrentSnapHeight();
  }

  /**
   * Height for N *button* rows of the More-style grid.
   * Separators sit on their own grid rows between groups — include them so the
   * 4th button row (設定 / 斷線) is not clipped.
   */
  private actionSheetHeightPx(snap: MobileSheetSnap): number {
    const buttonRows = snap === 'peek'
      ? ContextMenuComponent.GRID_ROWS_PEEK
      : ContextMenuComponent.GRID_ROWS_HALF;
    const panel = this.rootElementRef?.nativeElement;
    const resizeEl = panel?.querySelector?.('.sheet-resize-bar') as HTMLElement | null;
    const titleEl = panel?.querySelector?.('.title-row') as HTMLElement | null;
    const cellEl = panel?.querySelector?.('li.is-grid-icon') as HTMLElement | null;
    const sepEl = panel?.querySelector?.('li:has(> hr.separator)') as HTMLElement | null;

    const resizeBar = Math.max(22, Math.ceil(resizeEl?.getBoundingClientRect().height || 22));
    const titleRow = Math.max(40, Math.ceil(titleEl?.getBoundingClientRect().height || 40));
    const cell = Math.max(52, Math.ceil(cellEl?.getBoundingClientRect().height || 52));
    const sepRow = Math.max(5, Math.ceil(sepEl?.getBoundingClientRect().height || 5));
    const gap = 6;
    const gridPad = 12;
    const padBottom = 4;
    // More root: button, sep, button, sep, … → (buttonRows - 1) separators.
    const sepRows = Math.max(0, buttonRows - 1);
    const gridRows = buttonRows + sepRows;
    const gridH = gridPad
      + buttonRows * cell
      + sepRows * sepRow
      + Math.max(0, gridRows - 1) * gap;
    return resizeBar + titleRow + gridH + padBottom;
  }

  private sheetMaxHeight(): number {
    return Math.max(
      this.actionSheetHeightPx('half'),
      Math.round(this.mobileLayout.viewportHeight - this.mobileLayout.bottomChromePx - 8),
    );
  }

  private adjustPositionRoot() {
    let panel: HTMLElement = this.rootElementRef.nativeElement;
    const isMobile = document.body.classList.contains('udon-mobile-layout');

    // Mobile: bottom action sheet (same chrome family as chat half-sheet / nav).
    // Icon grids (faces etc.) stay floating near the pointer.
    if (isMobile && !this.isIconsMenu) {
      this.isMobileActionSheet = true;
      panel.classList.add('is-mobile-action-sheet');
      panel.style.left = '';
      panel.style.top = '';
      panel.style.right = '';
      panel.style.bottom = '';
      this.changeDetector.detectChanges();
      this.applySheetHeight(panel);
      this.syncAltitudeSliderHeight(panel);
      return;
    }

    this.isMobileActionSheet = false;
    panel.classList.remove('is-mobile-action-sheet');
    panel.style.height = '';
    panel.style.maxHeight = '';

    // Nudge away from the cursor so the menu does not cover the target token.
    const OFFSET_X = 20;
    const OFFSET_Y = 4;
    panel.style.left = (this.contextMenuService.position.x + OFFSET_X) + 'px';
    panel.style.top = (this.contextMenuService.position.y + OFFSET_Y) + 'px';

    // Match altitude slider to full item list height before measuring clamp.
    this.syncAltitudeSliderHeight(panel);

    let panelBox = panel.getBoundingClientRect();

    let diffLeft = 0;
    let diffTop = 0;

    // On mobile, reserve bottom nav so the menu is not covered / clipped under it.
    const bottomReserve = isMobile
      ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--udon-bottom-chrome')) || 56)
      : 0;
    const maxBottom = window.innerHeight - bottomReserve;

    if (window.innerWidth < panelBox.right + diffLeft) {
      diffLeft += window.innerWidth - (panelBox.right + diffLeft);
    }
    if (panelBox.left + diffLeft < 0) {
      diffLeft += 0 - (panelBox.left + diffLeft);
    }

    if (maxBottom < panelBox.bottom + diffTop) {
      diffTop += maxBottom - (panelBox.bottom + diffTop);
    }
    if (panelBox.top + diffTop < 0) {
      diffTop += 0 - (panelBox.top + diffTop);
    }

    panel.style.left = panel.offsetLeft + diffLeft + 'px';
    panel.style.top = panel.offsetTop + diffTop + 'px';
  }

  /** Desktop: altitude track follows all menu items. Mobile sheet: fill panel body. */
  private syncAltitudeSliderHeight(panel: HTMLElement) {
    if (!this.altitudeSlider) return;
    const slider = this.altitudeSlider.nativeElement;
    if (this.isMobileActionSheet) {
      slider.style.height = Math.max(120, panel.clientHeight - 72) + 'px';
      return;
    }
    const actions = panel.querySelector('.sheet-actions') as HTMLElement | null;
    const listH = actions?.scrollHeight || 0;
    slider.style.height = `${Math.max(96, listH || Math.max(96, panel.clientHeight - 72))}px`;
  }

  private adjustPositionSub() {
    let parent: HTMLElement = this.elementRef.nativeElement.parentElement;
    let submenu: HTMLElement = this.rootElementRef.nativeElement;
    const isMobile = document.body.classList.contains('udon-mobile-layout');

    // Inside mobile action sheet: expand inline (never re-apply full sheet chrome).
    if (isMobile && parent?.closest?.('.is-mobile-action-sheet')) {
      submenu.classList.add('is-mobile-inline-submenu');
      submenu.style.left = '';
      submenu.style.top = '';
      submenu.style.right = '';
      submenu.style.bottom = '';
      submenu.style.width = '';
      submenu.style.height = '';
      return;
    }

    let parentBox = parent.getBoundingClientRect();
    let submenuBox = submenu.getBoundingClientRect();

    let diffLeft = 0;
    let diffTop = 0;

    const bottomReserve = isMobile
      ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--udon-bottom-chrome')) || 56)
      : 0;
    const maxBottom = window.innerHeight - bottomReserve;

    if (window.innerWidth < submenuBox.right + diffLeft) {
      diffLeft -= parentBox.width + submenuBox.width;
      diffLeft += 8;
    }
    if (submenuBox.left + diffLeft < 0) {
      diffLeft += 0 - (submenuBox.left + diffLeft);
    }

    if (maxBottom < submenuBox.bottom + diffTop) {
      diffTop += maxBottom - (submenuBox.bottom + diffTop);
    }
    if (submenuBox.top + diffTop < 0) {
      diffTop += 0 - (submenuBox.top + diffTop);
    }

    submenu.style.left = submenu.offsetLeft + diffLeft + 'px';
    submenu.style.top = submenu.offsetTop + diffTop + 'px';
  }

  doAction(action: ContextMenuAction, event?: Event) {
    // Nested <context-menu> items sit inside the parent <li>; without this, a
    // checkbox click bubbles up and the parent treats it as a second tap that
    // collapses the submenu (status / aura / ring toggles close immediately).
    event?.stopPropagation();

    this.showSubMenu(action, { fromClick: true });
    if (action.action == null) return;

    // Capture before action: nested open() (e.g. More → Toolbox) replaces this menu.
    const serialBefore = this.contextMenuService.serial;
    const host = this.rootElementRef?.nativeElement;
    action.action();
    if (serialBefore !== this.contextMenuService.serial) return;
    if (host && !host.isConnected) return;

    this.refreshActionVisual(action);

    // Checkbox / radio stay open so users can toggle several options.
    // Normal one-shot actions close. Explicit keepOpen overrides.
    const stayOpen = action.keepOpen === true
      || (action.keepOpen !== false && !!action.checkBox);
    if (!stayOpen) {
      this.close();
      return;
    }
    this.changeDetector.detectChanges();
  }

  private refreshActionVisual(action: ContextMenuAction) {
    const refreshList = (list: ContextMenuAction[]) => {
      for (const a of list) {
        if (!a) continue;
        if (typeof a.nameUpdate === 'function') {
          a.name = a.nameUpdate() ?? a.name;
        }
        if (a.subActions?.length) refreshList(a.subActions);
      }
    };

    // Prefer live nameUpdate when present (and refresh siblings / nested menus that also use it).
    if (typeof action.nameUpdate === 'function') {
      refreshList(this.actions);
      if (this.subMenu) refreshList(this.subMenu);
      // Radio: force the clicked row selected. nameUpdate may still see pre-action /
      // mid-animation state (e.g. day/night darkness tween), which would leave the
      // wrong ◉ until the menu is reopened.
      if (action.checkBox === 'radio' && action.name) {
        const list = this.subMenu && this.subMenu.includes(action) ? this.subMenu : this.actions;
        for (const a of list) {
          if (!a || a.checkBox !== 'radio' || !a.name) continue;
          if (a === action) a.name = a.name.replace(/^[◉○]/, '◉');
          else a.name = a.name.replace(/^[◉○]/, '○');
        }
      }
      return;
    }

    if (action.checkBox === 'check' && action.name) {
      if (action.name.startsWith('☑')) action.name = '☐' + action.name.substring(1);
      else if (action.name.startsWith('☐')) action.name = '☑' + action.name.substring(1);
      return;
    }
    if (action.checkBox === 'radio' && action.name) {
      const list = this.subMenu && this.subMenu.includes(action) ? this.subMenu : this.actions;
      for (const a of list) {
        if (!a || a.checkBox !== 'radio' || !a.name) continue;
        if (typeof a.nameUpdate === 'function') {
          a.name = a.nameUpdate() ?? a.name;
          continue;
        }
        if (a === action) a.name = a.name.replace(/^[◉○]/, '◉');
        else a.name = a.name.replace(/^[◉○]/, '○');
      }
    }
  }

  showSubMenu(action: ContextMenuAction, opts?: { fromClick?: boolean }) {
    // Guest menus only list allowed items — do not block expand (e.g. local view reset).
    const host = this.rootElementRef?.nativeElement;
    const mobileSheet = !!(this.isMobileActionSheet
      || host?.classList?.contains('is-mobile-action-sheet')
      || host?.classList?.contains('is-mobile-inline-submenu')
      || host?.closest?.('.is-mobile-action-sheet'));

    // Touch action sheets synthesize sticky hover — only expand/collapse from click.
    if (mobileSheet && !opts?.fromClick) return;

    clearTimeout(this.showSubMenuTimer);

    if (action.subActions == null || action.subActions.length < 1) {
      this.clearSubMenuNow();
      return;
    }

    // Mobile root sheet: push a full-page level (Settings-style), not a side/inline nest.
    if (opts?.fromClick && this.isMobileActionSheet && !this.isSubmenu) {
      this.drillInto(action);
      return;
    }

    // Already open: on desktop hover already expanded it — a click must not collapse.
    // Mobile nested (legacy) sheets: second tap toggles closed.
    if (opts?.fromClick && this.parentMenu === action && this.subMenu) {
      if (mobileSheet) this.clearSubMenuNow();
      return;
    }

    clearTimeout(this.hideSubMenuTimer);
    const delay = (mobileSheet || opts?.fromClick || this.parentMenu === action) ? 0 : 120;
    this.showSubMenuTimer = setTimeout(() => {
      this.parentMenu = action;
      this.subMenu = action.subActions;
      this.changeDetector.detectChanges();
    }, delay);
  }

  /** Replace sheet contents with submenu; Back restores previous level. */
  drillInto(action: ContextMenuAction) {
    if (!action?.subActions?.length) return;
    this.drillStack.push({ title: this.title, actions: this.actions });
    this.title = action.name || '';
    this.actions = action.subActions;
    this.clearSubMenuNow();
    this.changeDetector.detectChanges();
    queueMicrotask(() => {
      this.refreshSheetHeightIfFitting();
      this.scrollSheetActionsToTop();
    });
  }

  drillBack(event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    const prev = this.drillStack.pop();
    if (!prev) return;
    this.title = prev.title;
    this.actions = prev.actions;
    this.clearSubMenuNow();
    this.changeDetector.detectChanges();
    queueMicrotask(() => {
      this.refreshSheetHeightIfFitting();
      this.scrollSheetActionsToTop();
    });
  }

  private scrollSheetActionsToTop() {
    const host = this.rootElementRef?.nativeElement;
    const scroller = host?.querySelector?.('.sheet-actions') as HTMLElement | null;
    if (scroller) scroller.scrollTop = 0;
  }

  hideSubMenu() {
    clearTimeout(this.hideSubMenuTimer);
    // Short grace so the pointer can move into a floating submenu without it vanishing.
    this.hideSubMenuTimer = setTimeout(() => this.clearSubMenuNow(), 280);
  }

  private clearSubMenuNow() {
    clearTimeout(this.hideSubMenuTimer);
    clearTimeout(this.showSubMenuTimer);
    if (!this.subMenu && !this.parentMenu) return;
    this.parentMenu = null;
    this.subMenu = null;
    this.changeDetector.detectChanges();
  }

  close() {
    if (this.contextMenuService) this.contextMenuService.close();
  }

  actionNameHtmlEscape(str, checkBox=null) {
    if (str == null) return '';
    if (checkBox == 'check') str = str.replace(/^[☑☐]/, '');
    if (checkBox == 'radio') str = str.replace(/^[◉○]/, '');
    return StringUtil.escapeHtml(str).replace(/💭/g, '<span style="text-shadow: #111 0 0 1px">💭</span>');
  }
}
