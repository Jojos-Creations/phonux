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
}
/**
 * The closed pages as a searchable list grouped by the day they closed, newest first. Choosing a row touches its entry
 * in the list and calls `onReopen`. Draws its own frame, so it is used as the body of a panel. Its text comes from the
 * host's `labels`.
 * @public
 */
export declare function ClosedPagesPanel({ list, onReopen, className }: ClosedPagesPanelProps): React.ReactElement;
