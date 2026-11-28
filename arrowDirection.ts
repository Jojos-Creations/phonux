/**
 * Which way an arrow key points in a row of controls: in a right-to-left layout the header mirrors, so ArrowRight reaches
 * the control drawn to the right, which is the one before it in the document.
 */

/** Whether `el` is laid out right to left; the computed direction where the browser gives one, else the nearest `dir` attribute. @internal */
export function isRtl(el: Element): boolean {
  const computed = el.ownerDocument.defaultView?.getComputedStyle(el).direction;
  if (computed === 'rtl') return true;
  if (computed === 'ltr' && el.closest('[dir]') === null) return false;
  return el.closest('[dir]')?.getAttribute('dir')?.toLowerCase() === 'rtl' && computed !== 'ltr';
}

/** `ArrowLeft` and `ArrowRight` swapped when `el` is laid out right to left; any other key as it came. @internal */
export function inlineKey(key: string, el: Element): string {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return key;
  return isRtl(el) ? (key === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft') : key;
}
