/**
 * front-page-link-windows-primary-panel-unification, part 3 (owner-added,
 * 2026-09-14): pure overflow/collapse arithmetic shared between the main
 * process (electron/main.ts's real window resize, driven off a real
 * `display.workAreaSize.width`) and the renderer (client/src/desktop/GoalFrontPage.tsx's
 * PROACTIVE, pre-mount overflow prediction, driven off `window.screen.availWidth`
 * -- a close-enough renderer-side read of the same real quantity, with no new
 * IPC round trip needed to ask the main process for it). The owner's own
 * instruction was explicit: "reuse/adapt what's already there... do NOT
 * invent new arithmetic from scratch" -- before this file, the three numbers
 * (baseWidth 1250, perPanel = phoneWidth + gap, the display-width cap) lived
 * ONLY inline inside electron/main.ts's 'window:report-panel-count' handler,
 * with no way for the renderer to predict the same outcome ahead of time
 * without either duplicating the arithmetic (drifts silently) or an async
 * IPC round trip (defeats the whole point of a PROACTIVE, pre-mount check).
 *
 * Zero Electron/DOM imports -- same reasoning as electron/reload-gate.ts's
 * own header comment -- so this is directly unit-testable under plain node
 * (test/panel-layout.test.ts), and importable from both electron/main.ts and
 * client/src/desktop/GoalFrontPage.tsx exactly the way top-level src/navigate.ts and
 * src/model.ts already are (both already imported from client/src/*.tsx AND
 * from electron/main.ts before this file existed).
 */

/**
 * The row's own overflow check (GoalFrontPage.tsx's ResizeObserver
 * callback, previously inline as `row.scrollWidth > container.clientWidth`)
 * -- true once the row's actual content is wider than the scrollable
 * container currently showing it.
 */
export function isRowOverflowing(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth > clientWidth;
}

export interface WindowGrowthInput {
  /**
   * The width of whatever always-rendered, non-webview columns the row
   * currently has (e.g. the Settings view and/or History panel) -- see
   * `computeBaseWidth` below for how callers derive this. NOT a fixed
   * constant: front-page-strip-task-prompt found this hardcoded at `1250`
   * (a stale "3-phone baseline" left over from the pre-strip sidebar +
   * compose + result-panel layout) long after that layout was gone, which
   * silently reserved a whole phantom column's worth of width and made the
   * row collapse one panel earlier than the screen could actually fit.
   */
  baseWidth: number;
  /**
   * Live, non-primary panels beyond that baseline (client/src/desktop/GoalFrontPage.tsx's
   * own live EXTRA-kind panel count) -- the primary panel's own slot is
   * already inside `baseWidth`, so it never adds to this count regardless of
   * whether it currently happens to be live or collapsed (see this entry's
   * own evidence report for why: the base layout is sized for it either
   * way). A negative value (nothing to report yet) is clamped to 0, never
   * shrinking the request below `baseWidth`.
   */
  extraCount: number;
  /** One phone's own width plus the row's own gap -- how much wider each additional panel makes the row. */
  perPanel: number;
  /**
   * The display's own available width -- Electron's `display.workAreaSize.width`
   * on the main-process side; the renderer-side PREDICTIVE check below reads
   * `window.screen.availWidth` instead, a standard, synchronous web API
   * available inside a `<webview>`'s host renderer with no IPC round trip,
   * and close enough to the real work area for a PREDICTION (never used to
   * actually size the OS window itself -- only main.ts's real handler does
   * that, off the real Electron value). The hard ceiling growth can never
   * exceed either way.
   */
  displayWidth: number;
}

/**
 * `WindowGrowthInput.baseWidth`, derived from however many fixed
 * (non-webview) columns the row actually has right now, rather than a
 * hardcoded guess -- both main-process callers (createWindow's `minWidth`,
 * the `window:report-panel-count` handler) and the renderer's own
 * proactive prediction (usePanelManager.ts) call this with the SAME
 * `fixedColumnCount` the renderer computed for itself (`fixedItemCount` in
 * GoalFrontPage.tsx), so "the base layout" always means the columns
 * actually on screen, not a number that quietly drifts every time the
 * fixed-column layout changes.
 *
 * `fixedColumnCount` phone-width columns, `fixedColumnCount + 1` gaps (left
 * page padding, one gap between each pair of columns, right page padding),
 * plus a flat `slack` for the scrollbar the row would otherwise force --
 * same shape as this constant's own original, since-stale derivation
 * (3 phones + 4 gaps + 16 slack = 1250), just parameterized on the real
 * column count and the real (possibly user-resized) phone width instead of
 * the old fixed 390/3-column assumption.
 */
export function computeBaseWidth({
  fixedColumnCount,
  phoneWidth,
  gap,
  slack = 16,
}: {
  fixedColumnCount: number;
  phoneWidth: number;
  gap: number;
  slack?: number;
}): number {
  const columns = Math.max(0, fixedColumnCount);
  return columns * phoneWidth + (columns + 1) * gap + slack;
}

/** `baseWidth + max(0,extraCount) * perPanel`, capped at `displayWidth` -- the width electron/main.ts's real window resize (or the renderer's own prediction of it) computes before applying its own "never shrink" rule. */
export function desiredWindowWidth({ baseWidth, extraCount, perPanel, displayWidth }: WindowGrowthInput): number {
  const wanted = baseWidth + Math.max(0, extraCount) * perPanel;
  return Math.min(wanted, displayWidth);
}

/**
 * electron/main.ts's own 'window:report-panel-count' arithmetic in full,
 * including its "never shrink below whatever the window is already at
 * (fullscreen, or a human-resized size)" rule. `currentWidth` is a
 * separate parameter from `WindowGrowthInput` (not folded into it) because
 * `predictWouldOverflow` below deliberately never needs it -- see that
 * function's own doc comment for why.
 */
export function computeGrownWindowWidth(input: WindowGrowthInput & { currentWidth: number }): number {
  return Math.max(desiredWindowWidth(input), input.currentWidth);
}

/**
 * front-page-link-windows-primary-panel-unification, part 3 (owner-added):
 * would the row need MORE width than the window could actually grow to,
 * once `extraCount` reflects a panel that's about to be added? Reuses
 * `desiredWindowWidth`'s exact arithmetic rather than re-deriving it.
 *
 * `currentWidth` is deliberately never part of this check: the window's
 * CURRENT size (which `computeGrownWindowWidth`'s own "never shrink" rule
 * respects) has nothing to do with whether the DESTINATION width
 * (baseWidth + extraCount*perPanel, capped at the display) would exceed the
 * screen -- only the cap comparison matters for a prediction made BEFORE
 * anything has actually resized. True exactly when the display-capped width
 * is less than the row's own uncapped "wanted" width, i.e. growth alone
 * cannot cover the incoming panel and something must collapse first.
 */
export function predictWouldOverflow(input: WindowGrowthInput): boolean {
  const wanted = input.baseWidth + Math.max(0, input.extraCount) * input.perPanel;
  return desiredWindowWidth(input) < wanted;
}

/**
 * front-page-link-windows-primary-panel-unification, fix-up round (verifier
 * gap, evidence bullet 3): the third of the overflow/collapse mechanism's
 * pure extractions, alongside `isRowOverflowing` and
 * `desiredWindowWidth`/`computeGrownWindowWidth` above -- previously
 * `AUTO_COLLAPSE_SETTLE_MS` (GoalFrontPage.tsx) was a bare constant with no
 * comparison logic of its own to unit-test; the actual decision "has the
 * settle window elapsed since overflow first latched true" now lives here.
 *
 * GoalFrontPage.tsx's proactive-collapse effect records `latchedAtMs`
 * (`Date.now()`) the moment it schedules its settle-delay `setTimeout`, and
 * this function is called from inside that timeout's own callback (at fire
 * time, with `Date.now()` again as `nowMs`) to decide whether to actually
 * run the collapse -- a real, reachable go/no-go check for that call site
 * rather than a re-export of the constant, and the single place that
 * comparison lives (no duplicate inline `now - latchedAt >= settleMs` sits
 * beside it).
 */
export function shouldFireCollapse(latchedAtMs: number, nowMs: number, settleMs: number): boolean {
  return nowMs - latchedAtMs >= settleMs;
}

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
   * panels: the chat-compose panel (always 1) plus `showMiddleSlot`
   * (LiveViewPanel) and `showHistoryColumn` (the History panel) if shown --
   * computed by the caller from `panels`/`currentView` state, passed in as
   * a plain count so this function stays free of that state dependency.
   */
  fixedItemCount: number;
  /** How many panels are actually live right now (`panels.filter((p) =>
   * p.live).length`) -- computed by the caller from `panels` state, passed
   * in as a plain count for the same reason as `fixedItemCount`. */
  liveCountNow: number;
}

export interface RowLayoutResult {
  /** How many live panels the row can actually show before it would
   * overflow `containerWidth`, given the fixed items' own share of it. */
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
 * front-page-extract-row-centering-math: GoalFrontPage.tsx's row-centering
 * math, no DOM ref or effect dependency of its own (see this entry's own
 * plan record for why that -- not "zero state dependency at all" -- is the
 * property that actually matters here; `fixedItemCount`/`liveCountNow`
 * still ultimately derive from component state, just computed by the
 * caller and passed in as plain numbers).
 *
 * The fixed items have to be counted against what the row ACTUALLY renders,
 * or the arithmetic silently mis-centers by half an item -- this has
 * shipped wrong twice already (owner-caught, 2026-09-15, two separate
 * times) from the count being a hand-mirrored copy of the JSX conditions
 * rather than sharing their actual boolean; GoalFrontPage.tsx's own
 * `fixedItemCount` and the row's JSX further down still read the exact same
 * `showMiddleSlot`/`showHistoryColumn` source of truth this depends on.
 */
export function computeRowLayout({
  containerWidth,
  phoneWidth,
  gap,
  fixedItemCount,
  liveCountNow,
}: RowLayoutInput): RowLayoutResult {
  const availableForRow = Math.max(0, containerWidth - 2 * gap);
  const fixedWidth = fixedItemCount * phoneWidth + (fixedItemCount - 1) * gap;
  const maxLiveThatFit = Math.max(0, Math.floor((availableForRow - fixedWidth) / (phoneWidth + gap)));
  const effectiveLiveCount = Math.min(liveCountNow, maxLiveThatFit);
  const rowTotalWidth = fixedWidth + effectiveLiveCount * (phoneWidth + gap);
  const computedRowMarginLeft = Math.max(0, (availableForRow - rowTotalWidth) / 2);
  return { maxLiveThatFit, effectiveLiveCount, rowTotalWidth, computedRowMarginLeft };
}
