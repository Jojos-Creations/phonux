/**
 * The look tuning as one value per render: the workspace's leaves resolved over the library defaults, the context that
 * carries it to every PanelRow below a Workspace, and the merge of one panel's own leaves over it.
 */
import * as React from 'react';
import { LIBRARY_TUNING_DEFAULTS, checkTuningLeaf } from './panelSettings.js';
import type { ChromeTuning, ResolvedPanelTuning, ResolvedWorkspaceTuning, WorkspaceTuning } from './panelSettings.js';

/** The tuning a Workspace resolved; unset outside a Workspace. */
export const WorkspaceTuningContext = React.createContext<ResolvedWorkspaceTuning | undefined>(undefined);

/** The height in px the Workspace's scroll container leaves for the row (its padding taken out); 0 until measured, and always in an environment that does no layout. */
export const RowHeightContext = React.createContext<number>(0);

/** A panel's tuning: the four per-panel leaves and the workspace's row gap and chrome numbers. */
export type SlotTuning = ResolvedPanelTuning & { readonly rowGap: number; readonly chrome: ChromeTuning };

const OBJECT_LEAVES: ReadonlySet<string> = new Set(['dragToClose', 'slide', 'edgeScroll', 'chrome']);
/** What this module resolved: handing one on to another resolve keeps its identity, so a context value does not change for nothing. */
const RESOLVED = new WeakSet<object>([LIBRARY_TUNING_DEFAULTS]);

function frozenCopy<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy)) as unknown as T;
  if (typeof value === 'object' && value !== null) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, member]) => [key, frozenCopy(member)]))) as T;
  return value;
}

/**
 * `tuning` over the library defaults, member by member. A member the settings resolver would refuse (out of range,
 * the wrong type, unknown) keeps its default and nothing throws: this input has no caller to refuse it to.
 */
export function resolveWorkspaceTuning(tuning: WorkspaceTuning | undefined): ResolvedWorkspaceTuning {
  if (typeof tuning !== 'object' || tuning === null) return LIBRARY_TUNING_DEFAULTS;
  if (RESOLVED.has(tuning)) return tuning as ResolvedWorkspaceTuning;
  const out: Record<string, unknown> = {};
  for (const leaf of Object.keys(LIBRARY_TUNING_DEFAULTS) as (keyof ResolvedWorkspaceTuning)[]) {
    const fallback = LIBRARY_TUNING_DEFAULTS[leaf];
    const given = (tuning as Record<string, unknown>)[leaf];
    const accepted = given === undefined ? undefined : checkTuningLeaf(leaf, given).accepted;
    out[leaf] = accepted === undefined ? fallback : OBJECT_LEAVES.has(leaf) ? { ...(fallback as object), ...(accepted as object) } : accepted;
  }
  const resolved = frozenCopy(out) as unknown as ResolvedWorkspaceTuning;
  RESOLVED.add(resolved);
  return resolved;
}

/** One panel's tuning: its own leaves when it has resolved settings, else the workspace's; the row gap is always the workspace's. */
export function slotTuning(workspace: ResolvedWorkspaceTuning, own: ResolvedPanelTuning | undefined): SlotTuning {
  const from = own ?? workspace;
  return { rowGap: workspace.rowGap, chrome: workspace.chrome, dragToClose: from.dragToClose, slide: from.slide, hopFraction: from.hopFraction, edgeScroll: from.edgeScroll };
}

/** Whether two workspace tunings differ in a leaf a row reads. */
export function lookTuningDiffers(a: ResolvedWorkspaceTuning, b: ResolvedWorkspaceTuning): boolean {
  return JSON.stringify(slotTuning(a, undefined)) !== JSON.stringify(slotTuning(b, undefined));
}
