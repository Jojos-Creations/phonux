/**
 * front-page-link-windows-primary-panel-unification, part 3 (owner-added,
 * 2026-09-14): pure overflow/collapse arithmetic shared between the main
 * process (electron/main.ts's real window resize, driven off a real
 * `display.workAreaSize.width`) and the renderer (client/src/GoalFrontPage.tsx's
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
 * client/src/GoalFrontPage.tsx exactly the way top-level src/navigate.ts and
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
  /** The window's own fixed 3-phone baseline (sidebar + compose + one result panel) -- electron/main.ts's own `1250`, matching createWindow's minWidth. */
  baseWidth: number;
  /**
   * Live, non-primary panels beyond that baseline (client/src/GoalFrontPage.tsx's
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
