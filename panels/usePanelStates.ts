/**
 * The read side of a workspace for components: hooks over the reader a row gives its template views. They answer
 * from the nearest PanelRow that was given a workspace and nothing outside one.
 */
import { useContext, useSyncExternalStore } from 'react';
import { filterStates } from '../panelHandles.js';
import type { PanelId } from '../panelSettings.js';
import type { ListFilter, PanelReader, PanelSnapshot, PanelState } from '../panelTemplate.js';
import { PanelViewContextValue } from '../panelViewContext.js';

const NO_SUBSCRIBE = (): (() => void) => () => {};
const EMPTY_SNAPSHOT: PanelSnapshot = Object.freeze({ version: 0, status: 'detached', panels: Object.freeze([]) });

/**
 * The reader of every panel in the workspace of the PanelRow above, or undefined outside one.
 * @public
 */
export function useWorkspaceManager(): PanelReader | undefined {
  return useContext(PanelViewContextValue)?.manager;
}

function useSnapshot(): PanelSnapshot {
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
export function usePanelStates(f?: ListFilter): readonly PanelState[] {
  return filterStates(useSnapshot().panels, f);
}

/**
 * The state of the panel with this id, re-read when it changes, or undefined when the workspace knows none.
 * @param id - The panel's id.
 * @public
 */
export function usePanelState(id: PanelId): PanelState | undefined {
  return useSnapshot().panels.find((p) => p.id === id);
}
