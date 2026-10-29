/**
 * How many panels the row keeps live at once, from the fit count and the seated permanent-column count.
 * Pure and free of device state, so it is testable without a window.
 */
import { type RowLayoutInput } from './panelRowLayout.js';
/**
 * The live cap on how many panels (every permanent column plus web panels together) may be live at once,
 * from the current fit count and how many permanent columns (`collapsible:false`, e.g. History) are seated
 * right now. `fitCount === null` means unmeasured: no cap at all (Infinity) -- the first commit, and every
 * jsdom test that never calls measure(). Otherwise the fit count, floored at `fixedColumnCount + 1` so every
 * permanent column plus at least one web panel stays on screen even at the narrowest legal window. At
 * `fixedColumnCount === 1` (History alone) this floor is 2.
 * @internal
 */
export declare function effectiveMaxPanels(fitCount: number | null, fixedColumnCount: number): number;
/**
 * How many panels, permanent columns included, the row's window fits for these live widths: `fixedColumnCount` plus
 * `computeRowLayout`'s `maxLiveThatFit`. `null` while the row is unmeasured (`containerWidth === 0`), never 0.
 * The one fit computation: the row's capacity and `PanelsAPI.maxFitPanels` both call it, so they cannot disagree.
 * @internal
 */
export declare function rowFitCount(i: Pick<RowLayoutInput, 'containerWidth' | 'phoneWidth' | 'gap' | 'liveWidths' | 'reservedWidths'> & {
    fixedColumnCount: number;
}): number | null;
