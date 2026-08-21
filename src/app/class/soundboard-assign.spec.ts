import {
  isSoundboardOverDuration,
  planSoundboardAssign,
} from './soundboard-assign';

describe('planSoundboardAssign', () => {
  it('skips over clips entirely when OVER is declined (no pad, no folder)', () => {
    const actions = planSoundboardAssign(
      [
        { id: 'short', over: false },
        { id: 'long', over: true },
      ],
      false,
      0,
      8,
    );
    expect(actions).toEqual([
      { type: 'pad', pad: 0, id: 'short' },
      { type: 'skip', id: 'long' },
    ]);
  });

  it('places over clips on pads when OVER is allowed', () => {
    const actions = planSoundboardAssign(
      [{ id: 'long', over: true }],
      true,
      2,
      8,
    );
    expect(actions).toEqual([{ type: 'pad', pad: 2, id: 'long' }]);
  });

  it('sends leftovers past slot count to folder only', () => {
    const actions = planSoundboardAssign(
      [
        { id: 'a', over: false },
        { id: 'b', over: false },
        { id: 'c', over: false },
      ],
      false,
      7,
      8,
    );
    expect(actions).toEqual([
      { type: 'pad', pad: 7, id: 'a' },
      { type: 'folder', id: 'b' },
      { type: 'folder', id: 'c' },
    ]);
  });

  it('does not move declined OVER into folder even when pads are full', () => {
    const actions = planSoundboardAssign(
      [{ id: 'long', over: true }],
      false,
      7,
      8,
    );
    expect(actions).toEqual([{ type: 'skip', id: 'long' }]);
  });
});

describe('isSoundboardOverDuration', () => {
  it('uses 0.05s tolerance above the guide', () => {
    expect(isSoundboardOverDuration(8, 8)).toBeFalse();
    expect(isSoundboardOverDuration(8.04, 8)).toBeFalse();
    expect(isSoundboardOverDuration(8.06, 8)).toBeTrue();
  });
});
