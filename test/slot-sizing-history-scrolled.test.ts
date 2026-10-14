/**
 * Resizing History while the row is scrolled to its end: the strip grows to the right of the resized panel and the
 * scroll offset stays where the person left it. The container is 1000 wide, so the window is 968 and a row of n phone
 * panels has strip 406n - 16.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { resolvePanelSettings } from '../index.js';
import { applyTemplate } from '../panelSettings.js';
import { createHistoryPanel } from '../panelWindow.js';
import { maxScrollOf } from '../rowNumbers.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { ROOT, made, mountRow, row } from './support/scroll-row.js';

afterEach(() => cleanup());

const resizableRoot = () =>
  applyTemplate({ ...createHistoryPanel(ROOT), view: 'scroll-row-view' }, resolvePanelSettings({ template: { title: 'History', resizable: true, maxSlots: 3 } as never }, { root: true }).value, 'create');

test('History grows while the row is scrolled to its end: the offset is kept and the strip is longer by the added slots', async () => {
  const m = mountRow(row(resizableRoot(), ...['a', 'b', 'c', 'd', 'e'].map((id) => made(id))), 1000);
  const end = maxScrollOf(m.latest().rowNumbers!);
  assert.equal(end, 1452, 'six phone panels: the strip is 2420 long in a 968 window');
  m.container.scrollLeft = end;
  assert.equal(m.container.scrollLeft, end, 'scrolled to the end');
  act(() => void m.latest().setSlots(ROOT, 2));
  await advanceFrames(900);
  assert.equal(m.latest().entries.find((p) => p.id === ROOT)!.slots, 2, 'History is two slots wide');
  assert.equal(maxScrollOf(m.latest().rowNumbers!), end + 406, 'the strip grew by one slot and a gap');
  assert.equal(m.container.scrollLeft, end, 'the offset stays where it was');
  act(() => void m.latest().setSlots(ROOT, 1));
  await advanceFrames(900);
  assert.equal(maxScrollOf(m.latest().rowNumbers!), end, 'shrinking it back restores the strip');
  assert.ok(m.container.scrollLeft <= end, 'and the offset is within it');
});
