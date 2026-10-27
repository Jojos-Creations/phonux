/** What a view reaches as `useHost().panels`: the members of `PanelsAPI` and nothing the row keeps for itself. */
import type { PanelsAPI } from './hostApi.js';
import type { ProvidedPanels } from './panels/useProvidePanels.js';
/** Logs once per verb that it is deprecated and names what replaces it; silent in production and where `process` is undefined. @internal */
export declare function warnDeprecatedVerb(verb: string, instead: string): void;
/**
 * The `PanelsAPI` over `provided`: its read members, `undoClose` and `clearAll`, and the per-panel verbs, each of which still
 * works and warns once in development. The row's own members (`entries`, `rowNumbers`, `tuning` and the rest of `ProvidedPanels`) are not on it.
 * @internal
 */
export declare function hostPanelsOf(provided: ProvidedPanels): PanelsAPI;
