import { resetTabletopStore } from '../../../testing/tabletop-test.util';
import { CombatTracker, EncounterData } from './combat-tracker';

describe('CombatTracker.nextCombatant', () => {
  let t: CombatTracker;

  beforeEach(() => {
    resetTabletopStore();
    t = CombatTracker.instance;
    t.encountersJson = '[]';
    t.activeEncounterId = '';
  });

  function seed(combatants: Array<Partial<EncounterData['combatants'][0]>>): EncounterData {
    const e = t.createEncounter('Test');
    t.updateActive(enc => {
      enc.combatants = combatants.map((c, i) => ({
        id: c.id || `c${i}`,
        characterIdentifier: c.characterIdentifier || `ch${i}`,
        name: c.name || `C${i}`,
        initiative: c.initiative ?? (10 - i),
        isNpc: !!c.isNpc,
        isDefeated: !!c.isDefeated,
        isHidden: !!c.isHidden,
        imageIdentifier: '',
      }));
      enc.skipDefeated = true;
      enc.isStarted = true;
      enc.round = 1;
      enc.turnIndex = 0;
    });
    return t.activeEncounter;
  }

  it('returns the next playable combatant without mutating turnIndex', () => {
    seed([
      { id: 'a', characterIdentifier: 'A', initiative: 20 },
      { id: 'b', characterIdentifier: 'B', initiative: 15 },
      { id: 'c', characterIdentifier: 'C', initiative: 10 },
    ]);
    expect(t.currentCombatant()?.id).toBe('a');
    expect(t.nextCombatant()?.id).toBe('b');
    expect(t.activeEncounter.turnIndex).toBe(0);
  });

  it('skips defeated when skipDefeated is on', () => {
    seed([
      { id: 'a', characterIdentifier: 'A', initiative: 20 },
      { id: 'b', characterIdentifier: 'B', initiative: 15, isDefeated: true },
      { id: 'c', characterIdentifier: 'C', initiative: 10 },
    ]);
    expect(t.nextCombatant()?.id).toBe('c');
  });

  it('returns null when only one playable combatant remains', () => {
    seed([
      { id: 'a', characterIdentifier: 'A', initiative: 20 },
      { id: 'b', characterIdentifier: 'B', initiative: 15, isDefeated: true },
    ]);
    expect(t.nextCombatant()).toBeNull();
  });

  it('returns null when combat is not started', () => {
    seed([{ id: 'a', characterIdentifier: 'A' }]);
    t.updateActive(e => { e.isStarted = false; });
    expect(t.nextCombatant()).toBeNull();
  });
});
