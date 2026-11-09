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

/**
 * How far from the view, in slots, a parkable panel keeps its content loaded on an Embla row. Two: a step, an arrow key or a short
 * flick moves one to three slots, so those never meet a placeholder, and a row whose window fits four slots keeps at most eight
 * parkable panels alive. @internal
 */
export const ROW_NEAR_SLOTS = 2;

/** The enclosing `Workspace`'s `rowNearSlots`: how far from the view an Embla row keeps a parkable panel's content loaded. @internal */
export const RowNearContext = React.createContext<number>(ROW_NEAR_SLOTS);

/** On the placeholder an Embla row draws for a panel whose content it unloaded: the slot keeps its width and place. @internal */
export const EMBLA_UNLOADED_ATTRIBUTE = 'data-row-unloaded';

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

/** Where each panel sits along the strip: ids in row order, each one's left and width in strip px. @internal */
export interface StripLayout {
  ids: readonly string[];
  lefts: readonly number[];
  widths: readonly number[];
}

/**
 * The scroll that keeps the view still across a change of the strip from `before` to `after` (a panel opened, closed, moved or
 * resized, or clamped by a narrower window). The anchor is the first panel, in strip order, that reaches past the window's left
 * edge at `scroll` and is still in the strip: the scroll moves by as much as that panel moved, so it, and everything after it
 * that did not change, stays where it is on screen. Clamped to `[0, max]`, the strip's new end.
 * @internal
 */
export function keptScroll(before: StripLayout, after: StripLayout, scroll: number, max: number): number {
  const order = before.ids.map((_, k) => k).sort((a, b) => before.lefts[a]! - before.lefts[b]!);
  for (const k of order) {
    if (before.lefts[k]! + before.widths[k]! <= scroll + 0.5) continue;
    const j = after.ids.indexOf(before.ids[k]!);
    if (j < 0) continue;
    return Math.min(Math.max(0, scroll + after.lefts[j]! - before.lefts[k]!), max);
  }
  return Math.min(Math.max(0, scroll), max);
}

/** Whether two strip layouts place the same panels at the same lefts and widths. @internal */
export function sameLayout(a: StripLayout, b: StripLayout): boolean {
  return a.ids.length === b.ids.length && a.ids.every((id, k) => id === b.ids[k] && Math.abs(a.lefts[k]! - b.lefts[k]!) < 0.5 && Math.abs(a.widths[k]! - b.widths[k]!) < 0.5);
}

const rebuildWaiting = new WeakSet<EmblaCarouselType>();
/** The box width each row's Embla last built its stops at, so its resize watch rebuilds only for a change it did not hear of. */
const builtWidth = new WeakMap<EmblaCarouselType, number>();
const boxWidthOf = (embla: EmblaCarouselType): number => embla.containerNode().getBoundingClientRect().width;
/** Records that `embla` built its stops at the box's width now. @internal */
export function markEmblaBuilt(embla: EmblaCarouselType): void {
  builtWidth.set(embla, boxWidthOf(embla));
}

/**
 * Applies a change of the strip to the row: moves it by `shift` px (the keep-still rule's answer, 0 for a change right of the
 * view) and, when `restop`, rebuilds Embla's stops from the markers drawn now. The row stays where it is drawn, plus the shift:
 * a glide in flight goes on to the stop nearest where it was going, and a rest stays a rest. Embla's `reInit` drops a press or
 * wheel gesture in progress (it rebuilds the drag handler and the wheel plugin), so while one holds the row the shift is applied
 * in place and the rebuild waits for its release (`releaseEmbla`). Shifting or keeping a position that is not a stop uses
 * Embla's internal engine, which 8.6 is pinned for; a jump at rest to a stop uses the public `scrollTo`.
 * @internal
 */
export function moveEmbla(embla: EmblaCarouselType, shift: number, restop: boolean): void {
  const e = embla.internalEngine();
  if (e.dragHandler.pointerDown()) {
    if (Math.abs(shift) > 0.01) shiftEmbla(embla, shift);
    if (restop) rebuildWaiting.add(embla);
    return;
  }
  const drawn = emblaDrawnOf(embla) + shift;
  const target = -e.target.get() + shift;
  const gliding = Math.abs(e.target.get() - e.location.get()) > 0.5 || Math.abs(e.location.get() - e.offsetLocation.get()) > 0.5;
  if (restop) {
    embla.reInit();
    markEmblaBuilt(embla);
  } else if (Math.abs(shift) <= 0.01) return;
  const max = emblaMaxOf(embla);
  const clamp = (px: number): number => Math.min(Math.max(0, px), max);
  const stop = nearestStop(embla, clamp(gliding ? target : drawn));
  const onStop = Math.abs(stopPx(embla, stop) - clamp(drawn)) <= 0.5;
  if (!gliding && onStop) {
    embla.scrollTo(stop, true);
    return;
  }
  writeEmbla(embla, clamp(drawn));
  embla.scrollTo(stop);
}

/** A gesture that held the row let go: runs the rebuild a strip change made wait (see `moveEmbla`). @internal */
export function releaseEmbla(embla: EmblaCarouselType): void {
  if (!rebuildWaiting.delete(embla)) return;
  moveEmbla(embla, 0, true);
}

/** Moves every position Embla keeps by `shift` scroll px, so a drag, wheel gesture or glide in flight goes on from there. */
function shiftEmbla(embla: EmblaCarouselType, shift: number): void {
  const e = embla.internalEngine();
  for (const v of [e.location, e.previousLocation, e.offsetLocation, e.target]) v.set(v.get() - shift);
  e.translate.to(e.offsetLocation.get());
  notifyEmblaRows();
}

/** The row's furthest rest in scroll px, from Embla's stops. @internal */
export function emblaMaxOf(embla: EmblaCarouselType): number {
  const snaps = embla.internalEngine().scrollSnaps;
  return snaps.length === 0 ? 0 : Math.max(0, ...snaps.map((x) => -x));
}

/** Stop `k`'s place in scroll px. */
const stopPx = (embla: EmblaCarouselType, k: number): number => -(embla.internalEngine().scrollSnaps[k] ?? 0);

/**
 * Whether a press may start a drag of the row. A wheel gesture arrives as Embla's own untrusted mouse events and always may.
 * A mouse press only on the row's own surface, outside every panel, so a panel's text, controls and header grab keep the mouse.
 * A touch anywhere but on a control, an editable field or a frame, as the old row's finger swipe.
 * @internal
 */
export function pressStartsRowDrag(event: Pick<Event, 'isTrusted' | 'target' | 'type'>): boolean {
  if (!event.isTrusted) return true;
  const target = event.target as Element | null;
  if (target === null || typeof target.closest !== 'function') return false;
  if (event.type === 'mousedown') return target.closest(`[${ROW_SLOT_ATTRIBUTE}]`) === null;
  return target.closest('button,a[href],input,select,textarea,[contenteditable=""],[contenteditable="true"],[role="slider"],iframe,frame,embed,object') === null;
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
    // The row rebuilds Embla itself (`moveEmbla`) when the markers or the window change: Embla's own watchers would rebuild on every
    // slot and drop-gap change in the box, back to the selected stop, dropping a gesture in progress.
    watchSlides: false,
    // A size change of the window box Embla did not hear about from the row (a row shown after it was hidden) rebuilds the same way.
    watchResize: (api) => {
      if (Math.abs(boxWidthOf(api) - (builtWidth.get(api) ?? -1)) >= 0.5) moveEmbla(api, 0, true);
      return false;
    },
  };
}

/**
 * Which panels of an Embla row keep their content loaded with the view at `scroll`: every panel `unloadable` says no to; every
 * panel the window shows; and, nearest first, the unloadable ones whose edge lies under `near` slots past the window's edge, at
 * most `limit` loaded unloadable panels in all (the view's own count when it shows more). One loaded in `was` stays loaded until it
 * is a whole slot further, so a row resting on the boundary does not load and unload by turns.
 * @internal
 */
export function loadedNear(i: {
  layout: StripLayout;
  scroll: number;
  windowWidth: number;
  pitch: number;
  gap: number;
  near: number;
  limit: number | null;
  unloadable: (id: string) => boolean;
  was: ReadonlySet<string> | null;
}): Set<string> {
  const { layout, scroll, windowWidth, pitch, gap, near, limit, unloadable, was } = i;
  const loaded = new Set<string>();
  const nearBy: { id: string; away: number }[] = [];
  let shown = 0;
  layout.ids.forEach((id, k) => {
    const left = layout.lefts[k]!;
    const right = left + layout.widths[k]!;
    if (!unloadable(id)) {
      loaded.add(id);
      return;
    }
    if (Math.min(right, scroll + windowWidth) - Math.max(left, scroll) > 0.5) {
      loaded.add(id);
      shown += 1;
      return;
    }
    const outside = Math.max(scroll - right, left - (scroll + windowWidth), 0);
    const away = Math.max(0, outside - gap) / pitch;
    if (away < near || (was?.has(id) === true && away < near + 1)) nearBy.push({ id, away });
  });
  const room = limit === null ? Number.POSITIVE_INFINITY : Math.max(0, limit - shown);
  nearBy.sort((a, b) => a.away - b.away);
  for (const { id } of nearBy.slice(0, room)) loaded.add(id);
  return loaded;
}

/** What an Embla row lays out, for the dot bar: its panels along the strip, the window's width and the strip's, in px. @internal */
export interface EmblaStrip {
  layout: StripLayout;
  windowWidth: number;
  stripWidth: number;
  pitch: number;
  gap: number;
}

const strips = new WeakMap<Element, EmblaStrip>();
const rowListeners = new Set<() => void>();
let rowVersion = 0;
/** Tells every reader of an Embla row (its dot bar, its loader) that the row moved or changed. @internal */
export function notifyEmblaRows(): void {
  rowVersion += 1;
  for (const l of [...rowListeners]) l();
}
/** Subscribes to every Embla row's moves and changes, for `useSyncExternalStore`. @internal */
export function subscribeEmblaRows(listener: () => void): () => void {
  rowListeners.add(listener);
  return () => {
    rowListeners.delete(listener);
  };
}
/** A number that changes whenever an Embla row moved or changed. @internal */
export const emblaRowsVersion = (): number => rowVersion;

const sameStrip = (a: EmblaStrip | undefined, b: EmblaStrip): boolean =>
  a !== undefined && a.windowWidth === b.windowWidth && a.stripWidth === b.stripWidth && a.pitch === b.pitch && a.gap === b.gap && a.layout.ids.join(' ') === b.layout.ids.join(' ') && a.layout.lefts.join() === b.layout.lefts.join() && a.layout.widths.join() === b.layout.widths.join();
/** Records what the Embla row rooted on `win` lays out now. @internal */
export function publishEmblaStrip(win: Element, strip: EmblaStrip): void {
  if (sameStrip(strips.get(win), strip)) return;
  strips.set(win, strip);
  notifyEmblaRows();
}
/** What the Embla row whose window or container is `el` lays out, once it has drawn. @internal */
export function emblaStripOf(el: Element): EmblaStrip | undefined {
  const win = el.closest(`[${EMBLA_WINDOW_ATTRIBUTE}]`) ?? el.querySelector(`[${EMBLA_WINDOW_ATTRIBUTE}]`);
  return win === null ? undefined : strips.get(win);
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

/** Where the row is drawn this frame, in scroll px: Embla draws a translate between its last two fixed-step locations. @internal */
export function emblaDrawnOf(embla: EmblaCarouselType): number {
  return -embla.internalEngine().offsetLocation.get();
}

/** The index of the stop nearest `px` (scroll px). @internal */
export function nearestStop(embla: EmblaCarouselType, px: number): number {
  const snaps = embla.internalEngine().scrollSnaps.map((x) => -x);
  let best = 0;
  for (let k = 1; k < snaps.length; k += 1) if (Math.abs(snaps[k]! - px) < Math.abs(snaps[best]! - px)) best = k;
  return best;
}

/**
 * Puts the row at `px` and draws it there in this frame, with no glide and no stop: the oval drag's direct write. Any glide in flight
 * ends (an instant body has no velocity left). Uses Embla's internal engine, which 8.6 is pinned for.
 * @internal
 */
export function writeEmbla(embla: EmblaCarouselType, px: number): void {
  const e = embla.internalEngine();
  const to = -px;
  // Embla's body setters are plain closures named use*, not React hooks.
  const setDuration = e.scrollBody.useDuration;
  setDuration(0);
  e.target.set(to);
  e.location.set(to);
  e.previousLocation.set(to);
  e.offsetLocation.set(to);
  e.translate.to(to);
  notifyEmblaRows();
}

/** The proof's negative control: `true` makes the oval drag ease the row toward the pointer as Embla's own drag does. @internal */
export const emblaOvalDrag = { eased: false };

/** Moves the row toward `px` the way Embla's own drag does: the target moves, and the body eases the strip after it. @internal */
export function easeEmbla(embla: EmblaCarouselType, px: number): void {
  const e = embla.internalEngine();
  const baseDuration = e.scrollBody.useBaseDuration;
  const baseFriction = e.scrollBody.useBaseFriction;
  baseDuration();
  baseFriction();
  e.target.set(-px);
  e.animation.start();
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
    markEmblaBuilt(embla);
    embla.on('scroll', notifyEmblaRows).on('settle', notifyEmblaRows).on('reInit', notifyEmblaRows).on('pointerUp', releaseEmbla);
    notifyEmblaRows();
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
      embla.scrollTo(nearestStop(embla, to));
    };
    win.addEventListener('focusin', onFocus);
    return () => {
      win.removeEventListener('focusin', onFocus);
      if (quiet !== null) clearTimeout(quiet);
      view.removeEventListener('keydown', onKey);
      win.removeEventListener('wheel', onWheel);
      instances.delete(win);
      embla.destroy();
      notifyEmblaRows();
    };
  }, [enabled, windowRef, boxRef]);
}
