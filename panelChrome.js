/**
 * Which panel is the active one and which is being dragged: ephemeral facts about the person's attention, held by the
 * Workspace so two workspaces share nothing, kept out of the manager's snapshot and out of storage.
 */
import * as React from 'react';
import { animate, useReducedMotion, useReducedMotionConfig } from 'motion/react';
import { LIBRARY_TUNING_DEFAULTS } from './panelSettings.js';
import { warnCounterId } from './panelIds.js';
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
 * The values {@link CHROME_ATTRIBUTE} takes, one per part: `header`, `grabBar` (`'grab-bar'`), `footer` and `resize`. A panel
 * carries at most one element of each, except `resize`, which marks the grip on each side.
 * @public
 */
export const CHROME_PARTS = { header: 'header', grabBar: 'grab-bar', footer: 'footer' };
export function createChromeStore() {
    let active = null;
    let dragging = null;
    let resizing = null;
    let drawn = null;
    const resizingListeners = new Set();
    const drawnListeners = new Set();
    const setDrawnNow = (next) => {
        if (next === drawn || (next !== null && drawn !== null && next.id === drawn.id && next.px === drawn.px && next.pin === drawn.pin))
            return;
        drawn = next;
        for (const l of [...drawnListeners])
            l();
    };
    const activeListeners = new Set();
    let keys = new Map();
    let engines = new Map();
    const byPanel = new Map();
    const wake = (ids, activeChanged) => {
        for (const id of new Set(ids))
            if (id !== null)
                for (const l of [...(byPanel.get(id) ?? [])])
                    l();
        if (activeChanged)
            for (const l of [...activeListeners])
                l();
    };
    return {
        active: () => active,
        dragging: () => dragging,
        setActive(id) {
            if (id === active)
                return;
            const before = active;
            active = id;
            wake([before, id], true);
        },
        setDragging(id, on) {
            if (on ? dragging === id : dragging !== id)
                return;
            const before = dragging;
            dragging = on ? id : null;
            wake([before, dragging], false);
        },
        resizing: () => resizing,
        setResizing(id, on) {
            if (on ? resizing === id : resizing !== id)
                return;
            const before = resizing;
            resizing = on ? id : null;
            // The mark ending takes a width still held with it, so the row is never left drawing a width nobody is dragging.
            if (!on)
                setDrawnNow(null);
            wake([before, resizing], false);
            for (const l of [...resizingListeners])
                l();
        },
        drawn: () => drawn,
        setDrawn(id, px, pin) {
            if (resizing !== id)
                return;
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
            const set = byPanel.get(id) ?? new Set();
            byPanel.set(id, set);
            set.add(listener);
            return () => {
                set.delete(listener);
                if (set.size === 0 && byPanel.get(id) === set)
                    byPanel.delete(id);
            };
        },
        subscribeActive(listener) {
            activeListeners.add(listener);
            return () => void activeListeners.delete(listener);
        },
        setKeys(next) {
            keys = next;
            engines = new Map([...next].map(([engine, key]) => [key, engine]));
        },
        keyOf: (engine) => keys.get(engine) ?? engine,
        engineOf: (key) => {
            const engine = engines.get(key);
            if (engine !== undefined)
                return engine;
            const counterKey = keys.get(key);
            if (counterKey !== undefined)
                warnCounterId(key, counterKey);
            return key;
        },
    };
}
/** The store the Workspace above provides; PanelRow makes its own when it has no Workspace. */
export const ChromeStoreContext = React.createContext(undefined);
const NOOP_SET = () => { };
const NO_SUBSCRIBE = () => () => { };
/**
 * The id (key) of the active panel and a setter that takes one: the panel the person last pressed or focused inside, until another
 * panel is used, or the one the host set. Outside a Workspace it is `[null, no-op]`.
 * @public
 */
export function useActivePanel() {
    const store = React.useContext(ChromeStoreContext);
    const id = React.useSyncExternalStore(store?.subscribeActive ?? NO_SUBSCRIBE, () => { const active = store?.active() ?? null; return active === null ? null : store.keyOf(active); }, () => null);
    const set = React.useCallback((key) => store?.setActive(key === null ? null : store.engineOf(key)), [store]);
    return React.useMemo(() => [id, store === undefined ? NOOP_SET : set], [id, store, set]);
}
function usePanelMark(read) {
    const store = React.useContext(ChromeStoreContext);
    const id = React.useContext(PanelSlotContext)?.id;
    const subscribe = React.useCallback((l) => (store === undefined || id === undefined ? () => { } : store.subscribePanel(id, l)), [store, id]);
    return React.useSyncExternalStore(subscribe, () => (store === undefined || id === undefined ? false : read(store, id)), () => false);
}
/**
 * True while this panel is the active one. False for every other panel, and outside a row.
 * @public
 */
export function usePanelActive() {
    return usePanelMark((store, id) => store.active() === id);
}
/**
 * True from the moment a drag of this panel engages, on either axis, until it settles. A press that never becomes a
 * drag leaves it false. False outside a row.
 * @public
 */
export function usePanelDragging() {
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
export function usePanelSetDragging() {
    const store = React.useContext(ChromeStoreContext);
    const id = React.useContext(PanelSlotContext)?.id;
    const held = React.useRef(false);
    React.useEffect(() => () => {
        if (held.current && store !== undefined && id !== undefined)
            store.setDragging(id, false);
        held.current = false;
    }, [store, id]);
    return React.useCallback((on) => {
        if (store === undefined || id === undefined)
            return;
        held.current = on;
        store.setDragging(id, on);
    }, [store, id]);
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
export function usePanelResizing() {
    const store = React.useContext(ChromeStoreContext);
    const id = React.useContext(PanelSlotContext)?.id;
    const resizing = usePanelMark((s, panel) => s.resizing() === panel);
    const set = React.useCallback((on) => {
        if (store === undefined || id === undefined)
            return;
        store.setResizing(id, on);
        store.setDragging(id, on);
    }, [store, id]);
    const frame = React.useRef(null);
    const cancelFrame = () => {
        if (frame.current !== null)
            cancelAnimationFrame(frame.current.handle);
        frame.current = null;
    };
    const setDrawnWidth = React.useCallback((px, pin = 'start') => {
        if (store === undefined || id === undefined)
            return;
        if (px === null) {
            cancelFrame();
            store.setDrawn(id, null, pin);
            return;
        }
        if (!Number.isFinite(px) || px < 0)
            return;
        if (frame.current !== null) {
            frame.current.px = px;
            frame.current.pin = pin;
            return;
        }
        const pending = { handle: 0, px, pin };
        frame.current = pending;
        pending.handle = requestAnimationFrame(() => {
            if (frame.current === pending)
                frame.current = null;
            store.setDrawn(id, pending.px, pending.pin);
        });
    }, [store, id]);
    React.useEffect(() => cancelFrame, [store, id]);
    return React.useMemo(() => [resizing, set, setDrawnWidth], [resizing, set, setDrawnWidth]);
}
/** Whether the panel above shows its chrome in full; provided by `Panel`, true for a part drawn without one. */
export const PanelChromeVisibleContext = React.createContext(true);
function subscribeHoverNone(listener) {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
        return () => { };
    const query = window.matchMedia('(hover: none)');
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
}
const hoverNone = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches;
/**
 * Whether the panel above shows its chrome in full, and the root handlers that track hover and focus. Shown while the mode is
 * 'always', while the panel is hovered, holds focus, is active or is dragged, and on a device that cannot hover.
 */
export function useChromeVisibility() {
    const mode = (React.useContext(PanelSlotContext)?.tuning.chrome ?? LIBRARY_TUNING_DEFAULTS.chrome).mode;
    const active = usePanelActive();
    const dragging = usePanelDragging();
    const cannotHover = React.useSyncExternalStore(subscribeHoverNone, hoverNone, () => false);
    const [hovered, setHovered] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    const handlers = React.useMemo(() => ({
        onPointerEnter: () => setHovered(true),
        onPointerLeave: () => setHovered(false),
        onFocus: () => setFocused(true),
        onBlur: (e) => {
            if (!e.currentTarget.contains(e.relatedTarget))
                setFocused(false);
        },
    }), []);
    return { visible: mode === 'always' || hovered || focused || active || dragging || cannotHover, handlers };
}
/**
 * A ref for one chrome part (header, grab bar, footer) that fades it to opaque or transparent as the panel's chrome shows or
 * hides. Opacity only, so a hidden part stays hit-testable and focusable. It runs on Motion, not a CSS transition, which a
 * host's global `transition: none` would silence, and takes no time when `fadeMs` is 0, animation is off or motion is reduced.
 * With mode 'always' no inline opacity is left on the element.
 */
export function useChromeFade(visible) {
    const slot = React.useContext(PanelSlotContext);
    const { mode, fadeMs, fadeEase } = slot?.tuning.chrome ?? LIBRARY_TUNING_DEFAULTS.chrome;
    // The system preference counts whatever the app's MotionConfig says, as it does for the row's own slides.
    const configReduced = useReducedMotionConfig() === true;
    const systemReduced = useReducedMotion() === true;
    const reduced = configReduced || systemReduced;
    const easeKey = JSON.stringify(fadeEase);
    const instant = fadeMs === 0 || reduced;
    const target = mode === 'always' || visible ? 1 : 0;
    const node = React.useRef(null);
    const run = React.useRef(null);
    const latest = React.useRef({ mode, target });
    latest.current = { mode, target };
    const settle = (el) => {
        if (latest.current.mode === 'always')
            el.style.removeProperty('opacity');
        else
            el.style.opacity = String(latest.current.target);
    };
    const first = React.useRef(true);
    React.useLayoutEffect(() => {
        const el = node.current;
        run.current?.stop();
        run.current = null;
        if (el === null)
            return;
        if (first.current || instant) {
            first.current = false;
            settle(el);
            return;
        }
        const controls = animate(el, { opacity: target }, { duration: fadeMs / 1000, ease: fadeEase });
        run.current = controls;
        void controls.then(() => {
            if (run.current === controls)
                settle(el);
        });
    }, [target, instant, fadeMs, easeKey, mode]);
    React.useLayoutEffect(() => () => run.current?.stop(), []);
    return React.useCallback((el) => {
        node.current = el;
        if (el !== null)
            settle(el);
    }, []);
}
/**
 * The `onClose` and `reorder` of the panel this hook is called in, to spread onto `DragToClose`: a close and a move
 * through the panel's own handle, so both are gated and answer a `PanelResult`. A close is offered when the panel is
 * closable and sits in a column that closes; a reorder when it is movable, and a release crossing several
 * neighbours is one `move`. The reorder's `onStep` is the same call for the grab strip's Arrow keys. Outside a row with a workspace there is no handle, so it returns neither.
 * @public
 */
export function usePanelDragProps() {
    const slot = React.useContext(PanelSlotContext);
    const handle = slot?.handle;
    if (slot === undefined || handle === undefined)
        return {};
    const props = {};
    if (slot.collapsible && slot.closable)
        props.onClose = () => void handle.close('person');
    if (slot.movable) {
        props.reorder = {
            onDragEnd: (offset) => {
                const steps = reorderStepsForOffset(offset, slot.neighborWidths, slot.tuning.rowGap, slot.tuning.hopFraction);
                if (steps !== 0)
                    handle.move(steps, 'person');
            },
            onStep: (steps) => {
                const answer = handle.move(steps, 'person');
                return answer.ok && answer.changed;
            },
        };
    }
    return props;
}
