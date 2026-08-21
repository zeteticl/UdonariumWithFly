import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { GameObject } from './core/synchronize-object/game-object';
import { ObjectStore } from './core/synchronize-object/object-store';
import { CharacterToken } from './character-token';
import { GameCharacter } from './game-character';
import { TextNote } from './text-note';
import { TableSelecter } from './table-selecter';
import {
  notePinAnchorPx,
  pinAnchorPx,
  stringPathD,
  tokenCenterAnchorPx,
  tokenVisualHeightPx,
} from './table-fx/push-pin.util';

export type ClueLinkEndpoint = CharacterToken | GameCharacter | TextNote;

@SyncObject('clue-link')
export class ClueLink extends GameObject {
  @SyncVar() fromIdentifier: string = '';
  @SyncVar() toIdentifier: string = '';
  /** Slack factor for Bezier sag (0.05–0.55 typical). */
  @SyncVar() sag: number = 0.22;
  @SyncVar() color: string = '#c62828';
  /** Optional: only show when this table is viewed (empty = any). */
  @SyncVar() tableIdentifier: string = '';

  get fromObject(): ClueLinkEndpoint | null {
    return ClueLink.resolveEndpoint(this.fromIdentifier);
  }

  get toObject(): ClueLinkEndpoint | null {
    return ClueLink.resolveEndpoint(this.toIdentifier);
  }

  static resolveEndpoint(id: string): ClueLinkEndpoint | null {
    if (!id) return null;
    const obj = ObjectStore.instance.get(id);
    if (obj instanceof CharacterToken || obj instanceof TextNote) return obj;
    if (obj instanceof GameCharacter) {
      // Prefer the map Token when the body is off-table (strict body/TOKEN model).
      const tok = CharacterToken.focusTokenForCharacter(obj.identifier);
      if (tok) return tok;
      return obj;
    }
    return null;
  }

  static create(
    fromId: string,
    toId: string,
    opts?: { sag?: number; color?: string; tableIdentifier?: string; identifier?: string },
  ): ClueLink {
    const link = opts?.identifier ? new ClueLink(opts.identifier) : new ClueLink();
    link.fromIdentifier = fromId;
    link.toIdentifier = toId;
    if (opts?.sag != null) link.sag = opts.sag;
    if (opts?.color) link.color = opts.color;
    if (opts?.tableIdentifier) link.tableIdentifier = opts.tableIdentifier;
    link.initialize();
    return link;
  }

  static all(): ClueLink[] {
    return ObjectStore.instance.getObjects<ClueLink>(ClueLink);
  }

  static cleanupFor(endpointId: string): void {
    if (!endpointId) return;
    for (const link of ClueLink.all()) {
      if (link.fromIdentifier === endpointId || link.toIdentifier === endpointId) {
        link.destroy();
      }
    }
  }

  /**
   * After ZIP reload, self-echo DELETE must not wipe newly parsed links
   * that still reference reused syncIds.
   */
  static shouldCleanupOnEndpointDelete(opts: {
    isSendFromSelf?: boolean;
    aliasName?: string;
  }): boolean {
    if (opts.isSendFromSelf) return false;
    const alias = opts.aliasName || '';
    return alias === GameCharacter.aliasName
      || alias === CharacterToken.aliasName
      || alias === 'character-token'
      || alias === TextNote.aliasName;
  }

  isValidOnTable(viewTableId: string): boolean {
    if (this.tableIdentifier && viewTableId && this.tableIdentifier !== viewTableId) return false;
    const a = this.fromObject;
    const b = this.toObject;
    if (!a || !b) return false;
    if (!a.isVisibleOnTable || !b.isVisibleOnTable) return false;
    return true;
  }

  pathD(gridSize = 50): string | null {
    const a = this.fromObject;
    const b = this.toObject;
    if (!a || !b) return null;
    const p1 = endpointPinAnchor(a, gridSize);
    const p2 = endpointPinAnchor(b, gridSize);
    return stringPathD(p1.x, p1.y, p2.x, p2.y, this.sag);
  }
}

function endpointPinAnchor(obj: ClueLinkEndpoint, gridSize: number): { x: number; y: number } {
  const pose = obj.getPoseForView();
  const host = {
    pushPin: !!obj.pushPin,
    pushPinAngle: obj.pushPinAngle || 0,
    pushPinStyle: obj.pushPinStyle,
    pushPinLeft: obj.pushPinLeft,
    pushPinTop: obj.pushPinTop,
    location: { x: pose.x, y: pose.y },
    rotate: (typeof pose.rotate === 'number' ? pose.rotate : obj.rotate) || 0,
  };
  if (obj instanceof CharacterToken || obj instanceof GameCharacter) {
    const s = (obj.size || 1) * gridSize;
    // 3D: token XYZ center; 2D corkboard: push-pin tip.
    if (!TableSelecter.instance?.viewTable?.is2DMode) {
      const c = tokenCenterAnchorPx(
        { ...obj, location: host.location, posZ: pose.posZ, rotate: host.rotate },
        s,
        tokenVisualHeightPx(obj, gridSize),
        gridSize,
      );
      return { x: c.x, y: c.y };
    }
    return pinAnchorPx(host, s, s);
  }
  const w = (obj.width || 1) * gridSize;
  const h = (obj.height || 1) * gridSize;
  return notePinAnchorPx(host, w, h);
}
