/**
 * A panel that grows past the window's edge comes whole into view; one that grows wholly outside the window does not move the
 * view: the keep-still rule holds the panels on screen where they were. Row [root a b c d e] in a 1000 px container: panel k
 * starts at 102 + 406k, the window shows two slots, and the stops are 0, 406, 812, 1218 and 1624 (2030 once a panel is two slots).
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { advanceUntilRowRests, rowOffsetOf, setRowOffset, stubSlotBoxes } from './support/strip.js';
import { cleanup } from './support/mount-harness.js';
import { made, mountRow, rootEntry, row, type MountedRow } from './support/scroll-row.js';

afterEach(() => cleanup());

function sixPanels(): MountedRow {
  const m = mountRow(row(rootEntry(), ...['a', 'b', 'c', 'd', 'e'].map((id) => made(id))), 1000);
  stubSlotBoxes(m.container, 16);
  return m;
}

const screenX = (m: MountedRow, id: string): number => m.container.querySelector<HTMLElement>(`[data-row-id="${id}"]`)!.getBoundingClientRect().left;

test('a panel wholly left of the view that widens keeps the view still: the row moves by its growth, the panels shown stay put', async () => {
  const m = sixPanels();
  setRowOffset(m.container, 1218);
  await advanceUntilRowRests(m.container);
  assert.equal(rowOffsetOf(m.container), 1218, 'the view shows d and e');
  const dBefore = screenX(m, 'd');
  act(() => m.latest().setSlots('b', 2));
  await advanceUntilRowRests(m.container);
  assert.equal(rowOffsetOf(m.container), 1624, 'the row moved one slot right with b, not back to show b');
  assert.ok(Math.abs(screenX(m, 'd') - dBefore) <= 0.5, `d stays where it was on screen (${dBefore} -> ${screenX(m, 'd')})`);
});

test('a panel in view that grows past the window\'s right edge glides whole into view', async () => {
  const m = sixPanels();
  setRowOffset(m.container, 0);
  await advanceUntilRowRests(m.container);
  act(() => m.latest().setSlots('a', 2));
  await advanceUntilRowRests(m.container);
  assert.equal(rowOffsetOf(m.container), 406, 'the row glides one stop so a shows whole');
});
