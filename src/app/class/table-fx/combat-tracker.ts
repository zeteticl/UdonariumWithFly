import { SyncObject, SyncVar } from '../core/synchronize-object/decorator';
import { GameObject } from '../core/synchronize-object/game-object';
import { InnerXml } from '../core/synchronize-object/object-serializer';
import { EventSystem } from '../core/system';
import { UUID } from '../core/system/util/uuid';
import { translate } from 'i18n';

export type InitiativeDice = 'd20' | 'd100';

export interface CombatantData {
  id: string;
  characterIdentifier: string;
  name: string;
  initiative: number | null;
  isNpc: boolean;
  isDefeated: boolean;
  isHidden: boolean;
  imageIdentifier: string;
}

export interface EncounterData {
  id: string;
  name: string;
  isStarted: boolean;
  round: number;
  turnIndex: number;
  skipDefeated: boolean;
  initiativeDice: InitiativeDice;
  /** Detail/ability field name shown in the resource column (e.g. HP, 敏捷). */
  trackedResourceName: string;
  combatants: CombatantData[];
}

@SyncObject('combat-tracker')
export class CombatTracker extends GameObject implements InnerXml {
  @SyncVar() encountersJson: string = '[]';
  @SyncVar() activeEncounterId: string = '';

  private static _instance: CombatTracker;
  private _encountersCache: EncounterData[] = [];
  private _encountersCacheJson: string = '';

  static get instance(): CombatTracker {
    if (!CombatTracker._instance) {
      CombatTracker._instance = new CombatTracker('CombatTracker');
      CombatTracker._instance.initialize();
    }
    return CombatTracker._instance;
  }

  get encounters(): EncounterData[] {
    const json = this.encountersJson || '[]';
    if (json !== this._encountersCacheJson) {
      try {
        const arr = JSON.parse(json);
        this._encountersCache = Array.isArray(arr) ? arr : [];
      } catch {
        this._encountersCache = [];
      }
      this._encountersCacheJson = json;
    }
    return this._encountersCache;
  }
  set encounters(value: EncounterData[]) {
    this.commit(value || []);
  }

  get activeEncounter(): EncounterData {
    const list = this.encounters;
    if (!list.length) return null;
    return list.find(e => e.id === this.activeEncounterId) || list[0];
  }

  /** Ensure an encounter exists and activeEncounterId points at it. */
  ensureActiveEncounter(name?: string): EncounterData {
    name = name ?? translate('combat.encounterN', { n: 1 });
    const list = this.encounters;
    if (!list.length) return this.createEncounter(name);
    const active = list.find(e => e.id === this.activeEncounterId) || list[0];
    if (this.activeEncounterId !== active.id) this.activeEncounterId = active.id;
    return active;
  }

  private commit(list: EncounterData[], activeId?: string) {
    const json = JSON.stringify(list || []);
    if (this.encountersJson !== json) {
      this._encountersCache = list || [];
      this._encountersCacheJson = json;
      this.encountersJson = json;
    }
    if (activeId !== undefined && this.activeEncounterId !== activeId) {
      this.activeEncounterId = activeId;
    }
  }

  createEncounter(name?: string): EncounterData {
    name = name ?? translate('combat.encounter');
    const encounter: EncounterData = {
      id: UUID.generateUuid(),
      name,
      isStarted: false,
      round: 0,
      turnIndex: 0,
      skipDefeated: true,
      initiativeDice: 'd20',
      trackedResourceName: '',
      combatants: [],
    };
    const list = this.encounters.slice();
    list.push(encounter);
    this.commit(list, encounter.id);
    return encounter;
  }

  deleteActiveEncounter() {
    const list = this.encounters.filter(e => e.id !== this.activeEncounterId);
    this.commit(list, list[0]?.id || '');
  }

  selectEncounter(id: string) {
    if (!id || this.activeEncounterId === id) return;
    if (this.encounters.some(e => e.id === id)) this.activeEncounterId = id;
  }

  prevEncounter() {
    const list = this.encounters;
    if (list.length < 2) return;
    const idx = Math.max(0, list.findIndex(e => e.id === this.activeEncounterId));
    const next = list[(idx - 1 + list.length) % list.length];
    this.selectEncounter(next.id);
  }

  nextEncounter() {
    const list = this.encounters;
    if (list.length < 2) return;
    const idx = Math.max(0, list.findIndex(e => e.id === this.activeEncounterId));
    const next = list[(idx + 1) % list.length];
    this.selectEncounter(next.id);
  }

  updateActive(mutator: (e: EncounterData) => void) {
    const list = this.encounters.slice();
    if (!list.length) return;
    let idx = list.findIndex(e => e.id === this.activeEncounterId);
    if (idx < 0) idx = 0;
    // Deep-clone active encounter so in-place mutator cannot dirty the cache before we compare.
    list[idx] = JSON.parse(JSON.stringify(list[idx]));
    const before = JSON.stringify(list);
    mutator(list[idx]);
    this.sortCombatants(list[idx]);
    const after = JSON.stringify(list);
    const activeId = list[idx].id;
    if (before === after && this.activeEncounterId === activeId) return;
    this.commit(list, this.activeEncounterId === activeId ? undefined : activeId);
  }

  addCombatant(data: Omit<CombatantData, 'id' | 'initiative'> & { initiative?: number | null }) {
    this.addCombatants([data]);
  }

  /** Add many combatants in one commit (avoids dropping all-but-first when looping). */
  addCombatants(items: Array<Omit<CombatantData, 'id' | 'initiative'> & { initiative?: number | null }>) {
    if (!items?.length) return;
    this.ensureActiveEncounter();
    this.updateActive(e => {
      for (const data of items) {
        if (!data?.characterIdentifier) continue;
        if (e.combatants.some(c => c.characterIdentifier === data.characterIdentifier)) continue;
        e.combatants.push({
          id: UUID.generateUuid(),
          characterIdentifier: data.characterIdentifier,
          name: data.name,
          initiative: data.initiative ?? null,
          isNpc: !!data.isNpc,
          isDefeated: !!data.isDefeated,
          isHidden: !!data.isHidden,
          imageIdentifier: data.imageIdentifier || '',
        });
      }
    });
  }

  removeCombatant(combatantId: string) {
    this.updateActive(e => {
      e.combatants = e.combatants.filter(c => c.id !== combatantId);
      if (e.turnIndex >= e.combatants.length) e.turnIndex = Math.max(0, e.combatants.length - 1);
    });
  }

  /** Sync isDefeated for a character across all encounters (linked to FX status dead). */
  setDefeatedForCharacter(characterIdentifier: string, defeated: boolean) {
    if (!characterIdentifier) return;
    const list = this.encounters.slice();
    let changed = false;
    for (let i = 0; i < list.length; i++) {
      const e = JSON.parse(JSON.stringify(list[i])) as EncounterData;
      let touch = false;
      for (const c of e.combatants) {
        if (c.characterIdentifier === characterIdentifier && c.isDefeated !== defeated) {
          c.isDefeated = defeated;
          touch = true;
        }
      }
      if (touch) {
        list[i] = e;
        changed = true;
      }
    }
    if (changed) this.commit(list);
  }

  sortCombatants(e: EncounterData) {
    e.combatants.sort((a, b) => {
      const ai = a.initiative == null ? -Infinity : a.initiative;
      const bi = b.initiative == null ? -Infinity : b.initiative;
      return bi - ai;
    });
  }

  beginCombat() {
    this.updateActive(e => {
      e.isStarted = true;
      e.round = 1;
      e.turnIndex = this.firstPlayableIndex(e);
    });
    this.broadcastOpenTracker();
    this.broadcastRoundAnnounce('begin');
  }

  endCombat() {
    this.updateActive(e => {
      e.isStarted = false;
      e.round = 0;
      e.turnIndex = 0;
    });
  }

  nextTurn() {
    const beforeRound = this.activeEncounter?.round ?? 0;
    this.updateActive(e => {
      if (!e.isStarted || !e.combatants.length) return;
      let i = e.turnIndex;
      for (let n = 0; n < e.combatants.length; n++) {
        i = (i + 1) % e.combatants.length;
        if (i === 0) e.round += 1;
        if (this.isPlayable(e, i)) {
          e.turnIndex = i;
          return;
        }
      }
    });
    const afterRound = this.activeEncounter?.round ?? 0;
    if (afterRound > beforeRound) this.broadcastRoundAnnounce('round');
  }

  prevTurn() {
    this.updateActive(e => {
      if (!e.isStarted || !e.combatants.length) return;
      let i = e.turnIndex;
      for (let n = 0; n < e.combatants.length; n++) {
        if (i === 0) {
          e.round = Math.max(1, e.round - 1);
          i = e.combatants.length - 1;
        } else {
          i -= 1;
        }
        if (this.isPlayable(e, i)) {
          e.turnIndex = i;
          return;
        }
      }
    });
  }

  nextRound() {
    this.updateActive(e => {
      if (!e.isStarted) return;
      e.round += 1;
      e.turnIndex = this.firstPlayableIndex(e);
    });
    if (this.activeEncounter?.isStarted) this.broadcastRoundAnnounce('round');
  }

  private broadcastOpenTracker() {
    EventSystem.call('OPEN_COMBAT_TRACKER', null);
  }

  private broadcastRoundAnnounce(kind: 'begin' | 'round') {
    const e = this.activeEncounter;
    if (!e?.isStarted || !(e.round > 0)) return;
    EventSystem.call('COMBAT_ROUND_ANNOUNCE', {
      round: e.round,
      name: e.name || '',
      kind,
    });
  }

  prevRound() {
    this.updateActive(e => {
      if (!e.isStarted) return;
      e.round = Math.max(1, e.round - 1);
      e.turnIndex = this.firstPlayableIndex(e);
    });
  }

  private isPlayable(e: EncounterData, index: number): boolean {
    const c = e.combatants[index];
    if (!c) return false;
    if (e.skipDefeated && c.isDefeated) return false;
    return true;
  }

  private firstPlayableIndex(e: EncounterData): number {
    for (let i = 0; i < e.combatants.length; i++) {
      if (this.isPlayable(e, i)) return i;
    }
    return 0;
  }

  currentCombatant(): CombatantData {
    const e = this.activeEncounter;
    if (!e || !e.isStarted) return null;
    return e.combatants[e.turnIndex] || null;
  }

  /**
   * Peek the next playable combatant (same walk as {@link nextTurn}) without mutating.
   * Returns null when combat is idle or only one playable combatant remains.
   */
  nextCombatant(): CombatantData {
    const e = this.activeEncounter;
    if (!e?.isStarted || !e.combatants.length) return null;
    const cur = this.currentCombatant();
    let i = e.turnIndex;
    for (let n = 0; n < e.combatants.length; n++) {
      i = (i + 1) % e.combatants.length;
      if (!this.isPlayable(e, i)) continue;
      const c = e.combatants[i];
      if (cur && c.id === cur.id) return null;
      return c;
    }
    return null;
  }

  rollDie(dice: InitiativeDice): number {
    if (dice === 'd100') return 1 + Math.floor(Math.random() * 100);
    return 1 + Math.floor(Math.random() * 20);
  }

  innerXml(): string { return ''; }

  parseInnerXml(element: Element) {
    const context = CombatTracker.instance.toContext();
    context.syncData = this.toContext().syncData;
    CombatTracker.instance.apply(context);
    CombatTracker._instance._encountersCacheJson = '';
    CombatTracker.instance.update();
    this.destroy();
  }
}
