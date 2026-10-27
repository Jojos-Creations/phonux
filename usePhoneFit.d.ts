import * as React from 'react';
import type { ResolvedWorkspaceTuning } from './panelSettings.js';
/** What `usePhoneFit` returns. @public */
export interface PhoneFitResult {
    /** The width in px of one phone slot. */
    readonly width: number;
    /** The height in px of one phone slot. */
    readonly height: number;
    /**
     * The container width in px this size was fitted to: the measured width once it has held still for the resize settle. Hand it to
     * `useProvidePanels` and `Workspace` as their `containerWidth`, so the row's place, its capacity and its phone size change in one glide.
     */
    readonly containerWidth: number;
    /** The room in px the row has to grow into, settled with `containerWidth`: hand it to `Workspace` as `heightBudget`. 0 until measured. */
    readonly heightBudget: number;
}
/**
 * The phone size to give `useProvidePanels` (as `phoneWidth`) and `Workspace` (as `phoneWidth` and `phoneHeight`): with
 * `tuning.phoneFit` on, `preferred` scaled so whole slots fill the container `containerRef` holds, within `tuning.phoneFitMin`
 * and `tuning.phoneFitMax`; off, or before the container is measured, `preferred` itself. Under `tuning.phoneHeight` 'auto' the
 * height is as tall as the row's room, never shorter than the fit. A new fit is drawn only after the
 * container's width and height have held still for the resize settle (`tuning.resizeSettleSlides` slide durations), and at once
 * under Reduce Motion, so a window held at a breakpoint does not flip the count. `topInset` is the room the row leaves above
 * itself, as `Workspace`'s `topPadding`; omitted, the row gap; either way never less than a header's room unless `tuning.rowTop` is
 * set, which is taken as given. `containerWidth` is the measured width; pass the settled `containerWidth` and `heightBudget` this
 * returns on to the row.
 * Hand it a `tuning` that is the one the workspace is priced with (`ProvidedPanels.tuning`, or `WorkspaceHandle.tuning`).
 * @public
 */
export declare function usePhoneFit(containerRef: React.RefObject<HTMLDivElement | null>, containerWidth: number, preferred: {
    readonly width: number;
    readonly height: number;
}, tuning: ResolvedWorkspaceTuning, topInset?: number): PhoneFitResult;
