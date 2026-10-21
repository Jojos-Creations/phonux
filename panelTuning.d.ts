/**
 * The look tuning as one value per render: the workspace's leaves resolved over the library defaults, and the slice of it
 * each slot reads.
 */
import * as React from 'react';
import type { ResolvedWorkspaceTuning, WorkspaceTuning } from './panelSettings.js';
/** The height in px the Workspace's scroll container leaves for the row (its padding taken out); 0 until measured, and always in an environment that does no layout. */
export declare const RowHeightContext: React.Context<number>;
/** What a slot reads of the workspace's tuning. */
export type SlotTuning = Pick<ResolvedWorkspaceTuning, 'rowGap' | 'chrome' | 'dragToClose' | 'slide' | 'hopFraction' | 'edgeScroll'> & {
    view: Pick<ResolvedWorkspaceTuning, 'rowGap' | 'dragToClose' | 'slide' | 'hopFraction' | 'edgeScroll'>;
};
/**
 * `tuning` over the library defaults, member by member. A member the settings resolver would refuse (out of range,
 * the wrong type, unknown) keeps its default and nothing throws: this input has no caller to refuse it to.
 */
export declare function resolveWorkspaceTuning(tuning: WorkspaceTuning | undefined): ResolvedWorkspaceTuning;
/** The slice of the workspace's tuning every slot reads; one object per resolved tuning, so a context value does not change for nothing. */
export declare function slotTuning(workspace: ResolvedWorkspaceTuning): SlotTuning;
