import { NgZone } from '@angular/core';
import { MathUtil } from '@udonarium/core/system/util/math-util';

type Callback = (srcEvent: TouchEvent | MouseEvent | PointerEvent) => void;
type OnGestureCallback = (srcEvent: TouchEvent | MouseEvent | PointerEvent) => void;
type OnTransformCallback = (transformX: number, transformY: number, transformZ: number, rotateX: number, rotateY: number, rotateZ: number, event: TableTouchGestureEvent, srcEvent: TouchEvent | MouseEvent | PointerEvent) => void;

export enum TableTouchGestureEvent {
  PAN = 'pan',
  TAP_PINCH = 'tappinch',
  PINCH = 'pinch',
  ROTATE = 'rotate',
}

/** While multi-touch recognizers compete, lock to one dominant view gesture. */
type MultiTouchLock = 'none' | 'rotate' | 'pinch';

export class TableTouchGesture {
  private hammer: HammerManager = null;
  private deltaHammerDeltaX: number = 0;
  private deltaHammerDeltaY = 1.0;
  private deltaHammerScale = 1.0;
  private deltaHammerRotation = 0;

  private prevHammerDeltaX: number = 0;
  private prevHammerDeltaY: number = 0;
  private prevHammerScale: number = 0;
  private prevHammerRotation: number = 0;

  private tappedPanTimer: NodeJS.Timeout = null;
  private tappedPanCenter: HammerPoint = { x: 0, y: 0 };

  /** Mobile: once rotate or pinch wins, keep it until fingers lift. */
  private multiTouchLock: MultiTouchLock = 'none';

  /**
   * When true (phones / tablets), 1-finger drag always pans.
   * Tap-then-drag vertical zoom is disabled — pinch zooms instead.
   * Desktop mouse path does not use this class.
   */
  simplePan = false;

  onstart: Callback = null;
  onend: Callback = null;
  ongesture: OnGestureCallback = null;
  ontransform: OnTransformCallback = null;

  constructor(readonly targetElement: Element, private readonly ngZone: NgZone) {
    this.initializeHammer();
  }

  destroy() {
    this.clearTappedPanTimer();
    this.hammer.destroy();
  }

  private initializeHammer() {
    this.hammer = new Hammer.Manager(this.targetElement, { inputClass: Hammer.TouchInput });

    let tap = new Hammer.Tap();
    let pan1p = new Hammer.Pan({ event: 'pan1p', pointers: 1, threshold: 0 });
    let pan2p = new Hammer.Pan({ event: 'pan2p', pointers: 2, threshold: 0 });
    let pinch = new Hammer.Pinch();
    let rotate = new Hammer.Rotate();

    pan1p.recognizeWith(pan2p);
    pan1p.recognizeWith(rotate);
    pan1p.recognizeWith(pinch);

    pan2p.recognizeWith(pinch);
    pan2p.recognizeWith(rotate);
    pinch.recognizeWith(rotate);

    this.hammer.add([tap, pan1p, pan2p, pinch, rotate]);

    this.hammer.on('hammer.input', this.onHammer.bind(this));
    this.hammer.on('tap', this.onTap.bind(this));
    this.hammer.on('pan1pstart', this.onTappedPanStart.bind(this));
    this.hammer.on('pan1pmove', this.onTappedPanMove.bind(this));
    this.hammer.on('pan1pend', this.onTappedPanEnd.bind(this));
    this.hammer.on('pan1pcancel', this.onTappedPanEnd.bind(this));
    this.hammer.on('pan2pmove', this.onPanMove.bind(this));
    this.hammer.on('pinchmove', this.onPinchMove.bind(this));
    this.hammer.on('rotatemove', this.onRotateMove.bind(this));

    // Long-press → contextmenu (iOS / some Android lack native).
    // Mobile (simplePan): empty-table long-press is ping (pointer hold), not add-menu.
    // Object long-press still opens the object menu.
    let ua = window.navigator.userAgent.toLowerCase();
    let needsSyntheticContextMenu =
      ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1
      || (ua.indexOf('macintosh') > -1 && 'ontouchend' in document)
      || ua.indexOf('android') > -1;
    if (!needsSyntheticContextMenu) return;
    this.hammer.add(new Hammer.Press({ time: 550 }));
    this.hammer.on('press', ev => {
      if (this.simplePan) {
        const t = ev.target;
        const onObject = t instanceof Element && !!t.closest(
          '[appMovable], [appRotable], [appResizable], game-character, card, card-stack, dice-symbol, text-note, terrain, game-table-mask, range'
        );
        if (!onObject) return;
      }
      let event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: ev.center.x,
        clientY: ev.center.y,
      });
      this.ngZone.run(() => ev.srcEvent.target.dispatchEvent(event));
    });
  }

  private onHammer(ev: HammerInput) {
    if (ev.isFirst) {
      this.multiTouchLock = 'none';
      this.deltaHammerScale = ev.scale;
      this.deltaHammerRotation = ev.rotation;
      this.deltaHammerDeltaX = ev.deltaX;
      this.deltaHammerDeltaY = ev.deltaY;
      if (this.onstart) this.onstart(ev.srcEvent);
    } else if (ev.isFinal) {
      this.multiTouchLock = 'none';
      if (this.onend) this.onend(ev.srcEvent);
    } else {
      this.deltaHammerScale = ev.scale - this.prevHammerScale;
      this.deltaHammerRotation = ev.rotation - this.prevHammerRotation;
      this.deltaHammerDeltaX = ev.deltaX - this.prevHammerDeltaX;
      this.deltaHammerDeltaY = ev.deltaY - this.prevHammerDeltaY;
    }
    this.prevHammerScale = ev.scale;
    this.prevHammerRotation = ev.rotation;
    this.prevHammerDeltaX = ev.deltaX;
    this.prevHammerDeltaY = ev.deltaY;

    if (this.simplePan || this.tappedPanTimer == null || ev.eventType != Hammer.INPUT_START) return;
    let distance = MathUtil.sqrMagnitude(this.tappedPanCenter, ev.center);
    if (50 ** 2 < distance) {
      this.clearTappedPanTimer();
    }
  }

  private onTap(ev: HammerInput) {
    if (this.simplePan) {
      if (this.ongesture) this.ongesture(ev.srcEvent);
      return;
    }
    this.tappedPanCenter = ev.center;
    this.tappedPanTimer = setTimeout(() => { this.tappedPanTimer = null; }, 400);
    if (this.ongesture) this.ongesture(ev.srcEvent);
  }

  private onTappedPanStart(ev: HammerInput) {
    if (this.simplePan) {
      // Enable transform mode once; do not spam gesture (would clear object isDragging).
      if (this.ongesture) this.ongesture(ev.srcEvent);
      return;
    }
    if (this.tappedPanTimer == null) return;
    this.clearTappedPanTimer(false);
    if (this.ongesture) this.ongesture(ev.srcEvent);
  }

  private onTappedPanEnd(ev: HammerInput) {
    this.clearTappedPanTimer();
  }

  private onTappedPanMove(ev: HammerInput) {
    // pan1p still fires during 2-finger gestures via recognizeWith — leave view to pan2p/pinch.
    if (this.touchCount(ev) >= 2) return;

    if (this.simplePan || this.tappedPanTimer == null) {
      let transformX = this.deltaHammerDeltaX;
      let transformY = this.deltaHammerDeltaY;
      let transformZ = 0;
      // Pan must not call ongesture each move — that clears pointerDevice.isDragging mid object-drag.
      if (this.ontransform) this.ontransform(transformX, transformY, transformZ, 0, 0, 0, TableTouchGestureEvent.PAN, ev.srcEvent);
    } else {
      this.clearTappedPanTimer(false);
      let scale = this.deltaHammerDeltaY;
      let transformZ = scale * 7.5;
      if (this.ongesture) this.ongesture(ev.srcEvent);
      if (this.ontransform) this.ontransform(0, 0, transformZ, 0, 0, 0, TableTouchGestureEvent.TAP_PINCH, ev.srcEvent);
    }
  }

  private onPanMove(ev: HammerInput) {
    this.clearTappedPanTimer();
    if (this.ongesture) this.ongesture(ev.srcEvent);
    if (this.simplePan) {
      // Mobile two-finger drag = middle-mouse free rotate (yaw + pitch). Pinch zooms.
      if (this.multiTouchLock === 'pinch') return;
      if (this.multiTouchLock === 'none') this.multiTouchLock = 'rotate';
      const rotateZ = -this.deltaHammerDeltaX / 5;
      const rotateX = -this.deltaHammerDeltaY / 5;
      if (this.ontransform) {
        this.ontransform(0, 0, 0, rotateX, 0, rotateZ, TableTouchGestureEvent.ROTATE, ev.srcEvent);
      }
      return;
    }
    // Desktop touch path: two-finger vertical = pitch.
    const rotateX = -this.deltaHammerDeltaY / window.innerHeight * 100;
    if (this.ontransform) this.ontransform(0, 0, 0, rotateX, 0, 0, TableTouchGestureEvent.ROTATE, ev.srcEvent);
  }

  private onPinchMove(ev: HammerInput) {
    this.clearTappedPanTimer();
    // Ignore tiny scale jitter while two-finger pan/rotate dominates.
    if (Math.abs(this.deltaHammerScale) < 0.008) return;
    if (this.simplePan) {
      // Finger distance drifts during a rotate swipe on iOS — require clearer pinch intent.
      if (this.multiTouchLock === 'rotate') return;
      if (this.multiTouchLock === 'none') {
        if (Math.abs(this.deltaHammerScale) < 0.02) return;
        this.multiTouchLock = 'pinch';
      }
    }
    const transformZ = this.deltaHammerScale * 500;
    if (this.ongesture) this.ongesture(ev.srcEvent);
    if (this.ontransform) this.ontransform(0, 0, transformZ, 0, 0, 0, TableTouchGestureEvent.PINCH, ev.srcEvent);
  }

  private onRotateMove(ev: HammerInput) {
    this.clearTappedPanTimer();
    // Mobile simplePan: 2-finger drag already applies yaw+pitch — skip Hammer yaw-only rotate.
    if (this.simplePan) return;
    const rotateZ = this.deltaHammerRotation;
    if (this.ongesture) this.ongesture(ev.srcEvent);
    if (this.ontransform) this.ontransform(0, 0, 0, 0, 0, rotateZ, TableTouchGestureEvent.ROTATE, ev.srcEvent);
  }

  private touchCount(ev: HammerInput): number {
    const src = ev.srcEvent;
    return src instanceof TouchEvent ? src.touches.length : 0;
  }

  private clearTappedPanTimer(needsSetNull: boolean = true) {
    clearTimeout(this.tappedPanTimer);
    if (needsSetNull) this.tappedPanTimer = null;
  }
}
