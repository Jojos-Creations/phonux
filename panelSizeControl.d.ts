/**
 * The one width control every resizable panel shows: a header button whose icon is the panel's own width, opening a menu of
 * the widths that fit the window and Fullscreen. Picking a width goes through the panel's `setSlots`, so it runs the same size
 * glide as any other resize.
 */
import * as React from 'react';
import { type PanelSlotValue } from './panelSlotContext.js';
/** Whether the control draws anything in this slot, so `Panel` leaves its header's placeholder alone when it does not. */
export declare const drawsSizeControl: (slot: PanelSlotValue | undefined) => boolean;
/** The props of `PanelSizeControl`. @public */
export interface PanelSizeControlProps {
    /** The height of a bar the page keeps along the window's top edge, which a fullscreen panel stops below. 0 when omitted. */
    readonly topInset?: () => number;
    /** The Fullscreen shortcut as the host spells it, shown in the entry's hover text. */
    readonly fullscreenShortcut?: string;
    /** The Fullscreen shortcut in `aria-keyshortcuts` form. */
    readonly fullscreenKeys?: string;
    /** Called when a picked width or Fullscreen was refused. When omitted, the refusal is announced through the workspace's live region. */
    readonly onRefused?: (what: 'resize' | 'fullscreen') => void;
}
/**
 * The width control of the panel the call is made in, for its header. It draws nothing outside a row, nor for a panel that is
 * not resizable or may take fewer than two slots. The menu offers the widths up to five phones that `maxSlots` allows and the
 * window fits, with the panel's current size highlighted and disabled, then Fullscreen. Focus goes back to the button once a width is picked.
 * @public
 */
export declare function PanelSizeControl({ topInset, fullscreenShortcut, fullscreenKeys, onRefused }?: PanelSizeControlProps): React.JSX.Element | null;
