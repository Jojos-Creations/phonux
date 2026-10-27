import * as React from 'react';
import { type ClosedPageEntry } from './hostApi.js';
import type { ClosedPagesList } from './closedPagesList.js';
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
    /**
     * How many rows to show at first, newest first; a Show more button under the list shows this many more each press.
     * Search matches every entry, shown or not, and a new search starts again at this many. Absent, every row is shown.
     * When present, must be a positive integer.
     */
    readonly pageSize?: number;
    /**
     * The search text, for a host that draws its own search field elsewhere, such as in the panel's footer. Given, the
     * panel draws no search field and filters by it; absent, the panel draws its own field.
     */
    readonly query?: string;
}
/**
 * The closed pages as a searchable list grouped by the day they closed, newest first. Choosing a row touches its entry
 * in the list and calls `onReopen`. Draws its own frame, so it is used as the body of a panel. Its text comes from the
 * host's `labels`.
 * @throws RangeError when `pageSize` is given and is not a positive integer.
 * @public
 */
export declare function ClosedPagesPanel({ list, onReopen, className, pageSize, query: hostQuery }: ClosedPagesPanelProps): React.ReactElement;
