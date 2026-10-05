import type { Dispatch, SetStateAction } from 'react';
import type { JsonValue } from '../hostApi.js';
import type { PanelWindow } from '../panelWindow.js';
import type { WorkspaceStorage } from '../workspaceState.js';
/** How long the panel list must stay unchanged before it is saved. A change inside that time restarts it. */
export declare const WORKSPACE_SAVE_QUIET_MS = 500;
export declare function useWorkspacePersistence(i: {
    storage: WorkspaceStorage | undefined;
    panels: PanelWindow[];
    setPanels: Dispatch<SetStateAction<PanelWindow[]>>;
    rootId: string;
    freshId: () => string;
    defaultHostData: (() => JsonValue) | undefined;
}): void;
