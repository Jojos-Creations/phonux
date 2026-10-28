/**
 * Which panel opened which: each entry's `openedBy` names its opener's engine id. Pure functions over the panel list,
 * React-free, so the provider and the workspace core share one rule.
 */
import type { PanelWindow } from './panelWindow.js';
/**
 * `next` with every opener that left the list replaced by that opener's own opener, from `prev`, so the children of a
 * closed panel move up to its parent. An opener `prev` never held is kept: a family arriving from another workspace may
 * add a child before its parent.
 */
export declare function keepOpeners(prev: readonly PanelWindow[], next: PanelWindow[]): PanelWindow[];
/** The engine ids of `id` and every panel it opened, directly or through others, in row order; empty when the list holds no `id`. */
export declare function familyIds(entries: readonly PanelWindow[], id: string): string[];
