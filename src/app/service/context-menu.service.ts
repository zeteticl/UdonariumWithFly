import { ComponentRef, Injectable, ViewContainerRef } from '@angular/core';
import { TabletopObject } from '@udonarium/tabletop-object';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { PeerCursor } from '@udonarium/peer-cursor';

interface ContextMenuPoint {
  x: number,
  y: number
}

export enum ContextMenuType {
  ACTION = 'action',
  SEPARATOR = 'separator',
}

export const ContextMenuSeparator: ContextMenuAction = {
  name: '',
  disabled: true,
  type: ContextMenuType.SEPARATOR
}

export interface ContextMenuAction {
  name: string,
  action?: Function,
  disabled?: boolean,
  type?: ContextMenuType,
  subActions?: ContextMenuAction[],
  altitudeHande?: TabletopObject,
  altitudeDisabled?: boolean,
  default?: boolean,
  icon?: ImageFile,
  error?: string,
  materialIcon?: string,
  isOuterLink?: boolean,
  selfOnly?: boolean,
  level?: number,
  color?: string,
  center?: boolean,
  colorSample?: boolean,
  /** CSS color for the color-sample swatch (preferred over matching Chinese labels). */
  sampleColor?: string,
  hotkey?: string,
  checkBox?: string,
  /** Native browser tooltip (HTML title). */
  tip?: string,
  /** Override close behavior. Default: stay open for checkBox/radio, close for normal actions. */
  keepOpen?: boolean,
  /** Optional: refresh displayed name after action while menu stays open. */
  nameUpdate?: () => string,
}

/**
 * Checkbox that toggles live state (safe to click repeatedly while menu stays open).
 *
 * Modern label style (preferred):
 *   { label: '僅自己可見' } → "☑ 僅自己可見" / "☐ 僅自己可見"
 *   Checkbox shows current state; label names the feature (not the action / opposite).
 *
 * Legacy:
 *   { on: '☑ …', off: '☐ …' } still supported.
 */
export function contextMenuToggleCheck(options: {
  get: () => boolean;
  set: (value: boolean) => void;
  /** Feature name; ☑/☐ prefix is applied from get(). */
  label?: string;
  /** Legacy on-state text (may already include ☑). */
  on?: string;
  /** Legacy off-state text (may already include ☐). */
  off?: string;
  after?: () => void;
  disabled?: boolean;
  error?: string;
  tip?: string;
  level?: number;
  selfOnly?: boolean;
  hotkey?: string;
}): ContextMenuAction {
  const nameUpdate = () => {
    if (options.label != null && options.label !== '') {
      const body = String(options.label).replace(/^[☑☐]\s*/, '');
      return `${options.get() ? '☑' : '☐'} ${body}`;
    }
    return options.get() ? (options.on ?? '') : (options.off ?? '');
  };
  return {
    name: nameUpdate(),
    nameUpdate,
    action: () => {
      options.set(!options.get());
      options.after?.();
    },
    checkBox: 'check',
    disabled: options.disabled,
    error: options.error,
    tip: options.tip,
    level: options.level,
    selfOnly: options.selfOnly,
    hotkey: options.hotkey,
  };
}

@Injectable()
export class ContextMenuService {
  /* Todo */
  static defaultParentViewContainerRef: ViewContainerRef;
  static ContextMenuComponentClass: { new(...args: any[]): any } = null;

  private panelComponentRef: ComponentRef<any>
  /** Bumped on each open(); actions that replace the menu must not close the successor. */
  private openSerial = 0;

  title: string = '';
  actions: ContextMenuAction[] = [];
  position: ContextMenuPoint = { x: 0, y: 0 };
  titleColor: string = PeerCursor.CHAT_DEFAULT_COLOR;
  titleBold: boolean = false;

  get isShow(): boolean {
    return this.panelComponentRef ? true : false;
  }

  /** Monotonic id for the currently opening / open menu. */
  get serial(): number {
    return this.openSerial;
  }

  open(position: ContextMenuPoint, actions: ContextMenuAction[], title?: string, parentViewContainerRef?: ViewContainerRef, titleColor?: string, titleBold?: boolean) {
    this.close();
    this.openSerial++;
    if (!parentViewContainerRef) {
      parentViewContainerRef = ContextMenuService.defaultParentViewContainerRef;
    }

    const injector = parentViewContainerRef.injector;
    let panelComponentRef: ComponentRef<any> = parentViewContainerRef.createComponent(ContextMenuService.ContextMenuComponentClass, { index: parentViewContainerRef.length, injector: injector });

    const childPanelService: ContextMenuService = panelComponentRef.injector.get(ContextMenuService);

    childPanelService.panelComponentRef = panelComponentRef;
    if (actions) {
      childPanelService.actions = actions;
    }
    if (position) {
      childPanelService.position.x = position.x;
      childPanelService.position.y = position.y;
    }
    if (titleColor) {
      childPanelService.titleColor = titleColor;
    } else {
      childPanelService.titleColor = PeerCursor.CHAT_DEFAULT_COLOR;
    }
    childPanelService.titleBold = titleBold;

    childPanelService.title = title != null ? title : '';

    panelComponentRef.onDestroy(() => {
      childPanelService.panelComponentRef = null;
    });
  }

  close() {
    if (this.panelComponentRef) {
      this.panelComponentRef.destroy();
      this.panelComponentRef = null;
    }
  }
}