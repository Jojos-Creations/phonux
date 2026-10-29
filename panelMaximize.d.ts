/**
 * Maximize: a panel grows from its slot to fill the window and shrinks back, on the slide timing. The browser's
 * own fullscreen is not used: its transition is the operating system's (a swipe to a new space on macOS), which no page can change.
 */
import * as React from 'react';
import { type MaximizePhase } from './maximizedStore.js';
/**
 * On a panel's root while it fills the window. Style the maximized panel through it, for example a square frame.
 * @public
 */
export declare const MAXIMIZED_ATTRIBUTE = "data-panel-maximized";
/**
 * Grows or shrinks one panel, for a host's keyboard shortcut: the panel that fills the window if one does, else the maximizable
 * panel holding `target`, else the active panel (the one last pressed or focused). True when it found such a panel, so the key is
 * the host's to claim, even if the browser then refused (that panel's `onRefused` hears of it); false when there was none.
 * @public
 */
export declare function toggleMaximize(target?: EventTarget | null): boolean;
/**
 * What `usePanelMaximize` answers.
 * @public
 */
export interface PanelMaximize {
    /** Where the panel is between its slot and the window. */
    readonly phase: MaximizePhase;
    /** True while the panel is growing or fills the window. */
    readonly maximized: boolean;
    /** Grows the panel, or shrinks it if it is growing or grown. False when the browser refused to lift it (no popover support). */
    toggle(): boolean;
}
/**
 * Lets the panel that draws `anchor` fill the window. The panel grows from its slot on the workspace's `slide` timing and shrinks
 * back the same way (Reduce Motion jumps). While it fills the window, Escape shrinks it unless something inside already used the key,
 * and focus goes back to `anchor` on the way out. A panel unmounted while maximized goes back to its slot at once.
 *
 * `topInset` is the height of a bar the page keeps drawn along the window's top edge, which the panel stops below. `onRefused` is
 * called when the browser refuses to lift the panel (no popover support), however the grow was asked for.
 * @public
 */
export declare function usePanelMaximize(anchor: React.RefObject<HTMLElement | null>, options?: {
    readonly topInset?: () => number;
    readonly onRefused?: () => void;
}): PanelMaximize;
