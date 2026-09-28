/**
 * computeRowLayout is the one pure "how many fit" function usePanelManager's capacity and
 * SettingsAPI's fitCount both derive from: it must stay free of window-resize or DOM-overflow
 * side effects so a wider panel lowers the count instead of the row ever growing the OS window.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMaxLiveWidth, computeRowLayout } from '../client/src/shared/phone/panelRowLayout.js';

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

// The single-width formula, kept here verbatim ONLY as a fixed reference for the equal-widths
// property test below (it took `liveCountNow: number`, unlike production's `liveWidths` array) --
// never imported by production code.
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

test('computeMaxLiveWidth: the widest ONE live panel can be beside the fixed columns -- 842 in the default 1280 window, 1482 at 1920, 406 at the 844 minimum (History alone, phone 390)', () => {
  const at = (containerWidth: number, fixedItemCount = 1, phoneWidth = 390) => computeMaxLiveWidth({ containerWidth, phoneWidth, gap: 16, fixedItemCount });
  assert.equal(at(1280), 842, '1280 - 2*16 (padding) - 390 (History) - 16 (the gap before the panel)');
  assert.equal(at(1920), 1482);
  assert.equal(at(844), 406);
  assert.equal(at(1280, 2), 436, 'a second fixed column takes its width and a gap');
  assert.equal(at(0), Number.POSITIVE_INFINITY, 'unmeasured (0): no cap before the first measurement');
  assert.equal(at(1280, 3), 390, 'the fixed columns alone overflow: never narrower than a phone, which would not fit either');
  assert.equal(at(844, 1, 430), 430, 'a phone model too wide for the window: the floor is that phone width');
});

test('property: computeMaxLiveWidth is computeRowLayout\'s own budget -- one panel exactly that wide fits beside the fixed columns, one px wider does not', () => {
  const containerWidths = [844, 1000, 1280, 1500, 1920, 2600];
  const fixedItemCounts = [0, 1, 2];
  const phoneWidths = [360, 390, 430];
  const gap = 16;
  let checked = 0;
  let floored = 0;
  for (const containerWidth of containerWidths) {
    for (const fixedItemCount of fixedItemCounts) {
      for (const phoneWidth of phoneWidths) {
        const input = { containerWidth, phoneWidth, gap, fixedItemCount };
        const cap = computeMaxLiveWidth(input);
        const fitted = (width: number) => computeRowLayout({ ...input, liveWidths: [width] }).effectiveLiveCount;
        if (fitted(cap) === 0) {
          // Only the phone floor may be wider than what fits.
          assert.equal(cap, phoneWidth, `${JSON.stringify(input)}: a cap that does not fit must be the phone floor`);
          floored++;
          continue;
        }
        assert.equal(fitted(cap), 1, `${JSON.stringify(input)}: a panel ${cap} wide fits`);
        assert.equal(fitted(cap + 1), 0, `${JSON.stringify(input)}: ${cap + 1} does not`);
        assert.equal(computeRowLayout({ ...input, liveWidths: [cap] }).maxLiveThatFit, 1, 'and it leaves no room for another');
        checked++;
      }
    }
  }
  assert.equal(checked + floored, containerWidths.length * fixedItemCounts.length * phoneWidths.length, 'every combination ran');
  assert.ok(checked >= 40, `the sweep exercised the unfloored cap (${checked} cases), not only the floor`);
});
