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
