/**
 * Row order as anchor metadata: every entry but the row's root names the entry it sits beside, the side, and
 * how near. computeRowOrder turns anchors into an order; deriveAnchorsFromOrder turns an order back into anchors.
 * The root's id is always a parameter, never a constant here: which entry is the root is the app's choice.
 */
/**
 * An entry's place in the row: on `position`'s side of the entry `panel`, ranked by `priority` among the
 * entries on that same side of that same entry. Lower is nearer; ties keep the current row order.
 * @public
 */
export interface PanelAnchor {
    /** The id of the entry this one sits beside. */
    panel: string;
    /** Which side of `panel` the entry sits on. */
    position: 'left' | 'right';
    /** Nearness to `panel` on that side; a lower number is nearer. */
    priority: number;
}
/**
 * The entries in the order their anchors describe: a walk from the root, each entry's left side (farthest
 * first), then the entry, then its right side (nearest first). Priorities come back renumbered from 0 per side
 * of each entry, so a priority of -1 always lands nearest. An anchor naming a missing entry, or one in a cycle,
 * falls back to the root's right side (keeping its priority) instead of recursing forever or dropping the entry.
 * @internal
 */
export declare function computeRowOrder<T extends {
    id: string;
    anchor?: PanelAnchor;
}>(panels: readonly T[], rootId: string): T[];
/**
 * Every non-root entry re-anchored to the root from its current array position, so computeRowOrder reproduces
 * this exact order.
 * @internal
 */
export declare function deriveAnchorsFromOrder<T extends {
    id: string;
    anchor?: PanelAnchor;
}>(panels: readonly T[], rootId: string): T[];
/** The side of the row a reappearing entry slides in from. */
export type EnterDirection = 'left' | 'right';
/** The id of the entry `panel` orients its enter animation against: its anchor's, or the root's when it has none. */
export declare function anchorTargetOf(panel: {
    anchor?: PanelAnchor;
}, rootId: string): string;
/**
 * Which side a reappearing entry enters from: the side its anchor entry sits on. Both indexes must count in the
 * SAME present list the row renders, never the raw array, which miscounts whenever an entry is parked. -1 for
 * either (not present) falls back to 'right', the row's default; the root against itself compares equal, so 'right'.
 */
export declare function resolveEnterDirection(anchorIndex: number, ownIndex: number): EnterDirection;
