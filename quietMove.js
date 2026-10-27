/**
 * Work the header menu does to a panel without the row reading it as a choice: its pin never scrolls the row, and the focus
 * it hands back to the move button does not snap the row onto that panel. Depth-counted, so nested calls stay quiet to the end.
 * @internal
 */
let depth = 0;
/** Runs `work` with the row quiet: no scroll follows a move, and focus moves nothing. */
export function quietly(work) {
    depth += 1;
    try {
        return work();
    }
    finally {
        depth -= 1;
    }
}
/** Whether the row is quiet: a call made inside `quietly` reads true for the whole of it. */
export function isQuietly() {
    return depth > 0;
}
/**
 * Focuses the move button of the row slot `rowId` once the header is back: a pin can drop the header slot for a render, so
 * the button is looked for over the next frames. Focus is taken only while nothing else holds it, so a person's own move is
 * not overridden.
 */
export function focusMoveWhenBack(rowId, frames = 10) {
    const step = (left) => {
        const button = [...document.querySelectorAll('[data-panel-move]')].find((el) => el.closest('[data-row-id]')?.dataset.rowId === rowId);
        if (button !== undefined) {
            const held = document.activeElement;
            if (held === null || held === document.body || !held.isConnected)
                quietly(() => button.focus({ preventScroll: true }));
            return;
        }
        if (left > 0)
            requestAnimationFrame(() => step(left - 1));
    };
    requestAnimationFrame(() => step(frames));
}
