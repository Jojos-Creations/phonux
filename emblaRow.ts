/**
 * The row on Embla Carousel, the library's only row: Embla owns where the strip is, and turns drag, wheel and
 * glide into motion that settles on a stop. Ours is the window, sized to whole slots, and one invisible marker per slot, which
 * Embla takes as its slides, so each slot edge is a stop, a wide panel's inner ones included.
 *
 * Internal and out of the barrel until the old row is retired. Embla is pinned to 8.6: its `internalEngine()` interface, which
 * the later oval drag needs, is not covered by semver.
 */

import * as React from 'react';
import EmblaCarousel, { type EmblaCarouselType, type EmblaOptionsType } from 'embla-carousel';
import type { AwayStore } from './panelAway.js';
import { WheelGestures } from 'wheel-gestures';
import { arrowKeyBelongsElsewhere } from './arrowKeys.js';
import { registerRowKeys } from './rowStep.js';
import { EMBLA_WINDOW_ATTRIBUTE, PANEL_ROOT_ATTRIBUTE, ROW_SLOT_ATTRIBUTE } from './rowDom.js';

/** On the container of a row that runs on Embla. The old row's own wheel, touch and key listeners stand aside for it. @internal */
export const ROW_ENGINE_ATTRIBUTE = 'data-row-engine';
/** On each slot marker: an empty box one phone wide, at its slot's place in the strip. @internal */
export const EMBLA_SLOT_ATTRIBUTE = 'data-row-embla-slot';
// Declared in rowDom so the row's key and band code can read it without importing Embla.
export { EMBLA_WINDOW_ATTRIBUTE };


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
 * wheel gesture in progress (it rebuilds the drag handler, and goes back to the selected stop), so while one holds the row the
 * shift is applied in place and the rebuild waits for its release (`releaseEmbla`). Shifting or keeping a position that is not a stop uses
 * Embla's internal engine, which 8.6 is pinned for; a jump at rest to a stop uses the public `scrollTo`.
 * @internal
 */
export function moveEmbla(embla: EmblaCarouselType, shift: number, restop: boolean): void {
  const e = embla.internalEngine();
  if (e.dragHandler.pointerDown() || wheelRuns.has(embla)) {
    if (Math.abs(shift) > 0.01) shiftEmbla(embla, shift);
    if (restop) rebuildWaiting.add(embla);
    return;
  }
  const drawn = emblaDrawnOf(embla) + shift;
  const target = -e.target.get() + shift;
  const gliding = (Math.abs(e.target.get() - e.location.get()) > 0.5 || Math.abs(e.location.get() - e.offsetLocation.get()) > 0.5);
  // A glide in flight with the same stops keeps its pace: the shift moves its positions in place (its target too), so the view keeps
  // still under the change and the glide runs on with no restart (a restart from rest was a jump in speed, measured 301 px a frame).
  if (gliding && !restop) {
    if (Math.abs(shift) > 0.01) shiftEmbla(embla, shift);
    return;
  }
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
  embla.scrollTo(stop, reducedRows.has(embla));
}

const reducedRows = new WeakSet<EmblaCarouselType>();
/** Whether the row `embla` moves runs under Reduce Motion: every glide it starts lands at once instead. @internal */
export function setEmblaReduced(embla: EmblaCarouselType, on: boolean): void {
  if (on) reducedRows.add(embla);
  else reducedRows.delete(embla);
}
/** Whether the row `embla` moves runs under Reduce Motion. @internal */
export const emblaReduced = (embla: EmblaCarouselType): boolean => reducedRows.has(embla);

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
 * Whether a press may start a drag of the row. A mouse press only on the row's own surface, outside every panel, so a panel's text, controls and header grab keep the mouse.
 * A touch anywhere but on a control, an editable field or a frame, as the old row's finger swipe.
 * @internal
 */
export function pressStartsRowDrag(event: Pick<Event, 'target' | 'type'>): boolean {
  const target = event.target as Element | null;
  if (target === null || typeof target.closest !== 'function') return false;
  if (event.type === 'mousedown') return target.closest(`[${ROW_SLOT_ATTRIBUTE}]`) === null;
  return target.closest('button,a[href],input,select,textarea,[contenteditable=""],[contenteditable="true"],[role="slider"],iframe,frame,embed,object') === null;
}

/**
 * Whether a panel of the row rooted on `win` is lifted to fill the window (growing, grown or shrinking back): it covers the row, so
 * wheels, keys, drags and focus leave the row where it is and the panel shrinks back into the slot it grew from. @internal
 */
export function maximizedIn(win: Element): boolean {
  return win.querySelector(`[${PANEL_ROOT_ATTRIBUTE}][popover]`) !== null;
}

/** The options the row runs Embla with: one stop per slot marker, a flick may pass several. @internal */
export function emblaRowOptions(): EmblaOptionsType {
  return {
    align: 'start',
    containScroll: 'trimSnaps',
    slides: `:scope > [${EMBLA_SLOT_ATTRIBUTE}]`,
    skipSnaps: true,
    dragThreshold: 4,
    watchDrag: (api, event) => !maximizedIn(api.rootNode()) && pressStartsRowDrag(event),
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
 * panel the window shows, will show within `ahead` px of travel, or shows at `toward` (where a glide or a jump is going), whatever
 * `limit` says; and, nearest first, the unloadable ones whose edge lies under `near` slots past the window's edge, at
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
  /** How far the row will move in the next frames, scroll px (negative: toward the start): what that brings into view counts as shown. */
  ahead?: number;
  /** Where the row is going, scroll px: what the window shows there counts as shown, so a far glide or a jump lands on loaded pages. */
  toward?: number | null;
}): Set<string> {
  const { layout, scroll, windowWidth, pitch, gap, near, limit, unloadable, was } = i;
  const ahead = i.ahead ?? 0;
  const lo = scroll + Math.min(0, ahead);
  const hi = scroll + windowWidth + Math.max(0, ahead);
  const toward = i.toward ?? null;
  const overlaps = (left: number, right: number, a: number, b: number): boolean => Math.min(right, b) - Math.max(left, a) > 0.5;
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
    if (overlaps(left, right, lo, hi) || (toward !== null && overlaps(left, right, toward, toward + windowWidth))) {
      loaded.add(id);
      shown += 1;
      return;
    }
    const outside = Math.max(lo - right, left - hi, 0);
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

/** Frames a row's slots stand still before the inert marks stop being read every frame (a slot glide starts within a frame or two). */
const AWAY_IDLE_FRAMES = 20;
/** How long after a commit or a move the marks are read every frame however still the slots stand: a slot glide can start late. */
const AWAY_HOLD_MS = 1500;

/** Fixed 60 Hz steps an Embla row looks ahead to load what comes into view: a page mounts a render or two after it is asked for. */
const AHEAD_STEPS = 8;
/**
 * How far the row will move in the next few frames, in scroll px (negative toward the start), at its speed now and never past where
 * it is going: the panels that brings into view load before they enter it. @internal
 */
export function emblaAheadOf(embla: EmblaCarouselType): number {
  const e = embla.internalEngine();
  const togo = -e.target.get() - emblaDrawnOf(embla);
  const speed = Math.abs(e.location.get() - e.previousLocation.get());
  return Math.sign(togo) * Math.min(Math.abs(togo), speed * AHEAD_STEPS);
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


/**
 * Marks each slot of the row rooted on `win` that is drawn wholly outside the window `inert`, and clears it as soon as any part is
 * drawn inside: a page the window does not show takes no focus, key, pointer or find-in-page, and a host's styles can key on it (a
 * focus halo resting one gap past the edge). The row's away store (`usePanelPresence`'s 'scrolledAway') follows the same marks. Read off each slot's drawn box, so a glide, a wheel, a drag, a slot's own glide and a
 * reorder shift all count where they are drawn this frame, never where Embla's location runs ahead. Answers a weighted sum of the drawn
 * lefts, so a caller can tell a frame that moved from one that did not.
 * @internal
 */
export function markAwaySlots(win: Element): number {
  const view = win.getBoundingClientRect();
  const store = awayStores.get(win);
  const seen = new Set<string>();
  let sum = 0;
  let k = 0;
  for (const slot of win.querySelectorAll<HTMLElement>(`[${ROW_SLOT_ATTRIBUTE}]`)) {
    const r = slot.getBoundingClientRect();
    k += 1;
    sum += k * r.left + r.width;
    const away = r.width > 0.5 && (r.right <= view.left + 0.5 || r.left >= view.right - 0.5);
    if (slot.hasAttribute('inert') !== away) slot.toggleAttribute('inert', away);
    const id = slot.dataset.rowId;
    if (id !== undefined) {
      seen.add(id);
      store?.set(id, away);
    }
  }
  store?.retain(seen);
  return sum;
}
const awayStores = new WeakMap<Element, AwayStore>();

const awayKicks = new WeakMap<Element, () => void>();
/** Keeps the inert marks of the row rooted on `win` current over the next frames: a commit that starts slot glides calls it. @internal */
export function kickEmblaAway(win: Element): void {
  awayKicks.get(win)?.();
}

const freeWaiting = new WeakMap<EmblaCarouselType, (() => void)[]>();
/** Whether a press, a wheel gesture or a reorder drag's edge scroll holds the row `embla` moves. @internal */
export function emblaHeld(embla: EmblaCarouselType): boolean {
  return embla.internalEngine().dragHandler.pointerDown() || heldRows.has(embla) || wheelRuns.has(embla);
}
/** Runs `run` now, or, while a gesture holds the row, once it lets go (in the order asked). @internal */
export function whenEmblaFree(embla: EmblaCarouselType, run: () => void): void {
  if (!emblaHeld(embla)) {
    run();
    return;
  }
  freeWaiting.set(embla, [...(freeWaiting.get(embla) ?? []), run]);
}
function runFreeWaiting(embla: EmblaCarouselType): void {
  const waiting = freeWaiting.get(embla);
  if (waiting === undefined || emblaHeld(embla)) return;
  freeWaiting.delete(embla);
  for (const run of waiting) run();
}

/** Where the row goes to show a panel at `left` `width` wide (strip px) at `align`, from `from`, clamped to `[0, max]`. @internal */
export function emblaShowScroll(left: number, width: number, from: number, windowWidth: number, align: 'into-view' | 'start' | 'center', max: number): number {
  const raw = align === 'start' ? left : align === 'center' ? left + width / 2 - windowWidth / 2 : (revealScroll(left, width, from, windowWidth) ?? from);
  return Math.min(Math.max(0, raw), max);
}

/**
 * Brings panel `id` of the row `embla` moves into view at `align`, from where the row is heading: a glide to the nearest stop (a jump
 * under Reduce Motion), and none when it is there already. While a gesture holds the row it waits for the release, and then reads the
 * strip as drawn at that time. False when the strip has no such panel now.
 * @internal
 */
export function showOnEmbla(embla: EmblaCarouselType, id: string, align: 'into-view' | 'start' | 'center'): boolean {
  if (strips.get(embla.rootNode())?.layout.ids.includes(id) !== true) return false;
  whenEmblaFree(embla, () => {
    const strip = strips.get(embla.rootNode());
    const k = strip === undefined ? -1 : strip.layout.ids.indexOf(id);
    if (strip === undefined || k < 0) return;
    const from = emblaTargetOf(embla);
    const stop = nearestStop(embla, emblaShowScroll(strip.layout.lefts[k]!, strip.layout.widths[k]!, from, strip.windowWidth, align, emblaMaxOf(embla)));
    if (Math.abs(stopPx(embla, stop) - from) <= 0.5) return;
    embla.scrollTo(stop, reducedRows.has(embla));
  });
  return true;
}

/**
 * Whether `showOnEmbla(embla, id, align)` moves the row now: the stop it would go to differs from where the row is heading. Null when
 * the drawn strip does not carry `id`. @internal
 */
export function emblaWouldShow(embla: EmblaCarouselType, id: string, align: 'into-view' | 'start' | 'center'): boolean | null {
  const strip = strips.get(embla.rootNode());
  const k = strip === undefined ? -1 : strip.layout.ids.indexOf(id);
  if (strip === undefined || k < 0) return null;
  const from = emblaTargetOf(embla);
  const stop = nearestStop(embla, emblaShowScroll(strip.layout.lefts[k]!, strip.layout.widths[k]!, from, strip.windowWidth, align, emblaMaxOf(embla)));
  return Math.abs(stopPx(embla, stop) - from) > 0.5;
}

const heldRows = new WeakSet<EmblaCarouselType>();

/**
 * How long a wheel gesture holds the row after its last wheel before it settles: Chromium's own wheel transaction (a wheel this soon
 * after the last one is the same scroll), so a finger lifted to reposition on a wheel or a trackpad keeps the row where it is drawn.
 */
const WHEEL_IDLE_MS = 500;
/** Wheel travel against a gesture's direction that turns it: a momentum tail's last events can flicker a px the other way. */
const WHEEL_AGAINST_PX = 8;
/**
 * Embla's body while a wheel drives the row: critically damped (friction f, duration just above f / (1 + f - 2 sqrt f)), so the row
 * trails the wheel closely and never runs past it. Embla's drag body (friction 0.3, duration 0.75) is an underdamped spring that ran
 * past each notch and came back 1-2 px.
 */
const WHEEL_FRICTION = 0.1;
const WHEEL_DURATION = 0.22;
/** Row px per wheel px: the owner found the row at 1:1 a bit fast (2026-11-09). */
const WHEEL_SPEED = 0.65;
/**
 * A wheel gesture driving the row: its direction of travel (scroll px sign), travel against it, its idle wait, and the wheel's target
 * kept across a release Embla runs with no press of its own.
 */
interface WheelRun {
  dir: number;
  against: number;
  idle: ReturnType<typeof setTimeout> | null;
  keep: number | null;
}
/**
 * The wheel gesture on each row. A wheel moves Embla's target directly, with no press: Embla's drag listens on the document only
 * from a press, so no input but the wheel reaches the row during a gesture (a press of Embla's held open through the gesture let a
 * person's pointer move or release in, read against the wheel's synthetic pointer: the row jumped back to where the gesture began).
 */
const wheelRuns = new WeakMap<EmblaCarouselType, WheelRun>();
function endWheelRun(embla: EmblaCarouselType): WheelRun | undefined {
  const run = wheelRuns.get(embla);
  if (run?.idle != null) clearTimeout(run.idle);
  wheelRuns.delete(embla);
  return run;
}
function setWheelBody(embla: EmblaCarouselType): void {
  // Embla's body setters are plain closures named use*, not React hooks.
  const body = embla.internalEngine().scrollBody;
  const setFriction = body.useFriction;
  const setDuration = body.useDuration;
  setFriction(WHEEL_FRICTION);
  setDuration(WHEEL_DURATION);
}
/**
 * One wheel of a gesture on the row `embla` moves: `by` scroll px (sideways, already normalized). The first one starts the gesture
 * where the row is drawn (a glide in flight stops there, as a press stopped it). The target stops flat at the row's ends (owner
 * ruling 2026-11-09, "just stop"): no stretch past them and no spring back. Every wheel restarts the idle wait.
 */
function wheelBy(embla: EmblaCarouselType, by: number): void {
  const e = embla.internalEngine();
  let run = wheelRuns.get(embla);
  if (run === undefined) {
    writeEmbla(embla, emblaDrawnOf(embla));
    // An instant step with the target on the location zeroes the glide's speed, so the wheel body starts from rest.
    e.scrollBody.seek();
    run = { dir: 0, against: 0, idle: null, keep: null };
    wheelRuns.set(embla, run);
  }
  if (run.idle !== null) clearTimeout(run.idle);
  run.idle = setTimeout(() => settleWheelRun(embla), WHEEL_IDLE_MS);
  setWheelBody(embla);
  const from = emblaTargetOf(embla);
  const m = Math.min(Math.max(0, from + by), emblaMaxOf(embla)) - from;
  if (Math.abs(m) < 0.01) return;
  e.target.set(-(from + m));
  e.animation.start();
  if (run.dir === 0 || Math.sign(m) === run.dir) {
    run.dir = Math.sign(m);
    run.against = 0;
    return;
  }
  run.against += Math.abs(m);
  if (run.against >= WHEEL_AGAINST_PX) {
    run.dir = Math.sign(m);
    run.against = 0;
  }
}
/**
 * Ends the wheel gesture on the row and leaves the row where it is drawn: a key step, a press, a dot, a focus reveal, a summon or a
 * reorder drag takes the row from there. True when there was one to end.
 * @internal
 */
export function endEmblaWheel(embla: EmblaCarouselType): boolean {
  if (endWheelRun(embla) === undefined) return false;
  const at = emblaDrawnOf(embla);
  releaseEmbla(embla);
  writeEmbla(embla, at);
  runFreeWaiting(embla);
  return true;
}

/**
 * The stop a wheel gesture moving `dir` rests on from `from` (scroll px): the first one not behind it, so the row never moves back
 * against the scroll; the nearest for no direction.
 * @internal
 */
export function stopAhead(stops: readonly number[], from: number, dir: number): number {
  if (stops.length === 0) return 0;
  let best = 0;
  for (let k = 1; k < stops.length; k += 1) if (Math.abs(stops[k]! - from) < Math.abs(stops[best]! - from)) best = k;
  if (dir === 0 || Math.abs(stops[best]! - from) <= 0.5) return best;
  const order = stops.map((_, k) => k).sort((a, b) => stops[a]! - stops[b]!);
  const ahead = dir > 0 ? order.find((k) => stops[k]! >= from - 0.5) : [...order].reverse().find((k) => stops[k]! <= from + 0.5);
  return ahead ?? (dir > 0 ? order[order.length - 1]! : order[0]!);
}
/** Ends a wheel gesture that has been idle `WHEEL_IDLE_MS`: settles on the stop ahead of the travel, then runs what waited for it. */
function settleWheelRun(embla: EmblaCarouselType): void {
  const run = endWheelRun(embla);
  if (run === undefined) return;
  const target = emblaTargetOf(embla);
  const drawn = emblaDrawnOf(embla);
  const from = run.dir > 0 ? Math.max(target, drawn) : run.dir < 0 ? Math.min(target, drawn) : target;
  const stops = embla.internalEngine().scrollSnaps.map((x) => -x);
  embla.scrollTo(stopAhead(stops, Math.min(Math.max(0, from), emblaMaxOf(embla)), run.dir), reducedRows.has(embla));
  releaseEmbla(embla);
  runFreeWaiting(embla);
}
/**
 * The one writer a reorder drag's edge scroll holds on an Embla row: `write` puts the row at a scroll px clamped to `[0, the bound]`
 * and draws it there in this frame (`writeEmbla`). Null while another drag holds the row. @internal
 */
export function holdEmbla(embla: EmblaCarouselType): { write(left: number): number; setMaxScroll(max: number): void; release(): void } | null {
  if (heldRows.has(embla)) return null;
  heldRows.add(embla);
  endEmblaWheel(embla);
  let max = 0;
  return {
    write(left) {
      if (!heldRows.has(embla)) return 0;
      const at = emblaDrawnOf(embla);
      const to = Math.min(Math.max(0, left), max);
      if (Math.abs(to - at) < 0.001) return 0;
      writeEmbla(embla, to);
      return to - at;
    },
    setMaxScroll(m) {
      max = Math.max(0, m);
    },
    release() {
      heldRows.delete(embla);
      runFreeWaiting(embla);
    },
  };
}

/**
 * Runs Embla on `windowRef` (the root) with `boxRef` (its container, the box the slots and markers sit in). Wheel and trackpad
 * move Embla's target directly (`wheelBy`), read through wheel-gestures; a wheel handed in from embedded content (`feedRowWheel`)
 * bubbles to the same listener and moves the row as a wheel over the row does; Option held at a gesture's first event leaves the whole gesture to the content. Bare arrow keys step
 * one slot. `enabled` false tears it down.
 * @internal
 */
export function useEmblaRow(windowRef: React.RefObject<HTMLElement | null>, boxRef: React.RefObject<HTMLElement | null>, enabled: boolean, quietMs: number, awayStore?: AwayStore): void {
  const quietRef = React.useRef(quietMs);
  quietRef.current = quietMs;
  React.useLayoutEffect(() => {
    const win = windowRef.current;
    if (!enabled || win === null || awayStore === undefined) return undefined;
    awayStores.set(win, awayStore);
    markAwaySlots(win);
    return () => {
      awayStores.delete(win);
    };
  }, [enabled, windowRef, awayStore]);
  React.useLayoutEffect(() => {
    const win = windowRef.current;
    const box = boxRef.current;
    if (!enabled || win === null || box === null) return undefined;
    let owner: 'row' | 'content' | null = null;
    let quiet: ReturnType<typeof setTimeout> | null = null;
    // wheel-gestures (the normalizer under Embla's wheel plugin) reads each wheel: pixels from lines and pages, a cap on one event's
    // size, a trackpad's momentum, and it cancels a sideways wheel (`preventWheelAction: 'x'`), so `feedRowWheel` reads it as taken.
    const wheels = WheelGestures({ preventWheelAction: 'x', reverseSign: false });
    const onWheel = (e: WheelEvent): void => {
      if (quiet !== null) clearTimeout(quiet);
      quiet = setTimeout(() => {
        owner = null;
      }, quietRef.current);
      if (owner === null) owner = e.altKey ? 'content' : 'row';
      if (owner === 'content' || win.closest('[inert]') !== null || maximizedIn(win)) return;
      // A reorder drag's edge scroll is the one writer while it holds the row, and the own row refused every step under a drag's claim:
      // the wheel is ignored, and a sideways one is still kept from the content.
      if (heldRows.has(embla)) {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault();
        return;
      }
      wheels.feedWheel(e);
    };
    // A gesture starts on a sideways wheel that is not a momentum tail (as the plugin started one), and not under a person's drag of
    // the row; from then on every wheel moves the row by its sideways delta until the wheel has been idle WHEEL_IDLE_MS.
    const offWheels = wheels.on('wheel', (s) => {
      if (s.isEnding || embla.internalEngine().dragHandler.pointerDown()) return;
      const [dx, dy] = s.axisDelta;
      if (!wheelRuns.has(embla) && (s.isMomentum || Math.abs(dx) <= Math.abs(dy))) return;
      wheelBy(embla, dx * WHEEL_SPEED);
    });
    win.addEventListener('wheel', onWheel, { passive: false });
    const embla = EmblaCarousel(win, { ...emblaRowOptions(), container: box });
    instances.set(win, embla);
    markEmblaBuilt(embla);
    // Embla's root runs its release on a contextmenu or a touchcancel even with no press of its own (the context-menu key, a
    // right-click): during a wheel gesture that release set the target to the stop nearest it, behind the travel as often as not. The
    // wheel's target is kept here, before Embla's listener, and put back on its release, so the gesture goes on.
    const onStrayRelease = (): void => {
      const run = wheelRuns.get(embla);
      if (run !== undefined && !embla.internalEngine().dragHandler.pointerDown()) run.keep = embla.internalEngine().target.get();
    };
    for (const type of ['contextmenu', 'touchcancel']) win.addEventListener(type, onStrayRelease, true);
    embla.on('scroll', notifyEmblaRows).on('select', notifyEmblaRows).on('settle', notifyEmblaRows).on('reInit', notifyEmblaRows).on('pointerUp', (api) => {
      const run = wheelRuns.get(api);
      if (run !== undefined && run.keep !== null) {
        api.internalEngine().target.set(run.keep);
        run.keep = null;
        setWheelBody(api);
        return;
      }
      // Under Reduce Motion a release lands on its stop at once: Embla sets its own settle speed on release, past the scrollTo jump flag.
      // Embla's body setters are plain closures named use*, not React hooks.
      const setDuration = api.internalEngine().scrollBody.useDuration;
      if (reducedRows.has(api)) setDuration(0);
      releaseEmbla(api);
      runFreeWaiting(api);
    });
    // The inert marks follow every drawn frame: Embla's own draws and writes notify, and a frame loop runs while slots still move
    // on their own (a slot glide, a reorder shift) until they have stood still for a while.
    let awayFrame = 0;
    let awayIdle = 0;
    let awayLast = Number.NaN;
    let awayUntil = 0;
    const awayTick = (): void => {
      awayFrame = 0;
      const sum = markAwaySlots(win);
      awayIdle = Math.abs(sum - awayLast) > 0.01 ? 0 : awayIdle + 1;
      awayLast = sum;
      if (awayIdle < AWAY_IDLE_FRAMES || performance.now() < awayUntil) awayFrame = requestAnimationFrame(awayTick);
    };
    const kickAway = (): void => {
      awayIdle = 0;
      awayUntil = performance.now() + AWAY_HOLD_MS;
      if (awayFrame === 0) awayFrame = requestAnimationFrame(awayTick);
    };
    const onRowsChange = (): void => {
      markAwaySlots(win);
      kickAway();
    };
    awayKicks.set(win, onRowsChange);
    const unsubscribeAway = subscribeEmblaRows(onRowsChange);
    notifyEmblaRows();
    const doc = win.ownerDocument;
    const view = doc.defaultView ?? window;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || arrowKeyBelongsElsewhere(e, doc)) return;
      if (win.closest('[inert]') !== null || maximizedIn(win)) return;
      e.preventDefault();
      step(e.key === 'ArrowLeft' ? 'left' : 'right');
    };
    const step = (direction: 'left' | 'right'): void => {
      // A key during a wheel gesture's hold ends it where it is drawn, as a press does, and steps from there.
      endEmblaWheel(embla);
      // From the stop nearest where the row is heading, not Embla's selected index, which a direct write (a keep's
      // jump) leaves stale: scrollNext from a stale index can name the stop the row already rests on.
      const snaps = embla.scrollSnapList().length;
      const at = nearestStop(embla, emblaTargetOf(embla));
      const to = Math.min(Math.max(0, at + (direction === 'left' ? -1 : 1)), snaps - 1);
      if (to !== at) embla.scrollTo(to, reducedRows.has(embla));
    };
    view.addEventListener('keydown', onKey);
    // A host's own chord (`stepRow`) steps this row as a bare arrow does, and not while a panel of it is lifted.
    const unregisterKeys = registerRowKeys(win, { step: (direction) => (win.closest('[inert]') !== null || maximizedIn(win) ? undefined : step(direction)) });
    // A panel focused while partly out of the window comes into it: Embla moves only for slides, and its slides are the markers.
    const onFocus = (e: FocusEvent): void => {
      const slot = (e.target as Element | null)?.closest<HTMLElement>(`[${ROW_SLOT_ATTRIBUTE}]`);
      if (slot == null || !box.contains(slot) || maximizedIn(win)) return;
      const to = revealScroll(Number(slot.dataset.rowSlot) || 0, slot.offsetWidth, emblaScrollOf(embla), box.offsetWidth);
      if (to === null) return;
      endEmblaWheel(embla);
      embla.scrollTo(nearestStop(embla, to), reducedRows.has(embla));
    };
    // A person's press during a wheel gesture stops the row where it is drawn, as a press stops a native scroll's momentum, and hands
    // it to whatever the press starts: Embla's own drag of the row (its release settles it), a reorder drag, or nothing, when the
    // release settles the row on the nearest stop. A right or middle press leaves the gesture going (its contextmenu is kept above).
    const onPress = (e: PointerEvent): void => {
      if (!e.isTrusted || e.button !== 0 || !endEmblaWheel(embla)) return;
      const settle = (): void => {
        view.removeEventListener('pointerup', settle, true);
        view.removeEventListener('pointercancel', settle, true);
        if (!emblaHeld(embla)) embla.scrollTo(nearestStop(embla, emblaDrawnOf(embla)), reducedRows.has(embla));
      };
      view.addEventListener('pointerup', settle, true);
      view.addEventListener('pointercancel', settle, true);
    };
    win.addEventListener('pointerdown', onPress, true);
    win.addEventListener('focusin', onFocus);
    return () => {
      offWheels();
      for (const type of ['contextmenu', 'touchcancel']) win.removeEventListener(type, onStrayRelease, true);
      endWheelRun(embla);
      win.removeEventListener('pointerdown', onPress, true);
      unsubscribeAway();
      cancelAnimationFrame(awayFrame);
      awayKicks.delete(win);
      unregisterKeys();
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

/** Where the row is heading, in scroll px: the stop a glide or a drag is going to, or where it rests. @internal */
export function emblaTargetOf(embla: EmblaCarouselType): number {
  return -embla.internalEngine().target.get();
}

const windowOf = (el: Element): Element | null => el.closest(`[${EMBLA_WINDOW_ATTRIBUTE}]`) ?? el.querySelector(`[${EMBLA_WINDOW_ATTRIBUTE}]`);
/** A move of a panel the row draws next: the commit that draws it snaps the slots it moves instead of gliding them. @internal */
export interface EmblaMoveNote {
  id: string;
  seq: number;
}
const moveNotes = new WeakMap<Element, EmblaMoveNote>();
let moveSeq = 0;
/**
 * Notes that the next commit of the Embla row whose window or container is `el` moves panel `id` from out of the view to just outside
 * it (a summon): that commit snaps the slots it moves (all out of the view), so the panel stands at its new place before the row's
 * glide brings it in. @internal
 */
export function noteEmblaMove(el: Element, id: string): void {
  const win = windowOf(el);
  if (win !== null) moveNotes.set(win, { id, seq: ++moveSeq });
}
/** The last move noted on the Embla row rooted on `win`. @internal */
export const emblaMoveOf = (win: Element): EmblaMoveNote | undefined => moveNotes.get(win);

/** Whether panel `k` of `layout` stands whole in a window `windowWidth` wide at `scroll`. @internal */
export function wholeInView(layout: StripLayout, k: number, scroll: number, windowWidth: number): boolean {
  return layout.lefts[k]! >= scroll - 0.5 && layout.lefts[k]! + layout.widths[k]! <= scroll + windowWidth + 0.5;
}

/**
 * Where a summon moves root `rootId` on a strip laid out as `layout`, with the row heading for `at` in a window `windowWidth` wide
 * (owner ruling 2026-11-09): into the slot just outside the view on the side it lies on, the left when it lies on neither (wider than
 * the view). `beside` is the page it goes next to: the first page reaching into the view on the left, the last one on the right; null
 * when there is none (the root goes to that end). Null when the root stands whole in the view or is not on the strip.
 * @internal
 */
export function emblaSummonMove(layout: StripLayout, at: number, windowWidth: number, rootId: string): { side: 'left' | 'right'; beside: string | null } | null {
  const k = layout.ids.indexOf(rootId);
  if (k < 0 || wholeInView(layout, k, at, windowWidth)) return null;
  const side = layout.lefts[k]! >= at + windowWidth - 0.5 || (layout.lefts[k]! > at + 0.5 && layout.lefts[k]! + layout.widths[k]! > at + windowWidth + 0.5) ? 'right' : 'left';
  const others = layout.ids.map((id, j) => ({ id, left: layout.lefts[j]!, right: layout.lefts[j]! + layout.widths[j]! })).filter((p) => p.id !== rootId);
  const beside = side === 'left' ? others.find((p) => p.right > at + 0.5) : [...others].reverse().find((p) => p.left < at + windowWidth - 0.5);
  return { side, beside: beside?.id ?? null };
}
