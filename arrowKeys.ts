/**
 * The one guard the row's and the column's arrow-key listeners share.
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
  for (const node of [e.target, doc.activeElement]) {
    if (!(node instanceof Element)) continue;
    if (node.closest('input,textarea,select')) return true;
    if (node.closest(EDITABLE_ROLES)) return true;
    const editable = node.closest('[contenteditable]');
    if (editable !== null && editable.getAttribute('contenteditable') !== 'false') return true;
    // dnd-kit marks the item a keyboard drag is carrying pressed.
    if (node.closest('[aria-pressed="true"][aria-roledescription]')) return true;
  }
  return doc.querySelector(`dialog[open],[aria-modal="true"],[${DRAGGING_ATTRIBUTE}]`) !== null;
}
