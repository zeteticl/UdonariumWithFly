import { ObjectSerializer } from './core/synchronize-object/object-serializer';
import { ObjectStore } from './core/synchronize-object/object-store';
import { ScenarioText } from './scenario-text';
import { ScenarioTextList } from './scenario-text-list';

function resetScenarioTextList() {
  const list = ScenarioTextList.instance;
  for (const child of [...list.children]) {
    child.destroy();
  }
}

describe('ScenarioTextList ZIP / backup load', () => {
  beforeEach(() => resetScenarioTextList());
  afterEach(() => resetScenarioTextList());

  it('replaces items on reload instead of accumulating duplicates', () => {
    const a = ScenarioText.create('Opening');
    a.body = 'Once upon a time';
    const b = ScenarioText.create('Climax');
    b.body = 'The end approaches';
    ScenarioTextList.instance.addItem(a);
    ScenarioTextList.instance.addItem(b);

    const xml = ObjectSerializer.instance.toXml(ScenarioTextList.instance);
    expect(ScenarioTextList.instance.items.length).toBe(2);

    // Simulate room already having the same items (pre-load state).
    expect(ScenarioTextList.instance.items.map(i => i.title)).toEqual(['Opening', 'Climax']);

    const loaded = ObjectSerializer.instance.parseXml(xml);
    expect(loaded).toBeTruthy();

    const titles = ScenarioTextList.instance.items.map(i => i.title);
    expect(titles).toEqual(['Opening', 'Climax']);
    expect(ScenarioTextList.instance.items.length).toBe(2);

    // Second reload must still be exactly the backup set.
    ObjectSerializer.instance.parseXml(xml);
    expect(ScenarioTextList.instance.items.map(i => i.title)).toEqual(['Opening', 'Climax']);
    expect(ScenarioTextList.instance.items.length).toBe(2);
  });

  it('purges orphan ScenarioText objects left outside the list', () => {
    const orphan = ScenarioText.create('Orphan');
    orphan.body = 'should not survive list reload';
    expect(orphan.parent).toBeFalsy();

    const kept = ScenarioText.create('Kept');
    kept.body = 'from backup';
    ScenarioTextList.instance.addItem(kept);
    const xml = ObjectSerializer.instance.toXml(ScenarioTextList.instance);

    ObjectSerializer.instance.parseXml(xml);

    expect(ScenarioTextList.instance.items.map(i => i.title)).toEqual(['Kept']);
    expect(ObjectStore.instance.get(orphan.identifier)).toBeNull();
  });
});
