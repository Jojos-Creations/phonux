/**
 * A panel resize that grows a stepping row past the window adds its stops in the same render that moves the centering margin.
 * The margin snaps while stops exist, so without a panel-resize exception every panel jumped by the whole margin in one frame.
 * A window resize keeps the snap.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { workspaceShellStyle, type WorkspaceShellStyleInput } from '../Workspace.js';
import { PANEL_TRANSITION } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { made, mountRow, rootEntry, row } from './support/scroll-row.js';

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

const stops = [0, 406];
const withStops: WorkspaceShellStyleInput = {
  containerWidth: 1800,
  rowResizeSettled: true,
  phoneWidth: 390,
  fixedColumnCount: 1,
  liveWidths: [],
  rowNumbers: { rowMarginLeft: 0, stops, rowScroll: true } as never,
};

test('workspaceShellStyle: while a panel is being resized the margin glides with the shared slide even though the row has stops', () => {
  assert.deepEqual(workspaceShellStyle(withStops).transition, { duration: 0 }, 'control: stops without a resize still snap');
  assert.equal(workspaceShellStyle({ ...withStops, panelResizing: true }).transition, PANEL_TRANSITION);
  assert.deepEqual(workspaceShellStyle({ ...withStops, panelResizing: true, rowResizeSettled: false }).transition, { duration: 0 }, 'a window still moving wins over a panel resize');
});

// Three slots in a window of four: the fitting margin is wider than the centering an overflowing row keeps.
const THREE = () => row(rootEntry(), ...[1, 2].map((k) => made(`s${k}`, { slots: 1, maxSlots: 64 })));
const marginOf = (container: HTMLElement): number => Number.parseFloat(container.querySelector<HTMLElement>('[data-row-strip]')!.style.marginLeft);

async function openedAt1800(): Promise<ReturnType<typeof mountRow>> {
  const m = mountRow(THREE(), 1800, { tuning: { rowGesture: 'step' } });
  await advanceFrames(2000);
  return m;
}

test('a panel grown past the window glides the centering margin instead of snapping it, with the stops added in that same render', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const m = await openedAt1800();
  assert.equal(m.latest().rowNumbers.stops.length, 0, 'control: three slots fit the window, so the row centers and has no stops');
  const start = marginOf(m.container);
  assert.ok(start > 0, `control: a fitting row has a centering margin (${start})`);
  act(() => void m.latest().setSlots('s1', 5));
  assert.ok(m.latest().rowNumbers.stops.length > 0, 'the grow added stops in the render that moved the margin');
  await advanceFrames(32);
  const mid = marginOf(m.container);
  await advanceFrames(2000);
  const end = marginOf(m.container);
  assert.equal(end, m.latest().rowNumbers.rowMarginLeft, 'an overflowing row rests on its centering shift');
  assert.ok(Math.min(start, end) < mid && mid < Math.max(start, end), `32 ms in the margin is between ${start} and ${end}: ${mid}`);
});

test('a window resize that narrows a panel and adds stops still snaps the margin', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const m = mountRow(row(rootEntry(), made('s1', { slots: 2, maxSlots: 64 }), made('s2', { slots: 1, maxSlots: 64 })), 1800, { tuning: { rowGesture: 'step' } });
  await advanceFrames(2000);
  const start = marginOf(m.container);
  const widthsBefore = m.latest().rowNumbers.widths;
  m.rerender(800);
  await advanceFrames(32);
  const n = m.latest().rowNumbers;
  assert.notDeepEqual(n.widths, widthsBefore, 'control: the narrower window changed a panel width');
  assert.ok(n.stops.length > 0, 'control: and the row overflows');
  const mid = marginOf(m.container);
  await advanceFrames(2000);
  assert.notEqual(start, marginOf(m.container), 'control: the margin moved');
  assert.equal(mid, marginOf(m.container), 'it is already at its end 32 ms in');
});
