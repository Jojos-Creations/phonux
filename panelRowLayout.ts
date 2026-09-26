/**
 * Pure row-layout arithmetic, shared between the renderer's row shell (client/src/desktop/row/useRowShell.ts)
 * and its panel manager (client/src/desktop/panels/usePanelManager.ts). Zero Electron/DOM imports, so this is
 * directly unit-testable under plain node (test/panel-layout.test.ts).
 */

export interface RowLayoutInput {
  /** The row container's measured width (useRowShell.ts's ResizeObserver);
   * the DOM wiring stays there so this function has none. */
  containerWidth: number;
  /** PanelFrame's own default width -- every fixed and live row item alike
   * is exactly this wide. */
  phoneWidth: number;
  /** The row's own gap between adjacent items (LivePanelSlot's `GAP`). */
  gap: number;
  /**
   * How many always-rendered (non-collapsible) slots the row holds before any
   * live panels -- History today. A plain count so this function stays free
   * of the caller's panel state.
   */
  fixedItemCount: number;
  /** How many panels are actually live right now (`panels.filter((p) =>
   * p.live).length`) -- computed by the caller from `panels` state, passed
   * in as a plain count for the same reason as `fixedItemCount`. */
  liveCountNow: number;
}

export interface RowLayoutResult {
  /** How many live panels the row can actually show before it would
   * overflow `containerWidth`, given the fixed items' own share of it --
   * usePanelManager.ts's own `fitCount` and `capacity` are derived from
   * this. */
  maxLiveThatFit: number;
  /** `liveCountNow`, capped at `maxLiveThatFit` -- what the row actually
   * renders width-wise (rendering itself is still `liveCountNow`-driven
   * elsewhere; this is only the centering math's own capped view of it). */
  effectiveLiveCount: number;
  /** The fixed items' width plus the live items' width, at
   * `effectiveLiveCount`. */
  rowTotalWidth: number;
  /** The `marginLeft` that centers `rowTotalWidth` inside the row's
   * available width -- floored at 0 once the row is at or past capacity. */
  computedRowMarginLeft: number;
}

/**
 * The row's centering math. `fixedItemCount` must come from the same array the row's JSX renders, never a
 * hand-mirrored copy of its conditions: a count that drifts from what is drawn mis-centers the row by half
 * an item, silently.
 *
 * `maxLiveThatFit` (at a `liveCountNow` of 0) is the one "how many fit" function usePanelManager.ts's
 * `capacity` and SettingsAPI's `fitCount` both derive from, so a wider panel lowers the count instead of
 * overflowing unnoticed.
 */
export function computeRowLayout({ containerWidth, phoneWidth, gap, fixedItemCount, liveCountNow }: RowLayoutInput): RowLayoutResult {
  const availableForRow = Math.max(0, containerWidth - 2 * gap);
  const fixedWidth = fixedItemCount * phoneWidth + (fixedItemCount - 1) * gap;
  const maxLiveThatFit = Math.max(0, Math.floor((availableForRow - fixedWidth) / (phoneWidth + gap)));
  const effectiveLiveCount = Math.min(liveCountNow, maxLiveThatFit);
  const rowTotalWidth = fixedWidth + effectiveLiveCount * (phoneWidth + gap);
  const computedRowMarginLeft = Math.max(0, (availableForRow - rowTotalWidth) / 2);
  return { maxLiveThatFit, effectiveLiveCount, rowTotalWidth, computedRowMarginLeft };
}
