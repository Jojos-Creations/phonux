/**
 * Pure row-layout arithmetic, shared between the renderer's row shell (client/src/desktop/row/useRowShell.ts)
 * and its panel manager (client/src/desktop/panels/usePanelManager.ts). Zero Electron/DOM imports, so this is
 * directly unit-testable under plain node (test/panel-layout.test.ts).
 */

export interface RowLayoutInput {
  /** GoalFrontPage.tsx's own measured row container width (a `useState`
   * populated by a ResizeObserver -- the DOM/effect wiring itself stays in
   * the component; only the arithmetic that consumes the resulting number
   * moves here). */
  containerWidth: number;
  /** PanelFrame's own default width -- every fixed and live row item alike
   * is exactly this wide. */
  phoneWidth: number;
  /** The row's own gap between adjacent items (LivePanelSlot's `GAP`). */
  gap: number;
  /**
   * How many non-live, always-rendered slots the row holds before any live
   * panels: History (and Settings, when it is its own column) -- computed by
   * the caller from `panels`/`currentView` state, passed in as a plain count
   * so this function stays free of that state dependency.
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
   * available width -- 0 once the row is at or past capacity, matching the
   * unmoved `Math.max(0, ...)` floor this had before extraction. */
  computedRowMarginLeft: number;
}

/**
 * GoalFrontPage.tsx's row-centering math, no DOM ref or effect dependency of its own (`fixedItemCount`/
 * `liveCountNow` still ultimately derive from component state, just computed by the caller and passed in as
 * plain numbers). The fixed items have to be counted against what the row ACTUALLY renders, or the
 * arithmetic silently mis-centers by half an item -- this has shipped wrong twice already (owner-caught,
 * 2026-09-15, two separate times) from the count being a hand-mirrored copy of the JSX conditions rather
 * than sharing their actual boolean.
 *
 * `maxLiveThatFit` is also the one pure "how many fit" function usePanelManager.ts's `capacity` and
 * SettingsAPI's `fitCount` both derive from, at a `liveCountNow` of 0 -- keeping "how many fit" as one
 * function of container width and panel widths means a wider panel (design-ux-system-split's future
 * phone->tablet->desktop panels) lowers the count instead of overflowing unnoticed.
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
