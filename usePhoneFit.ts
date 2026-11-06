import * as React from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useReducedMotionConfig } from 'motion/react';
import type { ResolvedWorkspaceTuning } from './panelSettings.js';
import { rowBottomReservePx, rowTopReservePx } from './panelChromeSize.js';
import { fitPhone, useRowHeightBudget } from './phoneFit.js';
import { resizeSettleDelayMs } from './Workspace.js';

/**
 * `width` and `height` once both have held still for `delayMs`, taken together so a resize lands in one commit. A side not yet
 * measured (0) takes its first value at once, so the first layout is not late.
 */
function useSettledSize(width: number, height: number, delayMs: number, instant: boolean): { readonly width: number; readonly height: number } {
  const [settled, setSettled] = React.useState({ width, height });
  const w = instant || settled.width === 0 ? width : settled.width;
  const h = instant || settled.height === 0 ? height : settled.height;
  React.useEffect(() => {
    if (w === width && h === height) {
      if (settled.width !== width || settled.height !== height) setSettled({ width, height });
      return undefined;
    }
    // Counted on animation frames, not a timer, so a virtual frame clock (`phonux/testing/row`) runs the wait as it runs the glide.
    const due = performance.now() + delayMs;
    let frame = requestAnimationFrame(function wait(): void {
      if (performance.now() >= due) setSettled({ width, height });
      else frame = requestAnimationFrame(wait);
    });
    return () => cancelAnimationFrame(frame);
  }, [width, height, w, h, delayMs, settled]);
  return React.useMemo(() => ({ width: w, height: h }), [w, h]);
}

/** What `usePhoneFit` returns. @public */
export interface PhoneFitResult {
  /** The width in px of one phone slot. */
  readonly width: number;
  /** The height in px of one phone slot. */
  readonly height: number;
  /**
   * The container width in px, as measured on every resize step. Hand it to `useProvidePanels` and `Workspace` as their
   * `containerWidth`: the row follows the window at once, at the phone size above, which changes only once the window holds still.
   */
  readonly containerWidth: number;
  /** The room in px the row has to grow into, as measured with `containerWidth`: hand it to `Workspace` as `heightBudget`. 0 until measured. */
  readonly heightBudget: number;
}

/**
 * The phone size to give `useProvidePanels` (as `phoneWidth`) and `Workspace` (as `phoneWidth` and `phoneHeight`): with
 * `tuning.phoneFit` on, `preferred` scaled so whole slots fill the container `containerRef` holds, within `tuning.phoneFitMin`
 * and `tuning.phoneFitMax`; off, or before the container is measured, `preferred` itself. Under `tuning.phoneHeight` 'auto' the
 * height is as tall as the row's room, never shorter than the fit. A new fit is drawn only after the
 * container's width and height have held still for the resize settle (`tuning.resizeSettleSlides` slide durations), and at once
 * under Reduce Motion, so a window held at a breakpoint does not flip the count. `topInset` is the room the row leaves above
 * itself, as `Workspace`'s `topPadding`, and `bottomInset` the room under it, as its `bottomPadding`; omitted, the row gap; either way never less than a header's room unless `tuning.rowTop` is
 * set, which is taken as given. `containerWidth` is the measured width; pass the `containerWidth` and `heightBudget` this
 * returns on to the row.
 * Hand it a `tuning` that is the one the workspace is priced with (`ProvidedPanels.tuning`, or `WorkspaceHandle.tuning`).
 * @public
 */
export function usePhoneFit(
  containerRef: React.RefObject<HTMLDivElement | null>,
  containerWidth: number,
  preferred: { readonly width: number; readonly height: number },
  tuning: ResolvedWorkspaceTuning,
  topInset?: number,
  bottomInset?: number,
): PhoneFitResult {
  const motionReduced = useReducedMotionConfig() === true;
  const osReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const reduced = motionReduced || osReduced;
  const on = tuning.phoneFit === 'fit';
  const budget = useRowHeightBudget(containerRef, rowTopReservePx(topInset, tuning.rowTop, tuning.rowGap), rowBottomReservePx(tuning.rowGap, bottomInset));
  const settled = useSettledSize(containerWidth, budget, resizeSettleDelayMs(tuning.slide, tuning.resizeSettleSlides), reduced);
  const previous = React.useRef<number | undefined>(undefined);
  const fit = on ? fitPhone({ windowWidth: settled.width, heightBudget: settled.height, rowCount: 1, preferred, gap: tuning.rowGap, edge: tuning.rowGap, min: tuning.phoneFitMin, max: tuning.phoneFitMax, ...(previous.current !== undefined ? { previousCount: previous.current } : {}) }) : undefined;
  React.useLayoutEffect(() => {
    previous.current = fit?.count || undefined;
  });
  const fitted = fit === undefined || fit.count === 0;
  const w = fitted ? preferred.width : fit.width;
  const base = fitted ? preferred.height : fit.height;
  // Under 'auto' the frame is as tall as the row's room, never shorter than the fit.
  const h = on && tuning.phoneHeight === 'auto' ? Math.max(settled.height, base) : base;
  // The row takes the live size on every step, so a resized window never draws the old layout; only the phone size waits.
  return React.useMemo(() => ({ width: w, height: h, containerWidth, heightBudget: budget }), [w, h, containerWidth, budget]);
}
