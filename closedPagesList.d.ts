import type { ClosedPageEntry } from './hostApi.js';
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
    /** The entries, least recently touched first. With a limit, the first entry is the next one to be evicted. */
    readonly entries: readonly ClosedPageEntry[];
    /**
     * Records a closed page. With a limit, at the limit the least recently touched entry is dropped. An entry whose `id` is
     * already in the list replaces that entry and counts as touched.
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
    /** The most entries the list keeps; past it the least recently touched are dropped. Absent, the list keeps every entry. When present, must be a positive integer. */
    readonly limit?: number;
}
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
export declare function useClosedPages({ storage, limit }: UseClosedPagesOptions): ClosedPagesList;
