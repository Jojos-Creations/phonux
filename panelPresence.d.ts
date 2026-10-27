/**
 * Why a view is or is not drawn: `shown` (drawn in the window), `exiting` (drawn, and on its way out for a reason
 * the other values do not name), `closing` (a person or code is closing it), `parked` (it is parked and leaves the
 * row) or `scrolledAway` (the row is scrolled so its slot is outside the window).
 * @public
 */
export type PanelPresenceReason = 'shown' | 'exiting' | 'closing' | 'parked' | 'scrolledAway';
/**
 * What a view reads of its own presence. `shown` is true for `shown` and `exiting`; when more than one reason holds,
 * `reason` names the first of `closing`, `parked`, `scrolledAway`, `exiting`, `shown` that does.
 * @public
 */
export interface PanelPresence {
    /** Whether the view is drawn in the window now. */
    readonly shown: boolean;
    /** The reason, as {@link PanelPresenceReason}. */
    readonly reason: PanelPresenceReason;
}
/**
 * The presence of the panel this view draws, read-only and live: it re-renders the view when the reason changes. Outside
 * a row the reason is `shown`, since nothing can close, park or scroll a view that no row draws.
 * @public
 */
export declare function usePanelPresence(): PanelPresence;
