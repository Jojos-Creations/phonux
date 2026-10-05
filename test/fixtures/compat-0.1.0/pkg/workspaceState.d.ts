/**
 * Workspace state as a saved file: the JSON shape, its guard, and the pure pair that turns the panel list into
 * that shape and back. DESIGN.md ("Workspace state persistence") holds the rules; this file holds no React and
 * no host code.
 */
import type { FormFactor, JsonValue } from './hostApi.js';
import { type PanelWindow } from './panelWindow.js';
/**
 * One saved panel. `id` only names this panel inside its own file, so an `anchor` can point at another entry;
 * it is replaced on restore. Never saved: `hostData`, `size`, `locked`, `collapsible`, `anchoredEnter` and the
 * host's root column.
 * @public
 */
export type WorkspacePanelState = {
    id: string;
    view: string;
    url: string;
    title?: string;
    params?: JsonValue;
    listed?: boolean;
    live: boolean;
    anchor: {
        panel: string;
        position: 'left' | 'right';
        priority: number;
    };
    formFactor?: FormFactor;
    permanent?: boolean;
    layer?: 'base' | 'raised';
};
/**
 * The saved workspace: a version and one entry per saved panel, in row order. The host's root column is not in it.
 * @public
 */
export type WorkspaceState = {
    version: 1;
    panels: WorkspacePanelState[];
};
/**
 * What a host implements to keep the workspace between launches. `load` resolves the saved state, or `null` when
 * there is none. `save` is fire-and-forget and must not throw.
 * @public
 */
export type WorkspaceStorage = {
    load(): Promise<WorkspaceState | null>;
    save(state: WorkspaceState): void;
};
/**
 * Whether `value` is a workspace file this version understands: version 1, a `panels` array of well-typed entries
 * with unique ids. Unknown extra keys are accepted (a later optional field is additive); `params` is not deep-checked.
 */
export declare function isWorkspaceState(value: unknown): value is WorkspaceState;
/**
 * The saved form of `panels`: every entry but the root, with only the documented keys. `permanent` is derived
 * (`!collapsible`) because PanelWindow has no such field, and an absent optional stays absent so no key holds
 * `undefined`.
 */
export declare function projectWorkspaceState(panels: readonly PanelWindow[], rootId: string): WorkspaceState;
/**
 * The panels `state` describes, in row order and without the root, each under a fresh id from `freshId`. `hostData`
 * is left for the caller: only the host knows what a new panel carries.
 */
export declare function hydrateWorkspaceState(state: WorkspaceState, freshId: () => string, rootId: string): PanelWindow[];
