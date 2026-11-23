/**
 * Tab and Shift+Tab across the spaces a column shows side by side. The cells stay where they were mounted in the DOM, because a cell
 * React moves would reload the web views inside it, so the order Tab walks is steered here instead: only the hand-over between
 * two stops (a cell or a divider) is taken over, and inside a stop the browser's own movement runs. DESIGN.md, "Side by side".
 */
import type * as React from 'react';
import { focusAsTab, isParking, park } from './panelRowTabOrder.js';

const TABBABLE = 'a[href],button,input,select,textarea,summary,iframe,[tabindex],[contenteditable=""],[contenteditable="true"]';

/** Marks the column's own tab stops: `start` and `end` at the column's two ends, `cell-start` and `cell-end` at each cell's. */
export const COLUMN_SENTINEL = 'data-column-sentinel';

// An element's own style does not say whether it is drawn: one inside a `hidden` panel, a closed dialog or a closed `details` has
// no box, takes no focus and is passed over by the browser. `checkVisibility` knows, also for fixed and content-visibility content.
function usable(el: HTMLElement): boolean {
  if (el.tabIndex < 0 || el.matches(':disabled') || el.closest('[inert]') !== null) return false;
  if (typeof el.checkVisibility === 'function') return el.checkVisibility({ visibilityProperty: true });
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

const isDivider = (stop: HTMLElement): boolean => stop.getAttribute('role') === 'separator';

/** Where the browser's own step can land inside a stop: a row's sentinels are among them, the column's are a stop's ends and not inside it. */
function landingsOf(stop: HTMLElement): HTMLElement[] {
  if (isDivider(stop)) return usable(stop) ? [stop] : [];
  return [...stop.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => !el.hasAttribute(COLUMN_SENTINEL) && usable(el));
}

/** The row's end sentinels are not content, and a stop's own element is never a tabbable of itself. */
function tabbablesOf(stop: HTMLElement): HTMLElement[] {
  return landingsOf(stop).filter((el) => !el.hasAttribute('data-row-sentinel'));
}

/** The tabbable element nearest the column on the side Tab is heading to, outside it. */
function elementBeyond(root: HTMLElement, back: boolean): HTMLElement | undefined {
  const beyond = [...root.ownerDocument.body.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) => !root.contains(el) && usable(el) && (root.compareDocumentPosition(el) & (back ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING)) !== 0,
  );
  return beyond[back ? beyond.length - 1 : 0];
}

/**
 * Focuses the first (`back`: last) tabbable element of the first stop from `from` in that direction that takes it. True only when
 * focus really moved: a key cancelled for an element that then refused focus would leave the person where they were, at every press.
 */
function enter(stops: readonly HTMLElement[], from: number, back: boolean): boolean {
  for (let k = from; k >= 0 && k < stops.length; k += back ? -1 : 1) {
    const found = tabbablesOf(stops[k]!);
    for (const el of back ? found.reverse() : found) {
      const was = el.ownerDocument.activeElement;
      focusAsTab(el, back);
      // The row may have passed the focus on to the panel its reading order starts at, so any move counts.
      if (el.ownerDocument.activeElement !== was) return true;
    }
  }
  return false;
}

/**
 * Moves on from stop `at` to the next one in screen order that has a tabbable element; true when focus went there. Past the last
 * stop there is none: with the browser's step still `pending`, focus is parked on the column's end so that step carries on out of
 * the column, to the page or to the browser itself, which no script can focus; with the step already spent, focus goes to the
 * element beyond the column, or stays where it is when the page has none.
 */
function advance(root: HTMLElement, stops: readonly HTMLElement[], at: number, back: boolean, pending: boolean): boolean {
  if (enter(stops, at + (back ? -1 : 1), back)) return true;
  if (pending) {
    const edge = root.querySelector<HTMLElement>(`[${COLUMN_SENTINEL}="${back ? 'start' : 'end'}"]`);
    if (edge !== null) park(edge);
  } else elementBeyond(root, back)?.focus();
  return false;
}

/** What `steerColumnTab` reads of a keydown, so React's event and the document's own both fit. @internal */
export type TabKey = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'defaultPrevented' | 'preventDefault'>;

/**
 * A Tab pressed where the browser's own step would leave a stop goes to the next stop in `stops`, which are in screen order, or out
 * of the column past the last one. A Tab the browser would keep inside the stop, and one a handler already took, is left alone.
 * Read from the focused element, not the event's target: a row that has found no panel to hand over to parks focus on a sentinel first.
 * `lost` stands in for the focused element when the page holds no focus: the element the column last held it on, where the browser's step still starts.
 * @internal
 */
export function steerColumnTab(event: TabKey, root: HTMLElement, stops: readonly HTMLElement[], lost?: HTMLElement): void {
  if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return;
  const from = lost ?? (root.ownerDocument.activeElement as HTMLElement | null);
  if (from === null || !root.contains(from)) return;
  const back = event.shiftKey;
  const end = from.getAttribute(COLUMN_SENTINEL);
  let at: number;
  if (end === 'start' || end === 'end') {
    if ((end === 'start') === back) return;
    at = back ? stops.length : -1;
  } else {
    at = stops.findIndex((stop) => stop.contains(from));
    if (at < 0) return;
    const stop = stops[at]!;
    // The browser's step from a cell's own element would land on the cell's start sentinel, which reads as a step out of the cell.
    if (from === stop && !back && !isDivider(stop) && enter([stop], 0, false)) return void event.preventDefault();
    const ahead = back ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING;
    if (from !== stop && landingsOf(stop).some((el) => el !== from && (from.compareDocumentPosition(el) & ahead) !== 0)) return;
  }
  if (advance(root, stops, at, back, true)) event.preventDefault();
}

/**
 * Focus reaching one of the column's sentinels by the browser's own step. At the column's start or end it comes from outside, from
 * the page or from the browser itself, and goes to the first (end: last) tabbable element in screen order, not to the DOM-first
 * (DOM-last) cell. At a cell's start or end it comes out of that cell, by a Tab pressed inside an iframe or handed on by the cell's
 * row, and moves on to the stop before (end: after) the cell. Focus anywhere else is left where it went.
 * @internal
 */
export function steerColumnSentinel(event: React.FocusEvent<HTMLElement>, root: HTMLElement, stops: readonly HTMLElement[]): void {
  const sentinel = event.target as HTMLElement;
  const kind = sentinel.getAttribute(COLUMN_SENTINEL);
  if (kind === null || isParking()) return;
  if (kind === 'start' || kind === 'end') return void enter(stops, kind === 'start' ? 0 : stops.length - 1, kind === 'end');
  const at = stops.findIndex((stop) => stop.contains(sentinel));
  if (at >= 0) advance(root, stops, at, kind === 'cell-start', false);
}
