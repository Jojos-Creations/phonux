import type { PanelId } from '../panelSettings.js';
import type { ListFilter, PanelReader, PanelState } from '../panelTemplate.js';
import type { ViewWorkspace } from '../workspaceCore.js';
/**
 * The reader of every panel in the workspace of the PanelRow above, or undefined outside one.
 * @public
 */
export declare function useWorkspaceManager(): PanelReader | undefined;
/**
 * The workspace of the PanelRow above, as a view acts on it: `panels.get(key)` returns the operable handle of any panel
 * (close, show, hide, move, configure), `panels.addPanel` makes one, and the rest of the manager is there too. It is the same
 * object on every render and undefined outside a PanelRow that has a workspace. The workspace's own `dispose`, `update` and
 * `rename` are not part of it.
 * @public
 */
export declare function useWorkspace(): ViewWorkspace | undefined;
/**
 * The state of every panel `f` keeps, re-read when the workspace changes. With no `f` it is the snapshot's own array,
 * the same one until something changes; empty outside a PanelRow that has a workspace.
 * @param f - What to keep; all panels when left out.
 * @public
 */
export declare function usePanelStates(f?: ListFilter): readonly PanelState[];
/**
 * The state of the panel with this id, re-read when it changes, or undefined when the workspace knows none. Only a
 * change to this panel re-renders the caller; a panel added later is picked up when it appears.
 * @param id - The panel's id.
 * @public
 */
export declare function usePanelState(id: PanelId): PanelState | undefined;
