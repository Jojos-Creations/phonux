/**
 * Which panel slots the Workspace has scrolled out of the window, as a plain store. Workspace writes it from its scroll
 * handler and a view reads it through usePanelPresence. Keyed by the slot's panel id, which a view can read from its slot
 * but cannot use to find the element.
 */
import * as React from 'react';

export interface AwayStore {
  /** Whether the slot of `id` is out of the window now. */
  has(id: string): boolean;
  /** Sets the flag of `id`. Listeners of `id` run only when the flag changes, so a scroll frame that keeps a slot where it was wakes nothing. */
  set(id: string, away: boolean): void;
  /** Clears the flag of every id not in `ids`: a slot that unmounted never reports away again. */
  retain(ids: ReadonlySet<string>): void;
  /** Calls `listener` when the flag of `id` changes. Returns the function that stops it. */
  subscribe(id: string, listener: () => void): () => void;
}

export function createAwayStore(): AwayStore {
  const away = new Set<string>();
  const listeners = new Map<string, Set<() => void>>();
  const wake = (id: string): void => {
    for (const listener of [...(listeners.get(id) ?? [])]) listener();
  };
  return {
    has: (id) => away.has(id),
    set(id, on) {
      if (away.has(id) === on) return;
      if (on) away.add(id);
      else away.delete(id);
      wake(id);
    },
    retain(ids) {
      for (const id of [...away]) {
        if (ids.has(id)) continue;
        away.delete(id);
        wake(id);
      }
    },
    subscribe(id, listener) {
      const set = listeners.get(id) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(id, set);
      return () => {
        set.delete(listener);
        if (set.size === 0 && listeners.get(id) === set) listeners.delete(id);
      };
    },
  };
}

/** The store of the Workspace a row is mounted in. Unprovided outside a Workspace: no slot is away. */
export const AwayContext = React.createContext<AwayStore | undefined>(undefined);
