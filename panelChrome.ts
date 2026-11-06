/**
 * Which panel is the active one and which is being dragged: ephemeral facts about the person's attention, held by the
 * Workspace so two workspaces share nothing, kept out of the manager's snapshot and out of storage.
 */
import * as React from 'react';
import { animate, useReducedMotion, useReducedMotionConfig } from 'motion/react';
import { LIBRARY_TUNING_DEFAULTS, type PanelId } from './panelSettings.js';
import type { ReorderHandle } from './dragToClose.js';
import { warnCounterId } from './panelIds.js';
import { PanelSlotContext } from './panelSlotContext.js';
import { reorderStepsForOffset } from './panelWindow.js';
import { screenBoxOf, type ScreenBox } from './slotMover.js';

/**
 * The attribute the library writes, empty-valued, on the root box of the active panel and removes when another panel
 * is used. A host styles from it, as `[data-panel-active]`.
 * @public
 */
export const ACTIVE_ATTRIBUTE = 'data-panel-active';

/**
 * The attribute the library writes, empty-valued, on a panel's root box from the moment a drag of it engages until it
 * settles. A host styles from it, as `[data-panel-dragging]`.
 * @public
 */
export const DRAGGING_ATTRIBUTE = 'data-panel-dragging';

/**
 * The attribute that marks the header, grab bar and footer of a panel: the elements `tuning.chrome` fades. Its value is
 * one of {@link CHROME_PARTS}. Other `data-panel-*` markers the library draws (`data-panel-grab-bar`,
 * `data-panel-footer`, `data-panel-size-box`) are not a public contract.
 * @public
 */
export const CHROME_ATTRIBUTE = 'data-panel-chrome-part';

/**
 * Set on a panel's root while its header and footer are showing, so a host can draw around them.
 * @public
 */
export const CHROME_SHOWN_ATTRIBUTE = 'data-panel-chrome-shown';

/**
 * The values {@link CHROME_ATTRIBUTE} takes, one per part: `header`, `grabBar` (`'grab-bar'`), `footer` and `resize`. A panel
 * carries at most one element of each, except `resize`, which marks the grip on each side.
 * @public
 */
export const CHROME_PARTS = { header: 'header', grabBar: 'grab-bar', footer: 'footer' } as const;

/**
 * A value of {@link CHROME_ATTRIBUTE}: `'header'`, `'grab-bar'`, `'footer'` or `'resize'`.
 * @public
 */
export type ChromePart = (typeof CHROME_PARTS)[keyof typeof CHROME_PARTS];

/** Which edge of a panel a drawn width keeps where it is: the left one, or the right one. */
export type DrawnPin = 'start' | 'end';

/** The width a host holds a hand-resized panel at, in px, and the edge that stays still. */
export interface DrawnWidth {
  readonly id: PanelId;
  readonly px: number;
  readonly pin: DrawnPin;
}

/** One workspace's active and dragging panel, with listeners per panel so a change wakes only the panels it concerns. */
export interface ChromeStore {
  active(): PanelId | null;
  dragging(): PanelId | null;
  setActive(id: PanelId | null): void;
  setDragging(id: PanelId, on: boolean): void;
  /** The panel a host is resizing by hand right now. */
  resizing(): PanelId | null;
  setResizing(id: PanelId, on: boolean): void;
  /** Wakes `listener` when the resized panel changes. */
  subscribeResizing(listener: () => void): () => void;
  /** The width a host holds the resized panel at, with the edge it keeps still; null when none is set. The same object until it changes. */
  drawn(): DrawnWidth | null;
  /** Sets or clears the drawn width of `id`; ignored unless `id` is the panel being resized by hand. */
  setDrawn(id: PanelId, px: number | null, pin: DrawnPin): void;
  /** Wakes `listener` when the drawn width is set, changes or clears. */
  subscribeDrawn(listener: () => void): () => void;
  /** Wakes `listener` when `id` gains or loses the active or dragging mark. */
  subscribePanel(id: PanelId, listener: () => void): () => void;
  /** Wakes `listener` when the active panel changes. */
  subscribeActive(listener: () => void): () => void;
  /** Whether `id` is in a slide: from its own motion starting until that motion ends. */
  sliding(id: PanelId): boolean;
  /** Marks `id` as sliding or not; a change wakes `subscribePanel(id)` listeners. */
  setSliding(id: PanelId, on: boolean): void;
  /** The row tells the store each panel's key, which is its public id; the store holds engine ids. */
  setKeys(keys: ReadonlyMap<PanelId, string>): void;
  /** The key a panel is public under, or `engine` itself when the row has not named it. */
  keyOf(engine: PanelId): string;
  /** The engine id of the panel public under `key`, or `key` itself when none is. */
  engineOf(key: string): PanelId;
}

const PANEL_PRESSES = new WeakSet<Event>();

/** Marks `event` as a press inside a panel; a portal a panel opens counts, since React carries its events through the panel. */
export function markPanelPress(event: Event): void {
  PANEL_PRESSES.add(event);
}

/** Whether `event` was marked by `markPanelPress`. */
export function isPanelPress(event: Event): boolean {
  return PANEL_PRESSES.has(event);
}

export function createChromeStore(): ChromeStore {
  let active: PanelId | null = null;
  let dragging: PanelId | null = null;
  let resizing: PanelId | null = null;
  let drawn: DrawnWidth | null = null;
  const resizingListeners = new Set<() => void>();
  const drawnListeners = new Set<() => void>();
  const setDrawnNow = (next: DrawnWidth | null): void => {
    if (next === drawn || (next !== null && drawn !== null && next.id === drawn.id && next.px === drawn.px && next.pin === drawn.pin)) return;
    drawn = next;
    for (const l of [...drawnListeners]) l();
  };
  const activeListeners = new Set<() => void>();
  const slidingIds = new Set<PanelId>();
  let keys: ReadonlyMap<PanelId, string> = new Map();
  let engines: ReadonlyMap<string, PanelId> = new Map();
  const byPanel = new Map<PanelId, Set<() => void>>();
  const wake = (ids: readonly (PanelId | null)[], activeChanged: boolean): void => {
    for (const id of new Set(ids)) if (id !== null) for (const l of [...(byPanel.get(id) ?? [])]) l();
    if (activeChanged) for (const l of [...activeListeners]) l();
  };
  return {
    active: () => active,
    dragging: () => dragging,
    setActive(id) {
      if (id === active) return;
      const before = active;
      active = id;
      wake([before, id], true);
    },
    setDragging(id, on) {
      if (on ? dragging === id : dragging !== id) return;
      const before = dragging;
      dragging = on ? id : null;
      wake([before, dragging], false);
    },
    resizing: () => resizing,
    setResizing(id, on) {
      if (on ? resizing === id : resizing !== id) return;
      const before = resizing;
      resizing = on ? id : null;
      // The mark ending takes a width still held with it, so the row is never left drawing a width nobody is dragging.
      if (!on) setDrawnNow(null);
      wake([before, resizing], false);
      for (const l of [...resizingListeners]) l();
    },
    drawn: () => drawn,
    setDrawn(id, px, pin) {
      if (resizing !== id) return;
      setDrawnNow(px === null ? null : { id, px, pin });
    },
    subscribeDrawn(listener) {
      drawnListeners.add(listener);
      return () => void drawnListeners.delete(listener);
    },
    subscribeResizing(listener) {
      resizingListeners.add(listener);
      return () => void resizingListeners.delete(listener);
    },
    subscribePanel(id, listener) {
      const set = byPanel.get(id) ?? new Set<() => void>();
      byPanel.set(id, set);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0 && byPanel.get(id) === set) byPanel.delete(id);
      };
    },
    subscribeActive(listener) {
      activeListeners.add(listener);
      return () => void activeListeners.delete(listener);
    },
    sliding: (id) => slidingIds.has(id),
    setSliding(id, on) {
      if (on === slidingIds.has(id)) return;
      if (on) slidingIds.add(id);
      else slidingIds.delete(id);
      wake([id], false);
    },
    setKeys(next) {
      keys = next;
      engines = new Map([...next].map(([engine, key]) => [key, engine]));
    },
    keyOf: (engine) => keys.get(engine) ?? engine,
    engineOf: (key) => {
      const engine = engines.get(key);
      if (engine !== undefined) return engine;
      const counterKey = keys.get(key);
      if (counterKey !== undefined) warnCounterId(key, counterKey);
      return key;
    },
  };
}

/** The store the Workspace above provides; PanelRow makes its own when it has no Workspace. */
export const ChromeStoreContext = React.createContext<ChromeStore | undefined>(undefined);

const NOOP_SET = (): void => {};
const NO_SUBSCRIBE = (): (() => void) => () => {};

/**
 * The id (key) of the active panel and a setter that takes one: the panel the person last pressed or focused inside, until another
 * panel is used or a press lands outside every panel, or the one the host set. Outside a Workspace it is `[null, no-op]`.
 * @public
 */
export function useActivePanel(): readonly [PanelId | null, (id: PanelId | null) => void] {
  const store = React.useContext(ChromeStoreContext);
  const id = React.useSyncExternalStore(store?.subscribeActive ?? NO_SUBSCRIBE, () => { const active = store?.active() ?? null; return active === null ? null : store!.keyOf(active); }, () => null);
  const set = React.useCallback((key: PanelId | null) => store?.setActive(key === null ? null : store.engineOf(key)), [store]);
  return React.useMemo(() => [id, store === undefined ? NOOP_SET : set] as const, [id, store, set]);
}

function usePanelMark(read: (store: ChromeStore, id: PanelId) => boolean): boolean {
  const store = React.useContext(ChromeStoreContext);
  const id = React.useContext(PanelSlotContext)?.id;
  const subscribe = React.useCallback((l: () => void) => (store === undefined || id === undefined ? () => {} : store.subscribePanel(id, l)), [store, id]);
  return React.useSyncExternalStore(subscribe, () => (store === undefined || id === undefined ? false : read(store, id)), () => false);
}

/**
 * A panel's box on screen, in viewport pixels, as `getBoundingClientRect` reports it.
 * @public
 */
export interface PanelRect {
  /** The left edge, in viewport pixels. */
  readonly x: number;
  /** The top edge, in viewport pixels. */
  readonly y: number;
  /** The box's width in pixels, as drawn (transforms included). */
  readonly width: number;
  /** The box's height in pixels, as drawn (transforms included). */
  readonly height: number;
}

/**
 * One report of a panel's box. `moving` comes each time the box changes while the panel moves; `settled` comes once after
 * the panel stops, with the box it stopped at. `key` is the panel's public key, the one `CaptureTrigger` and `PanelsAPI` use.
 * @public
 */
export interface PanelRectEvent {
  /** The panel's public key, the id `CaptureTrigger` and `PanelsAPI` use for it. */
  readonly key: string;
  /** The box at this report. */
  readonly rect: PanelRect;
  /** `moving` while the box changes; `settled` once, after the last `moving`, when the panel has stopped. */
  readonly phase: 'moving' | 'settled';
}

/** The `detail` of a `PANEL_RECT_EVENT`: the slot's panel id, which the provider maps to its key. @internal */
export interface PanelRectDetail {
  readonly id: string;
  readonly rect: PanelRect;
  readonly phase: 'moving' | 'settled';
}

/** The public report for one slot's detail, under the panel's key. @internal */
export function panelRectEvent(key: string, detail: PanelRectDetail): PanelRectEvent {
  return { key, rect: detail.rect, phase: detail.phase };
}

/**
 * The bubbling event a slot dispatches on its own element with a `PanelRectDetail`. Window-scoped listeners hear every slot,
 * so a provider filters by the ids it knows. @internal
 */
export const PANEL_RECT_EVENT = 'phonux:panel-rect';

/**
 * Reports one slot's box while it moves. `kick()` runs a frame loop that reports `moving` on each change and, once nothing
 * is moving and the box has stood still for a frame, one `settled`. `settle()` ends the loop at once with the box as it is,
 * for the moment a motion completes. @internal
 */
export interface PanelRectReporter {
  kick(): void;
  settle(): void;
  stop(): void;
}

/**
 * Builds the reporter for `el`. `id` is read at each report, so a slot whose panel id changes keeps reporting under it;
 * no report is sent while it is undefined. `moving` says whether anything besides the box's own changes keeps the loop
 * going (a slide, a drag, a resize, a row scroll). `stripX` is the row strip's translate now. While the loop runs, the box is
 * computed from the numbers that move it, measured once as the loop starts and again only when the slot's own width
 * changes; the settled report is a real measurement. @internal
 */
export function createRectReporter(el: HTMLElement, env: { id: () => string | undefined; moving: () => boolean; stripX?: () => number }): PanelRectReporter {
  let frame: number | null = null;
  let last: PanelRect | null = null;
  let model: { box: () => ScreenBox; width: string } | null = null;
  // One settled report is owed after each stop: set by the first measurement and by every change, cleared when it is sent.
  let owed = false;
  const stripX = env.stripX ?? ((): number => 0);
  const send = (phase: PanelRectDetail['phase'], rect: PanelRect): void => {
    const id = env.id();
    if (id === undefined) return;
    // The element's own window's constructor: an event from another realm is refused by its dispatchEvent.
    const Ctor = el.ownerDocument.defaultView?.CustomEvent ?? CustomEvent;
    el.dispatchEvent(new Ctor<PanelRectDetail>(PANEL_RECT_EVENT, { bubbles: true, detail: { id, rect, phase } }));
  };
  // Returns true only for a change since the previous reading; the first reading is a baseline, not a move.
  const read = (rect: PanelRect): boolean => {
    const first = last === null;
    const changed = last !== null && (rect.x !== last.x || rect.y !== last.y || rect.width !== last.width || rect.height !== last.height);
    if (first || changed) owed = true;
    if (changed) send('moving', rect);
    last = rect;
    return changed;
  };
  const measured = (): PanelRect => {
    const box = el.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  };
  const computed = (): PanelRect => {
    if (model === null || model.width !== el.style.width) model = { box: screenBoxOf(el, stripX), width: el.style.width };
    return model.box();
  };
  const settleReport = (): void => {
    if (!owed || last === null) return;
    owed = false;
    send('settled', last);
  };
  // The rest is measured: whatever the numbers do not model (a column sliding, the page moving) is caught there.
  const land = (): void => {
    model = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    read(measured());
    settleReport();
  };
  const tick = (): void => {
    frame = null;
    const changed = read(computed());
    if (!changed && !env.moving()) {
      land();
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  return {
    kick() {
      if (frame === null) frame = requestAnimationFrame(tick);
    },
    settle: land,
    stop() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      model = null;
    },
  };
}

/**
 * True from the moment this panel's slide starts (a move in its row, an entrance or an exit) until the slide ends. False
 * outside a row.
 * @public
 */
export function usePanelSliding(): boolean {
  return usePanelMark((store, id) => store.sliding(id));
}

/**
 * True while this panel is the active one. False for every other panel, and outside a row.
 * @public
 */
export function usePanelActive(): boolean {
  return usePanelMark((store, id) => store.active() === id);
}

/**
 * True from the moment a drag of this panel engages, on either axis, until it settles. A press that never becomes a
 * drag leaves it false. False outside a row.
 * @public
 */
export function usePanelDragging(): boolean {
  return usePanelMark((store, id) => store.dragging() === id);
}

/**
 * A setter for the dragging mark of the panel it is called in, for any drag the host runs itself except a resize grabber
 * (that uses `usePanelResizing()`), so a host never writes `data-panel-dragging` by hand. `setDragging(true)` when the drag
 * begins and `setDragging(false)` when it ends: `usePanelDragging()` and the attribute follow, and the chrome shows as it
 * does for a `DragToClose` drag. A panel has one mark, shared with `DragToClose` and `usePanelResizing()`, and the last
 * write wins. A mark this hook set ends when the calling view unmounts, and the setter keeps one identity for the view's
 * life. Outside a row the setter does nothing.
 * @public
 */
export function usePanelSetDragging(): (on: boolean) => void {
  const store = React.useContext(ChromeStoreContext);
  const id = React.useContext(PanelSlotContext)?.id;
  const held = React.useRef(false);
  React.useEffect(
    () => () => {
      if (held.current && store !== undefined && id !== undefined) store.setDragging(id, false);
      held.current = false;
    },
    [store, id],
  );
  return React.useCallback(
    (on: boolean) => {
      if (store === undefined || id === undefined) return;
      held.current = on;
      store.setDragging(id, on);
    },
    [store, id],
  );
}

/**
 * Whether this panel is being resized by hand, and two setters for a host's resize grabber to call.
 *
 * `setResizing(true)` when a drag begins and `setResizing(false)` when it ends. While it is true no other panel's drawn
 * size changes, so a grabber that reads `panel.size` at the start of its drag, and a neighbor that was drawn smaller to
 * fill the window, stay where they were until the release, and the row does not scroll. It also marks the panel as
 * dragging (`usePanelDragging`) for the same span, so a drag of any kind that a host runs shows the chrome a drag shows.
 *
 * `setDrawnWidth(px)` draws the panel `px` wide at once, with no glide, so it follows a pointer frame by frame: its size
 * box, the panels after it and the row's reach follow, and `panel.size` reads it back. The width is held between
 * one slot and the most slots that fit (and the panel's `maxSlots`); a value that is not a finite number is ignored. It never
 * changes the panel's stored `slots`, the panels the row keeps live or the row's stops. `pin` names the edge that stays
 * where it is: `'start'` (the default) keeps the left edge, so the right edge follows a grabber on the right; `'end'` keeps
 * the right edge, so the left edge follows a grabber on the left, and the panels before it make room. It does nothing unless
 * `setResizing(true)` came first, and calls within one animation frame draw once, with the last value. `setDrawnWidth(null)`
 * lets the panel glide to the width its stored `slots` give (at once under Reduce Motion), so a host ends a drag with
 * `setSlots(nearest)`, then `setDrawnWidth(null)`, then `setResizing(false)`, which settles the row once onto its nearest stop.
 * `setResizing(false)` clears a width still set. The panel closing, parking or unmounting during a drag ends the mark.
 *
 * Outside a row the value is false and the setters do nothing.
 * @public
 */
export function usePanelResizing(): readonly [boolean, (on: boolean) => void, (px: number | null, pin?: 'start' | 'end') => void] {
  const store = React.useContext(ChromeStoreContext);
  const id = React.useContext(PanelSlotContext)?.id;
  const resizing = usePanelMark((s, panel) => s.resizing() === panel);
  const set = React.useCallback(
    (on: boolean) => {
      if (store === undefined || id === undefined) return;
      store.setResizing(id, on);
      store.setDragging(id, on);
    },
    [store, id],
  );
  const frame = React.useRef<{ handle: number; px: number; pin: 'start' | 'end' } | null>(null);
  const cancelFrame = (): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current.handle);
    frame.current = null;
  };
  const setDrawnWidth = React.useCallback(
    (px: number | null, pin: 'start' | 'end' = 'start') => {
      if (store === undefined || id === undefined) return;
      if (px === null) {
        cancelFrame();
        store.setDrawn(id, null, pin);
        return;
      }
      if (!Number.isFinite(px) || px < 0) return;
      if (frame.current !== null) {
        frame.current.px = px;
        frame.current.pin = pin;
        return;
      }
      const pending = { handle: 0, px, pin };
      frame.current = pending;
      pending.handle = requestAnimationFrame(() => {
        if (frame.current === pending) frame.current = null;
        store.setDrawn(id, pending.px, pending.pin);
      });
    },
    [store, id],
  );
  React.useEffect(() => cancelFrame, [store, id]);
  return React.useMemo(() => [resizing, set, setDrawnWidth] as const, [resizing, set, setDrawnWidth]);
}

/** Whether the panel above shows its chrome in full; provided by `Panel`, true for a part drawn without one. */
export const PanelChromeVisibleContext = React.createContext<boolean>(true);

function subscribeHoverNone(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia('(hover: none)');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
const hoverNone = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches;

/** Handlers `Panel` puts on its root box, composed over the caller's own. */
export interface ChromeRootHandlers {
  onPointerEnter: React.PointerEventHandler<HTMLElement>;
  onPointerLeave: React.PointerEventHandler<HTMLElement>;
  onFocus: React.FocusEventHandler<HTMLElement>;
  onBlur: React.FocusEventHandler<HTMLElement>;
}

/** Whether Option (Alt) is down, which shows every panel's header and footer. Leaving the window lets it go, since its key-up then lands elsewhere. */
export function useOptionHeld(): boolean {
  const [held, setHeld] = React.useState(false);
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => setHeld(event.altKey);
    const onBlur = (): void => setHeld(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  return held;
}

/** How long a pointer may be off a panel before its chrome hides: long enough to cross the gap to the header at any speed. */
const CHROME_LEAVE_MS = 150;

/**
 * Whether the panel above shows its chrome in full, and the root handlers that track hover and focus. Shown while the mode is
 * 'always', while the panel is hovered, holds focus, is active or is dragged, and on a device that cannot hover.
 */
export function useChromeVisibility(): { visible: boolean; handlers: ChromeRootHandlers } {
  const { mode } = React.useContext(PanelSlotContext)?.tuning.chrome ?? LIBRARY_TUNING_DEFAULTS.chrome;
  const held = useOptionHeld();
  const active = usePanelActive();
  const dragging = usePanelDragging();
  const cannotHover = React.useSyncExternalStore(subscribeHoverNone, hoverNone, () => false);
  const [hovered, setHovered] = React.useState(false);
  const leaving = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(leaving.current), []);
  const [focused, setFocused] = React.useState(false);
  const handlers = React.useMemo<ChromeRootHandlers>(
    () => ({
      onPointerEnter: () => {
        clearTimeout(leaving.current);
        setHovered(true);
      },
      // The gap between the frame and its header or footer belongs to neither: a pointer crossing it has not left.
      onPointerLeave: () => {
        clearTimeout(leaving.current);
        leaving.current = setTimeout(() => setHovered(false), CHROME_LEAVE_MS);
      },
      onFocus: () => setFocused(true),
      onBlur: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      },
    }),
    [],
  );
  return { visible: mode === 'always' || held || hovered || focused || active || dragging || cannotHover, handlers };
}

/**
 * A ref for one chrome part (header, grab bar, footer) that fades it to opaque or transparent as the panel's chrome shows or
 * hides. Opacity only, so a hidden part stays hit-testable and focusable. It runs on Motion, not a CSS transition, which a
 * host's global `transition: none` would silence, and takes no time when `fadeMs` is 0, animation is off or motion is reduced.
 * With mode 'always' no inline opacity is left on the element.
 */
export function useChromeFade(visible: boolean): (node: HTMLElement | null) => void {
  const slot = React.useContext(PanelSlotContext);
  const { mode, fadeMs, fadeEase } = slot?.tuning.chrome ?? LIBRARY_TUNING_DEFAULTS.chrome;
  // The system preference counts whatever the app's MotionConfig says, as it does for the row's own slides.
  const configReduced = useReducedMotionConfig() === true;
  const systemReduced = useReducedMotion() === true;
  const reduced = configReduced || systemReduced;
  const easeKey = JSON.stringify(fadeEase);
  const instant = fadeMs === 0 || reduced;
  const target = mode === 'always' || visible ? 1 : 0;
  const node = React.useRef<HTMLElement | null>(null);
  const run = React.useRef<{ stop(): void } | null>(null);
  const latest = React.useRef({ mode, target });
  latest.current = { mode, target };
  const settle = (el: HTMLElement): void => {
    if (latest.current.mode === 'always') el.style.removeProperty('opacity');
    else el.style.opacity = String(latest.current.target);
  };
  const first = React.useRef(true);
  React.useLayoutEffect(() => {
    const el = node.current;
    run.current?.stop();
    run.current = null;
    if (el === null) return;
    if (first.current || instant) {
      first.current = false;
      settle(el);
      return;
    }
    const controls = animate(el, { opacity: target }, { duration: fadeMs / 1000, ease: fadeEase });
    run.current = controls;
    void controls.then(() => {
      if (run.current === controls) settle(el);
    });
  }, [target, instant, fadeMs, easeKey, mode]);
  React.useLayoutEffect(() => () => run.current?.stop(), []);
  return React.useCallback((el: HTMLElement | null) => {
    node.current = el;
    if (el !== null) settle(el);
  }, []);
}

/**
 * The `onClose` and `reorder` of the panel this hook is called in, to spread onto `DragToClose`: a close and a move
 * through the panel's own handle, so both are gated and answer a `PanelResult`. A close is offered when the panel is
 * closable and sits in a column that closes; a reorder when it is movable, and a release crossing several
 * neighbors is one `move`. The reorder's `onStep` is the same call for the grab strip's Arrow keys. Outside a row with a workspace there is no handle, so it returns neither.
 * @public
 */
export function usePanelDragProps(): { onClose?: () => void; reorder?: ReorderHandle } {
  const slot = React.useContext(PanelSlotContext);
  const handle = slot?.handle;
  if (slot === undefined || handle === undefined) return {};
  const props: { onClose?: () => void; reorder?: ReorderHandle } = {};
  if (slot.collapsible && slot.closable) props.onClose = () => void handle.close('person');
  if (slot.movable) {
    props.reorder = {
      onDragEnd: (offset) => {
        const steps = reorderStepsForOffset(offset, slot.neighborWidths, slot.tuning.rowGap, slot.tuning.hopFraction);
        if (steps !== 0) handle.move(steps, 'person');
      },
      onStep: (steps) => {
        const answer = handle.move(steps, 'person');
        return answer.ok && answer.changed;
      },
    };
  }
  return props;
}

