/**
 * Whether an arrow key belongs to something other than the row or column that listens for it: a modified key, one a handler already took,
 * one typed in a field or widget that uses the arrows, one while a dialog is open or an IME is composing, or one during a keyboard drag.
 * A repeated key is not judged here: the column ignores it and the row steps on it.
 * @internal
 */
export declare function arrowKeyBelongsElsewhere(e: KeyboardEvent, doc: Document): boolean;
/**
 * Whether `from` or an ancestor below the row's own scroller is a scroller of the panel's content that can still move along
 * `axis` in `direction`: the browser scrolls that first, so the row or column must leave the input alone.
 * @internal
 */
export declare function contentScrolls(from: Element, axis: 'x' | 'y', direction: number): boolean;
