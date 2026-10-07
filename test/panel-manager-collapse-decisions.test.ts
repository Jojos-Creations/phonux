/**
 * `effectiveMaxPanels` (panelCapacity.ts): the pure capacity decision usePanelManager.ts derives
 * its live cap from -- one hard capacity, never a mode.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveMaxPanels } from '../panelCapacity.js';

test('effectiveMaxPanels: the full matrix the owner\'s spec names (fixedColumnCount 1: History alone, byte-identical to the pre-permanent-columns floor of 2)', () => {
  const cases: Array<[fitCount: number | null, expected: number]> = [
    [4, 4],
    [1, 2],
    [null, Number.POSITIVE_INFINITY],
  ];
  for (const [fitCount, expected] of cases) {
    assert.equal(effectiveMaxPanels(fitCount, 1), expected, `effectiveMaxPanels(${fitCount}, 1)`);
  }
});

test('effectiveMaxPanels: null fitCount (unmeasured) is Infinity regardless of fixedColumnCount -- no cap, no reconcile, until the first real measurement', () => {
  assert.equal(effectiveMaxPanels(null, 1), Number.POSITIVE_INFINITY);
  assert.equal(effectiveMaxPanels(null, 3), Number.POSITIVE_INFINITY);
});

test('effectiveMaxPanels: the floor of fixedColumnCount + 1 always wins, even against a fit count below it', () => {
  assert.equal(effectiveMaxPanels(0, 1), 2);
  assert.equal(effectiveMaxPanels(1, 1), 2);
});

test('effectiveMaxPanels: fixedColumnCount 2 (History + one permanent column) floors at 3, not the literal 2 -- red if the floor is ever reverted to a hardcoded 2', () => {
  assert.equal(effectiveMaxPanels(4, 2), 4, 'follow the fit count: unaffected by the floor');
  assert.equal(effectiveMaxPanels(0, 2), 3, 'a fit count below the floor is raised to it');
});

test('effectiveMaxPanels: fixedColumnCount 3 floors at 4', () => {
  assert.equal(effectiveMaxPanels(6, 3), 6);
  assert.equal(effectiveMaxPanels(0, 3), 4);
});
