import * as React from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useReducedMotionConfig } from 'motion/react';
import type { ResolvedWorkspaceTuning } from './panelSettings.js';
import { fitPhone, useRowHeightBudget } from './phoneFit.js';
import { resizeSettleDelayMs } from './Workspace.js';

/** `value` once it has held still for `delayMs`; the first real (non-zero) value passes at once, so the first layout is not late. */
function useSettledValue(value: number, delayMs: number, instant: boolean, enabled: boolean): number {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    if (!enabled) return undefined;
    if (instant || settled === 0) return setSettled(value);
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs, instant, settled, enabled]);
  return instant || settled === 0 ? value : settled;
}

/**
 * The phone size to give `useProvidePanels` (as `phoneWidth`) and `Workspace` (as `phoneWidth` and `phoneHeight`): with
 * `tuning.phoneFit` on, `preferred` scaled so whole slots fill the container `containerRef` holds, within `tuning.phoneFitMin`
 * and `tuning.phoneFitMax`; off, or before the container is measured, `preferred` itself. A new fit is drawn only after the
 * container's width and height have held still for the resize settle (`tuning.resizeSettleSlides` slide durations), and at once
 * under Reduce Motion, so a window held at a breakpoint does not flip the count. `topInset` is the room the row leaves above
 * itself, as `Workspace`'s `topPadding`; omitted, the row gap. `containerWidth` is the same width the row is priced from.
 * Hand it a `tuning` that is the one the workspace is priced with (`ProvidedPanels.tuning`, or `WorkspaceHandle.tuning`).
 * @public
 */
export function usePhoneFit(
  containerRef: React.RefObject<HTMLDivElement | null>,
  containerWidth: number,
  preferred: { readonly width: number; readonly height: number },
  tuning: ResolvedWorkspaceTuning,
  topInset?: number,
): { readonly width: number; readonly height: number } {
  const motionReduced = useReducedMotionConfig() === true;
  const osReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const reduced = motionReduced || osReduced;
  const on = tuning.phoneFit === 'fit';
  const budget = useRowHeightBudget(containerRef, topInset ?? tuning.rowGap, tuning.rowGap, on);
  const delay = resizeSettleDelayMs(tuning.slide, tuning.resizeSettleSlides);
  const width = useSettledValue(containerWidth, delay, reduced, on);
  const height = useSettledValue(budget, delay, reduced, on);
  const previous = React.useRef<number | undefined>(undefined);
  const fit = on ? fitPhone({ windowWidth: width, heightBudget: height, rowCount: 1, preferred, gap: tuning.rowGap, edge: tuning.rowGap, min: tuning.phoneFitMin, max: tuning.phoneFitMax, ...(previous.current !== undefined ? { previousCount: previous.current } : {}) }) : undefined;
  React.useLayoutEffect(() => {
    previous.current = fit?.count || undefined;
  });
  const fitted = fit === undefined || fit.count === 0;
  const w = fitted ? preferred.width : fit.width;
  const h = fitted ? preferred.height : fit.height;
  return React.useMemo(() => ({ width: w, height: h }), [w, h]);
}
