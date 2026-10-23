/**
 * The closed-pages list as plain functions over an array: no React, no storage. The array is ordered least recently
 * touched first, so the entry to evict is always at index 0.
 */
import type { ClosedPageEntry } from './hostApi.js';

/** Drops the least recently touched entries from the front until at most `limit` remain. */
export function trimToLimit(entries: readonly ClosedPageEntry[], limit: number): readonly ClosedPageEntry[] {
  return entries.length > limit ? entries.slice(entries.length - limit) : entries;
}

/** Adds `entry` as the most recently touched one. An entry with the same id is replaced, not duplicated. */
export function addClosedPage(entries: readonly ClosedPageEntry[], entry: ClosedPageEntry, limit: number): readonly ClosedPageEntry[] {
  return trimToLimit([...entries.filter((e) => e.id !== entry.id), entry], limit);
}

/** Moves the entry with `id` to the most recently touched place. Returns `entries` itself when nothing moves. */
export function touchClosedPage(entries: readonly ClosedPageEntry[], id: string): readonly ClosedPageEntry[] {
  const at = entries.findIndex((e) => e.id === id);
  if (at < 0 || at === entries.length - 1) return entries;
  return [...entries.slice(0, at), ...entries.slice(at + 1), entries[at] as ClosedPageEntry];
}

/**
 * Merges what storage returned with what was added before storage answered. A stored entry that the local list also
 * holds is dropped from the stored side, so each id appears once and the local order wins.
 */
export function mergeClosedPages(stored: readonly ClosedPageEntry[], local: readonly ClosedPageEntry[]): readonly ClosedPageEntry[] {
  const localIds = new Set(local.map((e) => e.id));
  return [...stored.filter((e) => !localIds.has(e.id)), ...local];
}

/** Groups entries by the calendar day of `closedAt` (its UTC `YYYY-MM-DD`), newest day first and newest entry first within a day. */
export interface ClosedPagesDayGroup {
  /** The UTC calendar day, `YYYY-MM-DD`. */
  readonly date: string;
  /** The day's entries, newest first. */
  readonly entries: readonly ClosedPageEntry[];
}

/** Filters entries by a case-insensitive substring match on title or url, then groups them by day. A blank query matches everything. */
export function groupClosedPages(entries: readonly ClosedPageEntry[], query: string): readonly ClosedPagesDayGroup[] {
  const q = query.trim().toLowerCase();
  const matches = q === '' ? entries : entries.filter((e) => e.title.toLowerCase().includes(q) || (e.url ?? '').toLowerCase().includes(q));
  const byDay = new Map<string, ClosedPageEntry[]>();
  for (const e of matches) {
    const date = e.closedAt.slice(0, 10);
    const group = byDay.get(date);
    if (group) group.push(e);
    else byDay.set(date, [e]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, dayEntries]) => ({
      date,
      entries: [...dayEntries].sort((a, b) => (a.closedAt < b.closedAt ? 1 : a.closedAt > b.closedAt ? -1 : 0)),
    }));
}
