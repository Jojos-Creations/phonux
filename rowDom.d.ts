/**
 * The attributes the library draws on its own elements, published so a host's styles and listeners can find them by name
 * instead of by a string that a library change would break without a word.
 */
/**
 * On each row slot, holding the slot's rest offset in px from the row's start.
 * @public
 */
export declare const ROW_SLOT_ATTRIBUTE = "data-row-slot";
/**
 * On each row slot, holding the engine id of the panel drawn in it: the id `PanelsAPI` calls take. Use {@link rowPanelIdOf}
 * to read it from any element inside the slot.
 * @public
 */
export declare const ROW_ID_ATTRIBUTE = "data-row-id";
/**
 * On the row's scroll container, the element whose `scrollLeft` the row moves.
 * @public
 */
export declare const ROW_SCROLLER_ATTRIBUTE = "data-row-scroller";
/**
 * On the strip that holds the row's frames, inside the scroll container: its box is the frames' band.
 * @public
 */
export declare const ROW_STRIP_ATTRIBUTE = "data-row-strip";
/**
 * On a `WorkspaceColumn`'s outer box.
 * @public
 */
export declare const WORKSPACE_COLUMN_ATTRIBUTE = "data-workspace-column";
/**
 * On each cell of a `WorkspaceColumn`: one workspace's page. A cell out of view is inert.
 * @public
 */
export declare const WORKSPACE_CELL_ATTRIBUTE = "data-workspace-cell";
/**
 * On every `Panel`'s root element, the box that holds the header, the frame and the footer.
 * @public
 */
export declare const PANEL_ROOT_ATTRIBUTE = "data-panel-root";
/**
 * On the workspace's undo-close toast, the notice with an Undo button that shows while `PanelsAPI.recentlyClosed` is non-null.
 * @public
 */
export declare const UNDO_CLOSE_TOAST_ATTRIBUTE = "data-undo-close-toast";
/**
 * The engine id of the row slot that holds `target`, or null when it is not inside one.
 * @public
 */
export declare function rowPanelIdOf(target: EventTarget | null): string | null;
/**
 * The `Panel` root that holds `target`, or null when it is not inside one.
 * @public
 */
export declare function panelRootOf(target: EventTarget | null): HTMLElement | null;
/** On the element Embla is rooted on: the window that shows whole slots. @internal */
export declare const EMBLA_WINDOW_ATTRIBUTE = "data-row-embla-window";
/** The custom properties a row slot carries: how far in from the slot's left and right its header and footer lie, in px. @internal */
export declare const CHROME_CUT_LEFT_PROPERTY = "--phonux-chrome-cut-left";
/** @internal */
export declare const CHROME_CUT_RIGHT_PROPERTY = "--phonux-chrome-cut-right";
/** A header's or footer's left and right offsets, plus `inset` px: the row's cut where the slot carries one, else just `inset`. @internal */
export declare const chromeCutSides: (inset?: number) => {
    left: string;
    right: string;
};
