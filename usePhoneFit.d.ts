import * as React from 'react';
import type { ResolvedWorkspaceTuning } from './panelSettings.js';
/**
 * The phone size to give `useProvidePanels` (as `phoneWidth`) and `Workspace` (as `phoneWidth` and `phoneHeight`): with
 * `tuning.phoneFit` on, `preferred` scaled so whole slots fill the container `containerRef` holds, within `tuning.phoneFitMin`
 * and `tuning.phoneFitMax`; off, or before the container is measured, `preferred` itself. Under `tuning.phoneHeight` 'auto' the
 * height is as tall as the row's room, never shorter than the fit. A new fit is drawn only after the
 * container's width and height have held still for the resize settle (`tuning.resizeSettleSlides` slide durations), and at once
 * under Reduce Motion, so a window held at a breakpoint does not flip the count. `topInset` is the room the row leaves above
 * itself, as `Workspace`'s `topPadding`; omitted, the row gap; either way never less than a header's room unless `tuning.rowTop` is set, which is taken as given. `containerWidth` is the same width the row is priced from.
 * Hand it a `tuning` that is the one the workspace is priced with (`ProvidedPanels.tuning`, or `WorkspaceHandle.tuning`).
 * @public
 */
export declare function usePhoneFit(containerRef: React.RefObject<HTMLDivElement | null>, containerWidth: number, preferred: {
    readonly width: number;
    readonly height: number;
}, tuning: ResolvedWorkspaceTuning, topInset?: number): {
    readonly width: number;
    readonly height: number;
};
