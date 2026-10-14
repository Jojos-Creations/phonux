/**
 * Which panel is the active one and which is being dragged: ephemeral facts about the person's attention, held by the
 * Workspace so two workspaces share nothing, kept out of the manager's snapshot and out of storage.
 */
import * as React from 'react';
import { animate, useReducedMotion, useReducedMotionConfig } from 'motion/react';
import { LIBRARY_TUNING_DEFAULTS, type PanelId } from './panelSettings.js';
import type { ReorderHandle } from './dragToClose.js';
import { PanelSlotContext } from './panelSlotContext.js';
import { reorderStepsForOffset } from './panelWindow.js';

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
 * The values {@link CHROME_ATTRIBUTE} takes, one per part: `header`, `grabBar` (`'grab-bar'`) and `footer`. A panel
 * carries at most one element of each.
 * @public
 */
export const CHROME_PARTS = { header: 'header', grabBar: 'grab-bar', footer: 'footer' } as const;

/**
 * A value of {@link CHROME_ATTRIBUTE}: `'header'`, `'grab-bar'` or `'footer'`.
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
  };
}

/** The store the Workspace above provides; PanelRow makes its own when it has no Workspace. */
export const ChromeStoreContext = React.createContext<ChromeStore | undefined>(undefined);

const NOOP_SET = (): void => {};
const NO_SUBSCRIBE = (): (() => void) => () => {};

/**
 * The id of the active panel and a setter for it: the panel the person last pressed or focused inside, until another
 * panel is used, or the one the host set. Outside a Workspace it is `[null, no-op]`.
 * @public
 */
export function useActivePanel(): readonly [PanelId | null, (id: PanelId | null) => void] {
  const store = React.useContext(ChromeStoreContext);
  const id = React.useSyncExternalStore(store?.subscribeActive ?? NO_SUBSCRIBE, () => store?.active() ?? null, () => null);
  return React.useMemo(() => [id, store?.setActive ?? NOOP_SET] as const, [id, store]);
}

function usePanelMark(read: (store: ChromeStore, id: PanelId) => boolean): boolean {
  const store = React.useContext(ChromeStoreContext);
  const id = React.useContext(PanelSlotContext)?.id;
  const subscribe = React.useCallback((l: () => void) => (store === undefined || id === undefined ? () => {} : store.subscribePanel(id, l)), [store, id]);
  return React.useSyncExternalStore(subscribe, () => (store === undefined || id === undefined ? false : read(store, id)), () => false);
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
 * Whether this panel is being resized by hand, and two setters for a host's resize grabber to call.
 *
 * `setResizing(true)` when a drag begins and `setResizing(false)` when it ends. While it is true no other panel's drawn
 * size changes, so a grabber that reads `panel.size` at the start of its drag, and a neighbour that was drawn smaller to
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

/**
 * Whether the panel above shows its chrome in full, and the root handlers that track hover and focus. Shown while the mode is
 * 'always', while the panel is hovered, holds focus, is active or is dragged, and on a device that cannot hover.
 */
export function useChromeVisibility(): { visible: boolean; handlers: ChromeRootHandlers } {
  const mode = (React.useContext(PanelSlotContext)?.tuning.chrome ?? LIBRARY_TUNING_DEFAULTS.chrome).mode;
  const active = usePanelActive();
  const dragging = usePanelDragging();
  const cannotHover = React.useSyncExternalStore(subscribeHoverNone, hoverNone, () => false);
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const handlers = React.useMemo<ChromeRootHandlers>(
    () => ({
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
      onFocus: () => setFocused(true),
      onBlur: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      },
    }),
    [],
  );
  return { visible: mode === 'always' || hovered || focused || active || dragging || cannotHover, handlers };
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
  const instant = fadeMs === 0 || reduced || slot?.animated === false;
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
 * closable and sits in a column that closes; a reorder when it is draggable, and a release crossing several
 * neighbours is one `move`. Outside a row with a workspace there is no handle, so it returns neither.
 * @public
 */
export function usePanelDragProps(): { onClose?: () => void; reorder?: ReorderHandle } {
  const slot = React.useContext(PanelSlotContext);
  const handle = slot?.handle;
  if (slot === undefined || handle === undefined) return {};
  const props: { onClose?: () => void; reorder?: ReorderHandle } = {};
  if (slot.collapsible && slot.closable) props.onClose = () => void handle.close('person');
  if (slot.draggable) {
    props.reorder = {
      onDragEnd: (offset) => {
        const steps = reorderStepsForOffset(offset, slot.neighborWidths, slot.tuning.rowGap, slot.tuning.hopFraction);
        if (steps !== 0) handle.move(steps, 'person');
      },
    };
  }
  return props;
}
