import type { Dispatch, SetStateAction } from 'react';
import type { JsonValue } from '../hostApi.js';
import type { PanelSettings, SettingNote } from '../panelSettings.js';
import type { PanelTemplate } from '../panelTemplate.js';
import { SAVE_QUIET_MS } from '../rowConstants.js';
import { type PanelWindow } from '../panelWindow.js';
import type { DeclaredPanel } from '../workspacePlan.js';
import type { WorkspaceState, WorkspaceStorage } from '../workspaceState.js';
/** Where the row rested: the id of a panel this launch, and the offset of the stop from its left edge in phone widths. */
export type RestMark = NonNullable<WorkspaceState['scroll']>;
export { SAVE_QUIET_MS as WORKSPACE_SAVE_QUIET_MS };
export declare function useWorkspacePersistence(i: {
    storage: WorkspaceStorage | undefined;
    panels: PanelWindow[];
    setPanels: Dispatch<SetStateAction<PanelWindow[]>>;
    rootId: string;
    freshId: () => string;
    defaultHostData: (() => JsonValue) | undefined;
    /** How long the panel list must stay unchanged before it is saved; a change inside that time restarts it. Default SAVE_QUIET_MS. */
    saveQuietMs?: number;
    /** The templates a saved panel may be rebuilt from, over the registered ones. A list is read once, at mount; a function is called at each restore. */
    templates?: readonly PanelTemplate[] | (() => readonly PanelTemplate[]);
    /** The panels code declares; each is created unless the file has it or the person dismissed it. A list is read once, at mount; a function is called at each restore. */
    declared?: readonly DeclaredPanel[] | (() => readonly DeclaredPanel[]);
    /** The workspace's panel settings, so a restored panel resolves as a new one does. Read once, at mount. */
    workspaceDefaults?: PanelSettings;
    /** Receives each note the restore raises; whatever it throws is swallowed. */
    onNote?: (note: SettingNote) => void;
    /** The developer's panel order, read by every placement the restore makes whose value is `'order'`. */
    order?: () => readonly string[];
    /** The title a declared panel gets when no settings layer names one. */
    panelTitle?: (id: string) => string;
    /** Receives an error a save raised, by throwing or rejecting. Unset: `console.error`. */
    onError?: (e: unknown) => void;
    /** True for a workspace: the declared panels are created at mount even with no storage, and the restore settles after them. Read once, at mount. */
    replay?: boolean;
}): {
    restoreSettled: boolean;
    /** Adds tombstones for keys that left the list, newest last, dropping the oldest past the cap. */
    dismiss(keys: readonly string[]): void;
    /** Removes the tombstones of keys that are back in the list. */
    undismiss(keys: readonly string[]): void;
    /** Whether `key` is a tombstone now. */
    isDismissed(key: string): boolean;
    /** The saved rest this launch restored, then the one the row last came to rest on; null when there is none. */
    scroll: RestMark | null;
    setScroll: Dispatch<SetStateAction<RestMark | null>>;
};
