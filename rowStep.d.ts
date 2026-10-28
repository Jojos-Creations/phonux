type Direction = 'left' | 'right';
interface RowKeys {
    step?: (direction: Direction) => void;
    edge?: (direction: Direction, target: EventTarget | null) => boolean;
}
/** Hands the row drawn in `container` its step or its edge focus; returns the function that takes it back. @internal */
export declare function registerRowKeys(container: HTMLElement, part: RowKeys): () => void;
interface Span {
    readonly left: number;
    readonly right: number;
}
/** Whether enough of `slot` is inside `view` to count as on screen; a slot with no width, which is how the row keeps a hidden panel, never is. @internal */
export declare function isShown(slot: Span, view: Span): boolean;
/** Left picks the rightmost panel in view and Right the leftmost: the key that would scroll toward the missing panel lands on the window's far side. @internal */
export declare function edgeSlotInView<T extends Span>(slots: readonly T[], view: Span, direction: Direction): T | undefined;
/**
 * When `active` (an engine id) is out of `container`'s view and the key came from the page itself, focuses the panel at the view's
 * far edge and answers true. A control with focus, or an active panel in view, leaves the key to the row.
 * @internal
 */
export declare function focusEdgePanel(container: HTMLElement, active: string | null, direction: Direction, target: EventTarget | null): boolean;
/**
 * Steps the row `event` belongs to one stop toward `direction`, as a bare ArrowLeft or ArrowRight does, for a host binding its own
 * chord such as Option+Arrow. The row in the workspace cell that holds the event's target answers it, else the row in view. When the
 * panel in use is out of view, focus goes to the panel at the view's far edge instead, as for a bare arrow.
 *
 * Answers false, doing nothing, when the key belongs elsewhere (a text field, a widget that takes arrows, an open dialog, an IME,
 * a keyboard drag, a key already handled) or no row is in view. Modifier keys are not judged: the chord is the host's.
 * @public
 */
export declare function stepRow(event: KeyboardEvent, direction: 'left' | 'right'): boolean;
/** Steps the row drawn in `container` one stop, as its own gesture does; false when that row has no step. @internal */
export declare function stepRowIn(container: HTMLElement, direction: Direction): boolean;
export {};
