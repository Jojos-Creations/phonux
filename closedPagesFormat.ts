/**
 * The day heading of one group. It is parsed and formatted as UTC, the zone the group key was sliced from, so a
 * west-of-UTC viewer does not see the heading slip a day.
 */

/** The heading for a group key (`YYYY-MM-DD`), e.g. "Sep 14, 2026", in the viewer's locale. */
export function formatClosedPagesDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
