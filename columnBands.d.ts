/**
 * The bands above and below a column cell's row: an ordered list of named slots in each, which an app replaces, hides or adds to
 * by id without touching the defaults. DESIGN.md, "Column bands and slots".
 */
import * as React from 'react';
import type { PhonuxLabels } from './labels.js';
import type { WorkspaceColumnHandle } from './columnHandle.js';
import type { WorkspaceHandle } from './workspaceCore.js';
/** The height of a workspace name input and of the column's neighbour buttons, in px. @public */
export declare const WORKSPACE_NAME_CONTROL_HEIGHT = 24;
/** The attribute the workspace name input carries, so a stylesheet can select it without a class name. @public */
export declare const WORKSPACE_NAME_INPUT_ATTRIBUTE = "data-workspace-name-input";
/** The attribute every slot's box carries, set to the slot's id. @public */
export declare const COLUMN_SLOT_ATTRIBUTE = "data-column-slot";
/** The attribute each band's box carries, set to `above` or `below`. @public */
export declare const COLUMN_BAND_ATTRIBUTE = "data-column-band";
/** What every slot component is given. @public */
export interface ColumnSlotProps {
    /** The workspace whose cell this slot is drawn in. */
    workspace: WorkspaceHandle;
    /** The column the workspace is in. */
    column: WorkspaceColumnHandle;
    /** The workspace's index in the column, top first. */
    index: number;
    /** The workspace above, or undefined for the first. */
    above: WorkspaceHandle | undefined;
    /** The workspace below, or undefined for the last. */
    below: WorkspaceHandle | undefined;
    /** Whether this workspace is the one in view. */
    active: boolean;
    /** The column's labels, every one resolved. */
    labels: PhonuxLabels;
    /** The slot this one replaced through `withSlotChanges`, to wrap or fall back to; undefined for a slot that replaced nothing. */
    Default: React.ComponentType<ColumnSlotProps> | undefined;
}
/** One named slot in a band. @public */
export interface ColumnSlot {
    /** The slot's name, unique across both bands. `withSlotChanges` finds a slot by it. */
    id: string;
    /** Px the slot takes in its band. The slot's box is exactly this tall. */
    height: number;
    /** What the slot draws. It returns null to draw nothing in a given workspace and keeps its height. */
    component: React.ComponentType<ColumnSlotProps>;
    /**
     * Where the slot's content sits across the cell's width.
     * @defaultValue 'center'
     */
    align?: 'start' | 'center' | 'end';
    /** The component this slot replaced; given to `component` as `Default`. Set by `withSlotChanges`. */
    base?: React.ComponentType<ColumnSlotProps>;
}
/** One band: its slots from top to bottom, and how they share the band's height. @public */
export interface ColumnBand {
    /** The slots, top first. */
    slots: readonly ColumnSlot[];
    /**
     * The band's height as a CSS length, for a band whose slots spread through more room than they need, such as
     * `'var(--row-above)'`. Unset: the sum of its slots' heights.
     */
    size?: string;
    /**
     * How the slots share the band's height when `size` gives it more than they need.
     * @defaultValue 'start' above the row, 'end' below it
     */
    justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-evenly';
    /**
     * Px between the band and its window edge: under the column's `topInset` for the band above, over the window's foot for the band below.
     * @defaultValue 0 above the row, 2 below it
     */
    edge?: number;
}
/** The two bands of every cell of a column. @public */
export interface ColumnBands {
    /** Between the column's `topInset` and the row. */
    above: ColumnBand;
    /** Between the row and the window's foot. */
    below: ColumnBand;
}
/** A slot `withSlotChanges` adds, and where. @public */
export interface AddedColumnSlot extends ColumnSlot {
    /** The band it goes in. */
    band: 'above' | 'below';
    /** The id of the slot it goes before; ahead of `after`. */
    before?: string;
    /** The id of the slot it goes after. With neither, it goes last in its band. */
    after?: string;
}
/** What an app changes about a set of bands. Every member is optional. @public */
export interface ColumnSlotChanges {
    /** By id: the component that draws the slot instead, or that component with a new height. The replaced component is its `Default`. */
    replace?: Readonly<Record<string, React.ComponentType<ColumnSlotProps> | {
        component: React.ComponentType<ColumnSlotProps>;
        height?: number;
    }>>;
    /** The ids of slots to take out. */
    hide?: readonly string[];
    /** Slots to add, applied after `replace` and `hide`, in order, so one may sit next to another added before it. */
    add?: readonly AddedColumnSlot[];
    /** A new `size`, `justify` or `edge` for the band above. */
    above?: Omit<ColumnBand, 'slots'>;
    /** A new `size`, `justify` or `edge` for the band below. */
    below?: Omit<ColumnBand, 'slots'>;
}
/**
 * The least px the bands keep clear of the row: each band's edge and slot heights, plus 28 px between the band above and the row.
 * The band above's room is under the column's `topInset`.
 * @public
 */
export declare function columnBandRoom(bands: ColumnBands): {
    above: number;
    below: number;
};
/**
 * `bands` with `changes` applied: a new value, `bands` itself untouched. An id that names no slot is skipped with one console
 * warning per id, never thrown, so a default renamed upstream leaves the app's change undone rather than breaking the app.
 * Call it once, not on every render: each call makes new slot objects.
 * @example
 * ```ts
 * const bands = withSlotChanges(DEFAULT_COLUMN_BANDS, { replace: { 'neighbour-above': DiscoverLink }, hide: ['workspace-name'] });
 * ```
 * @public
 */
export declare function withSlotChanges(bands: ColumnBands, changes: ColumnSlotChanges): ColumnBands;
/** The default slot `neighbour-above`: names the workspace above and moves there, or creates one above when there is none. @public */
export declare function NeighbourAboveSlot(props: ColumnSlotProps): React.ReactElement;
/** The default slot `neighbour-below`: names the workspace below and moves there, or creates one below when there is none. @public */
export declare function NeighbourBelowSlot(props: ColumnSlotProps): React.ReactElement;
/** The default slot `workspace-name`: the workspace's name as an input that renames it on Enter or blur, and Escape undoes. @public */
export declare function WorkspaceNameSlot({ workspace, labels }: ColumnSlotProps): React.ReactElement;
/**
 * The bands a column draws when its options give none: the link to the workspace above and the name input above the row, the
 * link to the workspace below under it.
 * @public
 */
export declare const DEFAULT_COLUMN_BANDS: ColumnBands;
/** One band of one cell. The band and each slot box let clicks through to the row under them; only a slot's own content takes them. @internal */
export declare function Band({ side, band, inset, props }: {
    side: 'above' | 'below';
    band: ColumnBand;
    inset: number;
    props: Omit<ColumnSlotProps, 'Default'>;
}): React.ReactElement;
