/**
 * `effectiveMaxPanels` (adventureSettings.ts): the pure capacity decision usePanelManager.ts derives its live
 * cap from -- one hard capacity, never a mode.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveMaxPanels } from '../client/src/desktop/settings/adventureSettings.js';

test('effectiveMaxPanels: the full matrix the owner\'s spec names', () => {
  const cases: Array<[stored: number | null, fitCount: number | null, expected: number]> = [
    [null, 4, 4],
    [2, 4, 2],
    [6, 4, 4],
    [1, 4, 2],
    [null, 1, 2],
    [3, 1, 2],
    [null, null, Number.POSITIVE_INFINITY],
    [3, null, Number.POSITIVE_INFINITY],
  ];
  for (const [stored, fitCount, expected] of cases) {
    assert.equal(effectiveMaxPanels(stored, fitCount), expected, `effectiveMaxPanels(${stored}, ${fitCount})`);
  }
});

test('effectiveMaxPanels: null fitCount (unmeasured) is Infinity regardless of the stored value -- no cap, no reconcile, until the first real measurement', () => {
  assert.equal(effectiveMaxPanels(null, null), Number.POSITIVE_INFINITY);
  assert.equal(effectiveMaxPanels(0, null), Number.POSITIVE_INFINITY);
  assert.equal(effectiveMaxPanels(999, null), Number.POSITIVE_INFINITY);
});

test('effectiveMaxPanels: the floor of 2 always wins, even against a stored value AND a fit count both below it', () => {
  assert.equal(effectiveMaxPanels(0, 0), 2);
  assert.equal(effectiveMaxPanels(1, 1), 2);
  assert.equal(effectiveMaxPanels(-5, 1), 2, 'a corrupt/negative stored value never lowers the floor');
});

test('effectiveMaxPanels: a stored value between the floor and the fit count passes through unchanged', () => {
  assert.equal(effectiveMaxPanels(3, 6), 3);
  assert.equal(effectiveMaxPanels(5, 5), 5, 'exactly at the fit count');
});
