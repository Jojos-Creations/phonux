/**
 * The panel list as a plain store: a value, a setter that takes a value or an updater, and subscribers. React reads it
 * through useSyncExternalStore in useProvidePanels; nothing here imports React.
 *
 * An updater runs when it is called, against the value the store holds then. React's state setter queued it and ran it
 * at the next render, so an updater must not rely on a ref that is written after the call.
 */
export function createPanelList(initial) {
    let value = initial;
    const listeners = new Set();
    return {
        get: () => value,
        set: (next) => {
            const resolved = typeof next === 'function' ? next(value) : next;
            if (Object.is(resolved, value))
                return;
            value = resolved;
            for (const listener of [...listeners])
                listener();
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}
