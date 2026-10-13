/**
 * PanelsAPI.maxFitPanels: how many phone-width panels, permanent columns included, the window fits. Literal numbers are
 * worked by hand below so a test cannot restate the implementation; the row's capacity and the field share rowFitCount.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { effectiveMaxPanels, rowFitCount } from '../panelCapacity.js';
import { createFakeHost } from '../fakeHost.js';
import { cleanup } from './support/mount-harness.js';
import { capRig } from './support/cap-rig.js';

afterEach(cleanup);

/** Phone 390, gap 24, one permanent column: the row is container - 48 wide, History takes 390, each further panel 414. */
const fit = (containerWidth: number, fixedColumnCount = 1): number | null => {
  const n = rowFitCount({ containerWidth, phoneWidth: 390, gap: 24, fixedColumnCount, liveWidths: [] });
  return n === null ? null : effectiveMaxPanels(n, fixedColumnCount);
};

test('1800 px: (1800 - 48 - 390) / 414 = 3.29, so 3 panels beside History and 4 in all', () => {
  assert.equal(fit(1800), 4);
});

test('1266 px fits exactly 2 beside History (1266 - 48 - 390 = 828 = 2 * 414): 3 in all; 1265 px is a pixel short: 2', () => {
  assert.equal(fit(1266), 3);
  assert.equal(fit(1265), 2);
});

test('300 px, below one phone panel, still floors at the permanent columns plus one, as the row does', () => {
  assert.equal(fit(300), 2);
  assert.equal(fit(300, 2), 3);
});

test('unmeasured is null, never 0', () => {
  assert.equal(rowFitCount({ containerWidth: 0, phoneWidth: 390, gap: 24, fixedColumnCount: 1, liveWidths: [] }), null);
});

test('the fake host reports null until a test sets a number', () => {
  assert.equal(createFakeHost().panels.maxFitPanels, null);
  assert.equal(createFakeHost({ panels: { maxFitPanels: 6 } }).panels.maxFitPanels, 6);
});

test('the provider reports it, tracks a resize in the same render as the capacity, and a cap does not change it', async () => {
  const r = await capRig({ count: 3, width: 0 });
  assert.equal(r.provided().maxFitPanels, null);
  const cap = await capRig({ count: 3, cap: 1, width: 1800, tuning: { rowGap: 24 } });
  assert.equal(cap.provided().maxFitPanels, fit(1800));
  const wide = await capRig({ count: 3, width: 1266, tuning: { rowGap: 24 } });
  assert.equal(wide.provided().maxFitPanels, 3);
  wide.turn(() => wide.m.setWidth(1265));
  assert.equal(wide.provided().maxFitPanels, 2);
});

test('the provider applies the row floor: a 300 px window, below one phone panel, reports 2 with History alone, not the raw 1', async () => {
  const r = await capRig({ count: 2, width: 300, tuning: { rowGap: 24 } });
  assert.equal(r.provided().maxFitPanels, 2);
});
