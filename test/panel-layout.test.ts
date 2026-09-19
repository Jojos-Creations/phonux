/**
 * front-page-link-windows-primary-panel-unification: unit coverage for the
 * overflow threshold, the window-growth arithmetic, and part 3's own
 * (owner-added) proactive-overflow prediction -- src/panel-layout.ts's own
 * header comment explains why this lives in a plain, Electron-free module
 * importable from both electron/main.ts and client/src/desktop/GoalFrontPage.tsx.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGrownWindowWidth,
  computeRowLayout,
  desiredWindowWidth,
  isRowOverflowing,
  predictWouldOverflow,
  shouldFireCollapse,
} from '../src/panel-layout.js';

test('isRowOverflowing: true once the row is wider than the container showing it', () => {
  assert.equal(isRowOverflowing(2000, 1250), true);
});

test('isRowOverflowing: false when the row fits exactly or with room to spare', () => {
  assert.equal(isRowOverflowing(1250, 1250), false);
  assert.equal(isRowOverflowing(900, 1250), false);
});

test('desiredWindowWidth: baseWidth alone when there are no extra panels', () => {
  assert.equal(desiredWindowWidth({ baseWidth: 1250, extraCount: 0, perPanel: 406, displayWidth: 3000 }), 1250);
});

test('desiredWindowWidth: grows by exactly one perPanel per extra panel', () => {
  assert.equal(desiredWindowWidth({ baseWidth: 1250, extraCount: 2, perPanel: 406, displayWidth: 3000 }), 1250 + 2 * 406);
});

test('desiredWindowWidth: a negative extraCount never shrinks the request below baseWidth', () => {
  assert.equal(desiredWindowWidth({ baseWidth: 1250, extraCount: -3, perPanel: 406, displayWidth: 3000 }), 1250);
});

test('desiredWindowWidth: capped at the display width once the raw request would exceed it', () => {
  assert.equal(desiredWindowWidth({ baseWidth: 1250, extraCount: 10, perPanel: 406, displayWidth: 3000 }), 3000);
});

test('computeGrownWindowWidth: grows past the current window size when the desired width is bigger', () => {
  assert.equal(
    computeGrownWindowWidth({ baseWidth: 1250, extraCount: 1, perPanel: 406, displayWidth: 3000, currentWidth: 1250 }),
    1250 + 406,
  );
});

test('computeGrownWindowWidth: never shrinks below the current window size (a human-resized or fullscreen window)', () => {
  // The owner or the OS already chose 2600 -- one extra panel alone would
  // only ask for 1656, which must never shrink the window back down.
  assert.equal(
    computeGrownWindowWidth({ baseWidth: 1250, extraCount: 1, perPanel: 406, displayWidth: 3000, currentWidth: 2600 }),
    2600,
  );
});

test('computeGrownWindowWidth: the display cap still applies even against a smaller current width', () => {
  assert.equal(
    computeGrownWindowWidth({ baseWidth: 1250, extraCount: 20, perPanel: 406, displayWidth: 3000, currentWidth: 1250 }),
    3000,
  );
});

// ---------------------------------------------------------------------------
// predictWouldOverflow: part 3's own proactive, pre-mount prediction --
// "accounting for the fact that the window itself grows to accommodate a few
// panels before collapse is ever needed" (owner spec) means the FIRST few
// extra panels must never predict an overflow, only once growth alone can no
// longer keep up with the display's own ceiling.
// ---------------------------------------------------------------------------

test('predictWouldOverflow: false for the very first extra panel -- growth alone covers it (must never collapse on the first one)', () => {
  assert.equal(
    predictWouldOverflow({ baseWidth: 1250, extraCount: 1, perPanel: 406, displayWidth: 3000 }),
    false,
  );
});

test('predictWouldOverflow: false right up to the exact display width', () => {
  // baseWidth 1250 + 4*406 = 2874, still under 3000.
  assert.equal(
    predictWouldOverflow({ baseWidth: 1250, extraCount: 4, perPanel: 406, displayWidth: 3000 }),
    false,
  );
});

test('predictWouldOverflow: true once the desired width would exceed the display, even though growth still helps', () => {
  // baseWidth 1250 + 5*406 = 3280, now past displayWidth 3000 -- growth gets
  // capped at 3000, which is less than the row actually needs.
  assert.equal(
    predictWouldOverflow({ baseWidth: 1250, extraCount: 5, perPanel: 406, displayWidth: 3000 }),
    true,
  );
});

test('predictWouldOverflow: exactly at the display width is NOT an overflow (>= fits, per isRowOverflowing\'s own strict ">" semantics)', () => {
  assert.equal(
    predictWouldOverflow({ baseWidth: 1250, extraCount: 0, perPanel: 406, displayWidth: 1250 }),
    false,
  );
});

// ---------------------------------------------------------------------------
// shouldFireCollapse: fix-up round (evidence bullet 3) -- the third pure
// extraction, backing GoalFrontPage.tsx's AUTO_COLLAPSE_SETTLE_MS debounce.
// ---------------------------------------------------------------------------

test('shouldFireCollapse: false before the settle window has elapsed', () => {
  assert.equal(shouldFireCollapse(1_000, 1_499, 500), false);
});

test('shouldFireCollapse: true exactly at the settle boundary', () => {
  assert.equal(shouldFireCollapse(1_000, 1_500, 500), true);
});

test('shouldFireCollapse: true once well past the settle window', () => {
  assert.equal(shouldFireCollapse(1_000, 5_000, 500), true);
});

test('shouldFireCollapse: false when nowMs is somehow before latchedAtMs (clock skew never fires early)', () => {
  assert.equal(shouldFireCollapse(1_000, 900, 500), false);
});

// ---------------------------------------------------------------------------
// computeRowLayout: front-page-extract-row-centering-math -- previously bare
// inline arithmetic in GoalFrontPage.tsx with no unit coverage of its own,
// twice shipped mis-centered (owner-caught, 2026-09-15) from a hand-mirrored
// fixed-item count drifting from what the row actually rendered.
// ---------------------------------------------------------------------------

test('computeRowLayout: live panels that comfortably fit are not capped, and the row centers with a positive margin', () => {
  const result = computeRowLayout({
    containerWidth: 1250,
    phoneWidth: 390,
    gap: 16,
    fixedItemCount: 1,
    liveCountNow: 2,
  });
  assert.equal(result.maxLiveThatFit, 2);
  assert.equal(result.effectiveLiveCount, 2);
  assert.equal(result.rowTotalWidth, 1202);
  assert.equal(result.computedRowMarginLeft, 8);
});

test('computeRowLayout: more live panels than fit are capped at maxLiveThatFit for the width/centering math', () => {
  const result = computeRowLayout({
    containerWidth: 1250,
    phoneWidth: 390,
    gap: 16,
    fixedItemCount: 1,
    liveCountNow: 5,
  });
  assert.equal(result.maxLiveThatFit, 2);
  assert.equal(result.effectiveLiveCount, 2, 'liveCountNow (5) must be capped at maxLiveThatFit (2), not used raw');
  assert.equal(result.rowTotalWidth, 1202);
  assert.equal(result.computedRowMarginLeft, 8);
});

test('computeRowLayout: all 3 fixed slots shown (compose + middle slot + history) leaves zero room for live panels here', () => {
  const result = computeRowLayout({
    containerWidth: 1250,
    phoneWidth: 390,
    gap: 16,
    fixedItemCount: 3,
    liveCountNow: 0,
  });
  assert.equal(result.maxLiveThatFit, 0);
  assert.equal(result.effectiveLiveCount, 0);
  assert.equal(result.rowTotalWidth, 1202);
  assert.equal(result.computedRowMarginLeft, 8);
});

test('computeRowLayout: fixed items alone already exceed the container -- maxLiveThatFit and computedRowMarginLeft both floor at 0, never negative', () => {
  const result = computeRowLayout({
    containerWidth: 800,
    phoneWidth: 390,
    gap: 16,
    fixedItemCount: 3,
    liveCountNow: 1,
  });
  assert.equal(result.maxLiveThatFit, 0, 'a negative raw fit must clamp to 0, not go negative');
  assert.equal(result.effectiveLiveCount, 0);
  assert.equal(result.computedRowMarginLeft, 0, 'an overflowing row must never get a negative margin');
});
