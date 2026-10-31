/**
 * The phone size the default mount draws at: the host's preferred size scaled so whole slots fill the window. `fitPhone`
 * is the pure rule; the context and `usePhoneSize` carry its result to every reader of the phone size.
 */
import * as React from 'react';
import { flushSync } from 'react-dom';
import { useHost, useOptionalHost } from './hostApi.js';
import { ALL_SLOTS } from './rowConstants.js';
/** A count change needs the new count's scale this far (a fraction of the band edge) inside the band. */
export const PHONE_FIT_MARGIN = 0.02;
/**
 * Picks how many phone slots fit and the phone size that makes them fill the window. The widths are whole pixels, `floor((W + g) / N) - g`,
 * with W the window less its edge space. The smallest count whose phone is inside the band and under the height cap wins; with none, the
 * most slots inside the band at the cap, the leftover centered; with none of those, the minimum phone, as many as fit, the row scrolling
 * sideways. The height is never more than the row's share, so a row too short for the minimum phone draws it shorter than its shape.
 * @internal
 */
export function fitPhone(i) {
    const { preferred, gap, min, max } = i;
    if (!(i.windowWidth > 0))
        return { count: 0, width: preferred.width, height: preferred.height, heightCapped: false };
    const room = i.windowWidth - 2 * i.edge;
    const rows = Math.max(1, Math.floor(i.rowCount));
    const share = i.heightBudget > 0 ? (i.heightBudget - (rows - 1) * gap) / rows : Number.POSITIVE_INFINITY;
    const heightScale = share / preferred.height;
    const cap = Math.min(max, heightScale);
    const widthOf = (n) => Math.floor((room + gap) / n) - gap;
    const scaleOf = (n) => widthOf(n) / preferred.width;
    const minWidth = Math.ceil(min * preferred.width);
    // The row never scrolls vertically, so a phone held at the minimum width in a row too short for it is cut to the row's height.
    const make = (count, width) => ({ count, width, height: Math.min(Math.round((width / preferred.width) * preferred.height), Math.max(1, Math.floor(share))), heightCapped: heightScale < max });
    let inBand = 0;
    while (inBand < ALL_SLOTS && scaleOf(inBand + 1) >= min)
        inBand += 1;
    let first = 1;
    while (first <= inBand && scaleOf(first) > cap)
        first += 1;
    const minimum = () => make(Math.max(1, Math.min(ALL_SLOTS, Math.floor((room + gap) / (minWidth + gap)))), minWidth);
    let choice;
    if (cap < min || inBand === 0)
        choice = minimum();
    else if (first <= inBand)
        choice = make(first, widthOf(first));
    else
        choice = make(inBand, Math.max(minWidth, Math.floor(cap * preferred.width)));
    const prev = i.previousCount;
    if (prev !== undefined && prev >= 1 && prev <= inBand && prev !== choice.count && cap >= min) {
        const next = choice.count > prev ? scaleOf(choice.count) >= min * (1 + PHONE_FIT_MARGIN) : choice.width / preferred.width <= cap * (1 - PHONE_FIT_MARGIN);
        if (!next)
            return make(prev, Math.min(widthOf(prev), Math.max(minWidth, Math.floor(cap * preferred.width))));
    }
    return choice;
}
/** The size the default mount fits to the window; unset where nothing fits, so a reader falls back to the host's own. */
export const PhoneSizeContext = React.createContext(undefined);
/**
 * True in the commit that first measures the row's container, and in every commit before it. The fitted size lands in that
 * commit, so the slots moved to it snap there: a slide from the preferred size would be a move nobody asked for.
 * @internal
 */
export const LandingContext = React.createContext(false);
/**
 * The phone size a panel is drawn at: the width and height of one slot. With the workspace's `phoneFit` on it is the host's
 * preferred size scaled to the window; otherwise it is `useHost().device.size`, which stays the person's preference. Read this,
 * not `device.size`, for any layout that must agree with the panel's width.
 * @public
 */
export function usePhoneSize() {
    const fitted = React.useContext(PhoneSizeContext);
    const { device } = useHost();
    return fitted ?? device.size;
}
/** `usePhoneSize` outside a `HostProvider`: undefined there, where `usePhoneSize` throws. @internal */
export function useOptionalPhoneSize() {
    const fitted = React.useContext(PhoneSizeContext);
    const host = useOptionalHost();
    return fitted ?? host?.device.size;
}
/** The height in px `container` leaves for the row once `topPad` above and `bottomPad` below are taken out; 0 until measured and wherever nothing lays out. @internal */
export function useRowHeightBudget(ref, topPad, bottomPad, enabled = true) {
    const [budget, setBudget] = React.useState(0);
    React.useLayoutEffect(() => {
        const container = ref.current;
        if (!enabled || container === null)
            return undefined;
        const measure = () => setBudget(Math.max(0, Math.round(container.clientHeight - topPad - bottomPad)));
        measure();
        if (typeof ResizeObserver === 'undefined')
            return undefined;
        // Committed before the paint, as the width is: a resized window never draws the row at the old height.
        const observer = new ResizeObserver(() => flushSync(measure));
        observer.observe(container);
        return () => observer.disconnect();
    }, [ref, topPad, bottomPad, enabled]);
    return budget;
}
