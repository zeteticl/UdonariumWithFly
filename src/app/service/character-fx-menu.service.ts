import { Injectable } from '@angular/core';
import { CharacterToken } from '@udonarium/character-token';
import { ClueLink } from '@udonarium/clue-link';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { GameCharacter } from '@udonarium/game-character';
import { GuestSession } from '@udonarium/guest-session';
import { EventSystem, Network } from '@udonarium/core/system';
import { PeerCursor } from '@udonarium/peer-cursor';
import { AuraNameConfig, DEFAULT_AURA_NAMES } from '@udonarium/table-fx/aura-name-config';
import {
  CHARACTER_STATUS_DEFS,
  CharacterStatusEntry,
  CharacterStatusId,
  parseStatusesJson,
  setStatusFlag,
  stringifyStatuses,
} from '@udonarium/table-fx/character-status';
import { CombatTracker } from '@udonarium/table-fx/combat-tracker';
import {
  anyImageEffect,
  clearImageEffects,
} from '@udonarium/table-fx/image-effect';
import {
  isActivePushPinStyle,
  pinAngleFromId,
  randomPinOffset,
  randomPushPinStyle,
  TOKEN_FRAME_STYLES,
} from '@udonarium/table-fx/push-pin.util';
import { TextNote } from '@udonarium/text-note';
import { TableSelecter } from '@udonarium/table-selecter';
import { ContextMenuAction, ContextMenuSeparator, contextMenuToggleCheck } from 'service/context-menu.service';
import { I18nService } from 'service/i18n.service';
import { TabletopSelectionService } from 'service/tabletop-selection.service';

const VISION_RANGE_PRESETS = [0, 3, 6, 9, 12, 18, 24];
const BRIGHT_LIGHT_PRESETS = [0, 1, 2, 3, 4, 5, 6, 8];
const DIM_LIGHT_PRESETS = [0, 2, 4, 6, 8, 10, 12, 16];

const RING_OPTIONS = ['none', 'fire', 'magic', 'tech', 'eldritch', 'holy'];
const AURA_COLOR_KEYS = ['black', 'blue', 'green', 'cyan', 'red', 'magenta', 'yellow', 'white'] as const;
const AURA_SAMPLE_COLORS = ['#000', '#00f', '#0f0', '#0ff', '#f00', '#f0f', '#ff0', '#fff'];

/** Table cosmetics / stealth / FoW — resolve with CharacterToken.appearanceHostFor. */
type CosmeticsHost = GameCharacter | CharacterToken;

@Injectable({ providedIn: 'root' })
export class CharacterFxMenuService {
  constructor(
    private selectionService: TabletopSelectionService,
    private i18n: I18nService,
  ) {}

  get auraNames(): string[] { return AuraNameConfig.instance.names; }

  private auraDisplayName(index: number, custom: string): string {
    if (custom && custom !== DEFAULT_AURA_NAMES[index]) return custom;
    return this.i18n.t(`chat.aura.${AURA_COLOR_KEYS[index]}`);
  }

  makeAuraMenu(character: CosmeticsHost): ContextMenuAction {
    const names = this.auraNames;
    const auraLabel = (i: number) => `${character.aura == i ? '◉' : '○'} ${i < 0 ? this.i18n.t('fx.none') : this.auraDisplayName(i, names[i])}`;
    const setAura = (i: number) => {
      character.mutateAppearance(() => { character.aura = i; });
      EventSystem.trigger('UPDATE_INVENTORY', null);
    };
    return {
      name: this.i18n.t('fx.aura'),
      action: null,
      subActions: [
        {
          name: auraLabel(-1),
          action: () => setAura(-1),
          nameUpdate: () => auraLabel(-1),
          checkBox: 'radio'
        },
        ContextMenuSeparator,
        ...names.map((color, i) => ({
          name: auraLabel(i),
          colorSample: true,
          sampleColor: AURA_SAMPLE_COLORS[i],
          action: () => setAura(i),
          nameUpdate: () => auraLabel(i),
          checkBox: 'radio' as const
        })),
        ContextMenuSeparator,
        {
          name: this.i18n.t('fx.clearAura'),
          action: () => setAura(-1),
          disabled: character.aura === -1
        }
      ]
    };
  }

  makeRingMenu(character: CosmeticsHost): ContextMenuAction {
    return {
      name: this.i18n.t('fx.ring'),
      action: null,
      subActions: RING_OPTIONS.map(id => ({
        name: `${character.floorRing === id ? '◉' : '○'} ${this.i18n.t(`fx.ring.${id}`)}`,
        action: () => {
          character.mutateAppearance(() => { character.floorRing = id; });
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        nameUpdate: () => `${character.floorRing === id ? '◉' : '○'} ${this.i18n.t(`fx.ring.${id}`)}`,
        checkBox: 'radio' as const
      }))
    };
  }

  makeTokenFrameMenu(character: CosmeticsHost): ContextMenuAction {
    return {
      name: this.i18n.t('fx.tokenFrame'),
      action: null,
      subActions: TOKEN_FRAME_STYLES.map(id => ({
        name: `${character.tokenFrame === id ? '◉' : '○'} ${this.i18n.t(`fx.tokenFrame.${id}`)}`,
        action: () => {
          character.mutateAppearance(() => {
            character.tokenFrame = id;
            if (id === 'polaroid' && !character.tokenFrameCaption) {
              character.tokenFrameCaption = character.name || '';
            }
          });
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        nameUpdate: () => `${character.tokenFrame === id ? '◉' : '○'} ${this.i18n.t(`fx.tokenFrame.${id}`)}`,
        checkBox: 'radio' as const
      }))
    };
  }

  makePushPinMenu(host: CosmeticsHost | TextNote): ContextMenuAction {
    const after = () => EventSystem.trigger('UPDATE_INVENTORY', null);
    return {
      name: this.i18n.t('fx.pushPin'),
      action: null,
      subActions: [
        contextMenuToggleCheck({
          get: () => !!host.pushPin,
          set: v => {
            host.mutateAppearance(() => {
              host.pushPin = v;
              if (host.pushPin) this.ensureHostPushPin(host);
            });
          },
          on: this.i18n.t('fx.pushPin.on'),
          off: this.i18n.t('fx.pushPin.off'),
          after,
        }),
      ]
    };
  }

  /** Assign angle + style + position when enabling a pin. */
  private ensureHostPushPin(host: CosmeticsHost | TextNote) {
    if (!host.pushPinAngle) host.pushPinAngle = pinAngleFromId(host.identifier);
    if (!isActivePushPinStyle(host.pushPinStyle)) host.pushPinStyle = randomPushPinStyle();
    this.applyRandomPinOffset(host);
  }

  private applyRandomPinOffset(host: CosmeticsHost | TextNote) {
    const GRID = 50;
    let widthPx = GRID;
    if (host instanceof TextNote) {
      widthPx = Math.max(1, host.width) * GRID;
    } else {
      widthPx = Math.max(1, host.size) * GRID;
      // Framed tokens grow outward with padding (~7–8px each side).
      if (host.tokenFrame && host.tokenFrame !== 'none') widthPx += 16;
    }
    const off = randomPinOffset(widthPx);
    host.pushPinLeft = off.left;
    host.pushPinTop = off.top;
  }

  makeClueLinkMenu(from: GameCharacter | CharacterToken | TextNote): ContextMenuAction {
    const viewId = TableSelecter.instance.viewTable?.identifier || '';
    const targets = this.pinnedEndpointsOnView().filter(t => t.identifier !== from.identifier);
    const after = () => EventSystem.trigger('UPDATE_INVENTORY', null);
    const onView = (l: ClueLink) => !l.tableIdentifier || l.tableIdentifier === viewId;
    const isLinked = (t: GameCharacter | CharacterToken | TextNote) => ClueLink.all().some(l =>
      onView(l)
      && ((l.fromIdentifier === from.identifier && l.toIdentifier === t.identifier)
        || (l.fromIdentifier === t.identifier && l.toIdentifier === from.identifier)));
    const linksOf = () => ClueLink.all().filter(l =>
      onView(l) && (l.fromIdentifier === from.identifier || l.toIdentifier === from.identifier));
    return {
      name: this.i18n.t('fx.clueLink'),
      action: null,
      subActions: [
        ...targets.map(t => {
          const label = this.i18n.t('fx.clueLink.to', { name: this.endpointLabel(t) });
          return contextMenuToggleCheck({
            get: () => isLinked(t),
            set: (on) => {
              if (on) {
                // Yarn does not require a visible push pin.
                if (!isLinked(t)) {
                  ClueLink.create(from.identifier, t.identifier, { tableIdentifier: viewId });
                }
              } else {
                for (const l of ClueLink.all()) {
                  if (!onView(l)) continue;
                  if ((l.fromIdentifier === from.identifier && l.toIdentifier === t.identifier)
                    || (l.fromIdentifier === t.identifier && l.toIdentifier === from.identifier)) {
                    l.destroy();
                  }
                }
              }
            },
            on: `☑${label}`,
            off: `☐${label}`,
            after,
          });
        }),
        ...(targets.length ? [ContextMenuSeparator] : []),
        {
          name: this.i18n.t('fx.clueLink.clear'),
          action: () => {
            for (const l of linksOf()) l.destroy();
            after();
          },
          disabled: linksOf().length < 1,
        },
      ],
      disabled: GuestSession.isGuest,
    };
  }

  private pinnedEndpointsOnView(): Array<GameCharacter | CharacterToken | TextNote> {
    const tokens = ObjectStore.instance.getObjects(CharacterToken).filter(c => c.isVisibleOnTable);
    const notes = ObjectStore.instance.getObjects(TextNote).filter(n => n.isVisibleOnTable);
    return [...tokens, ...notes];
  }

  private endpointLabel(obj: GameCharacter | CharacterToken | TextNote): string {
    if (obj instanceof GameCharacter || obj instanceof CharacterToken) return obj.name || this.i18n.t('fx.unnamed');
    return obj.title || this.i18n.t('action.noteName');
  }

  makeStatusMenu(character: GameCharacter): ContextMenuAction {
    const labelOf = (id: string) => {
      const def = CHARACTER_STATUS_DEFS.find(d => d.id === id);
      const active = parseStatusesJson(character.statusesJson).find(s => s.id === id);
      if (!def) return '☐';
      if (def.hasLevel) {
        return `${active ? '☑' : '☐'} ${this.i18n.t(`fx.status.${id}`)}${active?.level ? ` (${active.level})` : ''}`;
      }
      return `${active ? '☑' : '☐'} ${this.i18n.t(`fx.status.${id}`)}`;
    };
    return {
      name: this.i18n.t('fx.status'),
      action: null,
      subActions: CHARACTER_STATUS_DEFS.map(def => {
        if (def.hasLevel) {
          return {
            name: labelOf(def.id),
            action: () => this.cycleExhaustion(character),
            nameUpdate: () => labelOf(def.id),
            checkBox: 'check' as const
          };
        }
        return {
          name: labelOf(def.id),
          action: () => this.toggleStatus(character, def.id),
          nameUpdate: () => labelOf(def.id),
          checkBox: 'check' as const
        };
      })
    };
  }

  makeMyTokenMenu(character: GameCharacter): ContextMenuAction {
    const mine = () => Network.peer?.userId || '';
    const isMine = () => !!mine() && character.playerOwner === mine();
    const takenByOther = () => !!character.playerOwner && character.playerOwner !== mine();
    const isGM = () => !!PeerCursor.myCursor?.isGMMode;
    return {
      name: this.i18n.t('fx.myToken', { mark: isMine() ? '☑' : '☐' }),
      action: () => {
        if (GuestSession.isGuest || !mine()) return;
        if (takenByOther() && !isGM()) return;
        GameCharacter.setAsMyToken(character, !isMine());
        EventSystem.trigger('UPDATE_INVENTORY', null);
      },
      nameUpdate: () => {
        if (isMine()) return this.i18n.t('fx.myToken', { mark: '☑' });
        if (takenByOther()) return this.i18n.t('fx.myTokenOwned', { mark: '☐', name: character.playerOwnerName });
        return this.i18n.t('fx.myToken', { mark: '☐' });
      },
      checkBox: 'check',
      disabled: GuestSession.isGuest || (takenByOther() && !isGM()),
    };
  }

  makeCombatMenu(character: GameCharacter): ContextMenuAction {
    const selectedCount = () => this.bodiesFromSelection().length;
    return {
      name: this.i18n.t('fx.addToCombat'),
      action: () => {
        if (GuestSession.isGuest) return;
        const chars = this.combatCharactersFor(character);
        CombatTracker.instance.addCombatants(chars.map(obj => ({
          characterIdentifier: obj.identifier,
          name: obj.name || this.i18n.t('fx.unnamed'),
          isNpc: !obj.hasPlayerController,
          isDefeated: parseStatusesJson(obj.statusesJson).some(s => s.id === 'dead'),
          isHidden: false,
          imageIdentifier: obj.imageFile?.identifier || '',
        })));
      },
      nameUpdate: () => {
        const n = selectedCount();
        return n > 1 ? this.i18n.t('fx.addToCombatCount', { count: n }) : this.i18n.t('fx.addToCombat');
      },
      disabled: GuestSession.isGuest,
      keepOpen: false,
    };
  }

  /** Unique bodies from Token and/or GameCharacter selection. */
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

  /** All selected character sheets, ensuring the context-menu target is included. */
  private combatCharactersFor(character: GameCharacter): GameCharacter[] {
    const selected = this.bodiesFromSelection();
    if (!selected.length) return [character];
    if (selected.some(c => c.identifier === character.identifier)) return selected;
    return [...selected, character];
  }

  makeVisionMenu(host: CosmeticsHost): ContextMenuAction {
    const mine = Network.peer?.userId || '';
    const body = host instanceof CharacterToken ? host.character : host;
    // Manual claim only — chat auto-vision must not drive this checkbox. Claim lives on body.
    const isMyVision = !!mine && !!body && body.visionOwner === mine;
    const title = () =>
      this.i18n.t('fx.visionLighting', {
        vision: host.visionRangeGrid,
        bright: host.brightLightGrid,
        dim: host.dimLightGrid,
      });

    const rangeSub = (
      label: string,
      presets: number[],
      getter: () => number,
      setter: (n: number) => void,
    ): ContextMenuAction => ({
      name: this.i18n.t('fx.rangeLabel', { label, value: getter() }),
      action: null,
      nameUpdate: () => this.i18n.t('fx.rangeLabel', { label, value: getter() }),
      subActions: presets.map(n => ({
        name: this.i18n.t('fx.rangeOption', { mark: getter() === n ? '◉' : '○', value: n }),
        action: () => {
          setter(n);
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        nameUpdate: () => this.i18n.t('fx.rangeOption', { mark: getter() === n ? '◉' : '○', value: n }),
        checkBox: 'radio' as const,
      })),
    });

    return {
      name: title(),
      action: null,
      nameUpdate: title,
      subActions: [
        {
          name: this.i18n.t('fx.myVision', { mark: isMyVision ? '☑' : '☐' }),
          action: () => {
            if (!mine || !body) return;
            body.visionOwner = body.visionOwner === mine ? '' : mine;
            EventSystem.trigger('UPDATE_INVENTORY', null);
          },
          nameUpdate: () => {
            const on = !!mine && !!body && body.visionOwner === mine;
            return this.i18n.t('fx.myVision', { mark: on ? '☑' : '☐' });
          },
          checkBox: 'check',
          disabled: GuestSession.isGuest || !body,
        },
        ContextMenuSeparator,
        rangeSub(this.i18n.t('fx.visionRange'), VISION_RANGE_PRESETS,
          () => host.visionRangeGrid,
          n => { host.mutateAppearance(() => { host.visionRange = n; }); }),
        rangeSub(this.i18n.t('fx.brightLight'), BRIGHT_LIGHT_PRESETS,
          () => host.brightLightGrid,
          n => {
            host.mutateAppearance(() => {
              host.brightLight = n;
              if (host.dimLightGrid < n) host.dimLight = n;
            });
          }),
        rangeSub(this.i18n.t('fx.dimLight'), DIM_LIGHT_PRESETS,
          () => host.dimLightGrid,
          n => { host.mutateAppearance(() => { host.dimLight = n; }); }),
        ContextMenuSeparator,
        {
          name: this.i18n.t('fx.clearLight'),
          action: () => {
            host.mutateAppearance(() => {
              host.brightLight = 0;
              host.dimLight = 0;
            });
            EventSystem.trigger('UPDATE_INVENTORY', null);
          },
          disabled: host.brightLightGrid <= 0 && host.dimLightGrid <= 0,
        },
      ],
    };
  }

  makeImageEffectMenu(character: CosmeticsHost): ContextMenuAction {
    const after = () => EventSystem.trigger('UPDATE_INVENTORY', null);
    const setFx = (fn: () => void) => character.mutateAppearance(fn);
    return {
      name: this.i18n.t('fx.imageEffects'),
      action: null,
      subActions: [
        contextMenuToggleCheck({
          get: () => character.isInverse,
          set: (v) => { setFx(() => { character.isInverse = v; }); },
          on: this.i18n.t('fx.inverseOn'),
          off: this.i18n.t('fx.inverseOff'),
          after,
        }),
        contextMenuToggleCheck({
          get: () => character.isFlipVertical,
          set: (v) => { setFx(() => { character.isFlipVertical = v; }); },
          on: this.i18n.t('fx.flipVerticalOn'),
          off: this.i18n.t('fx.flipVerticalOff'),
          after,
        }),
        ContextMenuSeparator,
        contextMenuToggleCheck({
          get: () => character.isHollow,
          set: (v) => { setFx(() => { character.isHollow = v; }); },
          on: this.i18n.t('fx.blurOn'),
          off: this.i18n.t('fx.blurOff'),
          after,
        }),
        contextMenuToggleCheck({
          get: () => character.isGrayscale,
          set: (v) => { setFx(() => { character.isGrayscale = v; }); },
          on: this.i18n.t('fx.grayscaleOn'),
          off: this.i18n.t('fx.grayscaleOff'),
          after,
        }),
        contextMenuToggleCheck({
          get: () => character.isSepia,
          set: (v) => { setFx(() => { character.isSepia = v; }); },
          on: this.i18n.t('fx.sepiaOn'),
          off: this.i18n.t('fx.sepiaOff'),
          after,
        }),
        contextMenuToggleCheck({
          get: () => character.isMatrix,
          set: (v) => { setFx(() => { character.isMatrix = v; }); },
          on: this.i18n.t('fx.matrixOn'),
          off: this.i18n.t('fx.matrixOff'),
          after,
        }),
        contextMenuToggleCheck({
          get: () => character.isContrast,
          set: (v) => { setFx(() => { character.isContrast = v; }); },
          on: this.i18n.t('fx.contrastOn'),
          off: this.i18n.t('fx.contrastOff'),
          after,
        }),
        ContextMenuSeparator,
        contextMenuToggleCheck({
          get: () => character.isBlackPaint,
          set: (v) => {
            setFx(() => {
              character.isBlackPaint = v;
              if (v) character.isWhitePaint = false;
            });
          },
          on: this.i18n.t('fx.silhouetteOn'),
          off: this.i18n.t('fx.silhouetteOff'),
          after,
        }),
        contextMenuToggleCheck({
          get: () => character.isWhitePaint,
          set: (v) => {
            setFx(() => {
              character.isWhitePaint = v;
              if (v) character.isBlackPaint = false;
            });
          },
          on: this.i18n.t('fx.whiteSilhouetteOn'),
          off: this.i18n.t('fx.whiteSilhouetteOff'),
          after,
        }),
        ContextMenuSeparator,
        {
          name: this.i18n.t('fx.resetImageEffects'),
          action: () => {
            setFx(() => clearImageEffects(character));
            after();
          },
          disabled: !anyImageEffect(character),
        }
      ]
    };
  }

  private toggleStatus(character: GameCharacter, id: CharacterStatusId) {
    const list = parseStatusesJson(character.statusesJson);
    const enable = !list.some(s => s.id === id);
    character.statusesJson = stringifyStatuses(setStatusFlag(list, id, enable));
    if (id === 'dead') {
      CombatTracker.instance.setDefeatedForCharacter(character.identifier, enable);
    }
    EventSystem.trigger('UPDATE_INVENTORY', null);
  }

  /** Remove a status immediately (token badge right-click). */
  clearStatus(character: GameCharacter, id: CharacterStatusId) {
    if (GuestSession.isGuest) return;
    const list = parseStatusesJson(character.statusesJson);
    if (!list.some(s => s.id === id)) return;
    character.statusesJson = stringifyStatuses(setStatusFlag(list, id, false));
    if (id === 'dead') {
      CombatTracker.instance.setDefeatedForCharacter(character.identifier, false);
    }
    EventSystem.trigger('UPDATE_INVENTORY', null);
  }

  private cycleExhaustion(character: GameCharacter) {
    const list = parseStatusesJson(character.statusesJson);
    const idx = list.findIndex(s => s.id === 'exhaustion');
    if (idx < 0) {
      list.push({ id: 'exhaustion', level: 1 });
    } else {
      const level = (list[idx].level || 1) + 1;
      if (level > 6) list.splice(idx, 1);
      else list[idx].level = level;
    }
    character.statusesJson = stringifyStatuses(list);
    EventSystem.trigger('UPDATE_INVENTORY', null);
  }

  statusesOf(character: GameCharacter | null | undefined): CharacterStatusEntry[] {
    if (!character) return [];
    return parseStatusesJson(character.statusesJson || '[]');
  }

  ringAsset(ring: string): string {
    switch (ring) {
      case 'fire': return 'assets/images/fx/fire/ring.svg';
      case 'magic': return 'assets/images/fx/magic/ring.svg';
      case 'tech': return 'assets/images/fx/tech/ring.svg';
      case 'eldritch': return 'assets/images/fx/coc/ring.svg';
      case 'holy': return 'assets/images/fx/magic/holy-ring.svg';
      default: return '';
    }
  }
}
