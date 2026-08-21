import { MobileLayoutService, MobileSheetSnap } from './mobile-layout.service';

/** sessionStorage key for More / toolbox action sheets (separate from panel sheets). */
export const ACTION_SHEET_SNAP_KEY = 'udon.actionSheet.snap';

export interface MobileSheetChromeOptions {
  /**
   * Own sessionStorage key.
   * If omitted, uses MobileLayoutService panel sheet snap (`udon.mobileSheetSnap`).
   */
  storageKey?: string;
  heightForSnap: (snap: MobileSheetSnap) => number;
  applyHeight: (height: number) => void;
  currentHeight: () => number;
  /** After a resize gesture ends (clamp already applied). */
  onResizeEnd?: () => void;
  minHeight?: () => number;
  maxHeight?: () => number;
}

/**
 * Shared peek/half snap + drag-resize for mobile bottom sheets
 * (ui-panel panels and context-menu action sheets).
 */
export class MobileSheetChrome {
  snap: MobileSheetSnap = 'half';
  isCustomHeight = false;
  resizing = false;
  /** True if the last resize drag moved enough to count as a drag (title-tap guard). */
  didDrag = false;

  private startY = 0;
  private startH = 0;
  private readonly onMove = (e: PointerEvent) => this.moveResize(e);
  private readonly onUp = () => this.endResize();

  constructor(
    private readonly mobileLayout: MobileLayoutService,
    private readonly opts: MobileSheetChromeOptions,
  ) {}

  get isPeek(): boolean {
    return !this.isCustomHeight && this.snap === 'peek';
  }

  readStoredSnap(): MobileSheetSnap {
    if (this.opts.storageKey) {
      try {
        return sessionStorage.getItem(this.opts.storageKey) === 'peek' ? 'peek' : 'half';
      } catch {
        return 'half';
      }
    }
    return this.mobileLayout.rememberedSheetSnap;
  }

  rememberSnap(snap: MobileSheetSnap) {
    if (this.opts.storageKey) {
      try { sessionStorage.setItem(this.opts.storageKey, snap); } catch { /* ignore */ }
      return;
    }
    this.mobileLayout.rememberSheetSnap(snap);
  }

  /** Toggle peek ↔ half (custom height counts as non-peek → go to peek). */
  toggleSnap() {
    this.applySnap(this.isPeek ? 'half' : 'peek');
  }

  applySnap(snap: MobileSheetSnap) {
    this.isCustomHeight = false;
    this.snap = snap;
    this.rememberSnap(snap);
    this.opts.applyHeight(this.clamp(this.opts.heightForSnap(snap)));
  }

  /** Re-measure and apply current snap height (e.g. after grid paints). */
  reapplyCurrentSnapHeight() {
    if (this.isCustomHeight) return;
    this.opts.applyHeight(this.clamp(this.opts.heightForSnap(this.snap)));
  }

  startResize(e: PointerEvent): boolean {
    if (e.button === 2) return false;
    e.preventDefault();
    e.stopPropagation();
    this.resizing = true;
    this.didDrag = false;
    this.isCustomHeight = true;
    this.startY = e.clientY;
    this.startH = this.opts.currentHeight();
    document.addEventListener('pointermove', this.onMove, { capture: true });
    document.addEventListener('pointerup', this.onUp, { capture: true });
    document.addEventListener('pointercancel', this.onUp, { capture: true });
    return true;
  }

  private moveResize(e: PointerEvent) {
    if (!this.resizing) return;
    e.preventDefault();
    const dy = this.startY - e.clientY;
    if (Math.abs(dy) > 4) this.didDrag = true;
    this.opts.applyHeight(this.clamp(this.startH + dy));
  }

  endResize() {
    document.removeEventListener('pointermove', this.onMove, true);
    document.removeEventListener('pointerup', this.onUp, true);
    document.removeEventListener('pointercancel', this.onUp, true);
    if (!this.resizing) return;
    this.resizing = false;
    this.isCustomHeight = true;
    this.opts.applyHeight(this.clamp(this.opts.currentHeight()));
    this.opts.onResizeEnd?.();
  }

  destroy() {
    this.endResize();
  }

  clamp(h: number): number {
    const min = this.opts.minHeight?.() ?? this.opts.heightForSnap('peek');
    const max = this.opts.maxHeight?.()
      ?? Math.max(min, this.mobileLayout.viewportHeight - this.mobileLayout.bottomChromePx - 8);
    return Math.max(min, Math.min(max, Math.round(h)));
  }
}
