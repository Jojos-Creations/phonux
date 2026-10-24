/**
 * Whether `p` is drawn in the row: an always-shown column, or a parkable entry while it is live, and never the
 * marker. Every reader of presence goes through this one function, so a marker excluded here is excluded everywhere.
 * @internal
 */
export const isPresent = (p) => p.marker !== true && (!p.collapsible || p.live);
/**
 * A row entry narrowed to what a view may see. Every place that hands a panel to a view goes through this one
 * function, so no view ever sees a layout field; `slots` is forwarded and the row adds the drawn `size`.
 * @internal
 */
export const summarisePanel = ({ id, key, url, title, live, params, slots, settings }) => ({
    id: key ?? id, url, title, live, params,
    // Absent, not undefined, when the record lacks them: a summary never lists a key its record never had.
    ...(slots !== undefined ? { slots } : {}),
    ...(settings !== undefined ? { maxSlots: settings.maxSlots } : {}),
});
