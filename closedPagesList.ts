import * as React from 'react';
import type { ClosedPageEntry } from './hostApi.js';
import { addClosedPage, mergeClosedPages, touchClosedPage, trimToLimit } from './closedPagesModel.js';

/**
 * Where the host keeps the closed-pages log. The library reads it once when the list mounts and writes the whole list
 * after every change; it keeps no copy of its own.
 * @public
 */
export interface ClosedPagesStorage {
  /** Resolves to the saved entries, least recently touched first. Rejecting leaves the list empty and makes it write nothing, so the saved log is never overwritten by a failed read. */
  read(): Promise<readonly ClosedPageEntry[]>;
  /** Saves the whole list, least recently touched first. A rejection is reported to the console and the in-memory list keeps the change. */
  write(entries: readonly ClosedPageEntry[]): Promise<void>;
}

/**
 * The closed-pages list a host holds: what it contains and how it changes.
 * @public
 */
export interface ClosedPagesList {
  /** Whether the saved log has been read. Until it is, `entries` holds only what was added since mount. */
  readonly loaded: boolean;
  /** The entries, least recently touched first. The first entry is the next one to be evicted at the limit. */
  readonly entries: readonly ClosedPageEntry[];
  /**
   * Records a closed page. At the limit the least recently touched entry is dropped. An entry whose `id` is already in
   * the list replaces that entry and counts as touched.
   */
  add(entry: ClosedPageEntry): void;
  /** Marks the entry with `id` as the most recently touched, so it is evicted last. Does nothing for an unknown id. */
  touch(id: string): void;
}

/**
 * The options of `useClosedPages`.
 * @public
 */
export interface UseClosedPagesOptions {
  /** Where the log is saved and read. */
  readonly storage: ClosedPagesStorage;
  /** The most entries the list keeps. The host chooses it; there is no default. Must be a positive integer. */
  readonly limit: number;
}

/**
 * A closed-pages list backed by the host's storage. Each call of `read` and `write` goes to `storage`, and nothing is
 * kept outside the component's state.
 * @throws RangeError when `limit` is not a positive integer.
 * @example
 * ```ts
 * const closed = useClosedPages({ storage: closedPagesStorage, limit: 50 });
 * // in a panel's onPanelsClosed: closed.add({ id, title, url, closedAt })
 * ```
 * @public
 */
export function useClosedPages({ storage, limit }: UseClosedPagesOptions): ClosedPagesList {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`useClosedPages: limit must be a positive integer, got ${String(limit)}`);
  const [entries, setEntries] = React.useState<readonly ClosedPageEntry[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const latest = React.useRef<readonly ClosedPageEntry[]>([]);
  const current = React.useRef({ storage, limit });
  current.current = { storage, limit };
  // Writes wait for the read: writing before it lands would overwrite the saved log with only what was added since mount.
  const writable = React.useRef(false);
  const queue = React.useRef<Promise<void>>(Promise.resolve());

  const commit = React.useCallback((next: readonly ClosedPageEntry[]): void => {
    latest.current = next;
    setEntries(next);
    if (!writable.current) return;
    const { storage: target } = current.current;
    queue.current = queue.current
      .then(() => target.write(next))
      .catch((e: unknown) => {
        console.error(`useClosedPages: could not save the closed pages: ${e instanceof Error ? e.message : String(e)}`);
      });
  }, []);

  React.useEffect(() => {
    let live = true;
    current.current.storage.read().then(
      (stored) => {
        if (!live) return;
        writable.current = true;
        setLoaded(true);
        const merged = trimToLimit(mergeClosedPages(stored, latest.current), current.current.limit);
        // Nothing local to save: the stored log is already the list, so loading does not write it back.
        if (latest.current.length === 0) {
          latest.current = merged;
          setEntries(merged);
        } else commit(merged);
      },
      (e: unknown) => {
        if (!live) return;
        setLoaded(true);
        console.error(`useClosedPages: could not read the closed pages, so none will be saved this session: ${e instanceof Error ? e.message : String(e)}`);
      },
    );
    return () => {
      live = false;
    };
  }, [commit]);

  const add = React.useCallback(
    (entry: ClosedPageEntry): void => commit(addClosedPage(latest.current, entry, current.current.limit)),
    [commit],
  );
  const touch = React.useCallback(
    (id: string): void => {
      const next = touchClosedPage(latest.current, id);
      if (next !== latest.current) commit(next);
    },
    [commit],
  );

  return React.useMemo(() => ({ loaded, entries, add, touch }), [loaded, entries, add, touch]);
}
