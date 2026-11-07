/** The rule that decides when the root steps aside, on the rows the browser tests do not build. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rootStepsAside } from '../rowNumbers.js';
import type { PanelRowEntry } from '../panelRowEntry.js';

const entry = (id: string, slots: number, overflow: 'park' | 'scroll' | undefined, collapsible = true): PanelRowEntry =>
  ({ id, live: true, collapsible, slots, view: id, title: id, url: '', listed: true, ...(overflow === undefined ? {} : { settings: { overflow } }) }) as unknown as PanelRowEntry;
const root = entry('root', 1, 'scroll', false);
const at = (entries: readonly PanelRowEntry[], containerWidth = 1400): boolean => rootStepsAside({ entries, rootId: 'root', phoneWidth: 390, containerWidth, gap: 16 });

test('the root steps aside for one parking panel that fits the window alone and not beside it', () => {
  assert.equal(at([root, entry('w', 3, 'park')]), true);
});

test('a panel that fits beside the root leaves it where it is', () => {
  assert.equal(at([root, entry('w', 2, 'park')]), false);
  assert.equal(at([root, entry('w', 3, 'park')], 1700), false);
});

test('a phone beside the root in a window too narrow for both scrolls as it always has', () => {
  assert.equal(at([root, entry('p', 1, 'park')], 700), false);
});

test('an unmeasured row never steps the root aside', () => {
  assert.equal(at([root, entry('w', 3, 'park')], 0), false, 'the window of 0 fits nothing, so the rule answers no without a guard');
});

test('a row with a panel that scrolls keeps its edge rule, a parking panel in it or not', () => {
  assert.equal(at([root, entry('w', 3, 'scroll')]), false);
  assert.equal(at([root, entry('w', 3, 'park'), entry('s', 1, 'scroll')], 2000), false);
});

test('a hand-built root sits in a row that caps its panels, so it needs no step', () => {
  assert.equal(at([entry('root', 1, undefined, false), entry('w', 3, 'park')]), false);
});

test('two parking panels past the fit are a capped row, which scrolls', () => {
  assert.equal(at([root, entry('a', 1, 'park'), entry('b', 1, 'park')], 1000), false);
});

test('a second fixed column that leaves the panel no room leaves the row as it was', () => {
  assert.equal(at([root, entry('fixed', 1, 'scroll', false), entry('w', 3, 'park')]), false);
});
