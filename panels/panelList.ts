/**
 * The panel list as a plain store: a value, a setter that takes a value or an updater, and subscribers. React reads it
 * through useSyncExternalStore in useProvidePanels; nothing here imports React.
 *
 * An updater runs when it is called, against the value the store holds then. React's state setter queued it and ran it
 * at the next render, so an updater must not rely on a ref that is written after the call.
 */

export interface PanelList<T> {
  /** The value now. The same reference until a set changes it. */
  readonly get: () => T;
  /** Replaces the value, or replaces it with what the updater returns from the value now. Notifies subscribers only when the value changes. */
  readonly set: (next: T | ((prev: T) => T)) => void;
  /** Calls `listener` after each change. Returns the function that stops it. */
  readonly subscribe: (listener: () => void) => () => void;
}

export function createPanelList<T>(initial: T): PanelList<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
