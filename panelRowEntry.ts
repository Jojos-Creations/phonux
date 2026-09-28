/**
 * The row's own record of one panel, and the one projection from it to what a view may see. The row needs
 * layout fields a view must never read, so the two are separate types (see DESIGN.md, PanelSummary).
 */
import type { JsonValue, PanelSummary } from './hostApi.js';
import type { PanelAnchor } from './panelRowOrder.js';

/**
 * One entry of a panel row: everything a view sees (PanelSummary) plus the layout fields only the row reads.
 * @public
 */
export interface PanelRowEntry<P = JsonValue> extends PanelSummary<P> {
  /** The registered view that renders this entry. An unregistered name renders a placeholder, never a crash. */
  readonly view: string;
  /** False for an always-shown column: the row never parks it and it is never a drag source. */
  readonly collapsible: boolean;
  /** Where this entry sits in the row. Undefined for the row's root; any other entry without one stays where it stands. */
  readonly anchor?: PanelAnchor;
  /** Which of the row's two stacking tiers this entry's slot sits in. Default 'base'. */
  readonly layer?: 'base' | 'raised';
  /** Whether a reappearance enters from its anchor's side instead of from the right. Default false. */
  readonly anchoredEnter?: boolean;
}

/**
 * The widths of the present panels a drag can cross, nearest first on each side. An always-shown column is
 * included: only the dragged panel must be collapsible.
 * @public
 */
export interface NeighborWidths {
  readonly left: readonly number[];
  readonly right: readonly number[];
}

/**
 * A row entry narrowed to what a view may see. Every place that hands a panel to a view goes through this one
 * function, so no view ever sees a layout field; `formFactor` and `size` are forwarded.
 * @public
 */
export const summarisePanel = ({ id, url, title, live, locked, params, formFactor, size }: PanelRowEntry): PanelSummary => ({
  id, url, title, live, locked, params,
  // Absent, not undefined, when the record lacks them: a summary never lists a key its record never had.
  ...(formFactor !== undefined ? { formFactor } : {}),
  ...(size !== undefined ? { size } : {}),
});
