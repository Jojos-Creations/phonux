/**
 * Waiting on the row instead of on a timer. A panel takes one operation a turn: a second call on it in the same turn answers
 * `busy`, and a panel just added or shown is live only once the row has drawn it. These calls retry when the workspace changes,
 * and once more at the turn's end for a `busy`, since the turn's gate clears without the snapshot changing.
 */
import { type WorkspaceColumnHandle } from './columnHandle.js';
import type { PanelManager, PanelResult } from './panelManager.js';
import type { PanelRefusal } from './panelManagerError.js';
import type { PanelId } from './panelSettings.js';
import type { PanelState } from './panelTemplate.js';
/**
 * Options for the waits.
 * @public
 */
export interface WaitOptions {
    /**
     * How long to wait before giving up, in ms.
     * @defaultValue 2000
     */
    readonly timeoutMs?: number;
}
/**
 * Runs `op` (a handle or `configure` call such as `() => panels.get(id)?.scrollTo('center') ?? refused`) now and, while it answers a refusal a later
 * turn can clear (`busy`, `is-pending`, `not-live`, `not-ready`, `not-attached`), again whenever the workspace changes and at the end
 * of the turn, until it is accepted, refused for good, or the wait runs out. Resolves with the last answer.
 * @public
 */
export declare function whenAccepted<R extends {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly code: PanelRefusal;
}>(panels: Pick<PanelManager, 'subscribe'>, op: () => R, options?: WaitOptions): Promise<R>;
/**
 * Resolves with panel `id`'s state once `test` passes on it (by default: the panel is live), or undefined when the wait runs out
 * first. Checked now and on every change of the workspace.
 * @public
 */
export declare function whenPanel(panels: Pick<PanelManager, 'get' | 'subscribe'>, id: PanelId, test?: (state: PanelState) => boolean, options?: WaitOptions): Promise<PanelState | undefined>;
/**
 * Puts away the panels of `hide` and then brings in those of `show`, each as soon as the row takes it: a show in the same turn as
 * the hides would still count them against the row's room. Resolves once every call is answered, with the answers in order (hides
 * first).
 * @public
 */
export declare function showPanels(panels: Pick<PanelManager, 'get' | 'subscribe'>, show: readonly PanelId[], hide?: readonly PanelId[], options?: WaitOptions): Promise<readonly PanelResult[]>;
/**
 * Resolves true once `column` and every workspace in it have read what was saved (status `ready`), or false when the wait runs out
 * first. Hold the page back on it, so a default workspace is never shown and then replaced.
 * @public
 */
export declare function whenColumnReady(column: WorkspaceColumnHandle, options?: WaitOptions): Promise<boolean>;
