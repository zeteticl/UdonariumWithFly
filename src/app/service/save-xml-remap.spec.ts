import { remapImageIdentifiers, remapIdsInJson } from './save-xml-remap.util';
import { reparentOrphanTableFx } from './tabletop-orphan-fx.util';
import { GameTableMask } from '@udonarium/game-table-mask';
import {
  makeTable,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('Save XML image remap', () => {
  it('remapIdsInJson remaps leaf strings only', () => {
    const remap = new Map([['oldImg', 'hashImg']]);
    expect(remapIdsInJson('oldImg', remap)).toBe('hashImg');
    expect(remapIdsInJson('keep', remap)).toBe('keep');
    expect(remapIdsInJson({ a: 'oldImg', n: 12 }, remap)).toEqual({ a: 'hashImg', n: 12 });
    expect(remapIdsInJson(['oldImg', 'x'], remap)).toEqual(['hashImg', 'x']);
  });

  it('remapImageIdentifiers rewrites image attrs without touching coordinates', () => {
    // Intentionally include digits that look like an image id substring in a coordinate.
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<character syncId="c1" location.x="100" location.y="200" imageIdentifier="img_100">',
      '  <data name="imageIdentifier" type="image">img_100</data>',
      '  <fx tokenFxConfig=\'{"auraImage":"img_100","x":100}\'/>',
      '</character>',
    ].join('');
    const remap = new Map([['img_100', 'abcd'.repeat(16)]]);
    const out = remapImageIdentifiers(xml, remap);
    const hash = 'abcd'.repeat(16);

    expect(out).toContain(`imageIdentifier="${hash}"`);
    expect(out).toContain(`>${hash}<`);
    // XMLSerializer may escape JSON quotes as &quot;
    expect(out).toMatch(/auraImage(?:&quot;|")\s*:\s*(?:&quot;|")/);
    expect(out).toContain(hash);
    // Coordinates must survive (no global replace of "100" / "img_100" fragments).
    expect(out).toMatch(/location\.x="100"/);
    expect(out).toMatch(/location\.y="200"/);
    expect(out).toMatch(/"x"\s*:\s*100|&quot;x&quot;:100/);
    expect(out).not.toContain('img_100');
  });

  it('remapImageIdentifiers returns original xml when parse fails (no global replace)', () => {
    // XmlUtil logs parse failures; silence so Karma CI output stays clean.
    spyOn(console, 'error');
    const bad = 'not-xml <broken';
    const remap = new Map([['a', 'b']]);
    expect(remapImageIdentifiers(bad, remap)).toBe(bad);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('Save orphan table FX reparent', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('reparentOrphanTableFx attaches parent-less masks to preferred or fallback table', () => {
    const table = makeTable('gameTable');
    viewTables('gameTable');

    const mask = GameTableMask.create('orphan', 2, 2, 1, 'orphanMask');
    mask.tableIdentifier = 'gameTable';
    expect(mask.parent).toBeFalsy();

    reparentOrphanTableFx();

    expect(mask.parent).toBe(table);
    expect(table.children).toContain(mask);
  });

  it('leaves already-parented masks alone', () => {
    const table = makeTable('gameTable');
    viewTables('gameTable');
    const mask = GameTableMask.create('owned', 1, 1, 1, 'ownedMask');
    table.appendChild(mask);
    const parentBefore = mask.parent;

    reparentOrphanTableFx();

    expect(mask.parent).toBe(parentBefore);
  });
});
