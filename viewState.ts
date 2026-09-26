/**
 * useViewState: per-view state that survives the view's own panel being parked (unmounted) and revived.
 * Why it is shaped this way: DESIGN.md, "`useViewState`: per-view state that outlives a park, not a restart".
 */

import * as React from 'react';
import type { JsonValue } from './phoneViewApi.js';

/** Ambient id of the panel currently rendering; read only by useViewState, set only by useViewState.Provider. */
const ViewIdContext = React.createContext<string | null>(null);

/** Thrown by useViewState() with no ambient panel id (e.g. called outside a View LivePanels.tsx rendered). */
export class ViewStateMissingProviderError extends Error {
  constructor() {
    super(
      'useViewState() was called with no ambient view id. A view must render as the child LivePanels.tsx mounts ' +
        '(inside useViewState.Provider); a test calling a view\'s hooks directly must wrap it the same way: ' +
        '<useViewState.Provider value="some-id">.',
    );
    this.name = 'ViewStateMissingProviderError';
  }
}

interface Cell {
  value: JsonValue;
  listeners: Set<() => void>;
}

/** Keyed by panel id first, so two views that pick the same key never share a cell. */
class ViewStateStore {
  private panels = new Map<string, Map<string, Cell>>();

  private cellFor(panelId: string, key: string, initial: JsonValue): Cell {
    let byKey = this.panels.get(panelId);
    if (!byKey) {
      byKey = new Map();
      this.panels.set(panelId, byKey);
    }
    let cell = byKey.get(key);
    if (!cell) {
      cell = { value: initial, listeners: new Set() };
      byKey.set(key, cell);
    }
    return cell;
  }

  get(panelId: string, key: string, initial: JsonValue): JsonValue {
    return this.cellFor(panelId, key, initial).value;
  }

  set(panelId: string, key: string, value: JsonValue): void {
    const cell = this.cellFor(panelId, key, value);
    if (cell.value === value) return;
    cell.value = value;
    for (const listener of [...cell.listeners]) listener();
  }

  subscribe(panelId: string, key: string, initial: JsonValue, listener: () => void): () => void {
    const cell = this.cellFor(panelId, key, initial);
    cell.listeners.add(listener);
    return () => void cell.listeners.delete(listener);
  }
}

const StoreContext = React.createContext<ViewStateStore | null>(null);

/** Mounted once by HostProvider, beside OverlayProvider. Not on the barrel: app code never needs its own store. */
export function ViewStateProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [store] = React.useState(() => new ViewStateStore()); // pure constructor: StrictMode's double init is harmless
  return React.createElement(StoreContext.Provider, { value: store }, children);
}

type ViewStateTuple<S> = [S, (next: S | ((prev: S) => S)) => void];

// `T` stays unconstrained so TS infers from `initial` exactly as for useState's `S`: a constraint that includes
// primitives (JsonValue does) would keep `0` as the type `0`. So the JSON check rides on `key`'s type instead.
function useViewStateImpl<T>(key: [T] extends [JsonValue] ? string : never, initial: T): ViewStateTuple<T>;
// For a caller that is itself generic over `U extends JsonValue`, where the check above cannot resolve.
function useViewStateImpl<T extends JsonValue>(key: string, initial: T): ViewStateTuple<T>;
function useViewStateImpl(key: string, initial: JsonValue): ViewStateTuple<JsonValue> {
  const panelId = React.useContext(ViewIdContext);
  const store = React.useContext(StoreContext);
  if (panelId === null || store === null) throw new ViewStateMissingProviderError();
  // The callbacks below run only after a render's getSnapshot has created the cell, so the first `initial` is
  // enough; keeping `initial` out of their deps keeps setValue stable, as useState's setter is.
  const firstInitial = React.useRef(initial);
  const subscribe = React.useCallback(
    (onChange: () => void) => store.subscribe(panelId, key, firstInitial.current, onChange),
    [store, panelId, key],
  );
  const getSnapshot = (): JsonValue => store.get(panelId, key, initial);
  const value = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setValue = React.useCallback(
    (next: JsonValue | ((prev: JsonValue) => JsonValue)) => {
      // JsonValue never includes a function, so this check can never mistake a real value for an updater.
      const resolved = typeof next === 'function' ? next(store.get(panelId, key, firstInitial.current)) : next;
      store.set(panelId, key, resolved);
    },
    [store, panelId, key],
  );
  return [value, setValue];
}

/**
 * The one hook a view uses for state that must survive its own panel parking and reviving: same `[value,
 * setValue]` pair and same type inference as `React.useState`, but `initial` must be JSON-shaped. Close +
 * undoClose need nothing extra: both keep the same panel id, so the store's cell is still there on remount.
 */
export const useViewState = Object.assign(useViewStateImpl, { Provider: ViewIdContext.Provider });
