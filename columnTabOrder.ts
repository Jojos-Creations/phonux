/**
 * Tab and Shift+Tab across the spaces a column shows side by side. The cells stay where they were mounted in the DOM, because a cell
 * React moves would reload the web views inside it, so the order Tab walks is steered here instead: only the hand-over between
 * two stops (a cell or a divider) is taken over, and inside a stop the browser's own movement runs. DESIGN.md, "Side by side".
 */
import type * as React from 'react';
import type { TabPress } from './panelRowTabOrder.js';

const TABBABLE = 'a[href],button,input,select,textarea,summary,iframe,[tabindex],[contenteditable=""],[contenteditable="true"]';

function usable(el: HTMLElement): boolean {
  if (el.tabIndex < 0 || el.matches(':disabled') || el.closest('[inert]') !== null) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/** The row's end sentinels are not content, and a stop's own element is never a tabbable of itself. */
function tabbablesOf(stop: HTMLElement): HTMLElement[] {
  if (stop.getAttribute('role') === 'separator') return usable(stop) ? [stop] : [];
  return [...stop.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => !el.hasAttribute('data-row-sentinel') && usable(el));
}

/** The tabbable element nearest the column on the side Tab is heading to, outside it. */
function elementBeyond(root: HTMLElement, back: boolean): HTMLElement | undefined {
  const beyond = [...root.ownerDocument.body.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) => !root.contains(el) && usable(el) && (root.compareDocumentPosition(el) & (back ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING)) !== 0,
  );
  return beyond[back ? beyond.length - 1 : 0];
}

/** Focuses the first (`back`: last) tabbable element of the first stop from `from` in that direction that has one; false when none has. */
function enter(stops: readonly HTMLElement[], from: number, back: boolean): boolean {
  for (let k = from; k >= 0 && k < stops.length; k += back ? -1 : 1) {
    const found = tabbablesOf(stops[k]!);
    if (found.length === 0) continue;
    found[back ? found.length - 1 : 0]!.focus();
    return true;
  }
  return false;
}

/**
 * A Tab pressed on the last (Shift+Tab: first) tabbable element of a stop goes to the next stop in `stops`, which are in screen order,
 * or out of the column from the last one. A Tab pressed anywhere else, and one a handler already took, is left to the browser.
 * @internal
 */
export function steerColumnTab(event: React.KeyboardEvent<HTMLElement>, root: HTMLElement, stops: readonly HTMLElement[]): void {
  if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return;
  const target = event.target as HTMLElement;
  const at = stops.findIndex((stop) => stop.contains(target));
  if (at < 0) return;
  const back = event.shiftKey;
  const own = tabbablesOf(stops[at]!);
  if (own[back ? 0 : own.length - 1] !== target) return;
  if (enter(stops, at + (back ? -1 : 1), back)) {
    event.preventDefault();
    return;
  }
  const beyond = elementBeyond(root, back);
  if (beyond === undefined) return;
  event.preventDefault();
  beyond.focus();
}

/**
 * A Tab from outside the column lands on the first (Shift+Tab: last) tabbable element in screen order, not on the DOM-first (DOM-last)
 * cell the browser would pick. Focus from anything else is left where it went.
 * @internal
 */
export function steerColumnEntry(event: React.FocusEvent<HTMLElement>, root: HTMLElement, stops: readonly HTMLElement[], tab: TabPress | null): void {
  const from = event.relatedTarget as Node | null;
  // A portaled dialog is a React child of the column but not a DOM descendant, and a null source is what Chromium reports for a step out of an iframe.
  if (tab === null || from === null || !root.contains(event.target as Node) || root.contains(from)) return;
  const all = stops.flatMap(tabbablesOf);
  const want = tab.shift ? all[all.length - 1] : all[0];
  if (want !== undefined && want !== event.target) want.focus();
}
