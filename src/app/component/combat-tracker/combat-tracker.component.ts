import { Component, OnDestroy, OnInit } from '@angular/core';
import { CharacterToken } from '@udonarium/character-token';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { DataElement } from '@udonarium/data-element';
import { GameCharacter } from '@udonarium/game-character';
import { GuestSession } from '@udonarium/guest-session';
import { EventSystem, Network } from '@udonarium/core/system';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { PeerCursor } from '@udonarium/peer-cursor';
import {
  CharacterStatusEntry,
  getStatusDef,
  hasStatus,
  parseStatusesJson,
  setStatusFlag,
  stringifyStatuses,
} from '@udonarium/table-fx/character-status';
import { CombatTracker, CombatantData, EncounterData, InitiativeDice } from '@udonarium/table-fx/combat-tracker';
import { ChatMessageService } from 'service/chat-message.service';
import { I18nService } from 'service/i18n.service';
import { PanelService } from 'service/panel.service';
import { TabletopSelectionService } from 'service/tabletop-selection.service';
import { TabletopService } from 'service/tabletop.service';

@Component({
  selector: 'combat-tracker',
  templateUrl: './combat-tracker.component.html',
  styleUrls: ['../shared/settings-ui.css', './combat-tracker.component.css'],
  standalone: false
})
export class CombatTrackerComponent implements OnInit, OnDestroy {
  private static openCount = 0;
  static get isOpen(): boolean { return CombatTrackerComponent.openCount > 0; }

  constructor(
    private panelService: PanelService,
    private selectionService: TabletopSelectionService,
    private chatMessageService: ChatMessageService,
    private tabletopService: TabletopService,
    private i18n: I18nService,
  ) {}

  get tracker(): CombatTracker { return CombatTracker.instance; }
  get encounter(): EncounterData { return this.tracker.activeEncounter; }
  get isGuest(): boolean { return GuestSession.isGuest; }
  get isGM(): boolean { return PeerCursor.myCursor?.isGMMode; }

  ngOnInit() {
    CombatTrackerComponent.openCount += 1;
    Promise.resolve().then(() => {
      this.refreshPanelTitle();
      this.tracker.ensureActiveEncounter(this.encounterName(1));
    });
    EventSystem.register(this)
      .on(`UPDATE_GAME_OBJECT/identifier/${this.tracker.identifier}`, () => { /* refresh via zone */ })
      .on('UPDATE_GAME_OBJECT', event => {
        // Refresh when combatant tokens change (HP / status / image).
        if (this.encounter?.combatants.some(c => c.characterIdentifier === event.data.identifier)) {
          /* zone refresh */
        }
      })
      .on('LOCALE_CHANGED', () => this.refreshPanelTitle());
  }

  ngOnDestroy() {
    CombatTrackerComponent.openCount = Math.max(0, CombatTrackerComponent.openCount - 1);
    EventSystem.unregister(this);
  }

  private refreshPanelTitle() {
    this.panelService.title = this.i18n.t('combat.title');
  }

  private encounterName(n: number): string {
    return this.i18n.t('combat.encounterN', { name: this.i18n.t('combat.defaultName'), n });
  }

  createEncounter() {
    if (this.isGuest) return;
    const n = this.tracker.encounters.length + 1;
    this.tracker.createEncounter(this.encounterName(n));
  }

  deleteEncounter() {
    if (this.isGuest) return;
    this.tracker.deleteActiveEncounter();
    if (!this.tracker.encounters.length) this.tracker.createEncounter(this.encounterName(1));
  }

  renameEncounter(name: string) {
    if (this.isGuest || !this.encounter) return;
    const next = (name || '').trim();
    if (!next || this.encounter.name === next) return;
    this.tracker.updateActive(e => { e.name = next; });
  }

  setDice(dice: InitiativeDice) {
    if (this.isGuest || !this.encounter) return;
    if (this.encounter.initiativeDice === dice) return;
    this.tracker.updateActive(e => { e.initiativeDice = dice; });
  }

  setSkipDefeated(value: boolean) {
    if (this.isGuest || !this.encounter) return;
    if (this.encounter.skipDefeated === !!value) return;
    this.tracker.updateActive(e => { e.skipDefeated = !!value; });
  }

  setTrackedResource(name: string) {
    if (this.isGuest || !this.encounter) return;
    const next = name || '';
    if ((this.encounter.trackedResourceName || '') === next) return;
    this.tracker.updateActive(e => { e.trackedResourceName = next; });
  }

  resourceNameOptions(): string[] {
    const names = new Set<string>();
    const e = this.encounter;
    if (!e) return [];
    for (const c of e.combatants) {
      const ch = this.characterOf(c);
      if (!ch?.detailDataElement) continue;
      this.collectResourceNames(ch.detailDataElement, names);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  }

  resourceDisplay(c: CombatantData): string {
    const name = this.encounter?.trackedResourceName;
    if (!name) return '';
    return this.formatElement(this.findResourceElement(c, name));
  }

  /** Prefer live HP-like numberResource named HP if present. */
  hpBar(c: CombatantData): { cur: number; max: number; pct: number } | null {
    const el = this.findResourceElement(c, 'HP') || this.findResourceElement(c, 'hp');
    if (!el?.isNumberResource) return null;
    const max = Number(el.value) || 0;
    const cur = Number(el.currentValue) || 0;
    if (max <= 0) return null;
    return { cur, max, pct: Math.max(0, Math.min(100, (cur / max) * 100)) };
  }

  private formatElement(el: DataElement): string {
    if (!el) return '—';
    if (el.isNumberResource) return `${el.currentValue}/${el.value}`;
    if (el.isAbilityScore) {
      const mod = el.calcAbilityScore();
      return el.currentValue ? `${el.value}(${mod >= 0 ? '+' : ''}${mod})` : String(el.value ?? '—');
    }
    return el.value == null || el.value === '' ? '—' : String(el.value);
  }

  private findResourceElement(c: CombatantData, name: string): DataElement {
    const ch = this.characterOf(c);
    return ch?.detailDataElement?.getFirstElementByName(name) || null;
  }

  private collectResourceNames(root: DataElement, names: Set<string>) {
    for (const child of root.children) {
      if (!(child instanceof DataElement)) continue;
      if (child.children.length) {
        this.collectResourceNames(child, names);
        continue;
      }
      if (!child.name) continue;
      if (child.isNumberResource || child.isAbilityScore || child.isSimpleNumber) {
        names.add(child.name);
      } else if (typeof child.value === 'number') {
        names.add(child.name);
      }
    }
  }

  characterOf(c: CombatantData): GameCharacter {
    return ObjectStore.instance.get<GameCharacter>(c.characterIdentifier) || null;
  }

  displayName(c: CombatantData): string {
    return this.characterOf(c)?.name || c.name || this.i18n.t('combat.unnamed');
  }

  portraitUrl(c: CombatantData): string {
    const ch = this.characterOf(c);
    const face = ch?.faceIcon;
    if (face?.url) return face.url;
    if (ch?.imageFile?.url) return ch.imageFile.url;
    if (c.imageIdentifier) {
      const file = ImageStorage.instance.get(c.imageIdentifier);
      if (file?.url) return file.url;
    }
    return '';
  }

  statusesOf(c: CombatantData): CharacterStatusEntry[] {
    const ch = this.characterOf(c);
    if (!ch) return [];
    return parseStatusesJson(ch.statusesJson);
  }

  statusIcon(id: string): string {
    return getStatusDef(id as any)?.icon || 'info';
  }

  statusTitle(s: CharacterStatusEntry): string {
    const name = this.i18n.t(`fx.status.${s.id}`);
    return s.level ? `${name} ${s.level}` : name;
  }

  ownerLabel(c: CombatantData): string {
    const ch = this.characterOf(c);
    if (!ch) return c.isNpc ? this.i18n.t('combat.npc') : this.i18n.t('combat.pc');
    const controllerId = ch.playerOwner || ch.owner;
    if (!controllerId) return this.i18n.t('combat.npc');
    const peer = PeerCursor.findByUserId(controllerId);
    return peer?.name
      ? this.i18n.t('combat.pcWithName', { name: peer.name })
      : this.i18n.t('combat.pc');
  }

  get selectedCharacterCount(): number {
    return this.bodiesFromSelection().length;
  }

  addSelected() {
    if (this.isGuest) return;
    const chars = this.bodiesFromSelection();
    if (!chars.length) return;
    this.tracker.addCombatants(chars.map(obj => ({
      characterIdentifier: obj.identifier,
      name: obj.name || this.i18n.t('combat.unnamed'),
      isNpc: !obj.hasPlayerController,
      isDefeated: hasStatus(obj.statusesJson, 'dead'),
      isHidden: false,
      imageIdentifier: obj.imageFile?.identifier || '',
    })));
  }

  addAllOnTable() {
    if (this.isGuest) return;
    const chars = CharacterToken.bodiesWithTokenOnView();
    if (!chars.length) return;
    this.tracker.addCombatants(chars.map(obj => ({
      characterIdentifier: obj.identifier,
      name: obj.name || this.i18n.t('combat.unnamed'),
      isNpc: !obj.hasPlayerController,
      isDefeated: hasStatus(obj.statusesJson, 'dead'),
      isHidden: false,
      imageIdentifier: obj.imageFile?.identifier || '',
    })));
  }

  remove(c: CombatantData) {
    if (this.isGuest) return;
    this.tracker.removeCombatant(c.id);
  }

  setInitiative(c: CombatantData, value: string | number) {
    if (this.isGuest) return;
    const num = value === '' || value == null ? null : Number(value);
    const next = Number.isFinite(num as number) ? num : null;
    if (c.initiative === next) return;
    this.tracker.updateActive(e => {
      const target = e.combatants.find(x => x.id === c.id);
      if (target && target.initiative !== next) target.initiative = next;
    });
  }

  trackCombatant(_: number, c: CombatantData): string { return c.id; }
  trackEncounter(_: number, e: EncounterData): string { return e.id; }
  trackStatus(_: number, s: CharacterStatusEntry): string { return s.id; }

  toggleHidden(c: CombatantData) {
    if (!this.isGM) return;
    this.tracker.updateActive(e => {
      const target = e.combatants.find(x => x.id === c.id);
      if (target) target.isHidden = !target.isHidden;
    });
  }

  toggleDefeated(c: CombatantData) {
    if (this.isGuest) return;
    const next = !c.isDefeated;
    this.tracker.setDefeatedForCharacter(c.characterIdentifier, next);
    const ch = this.characterOf(c);
    if (ch) {
      ch.statusesJson = stringifyStatuses(setStatusFlag(parseStatusesJson(ch.statusesJson), 'dead', next));
      EventSystem.trigger('UPDATE_INVENTORY', null);
    }
  }

  rollOne(c: CombatantData) {
    if (this.isGuest || !this.encounter) return;
    const roll = this.tracker.rollDie(this.encounter.initiativeDice);
    this.tracker.updateActive(e => {
      const target = e.combatants.find(x => x.id === c.id);
      if (target) target.initiative = roll;
    });
    this.logRoll(this.displayName(c), roll);
  }

  rollAll(npcsOnly = false) {
    if (this.isGuest || !this.encounter) return;
    this.tracker.updateActive(e => {
      for (const c of e.combatants) {
        if (c.initiative != null) continue;
        if (npcsOnly && !c.isNpc) continue;
        c.initiative = this.tracker.rollDie(e.initiativeDice);
        this.logRoll(c.name, c.initiative);
      }
    });
  }

  /** Fill initiative from tracked resource for combatants that have no initiative yet. */
  applyResourceInitiative() {
    if (this.isGuest || !this.encounter) return;
    const resourceName = this.encounter.trackedResourceName;
    if (!resourceName) return;

    this.tracker.updateActive(e => {
      for (const c of e.combatants) {
        if (c.initiative != null) continue;
        const value = this.resourceInitiativeValue(c, resourceName);
        if (value == null) continue;
        c.initiative = value;
        this.chatMessageService.sendOperationLog(
          this.i18n.t('combat.resourceInitiativeLog', {
            name: c.name || this.i18n.t('combat.unnamed'),
            value,
            resource: resourceName,
          })
        );
      }
    });
  }

  private resourceInitiativeValue(c: CombatantData, resourceName: string): number | null {
    const el = this.findResourceElement(c, resourceName);
    if (!el) return null;
    if (el.isNumberResource) {
      const n = Number(el.currentValue);
      return Number.isFinite(n) ? n : null;
    }
    const n = Number(el.value);
    return Number.isFinite(n) ? n : null;
  }

  resetInitiative() {
    if (this.isGuest) return;
    this.tracker.updateActive(e => {
      for (const c of e.combatants) c.initiative = null;
    });
  }

  begin() { if (!this.isGuest) this.tracker.beginCombat(); }
  end() { if (!this.isGuest) this.tracker.endCombat(); }
  nextTurn() { if (!this.isGuest) this.tracker.nextTurn(); }
  prevTurn() { if (!this.isGuest) this.tracker.prevTurn(); }
  nextRound() { if (!this.isGuest) this.tracker.nextRound(); }
  prevRound() { if (!this.isGuest) this.tracker.prevRound(); }

  /** Show「結束我的回合」only when the active combatant is my token. */
  isMyCombatTurn(): boolean {
    if (!this.encounter?.isStarted) return false;
    const cur = this.tracker.currentCombatant();
    if (!cur) return false;
    const ch = this.characterOf(cur);
    const userId = Network.peer?.userId;
    return !!ch && !!userId && ch.isControlledBy(userId);
  }

  endMyTurn() {
    if (!this.isMyCombatTurn()) return;
    this.tracker.nextTurn();
  }

  visibleCombatants(): CombatantData[] {
    const e = this.encounter;
    if (!e) return [];
    if (this.isGM) return e.combatants;
    return e.combatants.filter(c => !c.isHidden);
  }

  turnOrder(c: CombatantData): number {
    const list = this.visibleCombatants();
    return list.findIndex(x => x.id === c.id) + 1;
  }

  isCurrent(c: CombatantData): boolean {
    const cur = this.tracker.currentCombatant();
    return !!cur && cur.id === c.id && !!this.encounter?.isStarted;
  }

  currentCombatant(): CombatantData {
    return this.tracker.currentCombatant();
  }

  focusCombatant(c: CombatantData) {
    const tok = CharacterToken.focusTokenForCharacter(c.characterIdentifier);
    if (!tok) return;
    EventSystem.trigger('FOCUS_TABLETOP_OBJECT', { x: tok.location.x, y: tok.location.y, z: tok.posZ || 0 });
    this.selectionService.clear();
    this.selectionService.add(tok);
  }

  /** Unique bodies from selected Tokens and/or GameCharacters. */
  private bodiesFromSelection(): GameCharacter[] {
    const byId = new Map<string, GameCharacter>();
    for (const o of this.selectionService.objects) {
      if (o instanceof CharacterToken) {
        const body = o.character;
        if (body) byId.set(body.identifier, body);
      } else if (o instanceof GameCharacter) {
        byId.set(o.identifier, o);
      }
    }
    return Array.from(byId.values());
  }

  private logRoll(name: string, roll: number) {
    const dice = this.encounter?.initiativeDice || 'd20';
    this.chatMessageService.sendOperationLog(this.i18n.t('combat.initiativeLog', { name, roll, dice }));
  }
}
