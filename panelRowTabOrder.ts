const TABBABLE = 'a[href],button,input,select,textarea,summary,iframe,[tabindex],[contenteditable=""],[contenteditable="true"]';

function tabbablesOf(slot: Element): HTMLElement[] {
  if (slot.closest('[inert]') !== null) return [];
  return [...slot.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && el.closest('[inert]') === null,
  );
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
  const slots = new Map([...row.querySelectorAll<HTMLElement>('[data-row-slot]')].map((s) => [s.dataset.rowId ?? '', s]));
  const at = readingIds.indexOf(slot.dataset.rowId ?? '');
  if (at < 0) return;
  for (let k = at + (back ? -1 : 1); k >= 0 && k < readingIds.length; k += back ? -1 : 1) {
    const neighbour = slots.get(readingIds[k]!);
    const found = neighbour === undefined ? [] : tabbablesOf(neighbour);
    if (found.length === 0) continue;
    event.preventDefault();
    found[back ? found.length - 1 : 0]!.focus();
    return;
  }
  // No reading-order neighbour is left: the browser's next stop would be a DOM-later panel, so focus the DOM-extreme
  // tabbable and let the default step carry on from there, out of the row.
  const all = tabbablesOf(row);
  const edge = all[back ? 0 : all.length - 1];
  if (edge !== undefined) edge.focus();
}
