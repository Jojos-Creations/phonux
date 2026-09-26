/**
 * useViewState: per-View state that survives the view's OWN panel being parked (live:false -- LivePanels.tsx's
 * `present` filter fully unmounts a parked entry) and revived. Lives inside phonux, not on Host: a Map-backed
 * store outside React state, copying windowOverlay.tsx's OverlayStore shape (a private Map plus per-cell
 * subscribers), so parking a view never drops its own cell the way local `useState` would.
 *
 * No id parameter: `useViewState(key, initial)` reads its panel id from an AMBIENT context instead, set once
 * by the host's render loop (LivePanels.tsx's own render site, the one place a resolved View is actually
 * invoked) so a view author never wires an id at all. That ambient-id Provider is exposed as
 * `useViewState.Provider`, a property of the hook itself, rather than a second phonux export -- see
 * DESIGN.md's own new section for why.
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

/**
 * Map<panelId, Map<key, Cell>> -- two levels because two views never share a cell even if they happen to pick
 * the same key, and one view's own keys never collide with each other.
 */
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
    const cell = this.cellFor(panelId, key, value); // seeds a fresh cell at `value` if this is the first write
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

/** Mounted once by HostProvider, exactly like OverlayProvider (phoneViewApi.tsx). Not re-exported through index.ts: app code never needs its own store. */
export function ViewStateProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [store] = React.useState(() => new ViewStateStore()); // pure constructor: StrictMode's double init is harmless
  return React.createElement(StoreContext.Provider, { value: store }, children);
}

/**
 * `T extends JsonValue` alone infers a LITERAL type from a bare initial value (`useViewState('k', 0)` would
 * lock T to the type `0`, rejecting `setValue(7)`) -- a TS quirk of union-constrained generic inference that
 * plain `useState`'s unconstrained `T` never hits. Widen<T> re-widens exactly the cases TS's own inference
 * would widen for an unconstrained T (recursing into arrays/objects, since the same over-narrowing happens at
 * every nesting level), so the hook's public type reads identically to `useState` while `T extends JsonValue`
 * still rejects a non-JSON value at the call site.
 */
type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends null
        ? null
        : T extends readonly (infer U)[]
          ? readonly Widen<U>[]
          : T extends object
            ? { readonly [K in keyof T]: Widen<T[K]> }
            : T;

function useViewStateImpl<T extends JsonValue>(
  key: string,
  initial: T,
): [Widen<T>, (next: Widen<T> | ((prev: Widen<T>) => Widen<T>)) => void] {
  const panelId = React.useContext(ViewIdContext);
  const store = React.useContext(StoreContext);
  if (panelId === null || store === null) throw new ViewStateMissingProviderError();
  const value = React.useSyncExternalStore(
    // Cast, not a narrower store signature: keeps `T extends JsonValue` on useViewStateImpl the ONLY thing
    // enforcing the JSON bound, so widening that one clause is a complete, isolated proof it's load-bearing.
    (onChange) => store.subscribe(panelId, key, initial as JsonValue, onChange),
    () => store.get(panelId, key, initial as JsonValue) as Widen<T>,
    () => store.get(panelId, key, initial as JsonValue) as Widen<T>,
  );
  const setValue = React.useCallback(
    (next: Widen<T> | ((prev: Widen<T>) => Widen<T>)) => {
      // JsonValue never includes a function, so this check can never mistake a real value for an updater.
      const resolved =
        typeof next === 'function' ? (next as (prev: Widen<T>) => Widen<T>)(store.get(panelId, key, initial as JsonValue) as Widen<T>) : next;
      store.set(panelId, key, resolved as JsonValue);
    },
    [store, panelId, key, initial],
  );
  return [value, setValue];
}

/**
 * The one hook a view uses for state that must survive its own panel parking and reviving. Same `[value,
 * setValue]` tuple shape as `React.useState`, so a view's own render code reads identically either way.
 * Close + undoClose need no special-case code here: both keep the SAME panel id (panelWindow.ts's
 * close/restore, usePanelClosing.ts's undoClose), so the Map-keyed store already has the right cell waiting
 * when the view remounts.
 */
export const useViewState = Object.assign(useViewStateImpl, { Provider: ViewIdContext.Provider });
