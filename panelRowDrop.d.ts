/**
 * The row side of a drag that starts outside the row: the geometry that parts the row for it (shared with the header
 * drag), the controller PanelRow provides, and the state it drives. The hook a view calls is in usePanelRowDrop.ts.
 */
import * as React from 'react';
import type { PanelResult } from './panelManager.js';
import { type PanelRowEntry } from './panelRowEntry.js';
import type { ChromeStore } from './panelChrome.js';
import type { AddPlacement } from './panelSettings.js';
import type { DragScroll } from './panelSlotContext.js';
import { type WorkspaceHandle } from './workspaceCore.js';
/** A panel a drag would cross, with the width the row draws it at. */
export interface Neighbor {
    readonly id: string;
    readonly width: number;
}
/** The panels a drag can cross, nearest first on each side. */
export interface Walk {
    readonly left: readonly Neighbor[];
    readonly right: readonly Neighbor[];
}
/** The neighbors `steps` hops would cross. */
export declare const crossedBy: (walk: Walk, steps: number) => readonly Neighbor[];
/** How far a panel moves when it hops over `crossed`: each neighbor's width plus the gap. */
export declare const travelOver: (crossed: readonly Neighbor[], gap: number) => number;
/** Every panel the drag would cross moves by the dragged panel's own `span`, away from the side it is dragged toward. */
export declare function partShifts(walk: Walk, steps: number, span: number): Map<string, number>;
/** What a row-drop preview asks the row to draw. */
export interface DropPreview {
    /** The engine id of the panel being dropped. */
    readonly id: string;
    /** The hops the pointer has asked for; negative to the left. */
    readonly steps: number;
    /** True for a panel that is not in view: the row shows a gap for it instead of moving it. */
    readonly hidden: boolean;
}
/** The row's drawn parts for a preview: each panel's extra offset and, for a hidden source, the gap. */
export interface DropParts {
    readonly shifts: ReadonlyMap<string, number>;
    /** The gap a hidden source holds open, in the row's own px; null for a panel in view. */
    readonly gap: {
        readonly left: number;
        readonly width: number;
    } | null;
}
/** What `dropParts` reads of the row. */
export interface DropRow {
    readonly entries: readonly PanelRowEntry[];
    readonly rowGap: number;
    readonly widthById: ReadonlyMap<string, number>;
    readonly leftById: ReadonlyMap<string, number>;
    /** The width the dropped panel is drawn at. */
    readonly width: number;
    readonly walk: Walk;
}
/**
 * How the row parts for `preview`. A panel in view moves to the slot its hops end in while the neighbors it crossed
 * slide aside by its span. A hidden one leaves a gap its own width at the slot its hops end in: every present panel
 * after its place in the array moves right by the span, and the ones it crossed take that back.
 */
export declare function dropParts(preview: DropPreview, row: DropRow): DropParts;
/** Where a hidden panel lands after `steps` hops, as the placement the engine takes; 'in-place' for none. */
export declare function dropPlacement(walk: Walk, steps: number, keyOf: (id: string) => string): AddPlacement | 'in-place';
/**
 * What a view calls to drag a panel into the row: the controller PanelRow provides to its views.
 * @internal
 */
export interface RowDropController {
    begin(key: string, source: 'code' | 'person'): boolean;
    update(clientX: number): void;
    end(): PanelResult;
    cancel(): void;
}
/** Provided by PanelRow to the views it renders; absent outside a row. */
export declare const RowDropContext: React.Context<RowDropController | undefined>;
/** What the controller reads of the row, fresh on every render. */
export interface RowDropInput {
    readonly workspace: WorkspaceHandle;
    readonly rootId: string;
    readonly entries: readonly PanelRowEntry[];
    readonly chrome: ChromeStore;
    readonly boxRef: React.RefObject<HTMLElement | null>;
    /** The x of the center a drag of the entry counts its pointer offset from, in the row's own px: its slot when it is in view, else the gap it would hold open. */
    readonly centreOf: (entry: PanelRowEntry, hidden: boolean) => number;
    readonly walkOf: (entry: PanelRowEntry) => Walk;
    /** The hop rule shared with the header drag. */
    readonly stepsFor: (entry: PanelRowEntry, offset: number) => number;
    readonly dragScroll: DragScroll | undefined;
}
/**
 * The state and controller behind a row drop: the preview PanelRow draws, and the begin/update/end/cancel the hook
 * calls. The controller keeps one identity; it reads the row through a ref, so a call always sees the latest render.
 */
export declare function useRowDrop(input: RowDropInput): {
    preview: DropPreview | null;
    controller: RowDropController;
};
