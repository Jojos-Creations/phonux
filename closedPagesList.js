import * as React from 'react';
import { addClosedPage, mergeClosedPages, touchClosedPage, trimToLimit } from './closedPagesModel.js';
/**
 * A closed-pages list backed by the host's storage. Each call of `read` and `write` goes to `storage`, and nothing is
 * kept outside the component's state.
 * @throws RangeError when `limit` is given and is not a positive integer.
 * @example
 * ```ts
 * const closed = useClosedPages({ storage: closedPagesStorage });
 * // in a panel's onPanelsClosed: closed.add({ id, title, url, closedAt })
 * ```
 * @public
 */
export function useClosedPages({ storage, limit }) {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
        throw new RangeError(`useClosedPages: limit must be a positive integer, got ${String(limit)}`);
    const [entries, setEntries] = React.useState([]);
    const [loaded, setLoaded] = React.useState(false);
    const latest = React.useRef([]);
    const current = React.useRef({ storage, limit });
    current.current = { storage, limit };
    // Writes wait for the read: writing before it lands would overwrite the saved log with only what was added since mount.
    const writable = React.useRef(false);
    const queue = React.useRef(Promise.resolve());
    const commit = React.useCallback((next) => {
        latest.current = next;
        setEntries(next);
        if (!writable.current)
            return;
        const { storage: target } = current.current;
        queue.current = queue.current
            .then(() => target.write(next))
            .catch((e) => {
            console.error(`useClosedPages: could not save the closed pages: ${e instanceof Error ? e.message : String(e)}`);
        });
    }, []);
    React.useEffect(() => {
        let live = true;
        current.current.storage.read().then((stored) => {
            if (!live)
                return;
            writable.current = true;
            setLoaded(true);
            const merged = trimToLimit(mergeClosedPages(stored, latest.current), current.current.limit);
            // Nothing local to save: the stored log is already the list, so loading does not write it back.
            if (latest.current.length === 0) {
                latest.current = merged;
                setEntries(merged);
            }
            else
                commit(merged);
        }, (e) => {
            if (!live)
                return;
            setLoaded(true);
            console.error(`useClosedPages: could not read the closed pages, so none will be saved this session: ${e instanceof Error ? e.message : String(e)}`);
        });
        return () => {
            live = false;
        };
    }, [commit]);
    const add = React.useCallback((entry) => commit(addClosedPage(latest.current, entry, current.current.limit)), [commit]);
    const touch = React.useCallback((id) => {
        const next = touchClosedPage(latest.current, id);
        if (next !== latest.current)
            commit(next);
    }, [commit]);
    return React.useMemo(() => ({ loaded, entries, add, touch }), [loaded, entries, add, touch]);
}
