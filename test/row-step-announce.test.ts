/**
 * A key that steps the row says which panels it brought into the window, in the workspace's polite live region, from the names the
 * slots already carry; a step that cannot go further says nothing.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { advanceUntilRowRests, stubSlotBoxes } from './support/strip.js';
import { cleanup } from './support/mount-harness.js';
import { mountRow, panelsOf, type MountedRow } from './support/scroll-row.js';

afterEach(cleanup);

const rect = (left: number, width: number): DOMRect => ({ left, right: left + width, top: 0, bottom: 700, width, height: 700, x: left, y: 0, toJSON: () => ({}) });
function laidOutRow(): MountedRow {
  const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'step' } });
  m.container.getBoundingClientRect = () => rect(0, 1000);
  stubSlotBoxes(m.container, 16);
  return m;
}
const announcer = (): string => document.querySelector('[data-workspace-announcer]')?.textContent ?? '';

test('ArrowRight says the panels the step brings into the window, and ArrowLeft the ones it brings back', async () => {
  const m = laidOutRow();
  assert.equal(announcer(), '', 'control: nothing has been said yet');
  m.key('ArrowRight');
  await advanceUntilRowRests(m.container);
  assert.match(announcer(), /s1.*2 of 6.*s2.*3 of 6/, `the two panels in the window now: ${announcer()}`);
  m.key('ArrowLeft');
  await advanceUntilRowRests(m.container);
  assert.match(announcer(), /History.*1 of 6.*s1.*2 of 6/, `back to the first two: ${announcer()}`);
});

test('a step at the end of the row says nothing new', async () => {
  const m = laidOutRow();
  m.key('ArrowLeft');
  await advanceUntilRowRests(m.container);
  assert.equal(announcer(), '', 'the row is already at its first stop');
});
