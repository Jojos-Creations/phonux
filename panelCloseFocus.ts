/**
 * Where keyboard focus goes when the panel that holds it closes: the grab strip of the panel that takes its place, else the nearest
 * one on either side. Left alone, focus falls to the page body and the person starts again from the top.
 */
import { ROW_SLOT_ATTRIBUTE } from './rowDom.js';

const STRIP = '[data-panel-grab-bar][tabindex="0"]';

/** Focuses the nearest panel's grab strip to `box`'s slot that can take focus, and says whether one did. @internal */
export function focusNeighbourStrip(box: Element): boolean {
  const slot = box.closest<HTMLElement>(`[${ROW_SLOT_ATTRIBUTE}]`);
  if (slot === null) return false;
  const own = Number(slot.getAttribute(ROW_SLOT_ATTRIBUTE));
  const row = slot.parentElement;
  if (row === null) return false;
  const others = [...row.children]
    .filter((n): n is HTMLElement => n instanceof HTMLElement && n !== slot && n.hasAttribute(ROW_SLOT_ATTRIBUTE))
    .map((n) => ({ n, at: Number(n.getAttribute(ROW_SLOT_ATTRIBUTE)) }));
  // The panel on the right slides into the closed one's place, so it goes first; ties never occur between slots.
  const after = others.filter((o) => o.at > own).sort((a, b) => a.at - b.at);
  const before = others.filter((o) => o.at < own).sort((a, b) => b.at - a.at);
  for (const { n } of [...after, ...before]) {
    const strip = n.querySelector<HTMLElement>(STRIP);
    if (strip === null || strip.closest('[inert]') !== null) continue;
    strip.focus({ preventScroll: true });
    if (strip.ownerDocument.activeElement === strip) return true;
  }
  return false;
}
