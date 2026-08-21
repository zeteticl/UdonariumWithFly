import { InputHandler } from 'directive/input-handler';
import { NoteHandoutComponent } from 'component/note-handout/note-handout.component';

type Callback = (srcEvent: TouchEvent | MouseEvent | PointerEvent) => void;
type OnTransformCallback = (transformX: number, transformY: number, transformZ: number, rotateX: number, rotateY: number, rotateZ: number, event: TableMouseGestureEvent, srcEvent: TouchEvent | MouseEvent | PointerEvent | KeyboardEvent) => void;

export enum TableMouseGestureEvent {
  DRAG = 'drag',
  ZOOM = 'zoom',
  ROTATE = 'rotate',
  KEYBOARD = 'keyboard',
}

enum Keyboard {
  ArrowLeft = 'ArrowLeft',
  ArrowUp = 'ArrowUp',
  ArrowRight = 'ArrowRight',
  ArrowDown = 'ArrowDown',
  KeyW = 'w',
  KeyA = 'a',
  KeyS = 's',
  KeyD = 'd',
  KeyQ = 'q',
  KeyE = 'e',
}

export class TableMouseGesture {
  private currentPositionX: number = 0;
  private currentPositionY: number = 0;

  private buttonCode: number = 0;
  private input: InputHandler = null;
  /** Acc for Alt(+Shift)+wheel view rotate → exactly 3° per notch. */
  private altWheelAcc = 0;
  /** Track Alt from key events — e.altKey can stick after Alt+wheel on Windows. */
  private altHeld = false;

  get isGrabbing(): boolean { return this.input.isGrabbing; }
  get isDragging(): boolean { return this.input.isDragging; }

  private callbackOnWheel = (e) => this.onWheel(e);
  /** Capture: always block browser Ctrl/Meta+wheel page-zoom (map uses it to pan). */
  private callbackOnWheelCapture = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.cancelable) e.preventDefault();
  };
  private callbackOnKeydown = (e) => this.onKeydown(e);
  private callbackOnKeyup = (e) => this.onKeyup(e);
  private callbackOnBlur = () => { this.altHeld = false; };

  onstart: Callback = null;
  onend: Callback = null;
  ontransform: OnTransformCallback = null;

  /**
   * @param hasObjectSelection When true, Alt(+Shift)+wheel is owned by TabletopKeyboardService
   *   (object facing/roll) — do not rotate the view. Also blocks empty-view WASD/QE.
   * @param allowViewKeyboard Desktop only: empty-selection WASD pan / QE yaw.
   */
  constructor(
    readonly targetElement: HTMLElement,
    private readonly hasObjectSelection: () => boolean = () => false,
    private readonly allowViewKeyboard: () => boolean = () => true,
  ) {
    this.initialize();
  }

  private initialize() {
    this.input = new InputHandler(this.targetElement, { capture: true });
    this.addEventListeners();
    this.input.onStart = this.onInputStart.bind(this);
    this.input.onMove = this.onInputMove.bind(this);
    this.input.onEnd = this.onInputEnd.bind(this);
  }

  cancel() {
    this.input.cancel();
  }

  destroy() {
    this.input.destroy();
    this.removeEventListeners();
  }

  onInputStart(ev: any) {
    if (NoteHandoutComponent.previewConsumesPointer) return;
    this.currentPositionX = this.input.pointer.x;
    this.currentPositionY = this.input.pointer.y;
    this.buttonCode = ev.button;
    if (this.onstart) this.onstart(ev);
  }

  onInputEnd(ev: any) {
    if (this.onend) this.onend(ev);
  }

  onInputMove(ev: any) {
    if (NoteHandoutComponent.previewConsumesPointer) return;
    let x = this.input.pointer.x;
    let y = this.input.pointer.y;
    let deltaX = x - this.currentPositionX;
    let deltaY = y - this.currentPositionY;

    let transformX = 0;
    let transformY = 0;
    let transformZ = 0;

    let rotateX = 0;
    let rotateY = 0;
    let rotateZ = 0;

    let event = TableMouseGestureEvent.DRAG;

    // Middle-drag, or Ctrl+right-drag = rotate view; plain right-drag = pan.
    const mod = !!(ev && (ev.ctrlKey || ev.metaKey));
    if (this.buttonCode === 1 || (this.buttonCode === 2 && mod)) {
      event = TableMouseGestureEvent.ROTATE;
      rotateZ = -deltaX / 5;
      rotateX = -deltaY / 5;
    } else {
      transformX = deltaX;
      transformY = deltaY;
    }

    this.currentPositionX = x;
    this.currentPositionY = y;

    if (this.ontransform) this.ontransform(transformX, transformY, transformZ, rotateX, rotateY, rotateZ, event, ev);
  }

  onWheel(ev: WheelEvent) {
    // Ctrl-preview handout owns the wheel (zoom content) — do not pan/zoom the map.
    if (NoteHandoutComponent.previewConsumesWheel) {
      if (ev.cancelable) ev.preventDefault();
      return;
    }
    // Ctrl+Shift+wheel = object rotate (handled in TabletopKeyboardService).
    if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey) return;
    // Alt+wheel with selection = object rotate (same service, capture phase).
    if ((ev.altKey || this.altHeld) && this.hasObjectSelection()) return;

    // Prefer dominant axis (Shift+wheel often becomes deltaX on OS/browser).
    const useX = Math.abs(ev.deltaX) > Math.abs(ev.deltaY);
    const rawDelta = useX ? ev.deltaX : ev.deltaY;
    let pixelDelta = 0;
    switch (ev.deltaMode) {
      case WheelEvent.DOM_DELTA_LINE:
        pixelDelta = rawDelta * 16;
        break;
      case WheelEvent.DOM_DELTA_PAGE:
        pixelDelta = rawDelta * window.innerHeight;
        break;
      default:
        pixelDelta = rawDelta;
        break;
    }
    if (pixelDelta === 0) return;

    let transformX = 0;
    let transformY = 0;
    let transformZ = 0;

    let rotateX = 0;
    let rotateY = 0;
    let rotateZ = 0;

    let event = TableMouseGestureEvent.ZOOM;

    if (ev.altKey || this.altHeld) {
      // Empty selection → rotate view ±3° per wheel notch.
      if (ev.ctrlKey || ev.metaKey) return;
      if (ev.cancelable) ev.preventDefault();
      const notch = 100;
      const stepDeg = 3;
      this.altWheelAcc += pixelDelta;
      if (Math.abs(this.altWheelAcc) < notch) return;
      const dir = this.altWheelAcc > 0 ? 1 : -1;
      // Keep remainder so rapid ticks still track; one notch → exactly stepDeg.
      this.altWheelAcc -= dir * notch;
      event = TableMouseGestureEvent.ROTATE;
      if (ev.shiftKey) {
        rotateX = -dir * stepDeg; // pitch
      } else {
        rotateZ = -dir * stepDeg; // yaw
      }
    } else if (ev.shiftKey) {
      // Shift + wheel → pan left / right
      transformX = -pixelDelta;
      event = TableMouseGestureEvent.DRAG;
      if (ev.cancelable) ev.preventDefault();
    } else if (ev.ctrlKey || ev.metaKey) {
      // Ctrl + wheel → pan up / down
      transformY = -pixelDelta;
      event = TableMouseGestureEvent.DRAG;
      if (ev.cancelable) ev.preventDefault();
    } else {
      transformZ = pixelDelta * -1.5;
      if (300 ** 2 < transformZ ** 2) transformZ = Math.min(Math.max(transformZ, -300), 300);
    }

    if (this.ontransform) this.ontransform(transformX, transformY, transformZ, rotateX, rotateY, rotateZ, event, ev);
  }

  onKeydown(ev: KeyboardEvent) {
    if (this.shouldIgnoreKeyTarget(ev)) return;

    if (ev.code === 'AltLeft' || ev.code === 'AltRight') {
      this.altHeld = true;
      if (ev.cancelable) ev.preventDefault();
      return;
    }

    let transformX = 0;
    let transformY = 0;
    let transformZ = 0;

    let rotateX = 0;
    let rotateY = 0;
    let rotateZ = 0;

    let key = this.getKeyName(ev);

    // Empty selection (desktop): WASD = forward/back/strafe; Q/E yaw ±3°.
    // Pan axes are remapped by view yaw in onTableMouseTransform.
    // Use tracked altHeld — not e.altKey (sticky after Alt+wheel on Windows).
    if (
      this.allowViewKeyboard()
      && !this.hasObjectSelection()
      && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !this.altHeld
    ) {
      const code = ev.code;
      let handled = false;
      if (code === 'KeyW' || key === Keyboard.KeyW) {
        transformY = 14; // forward (depth remapped in game-table)
        handled = true;
      } else if (code === 'KeyS' || key === Keyboard.KeyS) {
        transformY = -14;
        handled = true;
      } else if (code === 'KeyA' || key === Keyboard.KeyA) {
        transformX = 10;
        handled = true;
      } else if (code === 'KeyD' || key === Keyboard.KeyD) {
        transformX = -10;
        handled = true;
      } else if (code === 'KeyQ' || key === Keyboard.KeyQ) {
        rotateZ = -3;
        handled = true;
      } else if (code === 'KeyE' || key === Keyboard.KeyE) {
        rotateZ = 3;
        handled = true;
      }
      if (handled) {
        if (ev.cancelable) ev.preventDefault();
        if (this.ontransform) this.ontransform(transformX, transformY, transformZ, rotateX, rotateY, rotateZ, TableMouseGestureEvent.KEYBOARD, ev);
        return;
      }
    }

    switch (key) {
      case Keyboard.ArrowLeft:
        if (ev.shiftKey) {
          rotateZ = -2;
        } else {
          transformX = 10;
        }
        break;
      case Keyboard.ArrowUp:
        if (ev.shiftKey) {
          rotateX = -2;
        } else if (ev.ctrlKey) {
          transformZ = 150;
        } else {
          transformY = 10;
        }
        break;
      case Keyboard.ArrowRight:
        if (ev.shiftKey) {
          rotateZ = 2;
        } else {
          transformX = -10;
        }
        break;
      case Keyboard.ArrowDown:
        if (ev.shiftKey) {
          rotateX = 2;
        } else if (ev.ctrlKey) {
          transformZ = -150;
        } else {
          transformY = -10;
        }
        break;
      default:
        return;
    }
    if (this.ontransform) this.ontransform(transformX, transformY, transformZ, rotateX, rotateY, rotateZ, TableMouseGestureEvent.KEYBOARD, ev);
  }

  private shouldIgnoreKeyTarget(ev: KeyboardEvent): boolean {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return !!target.closest('[contenteditable="true"], [contenteditable=""]');
  }

  onKeyup(ev: KeyboardEvent) {
    if (ev.code === 'AltLeft' || ev.code === 'AltRight') {
      this.altHeld = false;
      return;
    }
    // Heal lost Alt keyup (common after Alt+wheel on Windows).
    if (!ev.altKey) this.altHeld = false;
  }

  private getKeyName(keyboard: KeyboardEvent): string {
    if (keyboard.key) return keyboard.key.length === 1 ? keyboard.key.toLowerCase() : keyboard.key;
    switch (keyboard.keyCode) {
      case 37: return Keyboard.ArrowLeft;
      case 38: return Keyboard.ArrowUp;
      case 39: return Keyboard.ArrowRight;
      case 40: return Keyboard.ArrowDown;
      case 87: return Keyboard.KeyW;
      case 65: return Keyboard.KeyA;
      case 83: return Keyboard.KeyS;
      case 68: return Keyboard.KeyD;
      case 81: return Keyboard.KeyQ;
      case 69: return Keyboard.KeyE;
      default: return '';
    }
  }

  private addEventListeners() {
    this.targetElement.addEventListener('wheel', this.callbackOnWheel, { passive: false });
    // Capture on window so Ctrl+wheel during note preview (and elsewhere) cannot zoom the browser.
    window.addEventListener('wheel', this.callbackOnWheelCapture, { capture: true, passive: false });
    document.body.addEventListener('keydown', this.callbackOnKeydown, false);
    document.body.addEventListener('keyup', this.callbackOnKeyup, false);
    window.addEventListener('blur', this.callbackOnBlur);
  }

  private removeEventListeners() {
    this.targetElement.removeEventListener('wheel', this.callbackOnWheel);
    window.removeEventListener('wheel', this.callbackOnWheelCapture, true);
    document.body.removeEventListener('keydown', this.callbackOnKeydown, false);
    document.body.removeEventListener('keyup', this.callbackOnKeyup, false);
    window.removeEventListener('blur', this.callbackOnBlur);
  }
}
