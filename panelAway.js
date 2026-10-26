/**
 * Which panel slots the Workspace has scrolled out of the window, as a plain store. Workspace writes it from its scroll
 * handler and a view reads it through usePanelPresence. Keyed by the slot's panel id, which a view can read from its slot
 * but cannot use to find the element.
 */
import * as React from 'react';
export function createAwayStore() {
    const away = new Set();
    const listeners = new Map();
    const wake = (id) => {
        for (const listener of [...(listeners.get(id) ?? [])])
            listener();
    };
    return {
        has: (id) => away.has(id),
        set(id, on) {
            if (away.has(id) === on)
                return;
            if (on)
                away.add(id);
            else
                away.delete(id);
            wake(id);
        },
        retain(ids) {
            for (const id of [...away]) {
                if (ids.has(id))
                    continue;
                away.delete(id);
                wake(id);
            }
        },
        subscribe(id, listener) {
            const set = listeners.get(id) ?? new Set();
            set.add(listener);
            listeners.set(id, set);
            return () => {
                set.delete(listener);
                if (set.size === 0 && listeners.get(id) === set)
                    listeners.delete(id);
            };
        },
    };
}
/** The store of the Workspace a row is mounted in. Unprovided outside a Workspace: no slot is away. */
export const AwayContext = React.createContext(undefined);
