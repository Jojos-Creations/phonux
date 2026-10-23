/**
 * useViewState: per-view state that survives the view's own panel being parked (unmounted) and revived.
 * Why it is shaped this way: DESIGN.md, "`useViewState`: per-view state that outlives a park, not a restart".
 */
import * as React from 'react';
/** Ambient id of the panel currently rendering; read only by useViewState, set only by useViewState.Provider. */
const ViewIdContext = React.createContext(null);
/** Thrown by useViewState() unless it renders under BOTH wrappers a host's panel row supplies. @public */
export class ViewStateMissingProviderError extends Error {
    /** @param missing - Which wrapper is absent: the host provider, or the ambient view id. */
    constructor(missing) {
        super(`useViewState() was called ${missing === 'host' ? 'outside a <HostProvider>, which holds the state' : 'with no ambient view id'}. ` +
            'A view must render where its host mounts it, under both <HostProvider> and <useViewState.Provider value={panelId}>; ' +
            'a test calling a view\'s hooks directly must wrap it in both: ' +
            '<HostProvider host={createFakeHost()}><useViewState.Provider value="some-id">...</useViewState.Provider></HostProvider>.');
        this.name = 'ViewStateMissingProviderError';
    }
}
/** Keyed by panel id first, so two views that pick the same key never share a cell. */
class ViewStateStore {
    panels = new Map();
    /** Released while a view was still mounted (mid exit animation): dropped once its last listener leaves. */
    released = new Set();
    cellFor(panelId, key) {
        let byKey = this.panels.get(panelId);
        if (!byKey) {
            byKey = new Map();
            this.panels.set(panelId, byKey);
        }
        let cell = byKey.get(key);
        if (!cell) {
            cell = { value: undefined, listeners: new Set() };
            byKey.set(key, cell);
        }
        return cell;
    }
    get(panelId, key) {
        return this.panels.get(panelId)?.get(key)?.value;
    }
    set(panelId, key, value) {
        const cell = this.cellFor(panelId, key);
        if (cell.value === value)
            return;
        cell.value = value;
        for (const listener of [...cell.listeners])
            listener();
    }
    subscribe(panelId, key, listener) {
        const cell = this.cellFor(panelId, key);
        cell.listeners.add(listener);
        return () => {
            cell.listeners.delete(listener);
            this.dropIfReleased(panelId);
        };
    }
    hasPanelOutside(keep) {
        for (const panelId of this.panels.keys())
            if (!keep.has(panelId))
                return true;
        return false;
    }
    /** Never notifies: a still-mounted view keeps showing its value until it unmounts. */
    releaseAllExcept(keep) {
        for (const panelId of this.released)
            if (keep.has(panelId))
                this.released.delete(panelId);
        for (const panelId of [...this.panels.keys()]) {
            if (keep.has(panelId))
                continue;
            this.released.add(panelId);
            this.dropIfReleased(panelId);
        }
    }
    dropIfReleased(panelId) {
        if (!this.released.has(panelId))
            return;
        for (const cell of this.panels.get(panelId)?.values() ?? [])
            if (cell.listeners.size > 0)
                return;
        this.panels.delete(panelId);
        this.released.delete(panelId);
    }
}
const StoreContext = React.createContext(null);
/** Mounted once by HostProvider, beside OverlayProvider. Not on the barrel: app code never needs its own store. @internal */
export function ViewStateProvider({ children }) {
    const [store] = React.useState(() => new ViewStateStore()); // pure constructor: StrictMode's double init is harmless
    return React.createElement(StoreContext.Provider, { value: store }, children);
}
function useViewStateImpl(key, initial) {
    const panelId = React.useContext(ViewIdContext);
    const store = React.useContext(StoreContext);
    if (store === null)
        throw new ViewStateMissingProviderError('host');
    if (panelId === null)
        throw new ViewStateMissingProviderError('view id');
    // A ref, not `initial` itself: a fresh object each render must neither change the snapshot (useSyncExternalStore
    // needs a stable one) nor the setter's identity (useState's setter never changes).
    const firstInitial = React.useRef(initial);
    const read = React.useCallback(() => {
        const stored = store.get(panelId, key);
        return stored === undefined ? firstInitial.current : stored; // not `??`: null is a real stored value
    }, [store, panelId, key]);
    const subscribe = React.useCallback((onChange) => store.subscribe(panelId, key, onChange), [store, panelId, key]);
    const value = React.useSyncExternalStore(subscribe, read, read);
    const setValue = React.useCallback((next) => {
        // JsonValue never includes a function, so this check can never mistake a real value for an updater.
        store.set(panelId, key, typeof next === 'function' ? next(read()) : next);
    }, [store, panelId, key, read]);
    return [value, setValue];
}
/**
 * For the host's panel row, once per HostProvider: `panelIds` is every panel that can still be shown again
 * (the row's own list plus `PanelsAPI.recentlyClosed`); every other panel's state is released.
 */
function useRetainOnly(panelIds) {
    const store = React.useContext(StoreContext);
    if (store === null)
        throw new ViewStateMissingProviderError('host');
    const keep = new Set(panelIds);
    React.useEffect(() => {
        if (!store.hasPanelOutside(keep))
            return;
        // A task later, and cancelled by any newer commit: undoClose can commit once with a restored id in
        // neither list (recentlyClosed already null) before the commit that puts it back in the row.
        const timer = setTimeout(() => store.releaseAllExcept(keep), 0);
        return () => clearTimeout(timer);
    });
}
/**
 * The one hook a view uses for state that must survive its own panel parking and reviving: same
 * `[value, setValue]` pair and same type inference as `React.useState`, but `initial` must be JSON-shaped.
 * `Provider` and `useRetainOnly` are the host's side (PanelRow.tsx), never called by a view.
 * @public
 */
export const useViewState = Object.assign(useViewStateImpl, { Provider: ViewIdContext.Provider, useRetainOnly });
