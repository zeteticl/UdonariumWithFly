import {
  isInteractiveControlTarget,
  shouldIgnoreTabletopDoubleClick,
} from './tabletop-interact';

describe('tabletop-interact', () => {
  it('treats buttons and pdf-nav as interactive', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="pdf-nav"><button type="button" class="pdf-btn">›</button></div>
      <div class="body">paper</div>
    `;
    const btn = root.querySelector('button');
    const body = root.querySelector('.body');
    expect(isInteractiveControlTarget(btn)).toBeTrue();
    expect(isInteractiveControlTarget(body)).toBeFalse();
  });

  it('shouldIgnoreTabletopDoubleClick stops propagation for controls', () => {
    const btn = document.createElement('button');
    const ev = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'target', { value: btn });
    const stop = spyOn(ev, 'stopPropagation').and.callThrough();
    expect(shouldIgnoreTabletopDoubleClick(ev)).toBeTrue();
    expect(stop).toHaveBeenCalled();
  });
});
