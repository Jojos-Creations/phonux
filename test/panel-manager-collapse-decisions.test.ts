/**
 * `effectiveMaxPanels` (shared/phone/panelCapacity.ts): the pure capacity decision usePanelManager.ts derives
 * its live cap from -- one hard capacity, never a mode.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveMaxPanels } from '../client/src/shared/phone/panelCapacity.js';

test('effectiveMaxPanels: the full matrix the owner\'s spec names (fixedColumnCount 1: History alone, byte-identical to the pre-permanent-columns floor of 2)', () => {
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
    assert.equal(effectiveMaxPanels(stored, fitCount, 1), expected, `effectiveMaxPanels(${stored}, ${fitCount}, 1)`);
  }
});

test('effectiveMaxPanels: null fitCount (unmeasured) is Infinity regardless of the stored value or fixedColumnCount -- no cap, no reconcile, until the first real measurement', () => {
  assert.equal(effectiveMaxPanels(null, null, 1), Number.POSITIVE_INFINITY);
  assert.equal(effectiveMaxPanels(0, null, 1), Number.POSITIVE_INFINITY);
  assert.equal(effectiveMaxPanels(999, null, 1), Number.POSITIVE_INFINITY);
  assert.equal(effectiveMaxPanels(999, null, 3), Number.POSITIVE_INFINITY);
});

test('effectiveMaxPanels: the floor of fixedColumnCount + 1 always wins, even against a stored value AND a fit count both below it', () => {
  assert.equal(effectiveMaxPanels(0, 0, 1), 2);
  assert.equal(effectiveMaxPanels(1, 1, 1), 2);
  assert.equal(effectiveMaxPanels(-5, 1, 1), 2, 'a corrupt/negative stored value never lowers the floor');
});

test('effectiveMaxPanels: a stored value between the floor and the fit count passes through unchanged', () => {
  assert.equal(effectiveMaxPanels(3, 6, 1), 3);
  assert.equal(effectiveMaxPanels(5, 5, 1), 5, 'exactly at the fit count');
});

test('effectiveMaxPanels: fixedColumnCount 2 (History + one permanent column) floors at 3, not the literal 2 -- red if the floor is ever reverted to a hardcoded 2', () => {
  assert.equal(effectiveMaxPanels(null, 4, 2), 4, 'follow the fit count: unaffected by the floor');
  assert.equal(effectiveMaxPanels(2, 4, 2), 3, 'a stored value below the floor is raised to it, not passed through');
  assert.equal(effectiveMaxPanels(0, 0, 2), 3, 'floor wins even against a stored value AND fit count both below it');
  assert.equal(effectiveMaxPanels(5, 4, 2), 4, 'a stored value above the fit count is still capped at the fit count');
});

test('effectiveMaxPanels: fixedColumnCount 3 floors at 4', () => {
  assert.equal(effectiveMaxPanels(null, 6, 3), 6);
  assert.equal(effectiveMaxPanels(2, 6, 3), 4, 'a stored value below the floor is raised to it');
  assert.equal(effectiveMaxPanels(0, 0, 3), 4);
});
