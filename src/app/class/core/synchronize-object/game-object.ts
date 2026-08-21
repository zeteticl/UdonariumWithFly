import { UUID } from '../system/util/uuid';
import { ObjectFactory } from './object-factory';
import { ObjectSerializer } from './object-serializer';
import { ObjectStore } from './object-store';

export interface ObjectContext {
  aliasName: string;
  identifier: string;
  majorVersion: number;
  minorVersion: number;
  syncData: Object;
}

export class GameObject {
  private context: ObjectContext = {
    aliasName: (<typeof GameObject>this.constructor).aliasName,
    identifier: '',
    majorVersion: 0,
    minorVersion: 0,
    syncData: {}
  }

  /** When true, SyncVar setters / update() do not version-bump or broadcast. */
  private _syncSuppressed = false;

  static get aliasName() { return ObjectFactory.instance.getAlias(this); }
  get aliasName() { return this.context.aliasName; }
  get identifier() { return this.context.identifier; }
  get version() { return this.context.majorVersion + this.context.minorVersion; }

  get syncSuppressed(): boolean { return this._syncSuppressed; }
  set syncSuppressed(value: boolean) { this._syncSuppressed = !!value; }

  constructor(identifier: string = UUID.generateUuid()) {
    this.context.identifier = identifier;
  }

  initialize() {
    ObjectStore.instance.add(this);
  }

  destroy() {
    ObjectStore.instance.delete(this);
  }

  /** Remove from the local store without broadcasting DELETE (join-time clear). */
  destroyLocal() {
    ObjectStore.instance.delete(this, false);
  }

  // GameObject Lifecycle
  onStoreAdded() { }

  // GameObject Lifecycle
  onStoreRemoved() { }

  /** Run SyncVar writes without network UPDATE (map hydrate / inbound create). */
  withSyncSuppressed(fn: () => void) {
    const prev = this._syncSuppressed;
    this._syncSuppressed = true;
    try {
      fn();
    } finally {
      this._syncSuppressed = prev;
    }
  }

  update() {
    if (this._syncSuppressed) return;
    this.versionUp();
    ObjectStore.instance.update(this.identifier);
  }

  private versionUp() {
    this.context.majorVersion += 1;
    this.context.minorVersion = Math.random();
  }

  /**
   * Raise sync version above typical session bumps so peers treat this
   * instance as authoritative (e.g. after room ZIP / folder backup load).
   */
  claimSyncAuthority(broadcast = true) {
    if (this._syncSuppressed) return;
    const floor = Math.floor(Date.now() / 1000);
    if (this.context.majorVersion < floor) {
      this.context.majorVersion = floor;
    } else {
      this.context.majorVersion += 1;
    }
    this.context.minorVersion = Math.random();
    if (broadcast) ObjectStore.instance.update(this.identifier);
  }

  /** Drop local version so a peer's catalog/UPDATE can win LWW (join room). */
  yieldSyncAuthority() {
    this.context.majorVersion = 0;
    this.context.minorVersion = 0;
  }

  apply(context: ObjectContext) {
    if (context !== null && this.identifier === context.identifier) {
      this.context.majorVersion = context.majorVersion;
      this.context.minorVersion = context.minorVersion;
      this.context.syncData = context.syncData;
    }
  }

  clone(): this {
    const xmlString = this.toXml();
    const object = <this>ObjectSerializer.instance.parseXml(xmlString);
    return object;
  }
  
  complement(): void {};
  
  toContext(): ObjectContext {
    return {
      aliasName: this.context.aliasName,
      identifier: this.context.identifier,
      majorVersion: this.context.majorVersion,
      minorVersion: this.context.minorVersion,
      syncData: deepCopy(this.context.syncData)
    }
  }

  toXml(): string {
    return ObjectSerializer.instance.toXml(this);
  }
}

function deepCopy(obj: Object): Object {
  if (obj == null) return obj;
  let clone = Array.isArray(obj) ? [] : {};
  let keys = Object.getOwnPropertyNames(obj);
  for (let key of keys) {
    let type = typeof obj[key];
    if (obj[key] != null && type === 'object') {
      clone[key] = deepCopy(obj[key]);
    } else if (type !== 'function') {
      clone[key] = obj[key];
    }
  }
  return clone;
}
