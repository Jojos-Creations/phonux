/**
 * The read side of a workspace for components: hooks over the reader a row gives its template views. They answer
 * from the nearest PanelRow that was given a workspace and nothing outside one.
 */
import { useContext, useMemo, useSyncExternalStore } from 'react';
import { filterStates } from '../panelHandles.js';
import { PanelSlotContext } from '../panelSlotContext.js';
import { PanelViewContextValue } from '../panelViewContext.js';
const NO_SUBSCRIBE = () => () => { };
const EMPTY_SNAPSHOT = Object.freeze({ version: 0, status: 'detached', panels: Object.freeze([]) });
/**
 * The reader of every panel in the workspace of the PanelRow above, or undefined outside one.
 * @public
 */
export function useWorkspaceManager() {
    return useContext(PanelViewContextValue)?.manager;
}
/**
 * The workspace of the PanelRow above, as a view acts on it: `panels.get(key)` returns the operable handle of any panel
 * (close, show, hide, move, configure), `panels.addPanel` makes one, and the rest of the manager is there too. Inside a panel's
 * view, a panel its `addPanel` creates records that panel as its opener (`PanelState.openedBy`). It is the same object on every
 * render of one view and undefined outside a PanelRow that has a workspace. The workspace's own `dispose`, `update` and
 * `rename` are not part of it.
 * @public
 */
export function useWorkspace() {
    const context = useContext(PanelViewContextValue);
    const own = useContext(PanelSlotContext)?.id;
    return own === undefined || context?.workspaceFor === undefined ? context?.workspace : context.workspaceFor(own);
}
function useSnapshot() {
    const reader = useWorkspaceManager();
    const read = reader?.getSnapshot ?? (() => EMPTY_SNAPSHOT);
    return useSyncExternalStore(reader?.subscribe ?? NO_SUBSCRIBE, read, read);
}
/**
 * The state of every panel `f` keeps, re-read when the workspace changes. With no `f` it is the snapshot's own array,
 * the same one until something changes; empty outside a PanelRow that has a workspace.
 * @param f - What to keep; all panels when left out.
 * @public
 */
export function usePanelStates(f) {
    return filterStates(useSnapshot().panels, f);
}
function subscribeToPanel(reader, id) {
    return (l) => {
        let off = () => { };
        const own = reader.get(id);
        if (own !== undefined)
            off = own.subscribe(l);
        else {
            off = reader.subscribe(() => {
                const found = reader.get(id);
                if (found === undefined)
                    return;
                off();
                off = found.subscribe(l);
                l();
            });
        }
        return () => off();
    };
}
/**
 * The state of the panel with this id, re-read when it changes, or undefined when the workspace knows none. Only a
 * change to this panel re-renders the caller; a panel added later is picked up when it appears.
 * @param id - The panel's id.
 * @public
 */
export function usePanelState(id) {
    const reader = useWorkspaceManager();
    const subscribe = useMemo(() => (reader === undefined ? NO_SUBSCRIBE : subscribeToPanel(reader, id)), [reader, id]);
    const read = () => reader?.getSnapshot().panels.find((p) => p.id === id);
    return useSyncExternalStore(subscribe, read, read);
}
