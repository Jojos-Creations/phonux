/**
 * The row's arrow keys: a bare ArrowLeft or ArrowRight steps the row one stop, unless the panel in use has scrolled out of view,
 * when the key lands focus on the panel at the far edge of the view instead. `stepRow` gives a host's own chord the same answer.
 */
import { arrowKeyBelongsElsewhere } from './arrowKeys.js';
import { EMBLA_WINDOW_ATTRIBUTE, PANEL_ROOT_ATTRIBUTE, ROW_ID_ATTRIBUTE, WORKSPACE_CELL_ATTRIBUTE, panelRootOf } from './rowDom.js';

type Direction = 'left' | 'right';

interface RowKeys {
  step?: (direction: Direction) => void;
  edge?: (direction: Direction, target: EventTarget | null) => boolean;
  half?: (id: string) => boolean;
}

const rows = new Map<HTMLElement, RowKeys>();

/** Hands the row drawn in `container` its step or its edge focus; returns the function that takes it back. @internal */
export function registerRowKeys(container: HTMLElement, part: RowKeys): () => void {
  const entry = rows.get(container) ?? {};
  Object.assign(entry, part);
  rows.set(container, entry);
  return () => {
    for (const key of Object.keys(part) as (keyof RowKeys)[]) if (entry[key] === part[key]) delete entry[key];
    if (entry.step === undefined && entry.edge === undefined && entry.half === undefined) rows.delete(container);
  };
}

/** A panel with less than this much showing counts as off screen: the row hides a sliver, so there is nothing to see or to focus. */
const MIN_SHOWN_PX = 48;

interface Span {
  readonly left: number;
  readonly right: number;
}

/** Whether enough of `slot` is inside `view` to count as on screen; a slot with no width, which is how the row keeps a hidden panel, never is. @internal */
export function isShown(slot: Span, view: Span): boolean {
  if (slot.right <= slot.left) return false;
  const overlap = Math.min(slot.right, view.right) - Math.max(slot.left, view.left);
  return overlap >= Math.min(MIN_SHOWN_PX, slot.right - slot.left, view.right - view.left);
}

/** Left picks the rightmost panel in view and Right the leftmost: the key that would scroll toward the missing panel lands on the window's far side. @internal */
export function edgeSlotInView<T extends Span>(slots: readonly T[], view: Span, direction: Direction): T | undefined {
  const shown = slots.filter((slot) => isShown(slot, view)).sort((a, b) => a.left - b.left);
  return direction === 'left' ? shown[shown.length - 1] : shown[0];
}

/**
 * Whether focus is on the page rather than on a control: the body, or a workspace cell. A click on a panel's picture lands focus on
 * the cell, the nearest element that can take it, so the panel in use stands in then.
 */
function isFocusBackground(target: EventTarget | null): boolean {
  return target === document || target === document.documentElement || target === document.body || (target instanceof Element && target.hasAttribute(WORKSPACE_CELL_ATTRIBUTE));
}

/**
 * When `active` (an engine id) is out of `container`'s view and the key came from the page itself, focuses the panel at the view's
 * far edge and answers true. A control with focus, or an active panel in view, leaves the key to the row.
 * @internal
 */
export function focusEdgePanel(container: HTMLElement, active: string | null, direction: Direction, target: EventTarget | null): boolean {
  if (active === null || !isFocusBackground(target)) return false;
  const cell = container.closest(`[${WORKSPACE_CELL_ATTRIBUTE}]`);
  // Every workspace in a column keeps its row mounted and hears every key; only the one the key went to answers it.
  if (target instanceof Element && target.closest(`[${WORKSPACE_CELL_ATTRIBUTE}]`) !== null && cell !== null && !cell.contains(target)) return false;
  // On an Embla row the view is its window, which the container is wider than (the window is cut to whole slots and centered).
  const view = (container.querySelector(`[${EMBLA_WINDOW_ATTRIBUTE}]`) ?? container).getBoundingClientRect();
  const slots = [...container.querySelectorAll<HTMLElement>(`[${ROW_ID_ATTRIBUTE}]`)].map((el) => {
    const box = el.getBoundingClientRect();
    return { el, id: el.getAttribute(ROW_ID_ATTRIBUTE), left: box.left, right: box.right };
  });
  const own = slots.find((slot) => slot.id === active);
  if (own !== undefined && isShown(own, view)) return false;
  const edge = edgeSlotInView(slots, view, direction);
  if (edge === undefined) return false;
  // The panel's own ring marks it, so the browser's square outline is dropped; no scroll, as the panel is already in view.
  const root = edge.el.querySelector<HTMLElement>(`[${PANEL_ROOT_ATTRIBUTE}]`) ?? panelRootOf(edge.el) ?? edge.el;
  if (!root.hasAttribute('tabindex')) root.tabIndex = -1;
  root.style.outline = 'none';
  root.focus({ preventScroll: true });
  return true;
}

/**
 * Steps the row `event` belongs to one stop toward `direction`, as a bare ArrowLeft or ArrowRight does, for a host binding its own
 * chord such as Option+Arrow. The row in the workspace cell that holds the event's target answers it, else the row in view. When the
 * panel in use is out of view, focus goes to the panel at the view's far edge instead, as for a bare arrow.
 *
 * Answers false, doing nothing, when the key belongs elsewhere (a text field, a widget that takes arrows, an open dialog, an IME,
 * a keyboard drag, a key already handled) or no row is in view. Modifier keys are not judged: the chord is the host's.
 * @public
 */
export function stepRow(event: KeyboardEvent, direction: 'left' | 'right'): boolean {
  if (arrowKeyBelongsElsewhere(event, document, direction === 'left' ? 'ArrowLeft' : 'ArrowRight', true)) return false;
  const cell = event.target instanceof Element ? event.target.closest(`[${WORKSPACE_CELL_ATTRIBUTE}]`) : null;
  for (const [container, keys] of rows) {
    if (!container.isConnected || container.closest('[inert]') !== null || (cell !== null && !cell.contains(container))) continue;
    if (keys.edge?.(direction, event.target) === true) return true;
    if (keys.step === undefined) continue;
    keys.step(direction);
    return true;
  }
  return false;
}

/** Steps the row drawn in `container` one stop, as its own gesture does; false when that row has no step. @internal */
export function stepRowIn(container: HTMLElement, direction: Direction): boolean {
  const step = rows.get(container)?.step;
  if (step === undefined) return false;
  step(direction);
  return true;
}

/** Rests the row drawn in `container` on the half step that centers panel `id`; false when it has none to rest on. @internal */
export function halfStepIn(container: HTMLElement, id: string): boolean {
  return rows.get(container)?.half?.(id) ?? false;
}
