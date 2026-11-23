/**
 * The dot bar beside sticky panels, through the mounted row and the public `usePanelDots`: a sticky panel never scrolls, so it has
 * no dot to scroll to, and the bar lists it in `sticky` for the app to mark at the end of the bar on its side. Row: the root and five
 * pages in a window of two slots (container 1000), one of them sticky.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { usePanelDots, type PanelDots } from '../index.js';
import { advanceUntilRowRests, rowOffsetOf, stubSlotBoxes } from './support/strip.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { ROOT, made, mountRow, row, rootEntry, type MountedRow } from './support/scroll-row.js';

afterEach(() => cleanup());

const rect = (left: number, width: number): DOMRect => ({ left, right: left + width, top: 0, bottom: 700, width, height: 700, x: left, y: 0, toJSON: () => ({}) });

async function rowWithBar(stickyIds: Record<string, 'start' | 'end'>): Promise<{ m: MountedRow; bar: () => PanelDots }> {
  const pages = ['a', 'b', 'c', 'd', 'e'].map((id) => made(id, stickyIds[id] === undefined ? {} : { sticky: stickyIds[id]! }));
  const m = mountRow(row(rootEntry(), ...pages), 1000, { tuning: { rowGesture: 'step' } });
  m.container.getBoundingClientRect = () => rect(0, 1000);
  stubSlotBoxes(m.container, 16);
  await advanceFrames(64);
  let latest: PanelDots | undefined;
  const scroller = { current: m.container as HTMLElement };
  function Bar(): React.ReactElement {
    latest = usePanelDots({ entries: m.latest().entries, scroller });
    return React.createElement('div', { 'data-bar-probe': '' });
  }
  mount(React.createElement(Bar));
  return { m, bar: () => latest! };
}

test('a sticky panel has no dot, and the bar lists it by side; the other panels keep theirs', async () => {
  const { bar } = await rowWithBar({ a: 'start' });
  assert.deepEqual(bar().dots.map((d) => d.id).includes(ROOT), true, 'the root is in the strip, so it has its dot');
  assert.equal(bar().dots.length, 5, 'six panels, one of them sticky: five dots');
  assert.equal(bar().dots.some((d) => d.id.startsWith('a')), false, 'no dot for the sticky panel');
  assert.deepEqual(bar().sticky.map((s) => [s.id.startsWith('a'), s.side, s.hollow]), [[true, 'start', false]]);
});

test('of two sticky panels with room for one only the one that stayed is listed, and the list is empty when no panel is sticky', async () => {
  const two = await rowWithBar({ b: 'end', a: 'start' });
  assert.deepEqual(two.bar().sticky.map((s) => s.side), ['start']);
  cleanup();
  const none = await rowWithBar({});
  assert.deepEqual(none.bar().sticky, []);
  assert.equal(none.bar().dots.length, 6, 'control: with none sticky every panel has a dot');
});

test('a sticky panel is never in `shown`, and the oval spans only the panels the strip shows', async () => {
  const { bar } = await rowWithBar({ a: 'start' });
  assert.equal(bar().shown.some((id) => id.startsWith('a')), false);
  assert.equal(bar().oval.width > 0, true, 'control: the oval is drawn');
});

test('selectDot with a sticky panel focuses it and leaves the row where it is', async () => {
  const { m, bar } = await rowWithBar({ a: 'start' });
  const id = bar().sticky[0]!.id;
  act(() => bar().selectDot(id));
  await advanceFrames(64);
  const slot = m.container.querySelector<HTMLElement>(`[data-row-sticky] [data-row-id="${id}"]`)!;
  assert.ok(slot.contains(document.activeElement), 'focus is in the sticky panel');
  assert.equal(rowOffsetOf(m.container), 0, 'the row did not move');
});

test('selectDot with a strip panel still glides the row, so the sticky branch is not what moved nothing', async () => {
  const { m, bar } = await rowWithBar({ a: 'start' });
  const far = bar().dots.at(-1)!.id;
  act(() => bar().selectDot(far));
  await advanceUntilRowRests(m.container);
  assert.ok(rowOffsetOf(m.container) > 0, 'the row moved to show the far panel');
});
