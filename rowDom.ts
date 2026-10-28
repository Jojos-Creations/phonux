/**
 * The attributes the library draws on its own elements, published so a host's styles and listeners can find them by name
 * instead of by a string that a library change would break without a word.
 */

/**
 * On each row slot, holding the slot's rest offset in px from the row's start.
 * @public
 */
export const ROW_SLOT_ATTRIBUTE = 'data-row-slot';

/**
 * On each row slot, holding the engine id of the panel drawn in it: the id `PanelsAPI` calls take. Use {@link rowPanelIdOf}
 * to read it from any element inside the slot.
 * @public
 */
export const ROW_ID_ATTRIBUTE = 'data-row-id';

/**
 * On the row's scroll container, the element whose `scrollLeft` the row moves.
 * @public
 */
export const ROW_SCROLLER_ATTRIBUTE = 'data-row-scroller';

/**
 * On the strip that holds the row's frames, inside the scroll container: its box is the frames' band.
 * @public
 */
export const ROW_STRIP_ATTRIBUTE = 'data-row-strip';

/**
 * On a `WorkspaceColumn`'s outer box.
 * @public
 */
export const WORKSPACE_COLUMN_ATTRIBUTE = 'data-workspace-column';

/**
 * On each cell of a `WorkspaceColumn`: one workspace's page. A cell out of view is inert.
 * @public
 */
export const WORKSPACE_CELL_ATTRIBUTE = 'data-workspace-cell';

/**
 * On every `Panel`'s root element, the box that holds the header, the frame and the footer.
 * @public
 */
export const PANEL_ROOT_ATTRIBUTE = 'data-panel-root';

/**
 * On the workspace's undo-close toast, the notice with an Undo button that shows while `PanelsAPI.recentlyClosed` is non-null.
 * @public
 */
export const UNDO_CLOSE_TOAST_ATTRIBUTE = 'data-undo-close-toast';

/**
 * The engine id of the row slot that holds `target`, or null when it is not inside one.
 * @public
 */
export function rowPanelIdOf(target: EventTarget | null): string | null {
  return target instanceof Element ? (target.closest(`[${ROW_ID_ATTRIBUTE}]`)?.getAttribute(ROW_ID_ATTRIBUTE) ?? null) : null;
}

/**
 * The `Panel` root that holds `target`, or null when it is not inside one.
 * @public
 */
export function panelRootOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(`[${PANEL_ROOT_ATTRIBUTE}]`) : null;
}
