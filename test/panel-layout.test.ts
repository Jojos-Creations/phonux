/**
 * computeRowLayout is the one pure "how many fit" function usePanelManager's capacity and
 * SettingsAPI's fitCount both derive from: it must stay free of window-resize or DOM-overflow
 * side effects so a wider panel lowers the count instead of the row ever growing the OS window.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRowLayout } from '../src/panel-layout.js';

test('computeRowLayout: live panels that comfortably fit are not capped, and the row centers with a positive margin', () => {
  const result = computeRowLayout({
    containerWidth: 1250,
    phoneWidth: 390,
    gap: 16,
    fixedItemCount: 1,
    liveWidths: [390, 390],
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
    liveWidths: [390, 390, 390, 390, 390],
  });
  assert.equal(result.maxLiveThatFit, 2);
  assert.equal(result.effectiveLiveCount, 2, 'liveWidths.length (5) must be capped at maxLiveThatFit (2), not used raw');
  assert.equal(result.rowTotalWidth, 1202);
  assert.equal(result.computedRowMarginLeft, 8);
});

test('computeRowLayout: all 3 fixed slots shown (compose + middle slot + history) leaves zero room for live panels here', () => {
  const result = computeRowLayout({
    containerWidth: 1250,
    phoneWidth: 390,
    gap: 16,
    fixedItemCount: 3,
    liveWidths: [],
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
    liveWidths: [390],
  });
  assert.equal(result.maxLiveThatFit, 0, 'a negative raw fit must clamp to 0, not go negative');
  assert.equal(result.effectiveLiveCount, 0);
  assert.equal(result.computedRowMarginLeft, 0, 'an overflowing row must never get a negative margin');
});

test('computeRowLayout: at containerWidth 0 (unmeasured), maxLiveThatFit is 0 -- usePanelManager/SettingsAPI treat this as "no measurement yet" (null), never as a real fit count', () => {
  const result = computeRowLayout({ containerWidth: 0, phoneWidth: 390, gap: 16, fixedItemCount: 1, liveWidths: [390, 390, 390] });
  assert.equal(result.maxLiveThatFit, 0);
  assert.equal(result.computedRowMarginLeft, 0);
});

// ---------------------------------------------------------------------------
// The pre-Phase-3 formula, kept here verbatim ONLY as a fixed reference for the equal-widths property test
// below (its own now-replaced signature took `liveCountNow: number`) -- never imported by production code.
// ---------------------------------------------------------------------------
function oldComputeRowLayout({
  containerWidth,
  phoneWidth,
  gap,
  fixedItemCount,
  liveCountNow,
}: {
  containerWidth: number;
  phoneWidth: number;
  gap: number;
  fixedItemCount: number;
  liveCountNow: number;
}) {
  const availableForRow = Math.max(0, containerWidth - 2 * gap);
  const fixedWidth = fixedItemCount * phoneWidth + (fixedItemCount - 1) * gap;
  const maxLiveThatFit = Math.max(0, Math.floor((availableForRow - fixedWidth) / (phoneWidth + gap)));
  const effectiveLiveCount = Math.min(liveCountNow, maxLiveThatFit);
  const rowTotalWidth = fixedWidth + effectiveLiveCount * (phoneWidth + gap);
  const computedRowMarginLeft = Math.max(0, (availableForRow - rowTotalWidth) / 2);
  return { maxLiveThatFit, effectiveLiveCount, rowTotalWidth, computedRowMarginLeft };
}

test('property: with every live panel forced to the same phoneWidth, the generalized computeRowLayout(liveWidths) is byte-identical to the pre-Phase-3 single-width formula, across a sweep of container widths, counts and fixed columns', () => {
  const containerWidths = [0, 400, 800, 1250, 1301, 2000, 2500];
  const fixedItemCounts = [0, 1, 2, 3];
  const counts = [0, 1, 2, 3, 5, 8];
  const phoneWidth = 390;
  const gap = 16;
  let comparisons = 0;
  for (const containerWidth of containerWidths) {
    for (const fixedItemCount of fixedItemCounts) {
      for (const liveCountNow of counts) {
        const liveWidths = Array.from({ length: liveCountNow }, () => phoneWidth);
        const expected = oldComputeRowLayout({ containerWidth, phoneWidth, gap, fixedItemCount, liveCountNow });
        const actual = computeRowLayout({ containerWidth, phoneWidth, gap, fixedItemCount, liveWidths });
        assert.deepEqual(actual, expected, `containerWidth=${containerWidth} fixedItemCount=${fixedItemCount} liveCountNow=${liveCountNow}`);
        comparisons++;
      }
    }
  }
  // The sweep itself must actually have run every combination -- a loop that silently iterated zero times
  // would report this test green having proven nothing.
  assert.equal(comparisons, containerWidths.length * fixedItemCounts.length * counts.length);
});

test('mixed-width row: one desktop-size (1200) panel among phone-size (390) ones lowers maxLiveThatFit strictly below an all-phone row of the same containerWidth -- concrete numbers', () => {
  const shared = { containerWidth: 2500, phoneWidth: 390, gap: 16, fixedItemCount: 1 };
  const allPhone = computeRowLayout({ ...shared, liveWidths: [390, 390, 390, 390] });
  const mixed = computeRowLayout({ ...shared, liveWidths: [390, 390, 1200, 390] });
  assert.equal(allPhone.maxLiveThatFit, 5, 'all 4 given phones fit (1624 <= 2078 used budget) plus 1 more hypothetical phoneWidth slot');
  assert.equal(mixed.maxLiveThatFit, 3, 'the desktop panel (1216 with its gap) leaves no room for the 4th given phone (2028 + 406 = 2434 > 2078)');
  assert.ok(mixed.maxLiveThatFit < allPhone.maxLiveThatFit, `mixed (${mixed.maxLiveThatFit}) must be strictly lower than all-phone (${allPhone.maxLiveThatFit})`);
});
