/**
 * The hook a view calls to drag a panel into the row from outside it.
 */
import * as React from 'react';
import type { PanelResult } from './panelManager.js';
import { refused } from './panelManager.js';
import { RowDropContext } from './panelRowDrop.js';

/**
 * The four calls of a drag that starts outside the row, such as the drag of a Workspace or History tile.
 * @public
 */
export interface PanelRowDrop {
  /**
   * Starts dragging the panel with this id. Returns false, changing nothing, when the workspace knows no such panel, the
   * panel is closed or still being added, it is the row's root, another row drop is in progress, or `source` is
   * `'person'` and the panel's `movable` is false. `source` defaults to `'person'`, as a drag is a person's gesture; a
   * call from code (`'code'`) is not limited by `movable`, as the handle verbs are not.
   */
  begin(id: string, source?: 'code' | 'person'): boolean;
  /**
   * Moves the drag to a pointer at `clientX`. The row parts by the rule a header drag uses, so the panels the pointer
   * has passed make room and a panel that cannot be crossed stops the drag; the row scrolls at its edges as a header
   * drag does. A panel that is parked or hidden shows a gap its own width at the place it would land. Does nothing
   * when no drag is in progress.
   */
  update(clientX: number): void;
  /**
   * Drops the panel where the last `update` pointed. A panel in view moves in one `move`; a parked or hidden one is
   * placed and shown in one update. Answers the refusal of that call, or `{ ok: true, changed: false }` when the
   * panel stays where it was.
   */
  end(): PanelResult;
  /** Ends the drag and leaves the row exactly as it was. Does nothing when no drag is in progress. */
  cancel(): void;
}

const OUTSIDE_ROW: PanelRowDrop = {
  begin: () => false,
  update: () => {},
  end: () => refused('not-attached', 'no row drop is available outside a row'),
  cancel: () => {},
};

/**
 * The row drop of the PanelRow above: `begin`, `update`, `end` and `cancel`, the same object on every render. Outside a
 * row `begin` returns false and the rest do nothing.
 * @public
 */
export function usePanelRowDrop(): PanelRowDrop {
  const controller = React.useContext(RowDropContext);
  return React.useMemo<PanelRowDrop>(
    () => (controller === undefined ? OUTSIDE_ROW : { begin: (id, source = 'person') => controller.begin(id, source), update: (x) => controller.update(x), end: () => controller.end(), cancel: () => controller.cancel() }),
    [controller],
  );
}
