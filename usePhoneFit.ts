import * as React from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useReducedMotionConfig } from 'motion/react';
import type { ResolvedWorkspaceTuning } from './panelSettings.js';
import { rowBottomReservePx, rowTopReservePx } from './panelChromeSize.js';
import { fitPhone, useRowHeightBudget, useWindowSettle } from './phoneFit.js';
import { WINDOW_SETTLE_FLOOR_MS } from './rowConstants.js';
import { resizeSettleDelayMs } from './Workspace.js';

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
 * on a window jump and under Reduce Motion, so a window held at a breakpoint does not flip the count. `topInset` is the room the row leaves above
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
  const budget = useRowHeightBudget(containerRef, rowTopReservePx(topInset, tuning.rowTop, tuning.rowGap), rowBottomReservePx(tuning.rowGap, bottomInset, tuning.chrome.where));
  const settleMs = resizeSettleDelayMs(tuning.slide, tuning.resizeSettleSlides);
  // One window action is one resize: its sizes land at once at the phone size drawn before it, and the new phone size comes once it settles.
  const { settled } = useWindowSettle(containerWidth, budget, settleMs, WINDOW_SETTLE_FLOOR_MS, reduced || settleMs <= 0);
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
