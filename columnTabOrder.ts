/**
 * Tab and Shift+Tab across the spaces a column shows side by side. The cells stay where they were mounted in the DOM, because a cell
 * React moves would reload the web views inside it, so the order Tab walks is steered here instead. Nothing here reads what a cell
 * holds: inside a cell the browser alone moves focus, and the column acts only on its own elements. DESIGN.md, "Side by side".
 */
import type * as React from 'react';
import { isParking, park } from './panelRowTabOrder.js';

/** Marks the column's own tab stops: `start` and `end` at the column's two ends, `cell-start` and `cell-end` at each cell's. */
export const COLUMN_SENTINEL = 'data-column-sentinel';

const isDivider = (stop: HTMLElement): boolean => stop.getAttribute('role') === 'separator';

const sentinelOf = (scope: HTMLElement, kind: string): HTMLElement | null => scope.querySelector<HTMLElement>(`:scope > [${COLUMN_SENTINEL}="${kind}"]`);

/**
 * Moves on from stop `at` to the one beside it on screen; true when focus is on it and the key is done with. A divider takes focus
 * itself. A cell, and the page past the last stop, is entered by the browser: with its step still `pending`, focus is parked on the
 * cell's near end (the column's end) and the step carries on from there. With the step already spent focus rests on that end, and
 * the next press is the browser's.
 */
function go(root: HTMLElement, stops: readonly HTMLElement[], at: number, back: boolean, pending: boolean): boolean {
  const next = stops[at + (back ? -1 : 1)];
  if (next !== undefined && isDivider(next)) {
    next.focus();
    if (root.ownerDocument.activeElement === next) return true;
  }
  const edge = next === undefined ? sentinelOf(root, back ? 'start' : 'end') : sentinelOf(next, back ? 'cell-end' : 'cell-start');
  if (edge !== null) park(edge);
  return edge !== null && !pending;
}

/** What `steerColumnTab` reads of a keydown, so React's event and the document's own both fit. @internal */
export type TabKey = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'defaultPrevented' | 'preventDefault'>;

/**
 * A Tab pressed while focus is on one of the column's own elements: a divider, a cell's own element, or a sentinel. Heading out of
 * the stop it goes to the next one in `stops`, which are in screen order; heading into a cell it is left to the browser, from the
 * cell's near end. A Tab pressed anywhere else, and one a handler already took, is left alone.
 * Read from the focused element, not the event's target: a row that has found no panel to hand over to parks focus on a sentinel first.
 * `lost` stands in for the focused element when the page holds no focus: the element the column last held it on, where the browser's step still starts.
 * @internal
 */
export function steerColumnTab(event: TabKey, root: HTMLElement, stops: readonly HTMLElement[], lost?: HTMLElement): void {
  if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return;
  const from = lost ?? (root.ownerDocument.activeElement as HTMLElement | null);
  if (from === null || !root.contains(from)) return;
  const back = event.shiftKey;
  const kind = from.getAttribute(COLUMN_SENTINEL);
  let moved = false;
  if (kind === 'start' || kind === 'end') {
    if ((kind === 'start') !== back) moved = go(root, stops, back ? stops.length : -1, back, true);
  } else if (kind !== null) {
    const at = stops.indexOf(from.parentElement as HTMLElement);
    if (at >= 0 && (kind === 'cell-start') === back) moved = go(root, stops, at, back, true);
  } else {
    const at = stops.indexOf(from);
    if (at < 0) return;
    // The browser's forward step from a cell's own element starts before the cell's start: from that end it enters the cell.
    const near = back || isDivider(from) ? null : sentinelOf(from, 'cell-start');
    if (near !== null) park(near);
    else moved = go(root, stops, at, back, true);
  }
  if (moved) event.preventDefault();
}

/**
 * Focus reaching a cell's start or end by the browser's own step has come out of that cell, and moves on to the stop before (end:
 * after) it on screen. Focus on the column's own start or end rests there: the browser's next step leaves the column from it.
 * @internal
 */
export function steerColumnSentinel(event: React.FocusEvent<HTMLElement>, root: HTMLElement, stops: readonly HTMLElement[]): void {
  const sentinel = event.target as HTMLElement;
  const kind = sentinel.getAttribute(COLUMN_SENTINEL);
  if ((kind !== 'cell-start' && kind !== 'cell-end') || isParking()) return;
  const at = stops.indexOf(sentinel.parentElement as HTMLElement);
  if (at >= 0) go(root, stops, at, kind === 'cell-start', false);
}
