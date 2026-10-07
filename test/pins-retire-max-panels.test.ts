/**
 * What the capacity decision and the fake host's settings member do before the stored max-panels choice is
 * retired. A pin states what the code does; the change that retires the choice renames and rewrites it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveMaxPanels } from '../panelCapacity.js';
import { createFakeHost } from '../fakeHost.js';

test('pin P1: effectiveMaxPanels takes (stored, fitCount, fixedColumnCount) and a stored value caps the fit count', () => {
  assert.equal(effectiveMaxPanels(3, null, 2), Number.POSITIVE_INFINITY);
  assert.equal(effectiveMaxPanels(null, 5, 2), 5);
  assert.equal(effectiveMaxPanels(5, 3, 2), 3);
  assert.equal(effectiveMaxPanels(1, 1, 3), 4);
});

test('pin P2: the fake host settings member holds the four max-panels members and settingsColumn', () => {
  assert.deepEqual(Object.keys(createFakeHost().settings), ['maxPanelsOnScreen', 'fitCount', 'minPanelsOnScreen', 'setMaxPanelsOnScreen', 'settingsColumn']);
});
