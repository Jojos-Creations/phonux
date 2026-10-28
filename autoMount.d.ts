/**
 * The mount behind `createWorkspace`'s default: one React root that renders a workspace through the exported
 * HostProvider, Workspace and PanelRow, so the default layer is the code a hand-wired flow runs. Loaded only by a dynamic
 * `import()` from workspaceCore.ts, which keeps `react-dom/client` off the import path of a React-free caller.
 */
import * as React from 'react';
import { PanelRow } from './PanelRow.js';
import type { ProvidedPanels } from './panels/useProvidePanels.js';
import type { WorkspaceProps } from './Workspace.js';
import { type WorkspaceHandle } from './workspaceCore.js';
import type { WorkspaceColumnHandle } from './columnHandle.js';
/** The `Workspace` props the mount derives from what `useProvidePanels` returned: the same mapping a hand-wired flow writes out. @internal */
export declare function workspaceProps(provided: ProvidedPanels, workspace: WorkspaceHandle): Pick<WorkspaceProps, 'fixedColumnCount' | 'liveWidths' | 'rowScroll' | 'rowNumbers' | 'workspace'>;
/** The `PanelRow` props the mount derives from what `useProvidePanels` returned. @internal */
export declare function rowProps(provided: ProvidedPanels, workspace: WorkspaceHandle): Pick<React.ComponentProps<typeof PanelRow>, 'entries' | 'rootId' | 'closingIds' | 'enteringViaAnchorIds' | 'exitRightIds' | 'swapExitIds' | 'enterSideById' | 'maxLiveWidth' | 'rowNumbers' | 'workspace'>;
export declare function AutoRoot({ workspace, columnTop, columnBottom, themed }: {
    workspace: WorkspaceHandle;
    columnTop?: number;
    columnBottom?: number;
    themed?: boolean;
}): React.ReactElement;
/**
 * Renders `workspace` into `target` (default: a full-window element appended to `document.body`) and returns the function that
 * takes it all away again. A supplied `target` is only given a child and is never emptied.
 * @internal
 */
export declare function mountWorkspace(workspace: WorkspaceHandle, target: HTMLElement | undefined, onError: (e: unknown) => void): () => void;
/** What a column renders itself with: the theme, and the column over a cell per workspace. @internal */
export declare function ColumnRoot({ column }: {
    column: WorkspaceColumnHandle;
}): React.ReactElement;
/** Renders `column` into `target` as `mountWorkspace` does a workspace, and returns the function that takes it away. @internal */
export declare function mountColumn(column: WorkspaceColumnHandle, target: HTMLElement | undefined, onError: (e: unknown) => void): () => void;
