import * as React from 'react';
/**
 * Tab and Shift+Tab walk the panels in `readingIds` order although the DOM keeps them in the order they opened. Only the
 * hand-over between two panels is steered; inside a panel, and past the row's outer ends, the browser's own movement runs.
 */
export declare function steerTab(event: React.KeyboardEvent<HTMLElement>, row: HTMLElement, readingIds: readonly string[]): void;
/**
 * Focus reaching a panel's start or end sentinel. A Tab pressed inside an iframe never reaches the row's keydown handler, and
 * the browser's step out of the iframe lands on the sentinel next to it: coming from inside the panel, that hands focus over
 * to the drawn neighbour (or past the row's end); coming from outside, the sentinel is passed through to the panel's content.
 */
export declare function steerSentinel(event: React.FocusEvent<HTMLElement>, row: HTMLElement, readingIds: readonly string[]): void;
/** A Tab press the browser has not yet turned into a focus change; `shift` is its direction. */
export interface TabPress {
    readonly shift: boolean;
}
/**
 * Records a Tab press (no ctrl, alt or meta) from keydown until the focus change it causes has run. The record ends at the
 * next task, pointerdown, keydown or window blur, so focus that a script or a click causes is never mistaken for a Tab. Document-level
 * and capturing because focus can arrive from outside the row, where the row sees no key event.
 */
export declare function useTabPress(): React.RefObject<TabPress | null>;
/**
 * A Tab or Shift+Tab press that moves focus into the row from outside lands on the first (last) tabbable element in reading
 * order, not on the DOM-first (DOM-last) panel the browser would pick. Focus from anything else is left where it went.
 */
export declare function steerEntry(event: React.FocusEvent<HTMLElement>, row: HTMLElement, readingIds: readonly string[], tab: TabPress | null): void;
