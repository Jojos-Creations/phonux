/**
 * Wheels forwarded from content whose input never reaches the page. The Embla row's wheel listener (emblaRow.ts) reads them as it
 * reads a wheel over its own content.
 */

/**
 * Hands the row a wheel from content whose input never reaches the page, such as an Electron `<webview>` or a cross-origin
 * `<iframe>`: a script in that content cancels the wheel itself and passes its deltas here, with `from` the element that shows it.
 * The row reads the wheel as it reads one over its own content, so a sideways one moves it and a vertical one does nothing.
 * Pass `altKey` true for a gesture the content keeps, so the row lets the rest of it be.
 *
 * @param from - An element inside the row, usually the webview or iframe.
 * @param wheel - The wheel's deltas, `deltaMode` as `WheelEvent` reports it (0 pixels, 1 lines, 2 pages).
 * @returns True when the row took the wheel, so the content must not scroll by it.
 *
 * @public
 */
export function feedRowWheel(from: Element, wheel: { deltaX: number; deltaY?: number; deltaMode?: number; shiftKey?: boolean; altKey?: boolean }): boolean {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, composed: true, deltaY: 0, deltaMode: 0, ...wheel });
  from.dispatchEvent(event);
  return event.defaultPrevented;
}
