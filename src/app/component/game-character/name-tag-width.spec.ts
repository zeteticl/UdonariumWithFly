import { estimateNameTagWidthPx, nameTagShouldWrap, NAME_TAG_WRAP_WIDTH_PX } from './name-tag-width';

describe('name-tag-width', () => {
  it('keeps typical JP token names on one line (no wrap)', () => {
    expect(nameTagShouldWrap('モンスターB')).toBe(false);
    expect(nameTagShouldWrap('キャラクター')).toBe(false);
    expect(estimateNameTagWidthPx('モンスターB')).toBeLessThanOrEqual(NAME_TAG_WRAP_WIDTH_PX);
  });

  it('wraps only very long names', () => {
    const long = 'あ'.repeat(40);
    expect(estimateNameTagWidthPx(long)).toBeGreaterThan(NAME_TAG_WRAP_WIDTH_PX);
    expect(nameTagShouldWrap(long)).toBe(true);
  });
});
