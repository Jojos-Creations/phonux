/** The tiles per row a `WorkspacePanel` uses when `tileCounts` leaves a size out. */
export const DEFAULT_WORKSPACE_TILE_COUNTS = { small: 5, medium: 4, large: 3 };
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
 * Packs tiles into rows of `columns` columns, in the order given: a tile that does not fit in what is left of a row starts
 * the next row, and the row it left is stretched. No tile moves ahead of another to fill a hole. A tile wider than
 * `columns` takes a row of its own, whose `used` is then more than `columns`; a single-row strip reads the first row and
 * shows none of it when it is that wide.
 * @param spans - Each tile's width in columns: 1 for a phone page, 2 for a Fold page.
 * @param columns - The columns a row holds: the grid's column count, or the phones that fit across a strip.
 * @throws RangeError when `columns` is not a positive integer, or a span is not a positive integer.
 * @public
 */
export function packWorkspaceTiles(spans, columns) {
    if (!Number.isInteger(columns) || columns < 1)
        throw new RangeError(`WorkspacePanel: the column count must be a positive integer, got ${String(columns)}`);
    const rows = [];
    let start = 0;
    let used = 0;
    spans.forEach((span, i) => {
        if (!Number.isInteger(span) || span < 1)
            throw new RangeError(`WorkspacePanel: a tile span must be a positive integer, got ${String(span)}`);
        if (used > 0 && used + span > columns) {
            rows.push({ start, end: i, used, stretched: used < columns });
            start = i;
            used = 0;
        }
        used += span;
    });
    if (spans.length > start)
        rows.push({ start, end: spans.length, used, stretched: false });
    return rows;
}
/**
 * A tile's picture ratio: `span` phone widths by one phone height. A tile wider than the grid's columns draws at this
 * ratio, so it shows the whole panel shorter instead of cropped.
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
