/**
 * A row slot's own motion: how far it is drawn from its rest, its scale and its opacity, run as Web Animations API animations on
 * the shared start time, so every slot a commit moves is sampled together by the compositor. The rest itself is the slot's
 * `translate`, which the row's drawing pass writes (rowDraw.ts). The two are separate properties because an additive animation
 * on a style of the same property does not run on the compositor.
 */
/** Where a slot is drawn relative to its rest: its offset, its scale and its opacity. @internal */
export interface SlotPose {
    readonly x: number;
    readonly y: number;
    readonly scale: number;
    readonly opacity: number;
}
/** How one move runs: seconds and a cubic bezier. @internal */
export interface SlotTiming {
    readonly duration: number;
    readonly ease: readonly [number, number, number, number];
}
/** Moves one slot's element. @internal */
export interface SlotMover {
    /** Where the slot is drawn now, from its rest. */
    pose(): SlotPose;
    /** Draws `pose` at once, ending any move in flight. */
    set(pose: SlotPose): void;
    /** Moves from where the slot is drawn now to `pose` over `timing`; `done` runs when it lands, not when another move replaces it. */
    to(pose: SlotPose, timing: SlotTiming, done?: () => void): void;
    /** Moves the pose by `dx` at once, ending any move in flight: the slot's rest moved by `-dx`, and it stays where it is drawn. */
    shift(dx: number): void;
    /** True while a move is in flight. */
    moving(): boolean;
}
/** The named curves a close exit may take, as Motion draws them. @internal */
export declare const NAMED_EASE: Readonly<Record<'easeIn' | 'easeOut' | 'easeInOut' | 'linear', readonly [number, number, number, number]>>;
/** `rest` as a slot's `translate`. @internal */
export declare const restTranslate: (rest: number) => string;
/** `pose` as the transform a slot is drawn with: only what differs from rest, `none` when nothing does. @internal */
export declare const shortTransform: (p: SlotPose) => string;
/** The mover drawing `el`, if a row slot has one. @internal */
export declare const moverOf: (el: Element) => SlotMover | undefined;
/** The mover for `el`, starting at `start`. @internal */
export declare function createSlotMover(el: HTMLElement, start: SlotPose): SlotMover;
/** Records the sideways shift a held panel's host draws it with. @internal */
export declare function setHoldShift(holdBox: Element, px: number): void;
/** The shift last recorded for a held panel's host; 0 for one never held. @internal */
export declare function holdShiftOf(holdBox: Element): number;
/** A box on screen, in px. @internal */
export interface ScreenBox {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
/**
 * Measures `el` once and returns where it is drawn at any later moment, from the numbers that move it: the strip's translate
 * (`stripX`), a held panel's shift, the slot's rest and its pose. Reading it lays nothing out, so a frame loop can call it freely.
 * @internal
 */
export declare function screenBoxOf(el: HTMLElement, stripX: () => number): () => ScreenBox;
