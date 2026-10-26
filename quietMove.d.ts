/** Runs `work` with the row quiet: no scroll follows a move, and focus moves nothing. */
export declare function quietly<T>(work: () => T): T;
/** Whether the row is quiet: a call made inside `quietly` reads true for the whole of it. */
export declare function isQuietly(): boolean;
/**
 * Focuses the move button of the row slot `rowId` once the header is back: a pin can drop the header slot for a render, so
 * the button is looked for over the next frames. Focus is taken only while nothing else holds it, so a person's own move is
 * not overridden.
 */
export declare function focusMoveWhenBack(rowId: string, frames?: number): void;
