/**
 * Characterization tests for plans/records/front-page-panel-manager-
 * characterization-tests.md, behavior 1: `usePanelManager.ts`'s
 * `collapseCountForNewPanel(panelsNow)` (extracted out of
 * `GoalFrontPage.tsx` by front-page-scope-use-panel-manager-hook, then its
 * own `baseWidth` fixed by front-page-strip-task-prompt's `fixedColumnCount`
 * threading -- see that file's own doc comments) -- its count-mode and
 * overflow-mode collapse-count decisions.
 *
 * `collapseCountForNewPanel` is a closure defined inside the `usePanelManager`
 * hook body (not a separately exported function), so it cannot be called
 * directly without either rendering the whole hook or extracting it -- and
 * extracting it would be a refactor, which this entry (pure test-writing
 * against unchanged behavior) explicitly is not. Its own source (verified
 * live, usePanelManager.ts) is exactly this, verbatim:
 *
 *   const liveCountAfter = panelsNow.filter((p) => p.live).length + 1;
 *   if (maxViews.mode === 'count') {
 *     if (!countModeShouldCollapse(liveCountAfter, maxViews, fixedColumnCount)) return 0;
 *     return Math.max(0, liveCountAfter - countModeTargetLiveWebviews(maxViews, fixedColumnCount));
 *   }
 *   const extraCountAfter = panelsNow.filter((p) => p.live).length + 1;
 *   const overflow = predictWouldOverflow({ baseWidth, extraCount: extraCountAfter, perPanel: phoneWidth + GAP, displayWidth: displayWidth() });
 *   return overflow ? 1 : 0;
 *
 * i.e. a thin dispatch over two ALREADY-exported, already-unit-tested pure
 * primitives (`countModeShouldCollapse`/`countModeTargetLiveWebviews` from
 * client/src/desktop/settings/adventureSettings.ts, `predictWouldOverflow` from
 * src/panel-layout.ts) plus its own live-panel counting. This file pins that
 * exact dispatch formula against those real primitives directly (not a
 * fresh reimplementation of the math the primitives themselves already
 * cover) so a future extraction has something to diff against. The
 * overflow-mode branch's WRAPPER-level plumbing (that a real overflowing
 * open really does collapse exactly one panel, the oldest by array order,
 * and never a second time for the same overflow event) is additionally
 * exercised at the mount level (D6, 2026-09-22, replacing the CDP files this
 * comment used to name -- their subject, the old drag-onto-History flow,
 * is gone; test/dead-end-drag-drop-integration.test.ts is now the one
 * real-Electron smoke test) by test/goal-front-page-mount.test.ts's T9a,
 * T9c and T10a-T10d and test/goal-front-page-row-shell.test.ts's RS1, RS2,
 * RS6a and RS6b.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countModeShouldCollapse,
  countModeTargetLiveWebviews,
  type MaxViewsSettings,
} from '../client/src/desktop/settings/adventureSettings.js';
import { predictWouldOverflow } from '../src/panel-layout.js';
import { autoCollapseOldest, type PanelWindow } from '../client/src/desktop/panels/panelWindow.js';

function panel(id: string, live: boolean): PanelWindow {
  return { id, url: `http://example.test/${id}`, webContentsId: null, sourceWebContentsId: 1, live, locked: false };
}

/** Verbatim replica of collapseCountForNewPanel's own count-mode branch, see this file's header. */
function countModeCollapseCount(liveCountAfter: number, settings: MaxViewsSettings, fixedViewCount: number): number {
  if (!countModeShouldCollapse(liveCountAfter, settings, fixedViewCount)) return 0;
  return Math.max(0, liveCountAfter - countModeTargetLiveWebviews(settings, fixedViewCount));
}

/** Verbatim replica of collapseCountForNewPanel's own overflow-mode branch, see this file's header. */
function overflowModeCollapseCount(extraCountAfter: number, baseWidth: number, perPanel: number, displayWidth: number): number {
  const overflow = predictWouldOverflow({ baseWidth, extraCount: extraCountAfter, perPanel, displayWidth });
  return overflow ? 1 : 0;
}

test("collapseCountForNewPanel count-mode: returns 0 below collapseAtViews, then exactly enough to reach downToViews", () => {
  const settings: MaxViewsSettings = { mode: 'count', collapseAtViews: 6, downToViews: 4 };
  // fixedViewCount 3 + liveCountAfter live webviews. collapseAtViews=6
  // means the trigger is liveCountAfter >= 3 (3 fixed + 3 live = 6).
  assert.equal(countModeCollapseCount(1, settings, 3), 0, 'well under the trigger -- must not collapse anything');
  assert.equal(countModeCollapseCount(2, settings, 3), 0, 'still under the trigger (3+2=5 < 6)');
  assert.equal(countModeCollapseCount(3, settings, 3), 2, 'exactly at the trigger (3+3=6) -- downToViews=4 targets 1 live webview, so 3 live minus 1 target collapses 2');
  assert.equal(countModeCollapseCount(4, settings, 3), 3, 'well past the trigger -- collapses down to the 1-live-webview target regardless of how far past');
});

test('collapseCountForNewPanel count-mode: a stricter downToViews collapses further, a looser one collapses less', () => {
  const strict: MaxViewsSettings = { mode: 'count', collapseAtViews: 6, downToViews: 3 };
  const loose: MaxViewsSettings = { mode: 'count', collapseAtViews: 6, downToViews: 5 };
  assert.equal(countModeCollapseCount(3, strict, 3), 3, 'downToViews=3 (0 live webviews target) collapses all 3');
  assert.equal(countModeCollapseCount(3, loose, 3), 1, 'downToViews=5 (2 live webviews target) collapses only down to 2');
});

test('collapseCountForNewPanel count-mode: a smaller fixedViewCount (e.g. Settings hidden this session) reaches the trigger with more live webviews', () => {
  const settings: MaxViewsSettings = { mode: 'count', collapseAtViews: 6, downToViews: 4 };
  assert.equal(countModeCollapseCount(3, settings, 1), 0, 'fixedViewCount 1: 1+3=4, still under the trigger of 6');
  assert.equal(countModeCollapseCount(5, settings, 1), 2, 'fixedViewCount 1: 1+5=6 triggers; downToViews=4 targets 3 live webviews, so 5 minus 3 collapses 2');
});

test('collapseCountForNewPanel overflow-mode: never collapses more than exactly 1, regardless of how far the row would overflow', () => {
  const baseWidth = 1250;
  const perPanel = 420;
  const displayWidth = 1920;
  // extraCountAfter=1 fits comfortably (1250+420=1670 < 1920) -- no overflow.
  assert.equal(overflowModeCollapseCount(1, baseWidth, perPanel, displayWidth), 0, 'one extra panel must fit on a normal display -- no collapse');
  // extraCountAfter=5 overflows badly (1250+5*420=3350 > 1920) -- collapses,
  // but the wrapper's own `return overflow ? 1 : 0` means AT MOST 1 per call,
  // never scaled to how far over the display width the row would land.
  assert.equal(overflowModeCollapseCount(5, baseWidth, perPanel, displayWidth), 1, 'however far over the display width, collapseCountForNewPanel only ever asks for exactly 1 at a time');
});

/**
 * Characterization for behavior 2, collapseOldestIds's ordering guarantee
 * (GoalFrontPage.tsx's own `.filter((p) => p.live).slice(0, count).map((p)
 * => p.id)`, called from `revealPanelProactively` -- not separately
 * exported, so not directly callable). Pinned here instead via
 * `autoCollapseOldest` (client/src/desktop/panels/panelWindow.ts, already exported and
 * already production-wired into the REACTIVE safety-net collapse path):
 * both implement the identical "the OLDEST live panel(s), by array order"
 * policy -- GoalFrontPage.tsx's own comment on `promoteToLive` names
 * `autoCollapseOldest` as "the SAME policy" this file's proactive path
 * uses. `autoCollapseOldest` only ever demotes exactly one (the reactive
 * path's own need), but that one is the SAME first-live-by-array-order
 * choice `collapseOldestIds` generalizes to N.
 */
test('autoCollapseOldest (the same "oldest live panel, by array order" policy collapseOldestIds generalizes to N): always demotes the FIRST live panel by array order, never a later one', () => {
  const panels = [panel('a', false), panel('b', true), panel('c', true), panel('d', true)];
  const result = autoCollapseOldest(panels)!;
  assert.ok(result, 'expected a demotion when at least one panel is live');
  assert.equal(result.find((p) => p.id === 'b')!.live, false, 'the first LIVE panel by array order (b, since a is already parked) must be the one demoted');
  assert.equal(result.find((p) => p.id === 'c')!.live, true, 'a later live panel must never be chosen over an earlier one');
  assert.equal(result.find((p) => p.id === 'd')!.live, true, 'a later live panel must never be chosen over an earlier one');
});

test('autoCollapseOldest: reordering the SAME panels changes which one is "oldest" -- it is purely array-order-driven, not id- or content-based', () => {
  const order1 = [panel('x', true), panel('y', true)];
  const order2 = [panel('y', true), panel('x', true)];
  assert.equal(autoCollapseOldest(order1)!.find((p) => p.id === 'x')!.live, false, 'x is first in order1 -- x must be demoted');
  assert.equal(autoCollapseOldest(order2)!.find((p) => p.id === 'y')!.live, false, 'y is first in order2 -- y must be demoted, proving the choice tracks array position, not panel identity');
});

test('collapseCountForNewPanel overflow-mode: a wider display tolerates more extra panels before collapsing', () => {
  const baseWidth = 1250;
  const perPanel = 420;
  assert.equal(overflowModeCollapseCount(2, baseWidth, perPanel, 1920), 1, 'a 1920-wide display cannot fit baseWidth + 2 extra panels (1250+840=2090 > 1920)');
  assert.equal(overflowModeCollapseCount(2, baseWidth, perPanel, 2560), 0, 'a 2560-wide display comfortably fits the same 2 extra panels (1250+840=2090 < 2560)');
});
