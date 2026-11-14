/** What `minWorkspaceWidth` reads. Every width is in px. @public */
export interface MinWorkspaceWidthInput {
    /** The phone width a slot is drawn at. Every fixed column is priced at this width, as `PanelsAPI.maxFitPanels` prices it. */
    phoneWidth: number;
    /** How many fixed (non-collapsible) columns the row holds, such as History: a whole number, 0 or more. */
    fixedColumnCount: number;
    /**
     * How many phone slots must fit beside the fixed columns: a whole number, 1 or more.
     * @defaultValue 2
     */
    phoneSlots?: number;
    /**
     * The width of one tablet panel that must fit beside the fixed columns in place of the phone slots, when it is wider.
     * A value of 0 omits the tablet.
     * @defaultValue 768
     */
    tabletWidth?: number;
    /**
     * The row gap: between two columns and at each edge of the row.
     * @defaultValue `ROW_GAP` (16)
     */
    gap?: number;
}
/**
 * The narrowest row container, in whole px, at which every fixed column plus `phoneSlots` phone slots fit side by side,
 * or every fixed column plus one tablet panel when that is wider.
 *
 * @remarks
 * The row is one gap at each edge, each fixed column and the gap after it, then the wider of the phone slots (with a gap
 * between each two) and the tablet, rounded up:
 * `gap + F x (phoneWidth + gap) + max(N x phoneWidth + (N - 1) x gap, tabletWidth) + gap`,
 * with F the fixed columns and N the phone slots. At this width the row fits that many phones without parking
 * one and draws a tablet panel at its full width; one pixel less fits fewer. The value is the row container's width, so
 * a host whose window is wider than its row adds the difference. A two-slot panel is exactly two phone slots wide.
 *
 * @example
 * History alone at the default phone (390) and gap (16): `minWorkspaceWidth({ phoneWidth: 390, fixedColumnCount: 1 })`
 * is 1234.
 *
 * @throws RangeError when `phoneWidth` is not above 0, `fixedColumnCount` is not a whole number of 0 or more, or
 * `phoneSlots` is not a whole number of 1 or more.
 * @public
 */
export declare function minWorkspaceWidth(input: MinWorkspaceWidthInput): number;
