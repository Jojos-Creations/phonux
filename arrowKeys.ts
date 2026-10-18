/**
 * The guards the row's and the column's input listeners share, so input meant for a panel's own content stays with it.
 */
import { DRAGGING_ATTRIBUTE } from './panelChrome.js';

const EDITABLE_ROLES = '[role="textbox"],[role="searchbox"],[role="combobox"],[role="listbox"],[role="slider"],[role="spinbutton"],[role="menu"],[role="menubar"],[role="tablist"],[role="tree"],[role="grid"],[role="radiogroup"]';

/**
 * Whether an arrow key belongs to something other than the row or column that listens for it: a modified key, one a handler already took,
 * one typed in a field or widget that uses the arrows, one while a dialog is open or an IME is composing, or one during a keyboard drag.
 * A repeated key is not judged here: the column ignores it and the row steps on it.
 * @internal
 */
export function arrowKeyBelongsElsewhere(e: KeyboardEvent, doc: Document): boolean {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return true;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return true;
  const move = ARROW_MOVES[e.key];
  for (const node of [e.target, doc.activeElement]) {
    if (!(node instanceof Element)) continue;
    if (move !== undefined && contentScrolls(node, move.axis, move.direction)) return true;
    if (node.closest('input,textarea,select')) return true;
    if (node.closest(EDITABLE_ROLES)) return true;
    const editable = node.closest('[contenteditable]');
    if (editable !== null && editable.getAttribute('contenteditable') !== 'false') return true;
    // dnd-kit marks the item a keyboard drag is carrying pressed.
    if (node.closest('[aria-pressed="true"][aria-roledescription]')) return true;
  }
  return doc.querySelector(`dialog[open],[aria-modal="true"],[${DRAGGING_ATTRIBUTE}]`) !== null;
}

const ARROW_MOVES: Record<string, { axis: 'x' | 'y'; direction: number }> = {
  ArrowLeft: { axis: 'x', direction: -1 },
  ArrowRight: { axis: 'x', direction: 1 },
  ArrowUp: { axis: 'y', direction: -1 },
  ArrowDown: { axis: 'y', direction: 1 },
};

/**
 * Whether `from` or an ancestor below the row's own scroller is a scroller of the panel's content that can still move along
 * `axis` in `direction`: the browser scrolls that first, so the row or column must leave the input alone.
 * @internal
 */
export function contentScrolls(from: Element, axis: 'x' | 'y', direction: number): boolean {
  for (let node: Element | null = from; node !== null && !node.hasAttribute('data-row-scroller'); node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue;
    const style = getComputedStyle(node);
    if (!/(auto|scroll)/.test(axis === 'x' ? style.overflowX : style.overflowY)) continue;
    const at = axis === 'x' ? Math.abs(node.scrollLeft) : node.scrollTop;
    const max = axis === 'x' ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight;
    if (max < 1) continue;
    // A right-to-left scroller counts scrollLeft down from 0, so its rightward room is what has been scrolled.
    const rtl = axis === 'x' && style.direction === 'rtl';
    const forward = rtl ? -direction : direction;
    if (forward > 0 ? at < max - 0.5 : at > 0.5) return true;
  }
  return false;
}
