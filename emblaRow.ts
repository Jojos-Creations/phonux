/**
 * The row on Embla Carousel (`Workspace`'s `rowEngine="embla"`): Embla owns where the strip is, and turns drag, wheel and
 * glide into motion that settles on a stop. Ours is the window, sized to whole slots, and one invisible marker per slot, which
 * Embla takes as its slides, so each slot edge is a stop, a wide panel's inner ones included.
 *
 * Internal and out of the barrel until the old row is retired. Embla is pinned to 8.6: its `internalEngine()` interface, which
 * the later oval drag needs, is not covered by semver.
 */

import * as React from 'react';
import EmblaCarousel, { type EmblaCarouselType, type EmblaOptionsType } from 'embla-carousel';
import { WheelGesturesPlugin } from 'embla-carousel-wheel-gestures';
import { arrowKeyBelongsElsewhere } from './arrowKeys.js';
import { ROW_SLOT_ATTRIBUTE } from './rowDom.js';

/** On the container of a row that runs on Embla. The old row's own wheel, touch and key listeners stand aside for it. @internal */
export const ROW_ENGINE_ATTRIBUTE = 'data-row-engine';
/** On each slot marker: an empty box one phone wide, at its slot's place in the strip. @internal */
export const EMBLA_SLOT_ATTRIBUTE = 'data-row-embla-slot';
/** On the element Embla is rooted on: the window that shows whole slots. @internal */
export const EMBLA_WINDOW_ATTRIBUTE = 'data-row-embla-window';

/** Which engine moves a row. 'own' is the library's row; 'embla' is the row on Embla Carousel. @internal */
export type RowEngine = 'own' | 'embla';

/** The engine the enclosing `Workspace` moves its row with; the row reads it to draw for that engine. @internal */
export const RowEngineContext = React.createContext<RowEngine>('own');

/** Whether the row whose container is `container` runs on Embla. @internal */
export function runsOnEmbla(container: Element): boolean {
  return container.getAttribute(ROW_ENGINE_ATTRIBUTE) === 'embla';
}

/** The window an Embla row is seen through, in px. @internal */
export interface EmblaWindow {
  /** Whole slots that fit beside each other, at least one. */
  fit: number;
  /** The window's width: `fit` slots and the gaps between them, or the strip's own width when it is narrower. */
  width: number;
  /** True when the strip is wider than the window, so the row moves. */
  scrolls: boolean;
}

/**
 * The window for a strip `stripWidth` wide in `room` px (the container less one gap each side). The window holds whole slots
 * only, so at rest a one-slot panel is never cut; a strip that fits is the window, centered by the caller.
 * @internal
 */
export function emblaWindowOf(room: number, phoneWidth: number, gap: number, stripWidth: number): EmblaWindow {
  const pitch = phoneWidth + gap;
  const fit = Number.isFinite(room) ? Math.max(1, Math.floor((room + gap) / pitch)) : Number.POSITIVE_INFINITY;
  const full = Number.isFinite(fit) ? fit * pitch - gap : Number.POSITIVE_INFINITY;
  const scrolls = stripWidth > full + 0.5;
  return { fit: Number.isFinite(fit) ? fit : Math.max(1, Math.round((stripWidth + gap) / pitch)), width: scrolls ? full : Math.max(0, stripWidth), scrolls };
}

/** Each slot marker's left in strip px: one per slot of a strip `stripWidth` wide, every `phoneWidth + gap`. @internal */
export function slotMarkerLefts(stripWidth: number, phoneWidth: number, gap: number): number[] {
  const pitch = phoneWidth + gap;
  const count = stripWidth <= 0 ? 0 : Math.max(1, Math.round((stripWidth + gap) / pitch));
  return Array.from({ length: count }, (_, k) => k * pitch);
}

/**
 * The rests Embla reaches with markers at `markers` in a window `windowWidth` wide, as scroll px (what Embla's `align: 'start'`
 * and `containScroll: 'trimSnaps'` give): every marker up to the strip's end, and the end itself, each once.
 * @internal
 */
export function emblaRests(markers: readonly number[], stripWidth: number, windowWidth: number): number[] {
  const max = Math.max(0, stripWidth - windowWidth);
  const rests = markers.map((m) => Math.min(m, max));
  return rests.filter((r, k) => k === 0 || Math.abs(r - rests[k - 1]!) > 0.5);
}

/** Whether `scroll` is a rest on the slot grid: a whole number of pitches, or the strip's end. @internal */
export function restsOnGrid(scroll: number, pitch: number, max: number): boolean {
  if (Math.abs(scroll - max) <= 0.5) return true;
  return Math.abs(scroll / pitch - Math.round(scroll / pitch)) * pitch <= 0.5;
}

/**
 * The scroll that shows a panel at `left` (strip px) `width` wide whole in a window `windowWidth` wide now at `scroll`, moving
 * as little as it can; null when it is whole already. A panel wider than the window lands at its own left edge.
 * @internal
 */
export function revealScroll(left: number, width: number, scroll: number, windowWidth: number): number | null {
  if (left >= scroll - 0.5 && left + width <= scroll + windowWidth + 0.5) return null;
  if (left < scroll || width >= windowWidth) return left;
  return left + width - windowWidth;
}

/**
 * Whether a press may start a drag of the row. A wheel gesture arrives as Embla's own untrusted mouse events and always may.
 * A mouse press only on the row's own surface, outside every panel, so a panel's text, controls and header grab keep the mouse.
 * A touch anywhere but on a control, an editable field or a frame, as the old row's finger swipe.
 * @internal
 */
export function pressStartsRowDrag(event: Pick<Event, 'isTrusted' | 'target' | 'type'>): boolean {
  if (!event.isTrusted) return true;
  const target = event.target instanceof Element ? event.target : null;
  if (target === null) return false;
  if (event.type === 'mousedown') return target.closest(`[${ROW_SLOT_ATTRIBUTE}]`) === null;
  return target.closest('button,a[href],input,select,textarea,[contenteditable=""],[contenteditable="true"],[role="slider"],iframe,webview,[data-dnd-grab],[data-panel-grab]') === null;
}

/** The options the row runs Embla with: one stop per slot marker, a flick may pass several. @internal */
export function emblaRowOptions(): EmblaOptionsType {
  return {
    align: 'start',
    containScroll: 'trimSnaps',
    slides: `:scope > [${EMBLA_SLOT_ATTRIBUTE}]`,
    skipSnaps: true,
    dragThreshold: 4,
    watchDrag: (_api, event) => pressStartsRowDrag(event),
  };
}

const instances = new WeakMap<Element, EmblaCarouselType>();
/** The Embla instance moving the row whose window or container is `el`, for the proof page and the later steps. @internal */
export function emblaOf(el: Element): EmblaCarouselType | undefined {
  const win = el.closest(`[${EMBLA_WINDOW_ATTRIBUTE}]`) ?? el.querySelector(`[${EMBLA_WINDOW_ATTRIBUTE}]`);
  return win === null ? undefined : instances.get(win);
}

/** Where the row is, in scroll px (how far the strip is moved left), from Embla's own location. @internal */
export function emblaScrollOf(embla: EmblaCarouselType): number {
  return -embla.internalEngine().location.get();
}

/**
 * Runs Embla on `windowRef` (the root) with `boxRef` (its container, the box the slots and markers sit in). Wheel and trackpad
 * come through Embla's wheel-gestures plugin, so a wheel handed in from embedded content (`feedRowWheel`) moves the row as a
 * wheel over the row does; Option held at a gesture's first event leaves the whole gesture to the content. Bare arrow keys step
 * one slot. `enabled` false tears it down.
 * @internal
 */
export function useEmblaRow(windowRef: React.RefObject<HTMLElement | null>, boxRef: React.RefObject<HTMLElement | null>, enabled: boolean, quietMs: number): void {
  const quietRef = React.useRef(quietMs);
  quietRef.current = quietMs;
  React.useLayoutEffect(() => {
    const win = windowRef.current;
    const box = boxRef.current;
    if (!enabled || win === null || box === null) return undefined;
    // Registered before the plugin's own listener on the same node, so stopping it here keeps the gesture from the row only.
    let owner: 'row' | 'content' | null = null;
    let quiet: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent): void => {
      if (quiet !== null) clearTimeout(quiet);
      quiet = setTimeout(() => {
        owner = null;
      }, quietRef.current);
      if (owner === null) owner = e.altKey ? 'content' : 'row';
      if (owner === 'content' || win.closest('[inert]') !== null) e.stopImmediatePropagation();
    };
    win.addEventListener('wheel', onWheel, { passive: true });
    const embla = EmblaCarousel(win, { ...emblaRowOptions(), container: box }, [WheelGesturesPlugin({ target: win })]);
    instances.set(win, embla);
    const doc = win.ownerDocument;
    const view = doc.defaultView ?? window;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || arrowKeyBelongsElsewhere(e, doc)) return;
      if (win.closest('[inert]') !== null) return;
      e.preventDefault();
      if (e.key === 'ArrowLeft') embla.scrollPrev();
      else embla.scrollNext();
    };
    view.addEventListener('keydown', onKey);
    // A panel focused while partly out of the window comes into it: Embla moves only for slides, and its slides are the markers.
    const onFocus = (e: FocusEvent): void => {
      const slot = (e.target as Element | null)?.closest<HTMLElement>(`[${ROW_SLOT_ATTRIBUTE}]`);
      if (slot == null || !box.contains(slot)) return;
      const to = revealScroll(Number(slot.dataset.rowSlot) || 0, slot.offsetWidth, emblaScrollOf(embla), box.offsetWidth);
      if (to === null) return;
      const snaps = embla.internalEngine().scrollSnaps.map((x) => -x);
      let best = 0;
      for (let k = 1; k < snaps.length; k += 1) if (Math.abs(snaps[k]! - to) < Math.abs(snaps[best]! - to)) best = k;
      embla.scrollTo(best);
    };
    win.addEventListener('focusin', onFocus);
    return () => {
      win.removeEventListener('focusin', onFocus);
      if (quiet !== null) clearTimeout(quiet);
      view.removeEventListener('keydown', onKey);
      win.removeEventListener('wheel', onWheel);
      instances.delete(win);
      embla.destroy();
    };
  }, [enabled, windowRef, boxRef]);
}
