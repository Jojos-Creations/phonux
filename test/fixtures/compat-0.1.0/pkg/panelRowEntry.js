/**
 * A row entry narrowed to what a view may see. Every place that hands a panel to a view goes through this one
 * function, so no view ever sees a layout field; `formFactor` and `size` are forwarded.
 * @public
 */
export const summarisePanel = ({ id, url, title, live, locked, params, formFactor, size }) => ({
    id, url, title, live, locked, params,
    // Absent, not undefined, when the record lacks them: a summary never lists a key its record never had.
    ...(formFactor !== undefined ? { formFactor } : {}),
    ...(size !== undefined ? { size } : {}),
});
