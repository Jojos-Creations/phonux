/**
 * The blank space a parking row can rest with: a half slot after the always-shown columns, and slots after the last drawn panel.
 * A rest lets a panel sit in the window's center when no whole-slot row would put it there, and it lives only as long as the row
 * it was made for. Pure: the list hook holds it, the numbers draw it, and capacity counts it, so no parked panel refills a blank.
 */
/**
 * The blanks a row rests with, in slots: `lead` after the always-shown columns, `tail` after the last drawn panel. `lead + tail` is always whole.
 * @public
 */
export interface RowRest {
    /** Slots after the always-shown columns. */
    readonly lead: number;
    /** Slots after the last drawn panel. */
    readonly tail: number;
    /** Slots before the always-shown columns, which move the row right so the first of them can reach the center. Default none. */
    readonly head?: number;
}
/** What one step does to a resting row: which side brings a parked panel in, which end of the drawn panels parks, and the rest it leaves. @internal */
export interface RestPlan {
    readonly reveal?: 'left' | 'right';
    readonly park?: 'left' | 'right';
    readonly rest: RowRest;
}
/** The numbers a step reads, in px from the strip's window, and which steps the row has panels for. @internal */
export interface RestStepInput {
    readonly direction: 'left' | 'right';
    readonly rest: RowRest | null;
    /** The px the last drawn panel's center sits right of the window's center. */
    readonly lastOff: number;
    /** One slot and its gap. */
    readonly slot: number;
    /** Whether a parked panel waits to come in on that side. */
    readonly canLeft: boolean;
    readonly canRight: boolean;
    /** The slots of the panel a left step brings in, 1 when none does. */
    readonly revealSlots: number;
    /** The width and its gap of the leftmost drawn panel a tail step may park, or null when none may: it is the last, it cannot come back by scrolling, or the row has room to spare. */
    readonly parkable: number | null;
    /** The px the root's center sits right of the window's center, or null with no root to center. */
    readonly rootOff?: number | null;
    /** The width and its gap of the rightmost drawn panel a head step may park, or null when none may. */
    readonly lastParkable?: number | null;
    /** Whether the row has a slot to spare, so a head step needs to park nothing. */
    readonly roomy?: boolean;
}
/**
 * What a step does to a row that rests or could begin to, or null when it is the row's ordinary step. A half rest snaps back to
 * whole slots on any step. On whole slots a step right past the last panel opens a blank, and a step left closes one.
 * @internal
 */
export declare function restStep(i: RestStepInput): RestPlan | null;
/** The rest that centers a panel sitting half a slot off: one more blank slot, split as a half on each side of the panels. @internal */
export declare function halfRest(rest: RowRest | null): RowRest;
/** Whether a panel `off` px from the window's center sits half a slot from it, which only a half rest can center. @internal */
export declare function isHalfOff(off: number, slot: number): boolean;
