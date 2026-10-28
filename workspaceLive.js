const LIVE_KEYS = ['device', 'snapshots', 'labels', 'topInset', 'panels'];
/** The keys a `WorkspaceLive` names that `update` cannot change, or that are no key of it at all. */
export function refusedLiveKeys(input) {
    return Object.keys(input).filter((k) => !LIVE_KEYS.includes(k));
}
/**
 * Whether the values carry the same data: functions compare equal whatever their identity (an app that builds its objects
 * with fresh closures every render must not wake every reader every render), a function against no function does not,
 * and plain objects and arrays compare by their members, to a few levels.
 */
export function sameLiveData(a, b, depth = 4) {
    if (Object.is(a, b))
        return true;
    if (typeof a === 'function' && typeof b === 'function')
        return true;
    if (depth === 0 || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null)
        return false;
    if (Array.isArray(a) !== Array.isArray(b))
        return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length)
        return false;
    return ka.every((k) => Object.hasOwn(b, k) && sameLiveData(a[k], b[k], depth - 1));
}
export function createLiveStore(initial) {
    let latest = { ...initial };
    let version = 0;
    const listeners = new Set();
    return {
        latest: () => latest,
        version: () => version,
        update: (change) => {
            const next = { ...latest };
            let changed = false;
            for (const key of LIVE_KEYS) {
                if (!Object.hasOwn(change, key))
                    continue;
                const value = change[key];
                if (!sameLiveData(next[key], value))
                    changed = true;
                if (value === undefined)
                    delete next[key];
                else
                    next[key] = value;
            }
            latest = next;
            if (!changed)
                return false;
            version += 1;
            for (const l of [...listeners])
                l();
            return true;
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => void listeners.delete(listener);
        },
        clear: () => listeners.clear(),
    };
}
