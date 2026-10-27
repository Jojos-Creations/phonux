/**
 * The built-in controls of a panel's header: a move menu whose one entry pins or unpins the panel, and an X that closes
 * it. Each control is drawn only when the panel allows its gesture, and nothing is drawn in the panel's body. The grab
 * handle is not drawn here: `Panel` draws it from `grabProps`, so a second one would appear beside it.
 */
import * as React from 'react';
/** One entry the host adds under Pin in the move menu: a list item with a label. @public */
export interface HeaderMenuAction {
    /** A key that is unique within the menu. */
    readonly id: string;
    /** The text the entry shows, and its accessible name when it is only an icon. */
    readonly label: string;
    /** An icon drawn before the label, or alone in a group. */
    readonly icon?: React.ReactNode;
    /** A shortcut shown after the label, or in an icon's hover text, as the host spells it. */
    readonly shortcut?: string;
    /** Called when the entry is picked; the menu has closed by then. */
    readonly onSelect: () => void;
}
/** A titled row of icon-only actions, for a choice shown as icons with no text but the title. @public */
export interface HeaderMenuGroup {
    /** A key that is unique within the menu. */
    readonly id: string;
    /** The title shown above the row. */
    readonly title: string;
    /** The icon buttons in the row, in order: each one's label is its hover text and accessible name. */
    readonly actions: readonly HeaderMenuAction[];
}
/** One entry the host adds under Pin: a list item or a titled icon group. @public */
export type HeaderMenuEntry = HeaderMenuAction | HeaderMenuGroup;
/** The props of `PanelHeaderMenu`. @public */
export interface PanelHeaderMenuProps {
    /** Called once a Pin or Unpin from the menu has been applied or refused: `ok` is whether the panel's pin changed. */
    onPinChange?: (verb: 'pin' | 'unpin', ok: boolean) => void;
    /** Entries the host adds under Pin, in order. The move menu shows when there is at least one, even for a fixed panel. */
    entries?: readonly HeaderMenuEntry[];
    /** The icon of the menu's button; the library's move icon when omitted. */
    triggerIcon?: React.ReactNode;
}
/**
 * The header controls of the panel the call is made in, meant for the header slot (the `actions` of `Panel`, or of
 * `PanelHeaderRow`). It draws nothing outside a panel row.
 *
 * The move menu shows when the panel is movable or pinned and holds one entry, Pin or Unpin, which reads the panel's pinned
 * state; the X shows when the panel is closable. The pin never scrolls the row, and focus returns to the move button without
 * the row reading it as a choice. A refused pin or unpin is announced through the workspace's live region.
 * @public
 */
export declare function PanelHeaderMenu({ onPinChange, entries, triggerIcon }?: PanelHeaderMenuProps): React.JSX.Element | null;
