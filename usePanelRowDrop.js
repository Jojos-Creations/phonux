/**
 * The hook a view calls to drag a panel into the row from outside it.
 */
import * as React from 'react';
import { refused } from './panelManager.js';
import { RowDropContext } from './panelRowDrop.js';
import { panelRootOf } from './rowDom.js';
const OUTSIDE_ROW = {
    begin: () => false,
    update: () => { },
    end: () => refused('not-attached', 'no row drop is available outside a row'),
    cancel: () => { },
    follow: (_id, from, clientX, clientY) => (sidewaysOf(from, clientX, clientY) === null ? 'inside' : 'beside'),
};
/** Where the pointer is against the box of the panel holding `from`: null inside it (or with no box), else whether it is level with it. */
function sidewaysOf(from, x, y) {
    const box = panelRootOf(from)?.getBoundingClientRect();
    if (box === undefined || box.width <= 0 || (x >= box.left && x <= box.right))
        return null;
    return { level: y >= box.top && y <= box.bottom };
}
/**
 * The row drop of the PanelRow above: `begin`, `update`, `end` and `cancel`, the same object on every render. Outside a
 * row `begin` returns false and the rest do nothing.
 * @public
 */
export function usePanelRowDrop() {
    const controller = React.useContext(RowDropContext);
    return React.useMemo(() => {
        if (controller === undefined)
            return OUTSIDE_ROW;
        // Whether this hook's own drag is on; the handlers run outside React's render, so it is a closure, not state.
        let begun = false;
        const cancel = () => {
            controller.cancel();
            begun = false;
        };
        return {
            begin: (id, source = 'person') => {
                const ok = controller.begin(id, source);
                if (ok)
                    begun = true;
                return ok;
            },
            update: (x) => controller.update(x),
            end: () => {
                begun = false;
                return controller.end();
            },
            cancel,
            follow: (id, from, x, y) => {
                const side = sidewaysOf(from, x, y);
                if (side === null || !side.level) {
                    if (begun)
                        cancel();
                    return side === null ? 'inside' : 'beside';
                }
                if (!begun)
                    begun = controller.begin(id, 'person');
                if (begun)
                    controller.update(x);
                return 'row';
            },
        };
    }, [controller]);
}
