/**
 * Which panel is the active one and which is being dragged: ephemeral facts about the person's attention, held by the
 * Workspace so two workspaces share nothing, kept out of the manager's snapshot and out of storage.
 */
import * as React from 'react';
import { animate, useReducedMotion, useReducedMotionConfig } from 'motion/react';
import { LIBRARY_TUNING_DEFAULTS, type PanelId } from './panelSettings.js';
import { PanelSlotContext } from './panelSlotContext.js';

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
  /** Wakes `listener` when `id` gains or loses the active or dragging mark. */
  subscribePanel(id: PanelId, listener: () => void): () => void;
  /** Wakes `listener` when the active panel changes. */
  subscribeActive(listener: () => void): () => void;
}

export function createChromeStore(): ChromeStore {
  let active: PanelId | null = null;
  let dragging: PanelId | null = null;
  let resizing: PanelId | null = null;
  const resizingListeners = new Set<() => void>();
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
      wake([before, resizing], false);
      for (const l of [...resizingListeners]) l();
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
 * Whether this panel is being resized by hand, and a setter for a host's resize grabber to call: true when a drag begins,
 * false when it ends. While it is true no other panel's drawn size changes, so a grabber that reads `panel.size` at the
 * start of its drag, and a neighbour that was drawn smaller to fill the window, stay where they were until the release.
 * It also marks the panel as dragging (`usePanelDragging`) for the same span, so a drag of any kind that a host runs
 * shows the chrome a drag shows. Outside a row the value is false and the setter does nothing.
 * @public
 */
export function usePanelResizing(): readonly [boolean, (on: boolean) => void] {
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
  return React.useMemo(() => [resizing, set] as const, [resizing, set]);
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
