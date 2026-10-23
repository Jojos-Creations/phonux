import * as React from 'react';
import PanelFrame from './PanelFrame.js';
import { resolveLabels } from './labels.js';
import { useOptionalHost, type ClosedPageEntry } from './hostApi.js';
import type { ClosedPagesList } from './closedPagesList.js';
import { groupClosedPages } from './closedPagesModel.js';
import { formatClosedPagesDay } from './closedPagesFormat.js';

/**
 * The props of `ClosedPagesPanel`.
 * @public
 */
export interface ClosedPagesPanelProps {
  /** The list to show, from `useClosedPages`. */
  readonly list: ClosedPagesList;
  /** Called with the entry the person chose. The list has already marked it as touched when this runs. */
  readonly onReopen: (entry: ClosedPageEntry) => void;
  /** A class name for the panel's frame, for a host that styles the body. The panel draws no padding, scrolling or sizes of its own. */
  readonly className?: string;
}

/**
 * The closed pages as a searchable list grouped by the day they closed, newest first. Choosing a row touches its entry
 * in the list and calls `onReopen`. Draws its own frame, so it is used as the body of a panel. Its text comes from the
 * host's `labels`.
 * @public
 */
export function ClosedPagesPanel({ list, onReopen, className }: ClosedPagesPanelProps): React.ReactElement {
  const labels = resolveLabels(useOptionalHost()?.labels);
  const [query, setQuery] = React.useState('');
  const groups = groupClosedPages(list.entries, query);
  const reopen = (entry: ClosedPageEntry): void => {
    list.touch(entry.id);
    onReopen(entry);
  };
  return (
    <PanelFrame data-closed-pages="" className={className}>
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={labels.closedPagesSearch} aria-label={labels.closedPagesSearch} />
      {!list.loaded ? (
        <div>{labels.closedPagesLoading}</div>
      ) : groups.length === 0 ? (
        <div data-closed-pages-empty="">{list.entries.length === 0 ? labels.closedPagesEmpty : labels.closedPagesNoMatches}</div>
      ) : (
        groups.map((group) => (
          <section key={group.date} data-closed-pages-day={group.date}>
            <h3>{formatClosedPagesDay(group.date)}</h3>
            <ul>
              {group.entries.map((entry) => (
                <li key={entry.id} data-closed-pages-row="">
                  <button type="button" onClick={() => reopen(entry)}>
                    <span>{entry.title === '' ? labels.closedPagesUntitled : entry.title}</span>
                    {entry.url !== undefined && entry.url !== '' && <span>{entry.url}</span>}
                    <time dateTime={entry.closedAt}>{new Date(entry.closedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </PanelFrame>
  );
}
