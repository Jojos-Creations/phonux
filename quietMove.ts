/**
 * Work the header menu does to a panel without the row reading it as a choice: its pin never scrolls the row, and the focus
 * it hands back to the move button does not snap the row onto that panel. Depth-counted, so nested calls stay quiet to the end.
 * @internal
 */
let depth = 0;

/** Runs `work` with the row quiet: no scroll follows a move, and focus moves nothing. */
export function quietly<T>(work: () => T): T {
  depth += 1;
  try {
    return work();
  } finally {
    depth -= 1;
  }
}

/** Whether the row is quiet: a call made inside `quietly` reads true for the whole of it. */
export function isQuietly(): boolean {
  return depth > 0;
}
