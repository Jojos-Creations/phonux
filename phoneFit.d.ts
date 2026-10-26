/**
 * The phone size the default mount draws at: the host's preferred size scaled so whole slots fill the window. `fitPhone`
 * is the pure rule; the context and `usePhoneSize` carry its result to every reader of the phone size.
 */
import * as React from 'react';
/** A count change needs the new count's scale this far (a fraction of the band edge) inside the band. */
export declare const PHONE_FIT_MARGIN = 0.02;
/** What `fitPhone` reads. @internal */
export interface PhoneFitInput {
    /** The scroll container's width; 0 or less is unmeasured. */
    windowWidth: number;
    /** The height the row has, container less its padding; 0 is unmeasured and applies no height cap. */
    heightBudget: number;
    /** How many rows share the height; each gets an equal share. */
    rowCount: number;
    preferred: {
        width: number;
        height: number;
    };
    gap: number;
    /** Space left at each window edge. */
    edge: number;
    min: number;
    max: number;
    /** The count in force before this call; with it, a change of count needs `PHONE_FIT_MARGIN` of room inside the band. */
    previousCount?: number;
}
/** What `fitPhone` returns. @internal */
export interface PhoneFit {
    /** Whole slots that fit; 0 while unmeasured. */
    count: number;
    /** Whole pixels. */
    width: number;
    /** Whole pixels. */
    height: number;
    /** The height cap sits below the band's top, so the height, not the width, limited the phone. */
    heightCapped: boolean;
}
/**
 * Picks how many phone slots fit and the phone size that makes them fill the window. The widths are whole pixels, `floor((W + g) / N) - g`,
 * with W the window less its edge space. The smallest count whose phone is inside the band and under the height cap wins; with none, the
 * most slots inside the band at the cap, the leftover centered; with none of those, the minimum phone, as many as fit, the row scrolling
 * sideways. The height is never more than the row's share, so a row too short for the minimum phone draws it shorter than its shape.
 * @internal
 */
export declare function fitPhone(i: PhoneFitInput): PhoneFit;
/** The size the default mount fits to the window; unset where nothing fits, so a reader falls back to the host's own. */
export declare const PhoneSizeContext: React.Context<{
    readonly width: number;
    readonly height: number;
} | undefined>;
/**
 * True in the commit that first measures the row's container, and in every commit before it. The fitted size lands in that
 * commit, so the slots moved to it snap there: a slide from the preferred size would be a move nobody asked for.
 * @internal
 */
export declare const LandingContext: React.Context<boolean>;
/**
 * The phone size a panel is drawn at: the width and height of one slot. With the workspace's `phoneFit` on it is the host's
 * preferred size scaled to the window; otherwise it is `useHost().device.size`, which stays the person's preference. Read this,
 * not `device.size`, for any layout that must agree with the panel's width.
 * @public
 */
export declare function usePhoneSize(): {
    readonly width: number;
    readonly height: number;
};
/** `usePhoneSize` outside a `HostProvider`: undefined there, where `usePhoneSize` throws. @internal */
export declare function useOptionalPhoneSize(): {
    readonly width: number;
    readonly height: number;
} | undefined;
/** The height in px `container` leaves for the row once `topPad` above and `bottomPad` below are taken out; 0 until measured and wherever nothing lays out. @internal */
export declare function useRowHeightBudget(ref: React.RefObject<HTMLDivElement | null>, topPad: number, bottomPad: number, enabled?: boolean): number;
