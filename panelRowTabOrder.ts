import * as React from 'react';

const TABBABLE = 'a[href],button,input,select,textarea,summary,iframe,[tabindex],[contenteditable=""],[contenteditable="true"]';

function usable(el: HTMLElement): boolean {
  return el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && el.closest('[inert]') === null;
}

// The sentinels are not content: counting them would make a panel's last tabbable element its own end sentinel.
function tabbablesOf(scope: Element): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => !el.hasAttribute('data-row-sentinel') && usable(el));
}

// True while the code itself moves focus onto a sentinel to let the browser's pending step carry on from it.
let parking = false;

function slotsOf(row: HTMLElement): Map<string, HTMLElement> {
  return new Map([...row.querySelectorAll<HTMLElement>('[data-row-slot]')].map((s) => [s.dataset.rowId ?? '', s]));
}

/** Focuses the nearest reading-order neighbour of `slot` that has a tabbable element; false when there is none. */
function handOver(slot: HTMLElement, row: HTMLElement, readingIds: readonly string[], back: boolean): boolean {
  const slots = slotsOf(row);
  const at = readingIds.indexOf(slot.dataset.rowId ?? '');
  if (at < 0) return false;
  for (let k = at + (back ? -1 : 1); k >= 0 && k < readingIds.length; k += back ? -1 : 1) {
    const neighbour = slots.get(readingIds[k]!);
    const found = neighbour === undefined ? [] : tabbablesOf(neighbour);
    if (found.length === 0) continue;
    found[back ? found.length - 1 : 0]!.focus();
    return true;
  }
  return false;
}

/** Focuses the first (`back`: last) tabbable element of the first panel in reading order that has one; false when none has. */
function enterInReadingOrder(row: HTMLElement, readingIds: readonly string[], back: boolean): boolean {
  const slots = slotsOf(row);
  for (const id of back ? [...readingIds].reverse() : readingIds) {
    const slot = slots.get(id);
    const found = slot === undefined ? [] : tabbablesOf(slot);
    if (found.length === 0) continue;
    found[back ? found.length - 1 : 0]!.focus();
    return true;
  }
  return false;
}

/** The tabbable element nearest the row on the side Tab is heading to, outside the row. */
function elementBeyond(row: HTMLElement, back: boolean): HTMLElement | undefined {
  const beyond = tabbablesOf(row.ownerDocument.body).filter((el) => !row.contains(el) && (row.compareDocumentPosition(el) & (back ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING)) !== 0);
  return beyond[back ? beyond.length - 1 : 0];
}

/**
 * Tab and Shift+Tab walk the panels in `readingIds` order although the DOM keeps them in the order they opened. Only the
 * hand-over between two panels is steered; inside a panel, and past the row's outer ends, the browser's own movement runs.
 */
export function steerTab(event: React.KeyboardEvent<HTMLElement>, row: HTMLElement, readingIds: readonly string[]): void {
  if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return;
  const target = event.target as Element;
  const slot = target.closest<HTMLElement>('[data-row-slot]');
  if (slot === null || !row.contains(slot)) return;
  const back = event.shiftKey;
  const own = tabbablesOf(slot);
  if (own[back ? 0 : own.length - 1] !== target) return;
  if (readingIds.indexOf(slot.dataset.rowId ?? '') < 0) return;
  if (handOver(slot, row, readingIds, back)) {
    event.preventDefault();
    return;
  }
  // No reading-order neighbour is left: the browser's next stop would be a DOM-later panel. When the DOM-extreme panel has a
  // sentinel, park focus on it and let the default step carry on from there, out of the row; otherwise go there directly.
  const slots = [...slotsOf(row).values()];
  const extreme = slots[back ? 0 : slots.length - 1];
  const edge = extreme === undefined ? undefined : [...extreme.querySelectorAll<HTMLElement>(`[data-row-sentinel=${back ? 'start' : 'end'}]`)].find(usable);
  if (edge === undefined) {
    const beyond = elementBeyond(row, back);
    if (beyond === undefined) return;
    event.preventDefault();
    beyond.focus();
    return;
  }
  parking = true;
  try {
    edge.focus();
  } finally {
    parking = false;
  }
}

/**
 * Focus reaching a panel's start or end sentinel. A Tab pressed inside an iframe never reaches the row's keydown handler, and
 * the browser's step out of the iframe lands on the sentinel next to it: coming from inside the panel, that hands focus over
 * to the drawn neighbour (or past the row's end); coming from outside, the sentinel is passed through to the panel's content.
 */
export function steerSentinel(event: React.FocusEvent<HTMLElement>, row: HTMLElement, readingIds: readonly string[]): void {
  const sentinel = event.target as HTMLElement;
  const kind = sentinel.dataset.rowSentinel;
  if (parking || (kind !== 'start' && kind !== 'end')) return;
  const slot = sentinel.closest<HTMLElement>('[data-row-slot]');
  if (slot === null || !row.contains(slot)) return;
  const from = event.relatedTarget as Node | null;
  const inside = from !== null && slot.contains(from);
  const own = tabbablesOf(slot);
  if (!inside && own.length > 0) {
    // Coming from an element outside the row, the browser picked this slot by DOM order; reading order decides which panel is
    // entered. A null source is also what Chromium reports for a step out of an iframe, which must stay with this slot.
    if (from !== null && !row.contains(from) && enterInReadingOrder(row, readingIds, kind === 'end')) return;
    own[kind === 'start' ? 0 : own.length - 1]!.focus();
    return;
  }
  const back = inside ? kind === 'start' : kind === 'end';
  if (handOver(slot, row, readingIds, back)) return;
  elementBeyond(row, back)?.focus();
}

/** A Tab press the browser has not yet turned into a focus change; `shift` is its direction. */
export interface TabPress {
  readonly shift: boolean;
}

/**
 * Records a Tab press (no ctrl, alt or meta) from keydown until the focus change it causes has run. The record ends at the
 * next task, pointerdown, keydown or window blur, so focus that a script or a click causes is never mistaken for a Tab. Document-level
 * and capturing because focus can arrive from outside the row, where the row sees no key event.
 */
export function useTabPress(): React.RefObject<TabPress | null> {
  const press = React.useRef<TabPress | null>(null);
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      press.current = null;
      clearTimeout(timer);
    };
    const onKey = (event: KeyboardEvent) => {
      clear();
      if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return;
      press.current = { shift: event.shiftKey };
      timer = setTimeout(clear, 0);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', clear, true);
    // Focus moving into an iframe blurs this window; the Tab that leaves the iframe happens in its document, unseen here.
    window.addEventListener('blur', clear);
    return () => {
      clear();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', clear, true);
      window.removeEventListener('blur', clear);
    };
  }, []);
  return press;
}

/**
 * A Tab or Shift+Tab press that moves focus into the row from outside lands on the first (last) tabbable element in reading
 * order, not on the DOM-first (DOM-last) panel the browser would pick. Focus from anything else is left where it went.
 */
export function steerEntry(event: React.FocusEvent<HTMLElement>, row: HTMLElement, readingIds: readonly string[], tab: TabPress | null): void {
  const from = event.relatedTarget as Node | null;
  if (tab === null || (from !== null && row.contains(from))) return;
  enterInReadingOrder(row, readingIds, tab.shift);
}
