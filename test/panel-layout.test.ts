/**
 * src/panel-layout.ts: `computeRowLayout`, the row's centring math and the one pure "how many fit" function
 * usePanelManager.ts's `capacity`/SettingsAPI's `fitCount` both derive from. ux-row-scroll-by-hiding removed
 * this file's own window-growth arithmetic (`desiredWindowWidth`/`computeGrownWindowWidth`/`computeBaseWidth`/
 * `predictWouldOverflow`), the DOM-overflow check (`isRowOverflowing`) and the settle-window comparison
 * (`shouldFireCollapse`) along with the maxViews/autoCollapse model they served -- the row now hides its far
 * panel at a hard, measured capacity, never by growing the OS window or reacting to a DOM overflow reading.
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

test('computeRowLayout: at containerWidth 0 (unmeasured), maxLiveThatFit is 0 -- usePanelManager/SettingsAPI treat this as "no measurement yet" (null), never as a real fit count', () => {
  const result = computeRowLayout({ containerWidth: 0, phoneWidth: 390, gap: 16, fixedItemCount: 1, liveCountNow: 3 });
  assert.equal(result.maxLiveThatFit, 0);
  assert.equal(result.computedRowMarginLeft, 0);
});
