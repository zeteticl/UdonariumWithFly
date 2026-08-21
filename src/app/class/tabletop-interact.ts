/**
 * True when a dblclick originated on (or inside) an interactive control.
 * Rapid clicks on PDF next/prev, video controls, inputs, etc. must not open
 * object detail panels via parent (dblclick) handlers.
 */
export function isInteractiveControlTarget(target: EventTarget | null | undefined): boolean {
  if (!(target instanceof Element)) return false;
  const el = target.closest(
    [
      'button',
      'a',
      'input',
      'textarea',
      'select',
      'option',
      'label',
      'video',
      'audio',
      'summary',
      '[contenteditable="true"]',
      '[role="button"]',
      '[data-no-dblclick]',
      '.pdf-nav',
      '.pdf-btn',
      '.nav-btn',
      '.resize-grab',
      '.rotate-grab',
    ].join(','),
  );
  return !!el;
}

/** Call at the start of tabletop onDoubleClick handlers. */
export function shouldIgnoreTabletopDoubleClick(e: Event | null | undefined): boolean {
  if (!e) return false;
  if (isInteractiveControlTarget(e.target)) {
    e.stopPropagation();
    e.preventDefault?.();
    return true;
  }
  return false;
}
