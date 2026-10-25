/**
 * The generic header buttons a panel declares in `headerButtons`: the hook that lists them, the component that draws
 * them as MUI IconButtons (icon form) or Buttons (text form), and the press path that runs the developer's `onClick`.
 */
import * as React from 'react';
import type { HeaderButton } from './panelSettings.js';
import type { ViewHandle } from './panelTemplate.js';
import { type HeaderButtonsSlot } from './panelSlotContext.js';
/** What every listed header button has, whichever form it takes. @public */
export interface PanelHeaderButtonItemBase {
    /** The slot id. */
    readonly id: string;
    /** The accessible name; in the text form also the text drawn. */
    readonly label: string;
    /** Which end of the header row the button sits at. */
    readonly side: 'start' | 'end';
    /** The sort position among the buttons on the same side; ties break by id. */
    readonly order: number;
    /** Whether the button shows as pressed; undefined for a slot that declares no `pressed`. */
    readonly pressed: boolean | undefined;
    /** Whether the button is disabled: it stays focusable and a press does nothing. */
    readonly disabled: boolean;
    /** Whether the button is left out of the drawn cluster. */
    readonly hidden: boolean;
    /** Longer help text, or undefined. */
    readonly description: string | undefined;
    /** Tooltip text, or undefined. */
    readonly tooltip: string | undefined;
    /** Extra styles for the drawn button. */
    readonly sx: HeaderButton['sx'];
    /** Runs the slot's `onClick` as the person's gesture; does nothing while disabled, hidden or while the panel is leaving. */
    press(): void;
}
/** A listed button of the icon form: `icon` is what the slot's icon resolved to, null included. @public */
export interface PanelHeaderIconItem extends PanelHeaderButtonItemBase {
    /** Marks the icon form. */
    readonly form: 'icon';
    /** The icon to draw. */
    readonly icon: React.ReactNode;
}
/** A listed button of the text form: it draws its label as text and has no icon. @public */
export interface PanelHeaderTextItem extends PanelHeaderButtonItemBase {
    /** Marks the text form. */
    readonly form: 'text';
    /** Always undefined in the text form. */
    readonly icon: undefined;
}
/** One declared header button as `usePanelHeaderButtons` lists it, its functions already evaluated for the panel's current state; `form` tells the two forms apart. @public */
export type PanelHeaderButtonItem = PanelHeaderIconItem | PanelHeaderTextItem;
/** The attribute that marks a header row of a panel with declared buttons, and holds the panel's id. */
export declare const HEADER_ROW_ATTRIBUTE = "data-header-buttons-row";
/**
 * The header buttons the panel above declares, sorted start side first, then by order, then by id; empty outside a row slot.
 * @public
 */
export declare function usePanelHeaderButtons(): readonly PanelHeaderButtonItem[];
/**
 * Draws the panel's header buttons: all of them in order, or only those of one `side`. The polite status region
 * that `announce` writes to is the last child of the end side, or of the whole cluster. Outside a row slot, or with
 * nothing to draw, it draws nothing.
 * @public
 */
export declare function PanelHeaderButtons({ side }: {
    side?: 'start' | 'end';
}): React.ReactElement | null;
/** What PanelRow puts in the slot context for an entry: its resolved slots with its handle, or nothing when it declares none. @internal */
export declare function headerButtonsOf(slots: HeaderButtonsSlot['slots'], handle: ViewHandle | undefined, report: HeaderButtonsSlot['report'], note: HeaderButtonsSlot['note']): HeaderButtonsSlot | undefined;
