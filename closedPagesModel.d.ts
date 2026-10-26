/**
 * The closed-pages list as plain functions over an array: no React, no storage. The array is ordered least recently
 * touched first, so the entry to evict is always at index 0.
 */
import type { ClosedPageEntry } from './hostApi.js';
/** Drops the least recently touched entries from the front until at most `limit` remain; no limit keeps them all. */
export declare function trimToLimit(entries: readonly ClosedPageEntry[], limit: number | undefined): readonly ClosedPageEntry[];
/** Adds `entry` as the most recently touched one. An entry with the same id is replaced, not duplicated. */
export declare function addClosedPage(entries: readonly ClosedPageEntry[], entry: ClosedPageEntry, limit: number | undefined): readonly ClosedPageEntry[];
/** Moves the entry with `id` to the most recently touched place. Returns `entries` itself when nothing moves. */
export declare function touchClosedPage(entries: readonly ClosedPageEntry[], id: string): readonly ClosedPageEntry[];
/**
 * Merges what storage returned with what was added before storage answered. A stored entry that the local list also
 * holds is dropped from the stored side, so each id appears once and the local order wins.
 */
export declare function mergeClosedPages(stored: readonly ClosedPageEntry[], local: readonly ClosedPageEntry[]): readonly ClosedPageEntry[];
/** Groups entries by the calendar day of `closedAt` (its UTC `YYYY-MM-DD`), newest day first and newest entry first within a day. */
export interface ClosedPagesDayGroup {
    /** The UTC calendar day, `YYYY-MM-DD`. */
    readonly date: string;
    /** The day's entries, newest first. */
    readonly entries: readonly ClosedPageEntry[];
}
/** Filters entries by a case-insensitive substring match on title or url, then groups them by day. A blank query matches everything. */
export declare function groupClosedPages(entries: readonly ClosedPageEntry[], query: string): readonly ClosedPagesDayGroup[];
/** Keeps the first `count` entries across `groups` in order, dropping a group left empty. */
export declare function firstClosedPages(groups: readonly ClosedPagesDayGroup[], count: number): readonly ClosedPagesDayGroup[];
