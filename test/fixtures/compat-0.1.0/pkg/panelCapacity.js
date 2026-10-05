/**
 * How many panels the row keeps live at once, from the stored setting, the fit count and the seated
 * permanent-column count. Pure and free of device state, so it is testable without a window.
 */
/**
 * The live cap on how many panels (every permanent column plus web panels together) may be live at once,
 * from the stored setting, the current fit count and how many permanent columns (`collapsible:false`, e.g.
 * History) are seated right now. `fitCount === null` means unmeasured: no cap at all (Infinity) -- the first
 * commit, and every jsdom test that never calls measure(). Otherwise the floor of `fixedColumnCount + 1` wins
 * over a stored value or a fit count below it (every permanent column plus at least one web panel stays on
 * screen even at the narrowest legal window), and a stored value above the fit count is capped at the fit
 * count. At `fixedColumnCount === 1` (History alone) this floor is 2.
 * @internal
 */
export function effectiveMaxPanels(stored, fitCount, fixedColumnCount) {
    if (fitCount === null)
        return Number.POSITIVE_INFINITY;
    return Math.max(fixedColumnCount + 1, Math.min(stored ?? fitCount, fitCount));
}
