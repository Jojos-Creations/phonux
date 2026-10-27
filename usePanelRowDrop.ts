/**
 * The hook a view calls to drag a panel into the row from outside it.
 */
import * as React from 'react';
import type { PanelResult } from './panelManager.js';
import { refused } from './panelManager.js';
import { RowDropContext } from './panelRowDrop.js';
import { panelRootOf } from './rowDom.js';

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
  /**
   * Follows a drag of panel `id` that began inside another panel, such as a tile dragged out of a list panel: `from` is any element
   * inside that panel (the pressed element). While the pointer is inside that panel's box nothing happens and the answer is
   * `'inside'`. Once the pointer leaves the box sideways and is level with it, the drag begins if it has not and follows the pointer:
   * `'row'`. Sideways but above or below the box, or back inside, the drag is cancelled: `'beside'` or `'inside'`. Pair it with `end`
   * on release (which drops only when the answer was `'row'`) and `cancel`.
   */
  follow(id: string, from: Element | null, clientX: number, clientY: number): 'inside' | 'row' | 'beside';
}

const OUTSIDE_ROW: PanelRowDrop = {
  begin: () => false,
  update: () => {},
  end: () => refused('not-attached', 'no row drop is available outside a row'),
  cancel: () => {},
  follow: (_id, from, clientX, clientY) => (sidewaysOf(from, clientX, clientY) === null ? 'inside' : 'beside'),
};

/** Where the pointer is against the box of the panel holding `from`: null inside it (or with no box), else whether it is level with it. */
function sidewaysOf(from: Element | null, x: number, y: number): { level: boolean } | null {
  const box = panelRootOf(from)?.getBoundingClientRect();
  if (box === undefined || box.width <= 0 || (x >= box.left && x <= box.right)) return null;
  return { level: y >= box.top && y <= box.bottom };
}

/**
 * The row drop of the PanelRow above: `begin`, `update`, `end` and `cancel`, the same object on every render. Outside a
 * row `begin` returns false and the rest do nothing.
 * @public
 */
export function usePanelRowDrop(): PanelRowDrop {
  const controller = React.useContext(RowDropContext);
  return React.useMemo<PanelRowDrop>(
    () => {
      if (controller === undefined) return OUTSIDE_ROW;
      // Whether this hook's own drag is on; the handlers run outside React's render, so it is a closure, not state.
      let begun = false;
      const cancel = (): void => {
        if (begun) controller.cancel();
        begun = false;
      };
      return {
        begin: (id, source = 'person') => (begun = controller.begin(id, source)),
        update: (x) => controller.update(x),
        end: () => {
          begun = false;
          return controller.end();
        },
        cancel,
        follow: (id, from, x, y) => {
          const side = sidewaysOf(from, x, y);
          if (side === null || !side.level) {
            cancel();
            return side === null ? 'inside' : 'beside';
          }
          if (!begun) begun = controller.begin(id, 'person');
          if (begun) controller.update(x);
          return 'row';
        },
      };
    },
    [controller],
  );
}
