/**
 * Which panel is the active one and which is being dragged: ephemeral facts about the person's attention, held by the
 * Workspace so two workspaces share nothing, kept out of the manager's snapshot and out of storage.
 */
import * as React from 'react';
import { type PanelId } from './panelSettings.js';
import type { ReorderHandle } from './dragToClose.js';
/**
 * The attribute the library writes, empty-valued, on the root box of the active panel and removes when another panel
 * is used. A host styles from it, as `[data-panel-active]`.
 * @public
 */
export declare const ACTIVE_ATTRIBUTE = "data-panel-active";
/**
 * The attribute the library writes, empty-valued, on a panel's root box from the moment a drag of it engages until it
 * settles. A host styles from it, as `[data-panel-dragging]`.
 * @public
 */
export declare const DRAGGING_ATTRIBUTE = "data-panel-dragging";
/**
 * The attribute that marks the header, grab bar and footer of a panel: the elements `tuning.chrome` fades. Its value is
 * one of {@link CHROME_PARTS}. Other `data-panel-*` markers the library draws (`data-panel-grab-bar`,
 * `data-panel-footer`, `data-panel-size-box`) are not a public contract.
 * @public
 */
export declare const CHROME_ATTRIBUTE = "data-panel-chrome-part";
/**
 * The values {@link CHROME_ATTRIBUTE} takes, one per part: `header`, `grabBar` (`'grab-bar'`), `footer` and `resize`. A panel
 * carries at most one element of each, except `resize`, which marks the grip on each side.
 * @public
 */
export declare const CHROME_PARTS: {
    readonly header: "header";
    readonly grabBar: "grab-bar";
    readonly footer: "footer";
};
/**
 * A value of {@link CHROME_ATTRIBUTE}: `'header'`, `'grab-bar'`, `'footer'` or `'resize'`.
 * @public
 */
export type ChromePart = (typeof CHROME_PARTS)[keyof typeof CHROME_PARTS];
/** Which edge of a panel a drawn width keeps where it is: the left one, or the right one. */
export type DrawnPin = 'start' | 'end';
/** The width a host holds a hand-resized panel at, in px, and the edge that stays still. */
export interface DrawnWidth {
    readonly id: PanelId;
    readonly px: number;
    readonly pin: DrawnPin;
}
/** One workspace's active and dragging panel, with listeners per panel so a change wakes only the panels it concerns. */
export interface ChromeStore {
    active(): PanelId | null;
    dragging(): PanelId | null;
    setActive(id: PanelId | null): void;
    setDragging(id: PanelId, on: boolean): void;
    /** The panel a host is resizing by hand right now. */
    resizing(): PanelId | null;
    setResizing(id: PanelId, on: boolean): void;
    /** Wakes `listener` when the resized panel changes. */
    subscribeResizing(listener: () => void): () => void;
    /** The width a host holds the resized panel at, with the edge it keeps still; null when none is set. The same object until it changes. */
    drawn(): DrawnWidth | null;
    /** Sets or clears the drawn width of `id`; ignored unless `id` is the panel being resized by hand. */
    setDrawn(id: PanelId, px: number | null, pin: DrawnPin): void;
    /** Wakes `listener` when the drawn width is set, changes or clears. */
    subscribeDrawn(listener: () => void): () => void;
    /** Wakes `listener` when `id` gains or loses the active or dragging mark. */
    subscribePanel(id: PanelId, listener: () => void): () => void;
    /** Wakes `listener` when the active panel changes. */
    subscribeActive(listener: () => void): () => void;
    /** Whether `id` is in a slide: from its own motion starting until that motion ends. */
    sliding(id: PanelId): boolean;
    /** Marks `id` as sliding or not; a change wakes `subscribePanel(id)` listeners. */
    setSliding(id: PanelId, on: boolean): void;
    /** The row tells the store each panel's key, which is its public id; the store holds engine ids. */
    setKeys(keys: ReadonlyMap<PanelId, string>): void;
    /** The key a panel is public under, or `engine` itself when the row has not named it. */
    keyOf(engine: PanelId): string;
    /** The engine id of the panel public under `key`, or `key` itself when none is. */
    engineOf(key: string): PanelId;
}
/** Marks `event` as a press inside a panel; a portal a panel opens counts, since React carries its events through the panel. */
export declare function markPanelPress(event: Event): void;
/** Whether `event` was marked by `markPanelPress`. */
export declare function isPanelPress(event: Event): boolean;
export declare function createChromeStore(): ChromeStore;
/** The store the Workspace above provides; PanelRow makes its own when it has no Workspace. */
export declare const ChromeStoreContext: React.Context<ChromeStore | undefined>;
/**
 * The id (key) of the active panel and a setter that takes one: the panel the person last pressed or focused inside, until another
 * panel is used or a press lands outside every panel, or the one the host set. Outside a Workspace it is `[null, no-op]`.
 * @public
 */
export declare function useActivePanel(): readonly [PanelId | null, (id: PanelId | null) => void];
/**
 * A panel's box on screen, in viewport pixels, as `getBoundingClientRect` reports it.
 * @public
 */
export interface PanelRect {
    /** The left edge, in viewport pixels. */
    readonly x: number;
    /** The top edge, in viewport pixels. */
    readonly y: number;
    /** The box's width in pixels, as drawn (transforms included). */
    readonly width: number;
    /** The box's height in pixels, as drawn (transforms included). */
    readonly height: number;
}
/**
 * One report of a panel's box. `moving` comes each time the box changes while the panel moves; `settled` comes once after
 * the panel stops, with the box it stopped at. `key` is the panel's public key, the one `CaptureTrigger` and `PanelsAPI` use.
 * @public
 */
export interface PanelRectEvent {
    /** The panel's public key, the id `CaptureTrigger` and `PanelsAPI` use for it. */
    readonly key: string;
    /** The box at this report. */
    readonly rect: PanelRect;
    /** `moving` while the box changes; `settled` once, after the last `moving`, when the panel has stopped. */
    readonly phase: 'moving' | 'settled';
}
/** The `detail` of a `PANEL_RECT_EVENT`: the slot's panel id, which the provider maps to its key. @internal */
export interface PanelRectDetail {
    readonly id: string;
    readonly rect: PanelRect;
    readonly phase: 'moving' | 'settled';
}
/** The public report for one slot's detail, under the panel's key. @internal */
export declare function panelRectEvent(key: string, detail: PanelRectDetail): PanelRectEvent;
/**
 * The bubbling event a slot dispatches on its own element with a `PanelRectDetail`. Window-scoped listeners hear every slot,
 * so a provider filters by the ids it knows. @internal
 */
export declare const PANEL_RECT_EVENT = "phonux:panel-rect";
/**
 * Dispatched on a slot's element with `detail: { id }` before its slide starts, so a listener reads the picture the panel
 * still shows. @internal
 */
export declare const PANEL_SLIDE_EVENT = "phonux:panel-slide";
/**
 * Reports one slot's box while it moves. `kick()` runs a frame loop that reports `moving` on each change and, once nothing
 * is moving and the box has stood still for a frame, one `settled`. `settle()` ends the loop at once with the box as it is,
 * for the moment a motion completes. @internal
 */
export interface PanelRectReporter {
    kick(): void;
    settle(): void;
    stop(): void;
}
/**
 * Builds the reporter for `el`. `id` is read at each report, so a slot whose panel id changes keeps reporting under it;
 * no report is sent while it is undefined. `moving` says whether anything besides the box's own changes keeps the loop
 * going (a slide, a drag, a resize, a row scroll). `stripX` is the row strip's translate now. While the loop runs, the box is
 * computed from the numbers that move it, measured once as the loop starts and again only when the slot's own width
 * changes; the settled report is a real measurement. @internal
 */
export declare function createRectReporter(el: HTMLElement, env: {
    id: () => string | undefined;
    moving: () => boolean;
    stripX?: () => number;
}): PanelRectReporter;
/**
 * True from the moment this panel's slide starts (a move in its row, an entrance or an exit) until the slide ends. False
 * outside a row.
 * @public
 */
export declare function usePanelSliding(): boolean;
/**
 * True while this panel is the active one. False for every other panel, and outside a row.
 * @public
 */
export declare function usePanelActive(): boolean;
/**
 * True from the moment a drag of this panel engages, on either axis, until it settles. A press that never becomes a
 * drag leaves it false. False outside a row.
 * @public
 */
export declare function usePanelDragging(): boolean;
/**
 * A setter for the dragging mark of the panel it is called in, for any drag the host runs itself except a resize grabber
 * (that uses `usePanelResizing()`), so a host never writes `data-panel-dragging` by hand. `setDragging(true)` when the drag
 * begins and `setDragging(false)` when it ends: `usePanelDragging()` and the attribute follow, and the chrome shows as it
 * does for a `DragToClose` drag. A panel has one mark, shared with `DragToClose` and `usePanelResizing()`, and the last
 * write wins. A mark this hook set ends when the calling view unmounts, and the setter keeps one identity for the view's
 * life. Outside a row the setter does nothing.
 * @public
 */
export declare function usePanelSetDragging(): (on: boolean) => void;
/**
 * Whether this panel is being resized by hand, and two setters for a host's resize grabber to call.
 *
 * `setResizing(true)` when a drag begins and `setResizing(false)` when it ends. While it is true no other panel's drawn
 * size changes, so a grabber that reads `panel.size` at the start of its drag, and a neighbor that was drawn smaller to
 * fill the window, stay where they were until the release, and the row does not scroll. It also marks the panel as
 * dragging (`usePanelDragging`) for the same span, so a drag of any kind that a host runs shows the chrome a drag shows.
 *
 * `setDrawnWidth(px)` draws the panel `px` wide at once, with no glide, so it follows a pointer frame by frame: its size
 * box, the panels after it and the row's reach follow, and `panel.size` reads it back. The width is held between
 * one slot and the most slots that fit (and the panel's `maxSlots`); a value that is not a finite number is ignored. It never
 * changes the panel's stored `slots`, the panels the row keeps live or the row's stops. `pin` names the edge that stays
 * where it is: `'start'` (the default) keeps the left edge, so the right edge follows a grabber on the right; `'end'` keeps
 * the right edge, so the left edge follows a grabber on the left, and the panels before it make room. It does nothing unless
 * `setResizing(true)` came first, and calls within one animation frame draw once, with the last value. `setDrawnWidth(null)`
 * lets the panel glide to the width its stored `slots` give (at once under Reduce Motion), so a host ends a drag with
 * `setSlots(nearest)`, then `setDrawnWidth(null)`, then `setResizing(false)`, which settles the row once onto its nearest stop.
 * `setResizing(false)` clears a width still set. The panel closing, parking or unmounting during a drag ends the mark.
 *
 * Outside a row the value is false and the setters do nothing.
 * @public
 */
export declare function usePanelResizing(): readonly [boolean, (on: boolean) => void, (px: number | null, pin?: 'start' | 'end') => void];
/** Whether the panel above shows its chrome in full; provided by `Panel`, true for a part drawn without one. */
export declare const PanelChromeVisibleContext: React.Context<boolean>;
/** Handlers `Panel` puts on its root box, composed over the caller's own. */
export interface ChromeRootHandlers {
    onPointerEnter: React.PointerEventHandler<HTMLElement>;
    onPointerLeave: React.PointerEventHandler<HTMLElement>;
    onFocus: React.FocusEventHandler<HTMLElement>;
    onBlur: React.FocusEventHandler<HTMLElement>;
}
/**
 * Whether the panel above shows its chrome in full, and the root handlers that track hover and focus. Shown while the mode is
 * 'always', while the panel is hovered, holds focus, is active or is dragged, and on a device that cannot hover.
 */
export declare function useChromeVisibility(): {
    visible: boolean;
    handlers: ChromeRootHandlers;
};
/**
 * A ref for one chrome part (header, grab bar, footer) that fades it to opaque or transparent as the panel's chrome shows or
 * hides. Opacity only, so a hidden part stays hit-testable and focusable. It runs on Motion, not a CSS transition, which a
 * host's global `transition: none` would silence, and takes no time when `fadeMs` is 0, animation is off or motion is reduced.
 * With mode 'always' no inline opacity is left on the element.
 */
export declare function useChromeFade(visible: boolean): (node: HTMLElement | null) => void;
/**
 * The `onClose` and `reorder` of the panel this hook is called in, to spread onto `DragToClose`: a close and a move
 * through the panel's own handle, so both are gated and answer a `PanelResult`. A close is offered when the panel is
 * closable and sits in a column that closes; a reorder when it is movable, and a release crossing several
 * neighbors is one `move`. The reorder's `onStep` is the same call for the grab strip's Arrow keys. Outside a row with a workspace there is no handle, so it returns neither.
 * @public
 */
export declare function usePanelDragProps(): {
    onClose?: () => void;
    reorder?: ReorderHandle;
};
