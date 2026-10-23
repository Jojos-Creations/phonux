/** The one place that turns a name a caller gives into the entry it means: a panel's key, which is its public id, or the counter id the entry held before the key was the only id. */
import { panelKey } from './panelSettings.js';
/** The release that stops resolving a counter id; the warning and the CHANGELOG name it. */
export const COUNTER_ID_REMOVED_IN = '0.3.0';
const warned = new Set();
/** Logs once per counter id that the id a caller gave is the old one and names the key to use; silent in production and where `process` is undefined. @internal */
export function warnCounterId(counter, key) {
    if (typeof process === 'undefined' || process.env.NODE_ENV === 'production' || warned.has(counter))
        return;
    warned.add(counter);
    console.warn(`phonux: '${counter}' is a panel's old counter id; the panel's id is its key '${key}', and the counter id stops resolving in ${COUNTER_ID_REMOVED_IN}.`);
}
/** The entry whose key is `name`, else the entry whose counter id is `name` (with a development warning when that differs from its key); undefined when none. @internal */
export function entryNamed(entries, name) {
    const byKey = entries.find((e) => panelKey(e) === name);
    if (byKey !== undefined)
        return byKey;
    const byCounter = entries.find((e) => e.id === name);
    if (byCounter !== undefined)
        warnCounterId(name, panelKey(byCounter));
    return byCounter;
}
