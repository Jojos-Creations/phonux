/** The tiles per row a `WorkspacePanel` uses when `tileCounts` leaves a size out. */
export const DEFAULT_WORKSPACE_TILE_COUNTS = { small: 5, medium: 4, large: 3 };
/**
 * The groups that have at least one tile, in the order pinned, viewing, hidden. A pinned panel is in the pinned group only,
 * whatever its live state; each group keeps the order its tiles were given in.
 */
export function workspaceGroups(tiles, labels) {
    const groups = [
        { key: 'pinned', label: labels.workspacePinned, tiles: tiles.filter((t) => t.pinned) },
        { key: 'viewing', label: labels.workspaceViewing, tiles: tiles.filter((t) => !t.pinned && t.live) },
        { key: 'hidden', label: labels.workspaceHidden, tiles: tiles.filter((t) => !t.pinned && !t.live) },
    ];
    return groups.filter((group) => group.tiles.length > 0);
}
/** The tiles whose title holds `text`, ignoring case and outer spaces; blank text keeps them all. */
export function filterWorkspaceTiles(tiles, text) {
    const needle = text.trim().toLocaleLowerCase();
    if (needle === '')
        return tiles;
    return tiles.filter((tile) => tile.title.toLocaleLowerCase().includes(needle));
}
/**
 * The ids in the order a drop of `movedId` onto `overId` leaves them: `movedId` takes `overId`'s place and the ids between
 * the two shift one place, as a sortable list does. Unchanged when either id is absent or they are the same.
 */
export function reorderWorkspaceIds(ids, movedId, overId) {
    const from = ids.indexOf(movedId);
    const to = ids.indexOf(overId);
    const next = [...ids];
    if (from < 0 || to < 0 || from === to)
        return next;
    next.splice(from, 1);
    next.splice(to, 0, movedId);
    return next;
}
/**
 * The grid columns a tile spans: its panel's width in slots, capped at the grid's column count, and 1 when the entry gives no slots.
 * @throws RangeError when `slots` is not a positive integer.
 */
export function workspaceTileSpan(slots, columns) {
    if (slots === undefined)
        return 1;
    if (!Number.isInteger(slots) || slots < 1)
        throw new RangeError(`WorkspacePanel: an entry's slots must be a positive integer, got ${String(slots)}`);
    return Math.min(slots, columns);
}
/**
 * A tile's picture ratio: `span` phone widths by one phone height, so a tile of any span in a row has the same height as a
 * one-column tile and the row lines up.
 */
export function workspaceTileRatio(span, size) {
    return `${span * size.width} / ${size.height}`;
}
/** The title a tile shows: the panel's title, else its url, else `untitled`. */
export function workspaceTileTitle(title, url, untitled) {
    if (title !== undefined && title.trim() !== '')
        return title;
    if (url !== undefined && url !== '')
        return url;
    return untitled;
}
/**
 * The tiles per row at `size`, from the defaults overlaid with `counts`.
 * @throws RangeError when the count for `size` is not a positive integer.
 */
export function workspaceTileColumns(size, counts) {
    const n = counts?.[size] ?? DEFAULT_WORKSPACE_TILE_COUNTS[size];
    if (!Number.isInteger(n) || n < 1)
        throw new RangeError(`WorkspacePanel: the ${size} tile count must be a positive integer, got ${String(n)}`);
    return n;
}
