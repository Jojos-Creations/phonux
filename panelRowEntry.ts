/**
 * The row's own record of one panel, and the one projection from it to what a view may see. The row needs
 * layout fields a view must never read, so the two are separate types (see DESIGN.md, PanelSummary).
 */
import type { JsonValue, PanelSummary } from './hostApi.js';
import type { PanelAnchor } from './panelRowOrder.js';
import type { ResolvedPanelSettings } from './panelSettings.js';

/**
 * One entry of a panel row: everything a view sees (PanelSummary) plus the layout fields only the row reads.
 * @public
 */
export interface PanelRowEntry<P = JsonValue> extends PanelSummary<P> {
  /** The id of the template that renders this entry. A name no template answers to renders a placeholder, never a crash. */
  readonly view: string;
  /** False for an always-shown column: the row never parks it and it is never a drag source. */
  readonly collapsible: boolean;
  /** Where this entry sits in the row. Undefined for the row's root; any other entry without one stays where it stands. */
  readonly anchor?: PanelAnchor;
  /** Which of the row's two stacking tiers this entry's slot sits in. Default 'base'. */
  readonly layer?: 'base' | 'raised';
  /** Whether a reappearance enters from its anchor's side instead of from the right. Default false. */
  readonly anchoredEnter?: boolean;
  /** The resolved settings this entry was made under; absent for a hand-built entry. */
  readonly settings?: ResolvedPanelSettings;
  /** This entry's stable name, written once when it is created from settings; a hand-built entry has none and its `id` stands in. */
  readonly key?: string;
  /** True only for the reserved '__root__' entry a row without a root keeps so every other entry has something to anchor to: it stays in the array and is never drawn, priced, counted or hopped over. */
  readonly marker?: true;
}

/**
 * Whether `p` is drawn in the row: an always-shown column, or a parkable entry while it is live, and never the
 * marker. Every reader of presence goes through this one function, so a marker excluded here is excluded everywhere.
 * @internal
 */
export const isPresent = (p: { collapsible: boolean; live: boolean; marker?: boolean }): boolean => p.marker !== true && (!p.collapsible || p.live);

/**
 * The widths of the present panels a drag can cross, nearest first on each side. An always-shown column is
 * included: only the dragged panel must be collapsible.
 * @public
 */
export interface NeighborWidths {
  /** Widths in px of the present panels left of the dragged one, nearest first. */
  readonly left: readonly number[];
  /** Widths in px of the present panels right of the dragged one, nearest first. */
  readonly right: readonly number[];
}

/**
 * A row entry narrowed to what a view may see. Every place that hands a panel to a view goes through this one
 * function, so no view ever sees a layout field; `slots` and `size` are forwarded.
 * @internal
 */
export const summarisePanel = ({ id, key, url, title, live, locked, params, size, slots, settings }: PanelRowEntry): PanelSummary => ({
  id: key ?? id, url, title, live, locked, params,
  // Absent, not undefined, when the record lacks them: a summary never lists a key its record never had.
  ...(size !== undefined ? { size } : {}),
  ...(slots !== undefined ? { slots } : {}),
  ...(settings !== undefined ? { maxSlots: settings.maxSlots } : {}),
});
