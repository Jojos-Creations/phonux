import * as React from 'react';
import { type TargetAndTransition } from 'motion/react';
import { type SlotMover, type SlotPose, type SlotTiming } from './slotMover.js';
import type { SlideTuning } from './panelSettings.js';
/**
 * The library's default row gap, 16 px; the gap a workspace draws with is its `tuning.rowGap`, which this does not follow.
 * @public
 * @deprecated Read the gap with `usePanelTuning().rowGap`, and the default with `LIBRARY_TUNING_DEFAULTS.rowGap`.
 */
export declare const GAP = 16;
/** The timing/easing every panel slide uses. The SAME object as SLOT_TRANSITION, not a copy: a host animates
 * its own row "the same as a panel" by this reference (test/row-shell-style.test.ts pins it).
 * @public */
export declare const PANEL_TRANSITION: {
    duration: number;
    ease: [number, number, number, number];
};
/**
 * One live panel's animated slot, absolutely positioned at its own `leftOffset` so adding,
 * removing or resizing a panel never disturbs the ones to its left; `x`, not `left`, so the
 * browser composites it. Motion drives enter/exit (AnimatePresence keeps an outgoing node
 * mounted through its own unmount commit, unlike a plain CSS transition), and its Web Animations
 * API is immune to a theme's transition/animation:none reset, which must stay scoped there and never reach
 * transform/opacity, or it would kill this silently.
 */
export interface PanelRowSlotMotion {
    /** Where the slot starts when it mounts: one span beyond its resting place, faded out. */
    readonly initial: TargetAndTransition;
    /** The slot's resting position. */
    readonly animate: TargetAndTransition;
    /** Where the slot goes when it leaves: off the edge it was hidden past, or down for a close. */
    readonly exit: TargetAndTransition;
    /** The timing the slot moves with. */
    readonly transition: typeof PANEL_TRANSITION;
}
/**
 * How a slot enters: a slide from one side, a fade where it rests, or a scale up from 0: about its center for 'expand'
 * (an open), and about the edge on the side it comes in from for 'expand-left' / 'expand-right' (a reveal).
 * @internal
 */
export type SlotEntrance = 'left' | 'right' | 'top' | 'bottom' | 'fade' | 'expand' | 'expand-left' | 'expand-right';
/**
 * How a slot leaves: 'down' is the close exit on the close timing; the others take the slide timing. 'shrink' (a close)
 * scales it to 0 about its center, and 'shrink-left' / 'shrink-right' (a park) about the edge on the side it leaves by.
 * @internal
 */
export type SlotExit = 'down' | 'left' | 'right' | 'top' | 'bottom' | 'fade' | 'shrink' | 'shrink-left' | 'shrink-right';
/**
 * The pure values behind one PanelRowSlot render, split out so a test can assert exact motion
 * values without mounting a component. `exit` stays entirely local to this function: 'down' needs a second
 * axis and its own transition, 'left' a target independent of `leftOffset`; neither fits directionalTransition's
 * symmetric default.
 */
export declare function panelRowSlotMotion(leftOffset: number, width: number, phoneHeight: number, enterDirection: SlotEntrance, exitDirection: SlotExit, gap?: number, slide?: SlideTuning, rowScroll?: boolean): PanelRowSlotMotion;
/** The `x` and `opacity` a slot moves between. */
interface SlotValues {
    readonly x: number;
    readonly opacity: number;
}
/**
 * Where a slot goes when its panel parks: off the edge it was hidden past, faded out. In a scrolling row the strip
 * extends far past the window, so the exit is one span from the slot's own rest on either side; in a row that never
 * scrolls the left edge is the row's own origin.
 * @internal
 */
export declare function parkExitTarget(rest: number, ownSpan: number, side: 'left' | 'right', rowScroll: boolean): SlotValues;
/**
 * The imperative moves a slot makes on its own element. An object so a test can wrap them and read the order of the
 * calls; `set` draws at once, `glide` starts a move on the shared start time.
 * @internal
 */
export declare const slotDriver: {
    set(el: HTMLElement, mover: SlotMover, pose: SlotPose): void;
    glide(el: HTMLElement, mover: SlotMover, pose: SlotPose, timing: SlotTiming, done?: () => void): void;
};
/**
 * One entry's animated slot in the row: its position, width, enter/exit motion and stacking.
 * @internal
 */
export declare function PanelRowSlot({ panelId, label, leftOffset, width, phoneHeight, top, height, enterDirection, exitDirection, zIndex, tracking, gap, slide, rowScroll, previewing, firstPressFocusOnly, onActivate, dragged, children, }: {
    /** The panel this slot draws; the row's edge fade finds the slot by it. */
    panelId?: string;
    /** The slot's accessible name, set on its group: the panel's title and its place among the panels drawn. */
    label?: string;
    /** This slot's own rest x position -- the caller's running sum of every PRECEDING present item's own width plus one gap. */
    leftOffset: number;
    /** This panel's own width (`panelWidthOf`), also this slot's enter/exit travel distance (`panelRowSlotMotion`'s `ownSpan`). */
    width: number;
    /** The height in px a closing slot drops by. */
    phoneHeight: number;
    /** Where the slot's top edge sits in the row box, and its own height: a panel shorter than the row is aligned inside it. Omitted: the slot fills the row's height. */
    top?: number;
    height?: number;
    /** Computed by the caller (panelRowOrder.ts's `resolveEnterDirection`, or an explicit gesture side).
     * Must be correct on this component's FIRST render after the item (re)appears -- AnimatePresence
     * has no later render of a fresh mount to fix a wrong guess. */
    enterDirection: SlotEntrance;
    /** Must be correct on this component's LAST render before it leaves the `live`-filtered array --
     * AnimatePresence has no later render of a removed child to fix a wrong guess. */
    exitDirection: SlotExit;
    /**
     * The slot's tier (`ROW_LAYER_Z.BASE` or `RAISED`). Each slot carries a `transform`, so it is its OWN stacking context and a child's `zIndex`
     * cannot compare against a SIBLING slot: stacking between slots (e.g. a raised column above a panel sliding
     * left behind it) must be set HERE, on the slot, not on what renders inside it. Defaults to 0.
     */
    zIndex?: number;
    /** True while a host holds a width on a panel of the row: the slot's moves take no time, so a width that follows a pointer moves it the same frame. Default false. */
    tracking?: boolean;
    /** The row's gap and this panel's slide; the library defaults when omitted. */
    gap?: number;
    slide?: SlideTuning;
    /** Whether the row scrolls: a park then exits relative to this slot's rest. Default false. */
    rowScroll?: boolean;
    /** True while a sideways drag previews the reorder: under Reduce Motion the slot's own moves then snap, since a preview-time slide carries no information. */
    previewing?: boolean;
    /** True when a press on this panel while it is not in use only puts it in use (`tuning.firstPressFocusOnly`). Default false. */
    firstPressFocusOnly?: boolean;
    /** Called when a press or focus lands anywhere inside the slot, a portaled descendant included (React capture handlers follow the React tree); `control` is true when it lands on a control of the panel's own chrome. */
    onActivate?: (control: boolean) => void;
    /** True for the slot whose box is being dragged: its rest moving during the preview is the drop, which lands at once whatever the motion setting. */
    dragged?: boolean;
    /** The panel rendered inside the slot. */
    children: React.ReactNode;
}): React.JSX.Element;
/**
 * The box a resize animates. It is laid out once at the new size, and its drawn size eases from the size on screen to the new
 * one over the slide, in step with the neighboring slots, by a scale about its top left corner: the content takes its new layout
 * at the start and is drawn stretched in between. A row already draws one around every panel, which follows the panel's `resize`
 * setting; a `PanelSizeBox` inside it is a plain div that fills it. Under Reduce Motion, or while a host holds a width, the resize snaps.
 * @public
 */
export declare function PanelSizeBox({ width, height, reveal, children, }: {
    /** The box's width in px; a change animates. Omitted: the slot's drawn width inside a row, else the phone width. */
    width?: number;
    /** The box's height in px; a change animates. Omitted: the slot's drawn height inside a row, else the phone height. */
    height?: number;
    /**
     * True: while the box glides, its content is laid out once at the larger of the start and end sizes and is clipped, not
     * scaled, to the eased size, so the content is resized when a grow starts and when a shrink ends and is never stretched.
     * Nothing is clipped above the box, nor below it while the height holds, so a frame's header and footer still show. Default false.
     */
    reveal?: boolean;
    /** The content, laid out at the box's new size, or under `reveal` at the glide's larger size. */
    children: React.ReactNode;
}): React.JSX.Element;
/** A size glide of a panel's box: where it started and where it lands. A height of `'100%'` is the slot's own. @public */
export interface PanelSizeGlide {
    /** The box's size when the glide started. */
    from: {
        width: number;
        height: number | '100%';
    };
    /** The size the glide lands on. */
    to: {
        width: number;
        height: number | '100%';
    };
}
/**
 * The size glide of the panel box this is called in, from its start until it lands; null while the box is still, under Reduce
 * Motion, and outside a box. A window that draws no frames does not advance a glide, so a host that waits on its end caps the wait.
 * @public
 */
export declare function usePanelSizeGlide(): PanelSizeGlide | null;
/** True below a `SizeBox`: the panel and its frame fill the box, so they glide with it. @internal */
export declare const useInsideSizeBox: () => boolean;
/**
 * `PanelSizeBox` with a height that may be the slot's own (`'100%'`, a panel that fills the row's height), which is the box the
 * default frame draws around its whole panel. A box below another draws a plain div of the same size.
 * @internal
 */
export declare function SizeBox({ width: given, height: givenHeight, reveal, children }: {
    width?: number;
    height?: number | '100%';
    reveal?: boolean;
    children: React.ReactNode;
}): React.JSX.Element;
export {};
