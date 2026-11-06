/**
 * The row's one drawing pass. Everything the row draws from where its strip is, other than the strip itself and each slot's
 * own slide, is written here from the same numbers and the same scroll: the cut at the grid's edges, the held panels'
 * clamp, the cut and fade of a strip panel beside a held one, and which panels the window does not reach.
 */
import * as React from 'react';
import { AwayContext } from './panelAway.js';
import { gridEdgesOf, slotCutAt, slotEdgesAt, type RowNumbers } from './rowNumbers.js';
import { closestRowScroller, rowScrollerFor, rowStripOf } from './rowScroller.js';
import { holdShiftOf, setHoldShift } from './slotMover.js';

/** How far above and below its box a clip stays open, so a panel's shadow or focus ring is never cut. */
const CLIP_OPEN_PX = 100000;

/** The clip that cuts a slot of `width` to the band `lo..hi` of its own box; '' when nothing is cut. A style, never animated. */
function bandClip(lo: number, hi: number, width: number): string {
  const left = Math.max(0, lo);
  const right = Math.max(0, width - hi);
  return left > 0 || right > 0 ? `inset(-${CLIP_OPEN_PX}px ${right}px -${CLIP_OPEN_PX}px ${left}px)` : '';
}

/** How far past a slot's sides its fade stays open, so a panel's glow is not cut on the side the fade is not on. */
const FADE_OPEN_PX = 400;

/** Fades `slot` in over `gap` px from `start` in its own box, or clears the fade for null. A style, never animated. */
function drawFade(slot: HTMLElement, start: number | null, gap: number): void {
  const image = start === null ? '' : `linear-gradient(to right, transparent ${start + FADE_OPEN_PX}px, #000 ${start + gap + FADE_OPEN_PX}px)`;
  if (slot.style.maskImage === image) return;
  slot.style.maskImage = image;
  // No clip to the box, repeated down it: a header, a footer and a glow stand outside the slot and fade with it.
  slot.style.setProperty('mask-size', start === null ? '' : `calc(100% + ${2 * FADE_OPEN_PX}px) 100%`);
  slot.style.setProperty('mask-position', start === null ? '' : `-${FADE_OPEN_PX}px 0`);
  slot.style.setProperty('mask-repeat', start === null ? '' : 'repeat-y');
  slot.style.setProperty('mask-clip', start === null ? '' : 'no-clip');
}

/** The clip for `slotEdgesAt`'s cuts: '' when nothing is cut, and open on an uncut side, so a panel's glow still shows there. */
function edgeClip(left: number, right: number): string {
  if (left <= 0 && right <= 0) return '';
  return `inset(-${CLIP_OPEN_PX}px ${right > 0 ? `${right}px` : `-${FADE_OPEN_PX}px`} -${CLIP_OPEN_PX}px ${left > 0 ? `${left}px` : `-${FADE_OPEN_PX}px`})`;
}

/** What the pass needs to hold one panel at an edge: where it sits in its line and how far it keeps from the container's edges. */
export interface HoldSpec {
  id: string;
  /** Kept `left` px inside the container's left edge and `right` px inside its right one. */
  sticky: { left?: number; right?: number };
  /** The line's width before the panel's box, and the line's own width. */
  spacer: number;
  lineWidth: number;
  /** The panel's width. */
  width: number;
}

/**
 * Draws the row from `rowNumbers` and the scroller, on mount and commit and on every move of the row. `holds` lists the held and
 * stuck panels (see PanelHold, which only lays out their lines). A row with one asks the scroller to draw its strip in the frame
 * loop, since the clamp of a held panel and the cut beside it are written there and would drift from a strip the compositor draws.
 * `boxRef` is any element inside the row's strip.
 */
export function useRowDraw(boxRef: React.RefObject<HTMLElement | null>, rowNumbers: RowNumbers | undefined, gap: number, holds: readonly HoldSpec[]): void {
  const awayStore = React.useContext(AwayContext);
  React.useLayoutEffect(() => {
    const anchor = boxRef.current;
    const container = anchor === null ? null : closestRowScroller(anchor);
    const strip = container === null ? null : rowStripOf(container);
    if (container === null || strip === null || rowNumbers === undefined) return;
    const n = rowNumbers;
    const scroller = rowScrollerFor(container);
    const slots = [...strip.querySelectorAll<HTMLElement>('[data-row-slot]')];
    const framed = n.held.length > 0 || n.stuck.length > 0;
    // A row whose strip fits, or that scrolls freely with no hold, has no grid edge inside the window: it renders exactly as it did.
    const clips = n.stops.length > 0 || n.held.length > 0 || n.stuck.length > 0;
    const bleeds = clips && n.leftInset > 0 && n.rightInset === 0 && n.stuck.length === 0;
    const grid = gridEdgesOf(n);

    // The grid's edges are fixed in the window while the strip moves under them, so the cut is on the strip's fixed parent and is
    // written once: a cut written from the strip's position each frame trails the strip when the compositor draws it. That parent
    // starts where the strip does, after the left group. A row held only at the left runs on to the window's edge, where its slots
    // cut themselves (`slotEdgesAt`).
    const windowEl = strip.parentElement;
    if (windowEl !== null) {
      const right = (bleeds ? n.windowWidth + gap : grid.hi) - n.leftInset;
      const cut = clips && Number.isFinite(right) ? `polygon(${grid.lo - n.leftInset}px -${CLIP_OPEN_PX}px, ${right}px -${CLIP_OPEN_PX}px, ${right}px ${CLIP_OPEN_PX}px, ${grid.lo - n.leftInset}px ${CLIP_OPEN_PX}px)` : '';
      if (windowEl.style.clipPath !== cut) windowEl.style.clipPath = cut;
    }

    // Each held panel's host, measured once per commit: where its box sits in the strip, which no move of the row changes.
    const spots = new Map<HTMLElement, { spec: HoldSpec; inStrip: number }>();
    const stripLeft = strip.getBoundingClientRect().left;
    const pad = getComputedStyle(container);
    // A sticky box keeps its insets inside the container's padding, so they count from the content box's edges.
    const padLeft = Number.parseFloat(pad.paddingLeft) || 0;
    const contentRight = container.clientWidth - (Number.parseFloat(pad.paddingRight) || 0);
    for (const box of strip.querySelectorAll<HTMLElement>('[data-row-hold]')) {
      const id = box.querySelector<HTMLElement>('[data-row-slot]')?.dataset.rowId;
      const spec = id === undefined ? undefined : holds.find((h) => h.id === id);
      if (spec === undefined) {
        // Let go: a box that is no longer held goes back to where its line puts it.
        box.style.transform = '';
        setHoldShift(box, 0);
        continue;
      }
      spots.set(box, { spec, inStrip: box.getBoundingClientRect().left - stripLeft - holdShiftOf(box) });
    }

    const place = (): void => {
      for (const [box, { spec, inStrip }] of spots) {
        const x = strip.offsetLeft + scroller.stripX() + inStrip;
        let to = x;
        if (spec.sticky.right !== undefined) to = Math.min(to, contentRight - spec.sticky.right - spec.width);
        if (spec.sticky.left !== undefined) to = Math.max(to, padLeft + spec.sticky.left);
        const lineStart = x - spec.spacer;
        to = Math.min(Math.max(to, lineStart), lineStart + spec.lineWidth - spec.width);
        setHoldShift(box, to - x);
        box.style.transform = to === x ? '' : `translateX(${to - x}px)`;
      }
    };

    // Reach and the cut are written straight to the slots at every move of the row, since a state update per frame of a glide would
    // re-render the whole row. Both are judged from the row's numbers and offset, never from a slot's box: a box read before a slot
    // grew, or mid-slide, is stale, and a stale box once hid panels the window showed. No slot is ever hidden: a panel wholly inside
    // the slot grid is drawn whole, one crossing the grid's edge is cut there, and nothing is drawn in the margins beside the grid.
    const cut = (): void => {
      const held = scroller.claimHeld();
      const at = scroller.scrollLeft();
      const seen = new Set<string>();
      for (const slot of slots) {
        const id = slot.dataset.rowId;
        // A held or stuck panel is in reach at every offset, and so is an id `n` does not draw (one still exiting).
        const k = id === undefined || n.stuck.some((s) => s.id === id) ? -1 : n.ids.indexOf(id);
        const edge = k < 0 ? null : slotCutAt(n, k, at, gap);
        // A stepping row rests with whole panels past the window; a free-scrolling row keeps every slot in reach.
        const away = n.stops.length > 0 && edge !== null && edge.away;
        if (id !== undefined) {
          seen.add(id);
          awayStore?.set(id, away);
        }
        // A strip panel beside a held or stuck panel is cut at that panel's gap, never hidden: what its window shows of it is drawn.
        // The grid's own edges are the window element's cut above, so a slot sliding off its numbers is still cut where it is drawn.
        const edges = bleeds && edge !== null ? slotEdgesAt(n, k, at, gap) : null;
        const slotClip = edges !== null ? edgeClip(edges.left, edges.right) : clips && edge !== null && (n.leftInset > 0 || n.rightInset > 0 || n.stuck.length > 0) ? bandClip(edge.left, n.widths[k]! - edge.right, n.widths[k]!) : '';
        if (slot.style.clipPath !== slotClip) slot.style.clipPath = slotClip;
        drawFade(slot, edges === null ? null : edges.fade, gap);
        // A drag's claim holds reach still until the release.
        if (held) continue;
        if (slot.style.pointerEvents !== (away ? 'none' : '')) slot.style.pointerEvents = away ? 'none' : '';
        // Inert too: Tab or find-in-page would otherwise move the row off its stop to reveal a panel the window does not reach.
        if (slot.hasAttribute('inert') !== away) slot.toggleAttribute('inert', away);
      }
      awayStore?.retain(seen);
    };

    const draw = (): void => {
      place();
      cut();
    };
    draw();
    const unsubscribe = scroller.subscribe(draw, { sameFrame: framed });
    // A claim's release moves no offset, so reach catches up on the next pointer or key on the row: on the frame after it, so the
    // key itself (a Tab across an inert panel) is answered by the reach the row had.
    let frame = 0;
    const later = (): void => {
      if (frame === 0)
        frame = requestAnimationFrame(() => {
          frame = 0;
          cut();
        });
    };
    container.addEventListener('pointermove', later, { passive: true });
    container.addEventListener('keydown', later);
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener('pointermove', later);
      container.removeEventListener('keydown', later);
      unsubscribe();
    };
  });
}
