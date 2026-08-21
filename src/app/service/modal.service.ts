import { ComponentRef, Injectable, Injector, OnChanges, ViewContainerRef } from '@angular/core';
import { I18nService } from './i18n.service';

class ModalContext {
  constructor(
    private _resolve: Function,
    private _reject: Function,
    public option?: any
  ) {
  }
  resolve(value: any) {
    this._resolve(value);
    this._resolve = null;
  }
  reject(reason?: any) {
    this._reject(reason);
    this._reject = null;
  }
}

@Injectable()
export class ModalService {
  private modalContext: ModalContext = null;
  private count = 0;
  /** Child modal services currently open (top = last). */
  private static activeStack: ModalService[] = [];

  title: string = 'Untitled dialog';

  /* Todo */
  static defaultParentViewContainerRef: ViewContainerRef;
  static ModalComponentClass: { new(...args: any[]): any } = null;

  constructor(private i18n: I18nService) {
    this.title = this.i18n.t('modal.untitled');
  }

  get option(): any {
    return this.modalContext ? this.modalContext.option : null;
  }

  get isShow(): boolean {
    return this.count > 0;
  }

  /** Dismiss the topmost modal as cancel (false). Returns true if a modal was closed. */
  static dismissTop(): boolean {
    const top = ModalService.activeStack[ModalService.activeStack.length - 1];
    if (!top?.modalContext) return false;
    top.resolve(false);
    return true;
  }

  private static pushActive(service: ModalService) {
    ModalService.activeStack.push(service);
  }

  private static popActive(service: ModalService) {
    const i = ModalService.activeStack.lastIndexOf(service);
    if (i >= 0) ModalService.activeStack.splice(i, 1);
  }

  open<T>(childComponent: { new(...args: any[]) }, option?, parentViewContainerRef?: ViewContainerRef): Promise<T> {
    if (!parentViewContainerRef) {
      parentViewContainerRef = ModalService.defaultParentViewContainerRef;
    }
    return new Promise<T>((resolve, reject) => {
      // 建立 Injector
      const _resolve = (val: T) => {
        if (panelComponentRef) {
          ModalService.popActive(childModalService);
          panelComponentRef.destroy();
          resolve(val);
          this.count--;
        }
      };

      const _reject = (reason?: any) => {
        if (panelComponentRef) {
          ModalService.popActive(childModalService);
          panelComponentRef.destroy();
          reject(reason);
          this.count--;
        }
      };

      const childModalService: ModalService = new ModalService(this.i18n);
      childModalService.modalContext = new ModalContext(_resolve, _reject, option);
      ModalService.pushActive(childModalService);

      const parentInjector = parentViewContainerRef.injector;
      const injector = Injector.create({ providers: [{ provide: ModalService, useValue: childModalService }], parent: parentInjector });

      let panelComponentRef: ComponentRef<any> = parentViewContainerRef.createComponent(ModalService.ModalComponentClass, { index: parentViewContainerRef.length, injector: injector });
      let bodyComponentRef: ComponentRef<any> = panelComponentRef.instance.content.createComponent(childComponent);

      panelComponentRef.onDestroy(() => {
        ModalService.popActive(childModalService);
        panelComponentRef = null;
        this.count--;
      });

      bodyComponentRef.onDestroy(() => {
        bodyComponentRef = null;
        this.count--;
      });

      this.count++;

      let panelOnChanges = panelComponentRef.instance as OnChanges;
      let bodyOnChanges = bodyComponentRef.instance as OnChanges;
      if (panelOnChanges?.ngOnChanges != null || bodyOnChanges?.ngOnChanges != null) {
        queueMicrotask(() => {
          if (bodyComponentRef) bodyOnChanges?.ngOnChanges({});
          if (panelComponentRef) panelOnChanges?.ngOnChanges({});
        });
      }
    });
  }

  resolve(value?: any) {
    if (this.modalContext) {
      this.modalContext.resolve(value);
      this.modalContext = null;
    }
  }

  reject(reason?: any) {
    if (this.modalContext) {
      this.modalContext.reject(reason);
      this.modalContext = null;
    }
  }
}