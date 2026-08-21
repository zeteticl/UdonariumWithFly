import { Injectable, OnDestroy } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import {
  applyMaskTokenFxToCharacter,
  MaskTokenFxSnapshot,
  MaskTokenFxTarget,
  restoreMaskTokenFxSnapshot,
  snapshotCharacterTokenFx,
} from '@udonarium/table-fx/mask-token-fx-apply';
import { MaskTokenFxConfig, tokenFxConfigHasWork } from '@udonarium/table-fx/mask-appearance';
import { pickTopPassiveMask } from '@udonarium/table-fx/mask-token-overlap';

import { TabletopService } from './tabletop.service';

interface ActiveZone {
  maskId: string;
  snap: MaskTokenFxSnapshot;
  /** Mask tokenFxPassiveJson at time of apply; used to detect config edits. */
  configKey: string;
}

const PASSIVE_FX_KEYS: (keyof MaskTokenFxConfig)[] = [
  'isInverse',
  'isHollow',
  'isBlackPaint',
  'isGrayscale',
  'isSepia',
  'isWhitePaint',
  'isMatrix',
  'isFlipVertical',
  'isContrast',
];

function characterMatchesPassiveConfig(ch: MaskTokenFxTarget, cfg: MaskTokenFxConfig): boolean {
  for (const key of PASSIVE_FX_KEYS) {
    if (!!(ch as any)[key] !== !!cfg[key]) return false;
  }
  return true;
}

/** Baseline used when FX were already baked into a loaded save while standing. */
function clearedFxSnapshot(ch: MaskTokenFxTarget, cfg: MaskTokenFxConfig): MaskTokenFxSnapshot {
  const snap = snapshotCharacterTokenFx(ch);
  for (const key of PASSIVE_FX_KEYS) {
    (snap as any)[key] = false;
  }
  const mode = cfg.altitudeMode || 'none';
  if (mode === 'set' || mode === 'delta') {
    // Best-effort: undo set/delta is unknown after bake; leave altitude as-is on restore.
    snap.altitudeTouched = false;
  }
  return snap;
}

/**
 * Passive mask zones: when a token stands on a mask with tokenFxPassive,
 * apply standing FX (tokenFxPassiveJson) and restore on leave. Highest posZ wins.
 */
@Injectable()
export class MaskTokenFxService implements OnDestroy {
  private started = false;
  private timer: ReturnType<typeof setTimeout> = null;
  private readonly active = new Map<string, ActiveZone>();

  constructor(private tabletopService: TabletopService) {}

  start() {
    if (this.started) return;
    this.started = true;
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', () => this.scheduleRefresh())
      .on('DELETE_GAME_OBJECT', () => this.scheduleRefresh())
      .on('UPDATE_OBJECT_CHILDREN', () => this.scheduleRefresh())
      .on('BEFORE_ROOM_SAVE', () => this.restoreAllActiveForSave())
      .on('AFTER_ROOM_SAVE', () => this.forceRefresh())
      .on('ARCHIVE_LOAD_COMPLETE', () => this.forceRefresh())
      .on<{ characterIds?: string[] }>('MASK_TOKEN_FX_ADOPT', event => {
        this.adoptCurrentAsRestorePoint(event.data?.characterIds || []);
      });
    this.scheduleRefresh();
  }

  /**
   * Before room ZIP serialize: restore pre-standing FX so temporary zone effects
   * are not baked into character SyncVars permanently.
   */
  restoreAllActiveForSave() {
    for (const [chId, zone] of Array.from(this.active.entries())) {
      const ch = ObjectStore.instance.get(chId) as MaskTokenFxTarget;
      if (ch) restoreMaskTokenFxSnapshot(ch, zone.snap);
      this.active.delete(chId);
    }
  }

  private forceRefresh() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.refresh();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    if (this.timer) clearTimeout(this.timer);
    this.started = false;
  }

  /**
   * After Alt+double-click (or other external) FX changes, update the leave-restore
   * snapshot so walking off the mask does not undo those changes.
   */
  adoptCurrentAsRestorePoint(characterIds: string[]) {
    if (!characterIds?.length) return;
    for (const id of characterIds) {
      const zone = this.active.get(id);
      if (!zone) continue;
      const ch = ObjectStore.instance.get(id) as MaskTokenFxTarget;
      if (!ch) continue;
      const altitudeTouched = zone.snap.altitudeTouched;
      zone.snap = snapshotCharacterTokenFx(ch);
      zone.snap.altitudeTouched = altitudeTouched;
    }
  }

  private scheduleRefresh() {
    if (this.active.size === 0 && !this.hasPassiveMask()) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh();
    }, 80);
  }

  private hasPassiveMask(): boolean {
    const masks = this.tabletopService.tableMasks || [];
    for (const m of masks) {
      if (m?.tokenFxPassive) return true;
    }
    return false;
  }

  private refresh() {
    if (Network.GuestMode()) return;
    if (this.active.size === 0 && !this.hasPassiveMask()) return;
    const tokens = this.tabletopService.characterTokens || [];
    const masks = (this.tabletopService.tableMasks || []).filter(m => m?.tokenFxPassive);
    const seen = new Set<string>();

    for (const ch of tokens) {
      if (!ch || ch.location.name !== 'table') continue;
      const top = pickTopPassiveMask(masks, ch);
      const chId = ch.identifier;
      seen.add(chId);
      const prev = this.active.get(chId);

      if (!top) {
        if (prev) {
          restoreMaskTokenFxSnapshot(ch, prev.snap);
          this.active.delete(chId);
        }
        continue;
      }

      const cfg = top.tokenFxPassiveConfig;
      const hasWork = tokenFxConfigHasWork(cfg);
      const configKey = top.tokenFxPassiveJson || '';

      if (prev && prev.maskId === top.identifier) {
        if (prev.configKey === configKey) continue;
        // Same mask, config edited while standing — re-apply from original snap.
        restoreMaskTokenFxSnapshot(ch, prev.snap);
        this.active.delete(chId);
        if (!hasWork) continue;
        const snap = applyMaskTokenFxToCharacter(ch, cfg);
        this.active.set(chId, { maskId: top.identifier, snap, configKey });
        continue;
      }

      if (prev) {
        restoreMaskTokenFxSnapshot(ch, prev.snap);
        this.active.delete(chId);
      }
      if (!hasWork) continue;

      // ZIP saved while standing may already have FX baked into the character.
      // Treat that as "already applied" and use a cleared baseline so leave restores cleanly.
      if (characterMatchesPassiveConfig(ch, cfg)) {
        const snap = clearedFxSnapshot(ch, cfg);
        this.active.set(chId, { maskId: top.identifier, snap, configKey });
        continue;
      }

      const snap = applyMaskTokenFxToCharacter(ch, cfg);
      this.active.set(chId, { maskId: top.identifier, snap, configKey });
    }

    for (const chId of Array.from(this.active.keys())) {
      if (seen.has(chId)) continue;
      const prev = this.active.get(chId);
      const ch = ObjectStore.instance.get(chId) as MaskTokenFxTarget;
      if (ch && prev) restoreMaskTokenFxSnapshot(ch, prev.snap);
      this.active.delete(chId);
    }
  }
}
