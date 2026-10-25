/**
 * The hook a view calls to drag a panel into the row from outside it.
 */
import * as React from 'react';
import { refused } from './panelManager.js';
import { RowDropContext } from './panelRowDrop.js';
const OUTSIDE_ROW = {
    begin: () => false,
    update: () => { },
    end: () => refused('not-attached', 'no row drop is available outside a row'),
    cancel: () => { },
};
/**
 * The row drop of the PanelRow above: `begin`, `update`, `end` and `cancel`, the same object on every render. Outside a
 * row `begin` returns false and the rest do nothing.
 * @public
 */
export function usePanelRowDrop() {
    const controller = React.useContext(RowDropContext);
    return React.useMemo(() => (controller === undefined ? OUTSIDE_ROW : { begin: (id, source = 'person') => controller.begin(id, source), update: (x) => controller.update(x), end: () => controller.end(), cancel: () => controller.cancel() }), [controller]);
}
