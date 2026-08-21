import { Injectable } from '@angular/core';

/**
 * Fullscreen “connecting / creating room / loading” busy state.
 * Nested show/hide uses a depth counter so one hide cannot clear another caller’s overlay.
 * Accessible from static helpers via ConnectionBusyService.instance.
 */
@Injectable({ providedIn: 'root' })
export class ConnectionBusyService {
  private static _instance: ConnectionBusyService | null = null;
  static get instance(): ConnectionBusyService | null {
    return ConnectionBusyService._instance;
  }

  busy = false;
  messageKey = 'peer.connectingRoom';
  private depth = 0;

  private listeners = new Set<() => void>();

  constructor() {
    ConnectionBusyService._instance = this;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  show(messageKey: string = 'peer.connectingRoom') {
    this.depth++;
    this.messageKey = messageKey || 'peer.connectingRoom';
    this.busy = true;
    this.notify();
  }

  hide() {
    if (this.depth <= 0) {
      this.depth = 0;
      if (this.busy) {
        this.busy = false;
        this.notify();
      }
      return;
    }
    this.depth--;
    if (this.depth === 0) {
      this.busy = false;
      this.notify();
    }
  }

  async run<T>(work: Promise<T> | (() => Promise<T>), messageKey?: string): Promise<T> {
    this.show(messageKey);
    try {
      return await (typeof work === 'function' ? work() : work);
    } finally {
      this.hide();
    }
  }
}
