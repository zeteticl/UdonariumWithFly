import { ObjectSerializer } from './core/synchronize-object/object-serializer';
import { ObjectStore } from './core/synchronize-object/object-store';
import { TableDrawing } from './table-fx/table-drawing';
import { TableLight } from './table-fx/table-light';
import { TableWall } from './table-fx/table-wall';
import { TabletopObject } from './tabletop-object';
import { TextNote } from './text-note';
import {
  makeTable,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

/** Mirror pasteClipboard TextNote cross-map shared branch. */
function pasteNoteSharedOrClone(
  xml: string,
  sourceId: string,
): { result: TextNote; createdNew: boolean } {
  const clone = ObjectSerializer.instance.parseXml(xml) as TextNote;
  expect(clone instanceof TextNote).toBeTrue();
  const viewId = TabletopObject.resolveViewTableIdentifier();
  const x = clone.location.x + 50;
  const y = clone.location.y + 50;
  const posZ = clone.posZ;
  const source = ObjectStore.instance.get<TextNote>(sourceId);

  if (source instanceof TextNote && source !== clone && source.location.name === 'table') {
    if (source.scope === 'room') {
      clone.destroy();
      source.addToTable(viewId, { x, y, posZ }, true);
      return { result: source, createdNew: false };
    }
    if (viewId && !source.hasPlacement(viewId)) {
      clone.destroy();
      source.addToTable(viewId, { x, y, posZ }, false);
      return { result: source, createdNew: false };
    }
  }

  clone.tablePlacements = '';
  clone.addToTable(viewId, { x, y, posZ }, true);
  return { result: clone, createdNew: true };
}

describe('TextNote clipboard', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('preserves title and text through toXml/parseXml while original still exists', () => {
    makeTable('mapA');
    viewTables('mapA');
    const note = TextNote.create('MyTitle', 'Hello\nWorld <tag> & stuff', 16, 2, 2, 'noteSrc');
    note.scope = 'room';
    note.location = { name: 'table', x: 40, y: 60 };
    note.addToTable('mapA', { x: 40, y: 60, posZ: 0 }, true);

    const xml = note.toXml();
    const parsed = ObjectSerializer.instance.parseXml(xml) as TextNote;
    expect(parsed).toBeTruthy();
    expect(parsed.identifier).not.toBe(note.identifier);
    expect(parsed.title).toBe('MyTitle');
    expect(parsed.text).toBe('Hello\nWorld <tag> & stuff');
    expect(parsed.scope).toBe('room');
  });

  it('cross-map paste reuses the same note so content stays common', () => {
    makeTable('mapA');
    makeTable('mapB');
    viewTables('mapA');
    const note = TextNote.create('Title', 'Shared body text', 16, 2, 2, 'noteCross');
    note.location = { name: 'table', x: 10, y: 20 };
    note.addToTable('mapA', { x: 10, y: 20, posZ: 0 }, true);
    const xml = note.toXml();

    viewTables('mapB');
    const { result, createdNew } = pasteNoteSharedOrClone(xml, note.identifier);
    expect(createdNew).toBeFalse();
    expect(result).toBe(note);
    expect(result.text).toBe('Shared body text');
    expect(result.hasPlacement('mapA')).toBeTrue();
    expect(result.hasPlacement('mapB')).toBeTrue();

    result.text = 'edited-on-B';
    viewTables('mapA');
    expect(note.text).toBe('edited-on-B');
  });

  it('same-map paste keeps an independent clone with copied text', () => {
    makeTable('mapA');
    viewTables('mapA');
    const note = TextNote.create('Title', 'body-a', 16, 2, 2, 'noteSame');
    note.location = { name: 'table', x: 10, y: 20 };
    note.addToTable('mapA', { x: 10, y: 20, posZ: 0 }, true);
    const xml = note.toXml();

    const { result, createdNew } = pasteNoteSharedOrClone(xml, note.identifier);
    expect(createdNew).toBeTrue();
    expect(result).not.toBe(note);
    expect(result.text).toBe('body-a');
    result.text = 'body-b';
    expect(note.text).toBe('body-a');
  });

  it('scene light/wall/drawing survive XML clone for cross-table paste', () => {
    const tableA = makeTable('mapA');
    const tableB = makeTable('mapB');
    viewTables('mapA');

    const light = TableLight.create(100, 200, 150);
    tableA.appendChild(light);
    const wall = TableWall.create([{ x: 0, y: 0 }, { x: 40, y: 40 }]);
    tableA.appendChild(wall);
    const drawing = TableDrawing.create('text', 'user1');
    drawing.x = 30;
    drawing.y = 40;
    drawing.text = 'hello';
    tableA.appendChild(drawing);

    const light2 = ObjectSerializer.instance.parseXml(light.toXml()) as TableLight;
    const wall2 = ObjectSerializer.instance.parseXml(wall.toXml()) as TableWall;
    const draw2 = ObjectSerializer.instance.parseXml(drawing.toXml()) as TableDrawing;
    expect(light2.x).toBe(100);
    expect(light2.y).toBe(200);
    expect(wall2.points.length).toBe(2);
    expect(draw2.text).toBe('hello');

    viewTables('mapB');
    light2.x += 10;
    wall2.points = wall2.points.map(p => ({ x: p.x + 10, y: p.y + 10 }));
    draw2.x += 10;
    tableB.appendChild(light2);
    tableB.appendChild(wall2);
    tableB.appendChild(draw2);

    expect(tableB.lights.length).toBe(1);
    expect(tableB.walls.length).toBe(1);
    expect(tableB.drawings.length).toBe(1);
    expect(tableA.lights.length).toBe(1);
  });
});
