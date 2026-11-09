/**
 * A panel resize that grows a stepping row past the window adds its stops in the same render that moves the centering margin.
 * The margin snaps while stops exist, so without a panel-resize exception every panel jumped by the whole margin in one frame.
 * A window resize keeps the snap.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { stripMarginOf } from './support/strip.js';
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

test('workspaceShellStyle: while a panel is being resized the margin glides with the shared slide even though the row has stops and the window is settling', () => {
  assert.deepEqual(workspaceShellStyle(withStops).transition, { duration: 0 }, 'control: stops without a resize still snap');
  assert.equal(workspaceShellStyle({ ...withStops, panelResizing: true }).transition, PANEL_TRANSITION);
  assert.equal(workspaceShellStyle({ ...withStops, panelResizing: true, rowResizeSettled: false }).transition, PANEL_TRANSITION, 'a panel resize glides inside the window settle too');
  assert.deepEqual(workspaceShellStyle({ ...withStops, panelResizing: false, rowResizeSettled: false }).transition, { duration: 0 }, 'a window still moving snaps the margin with stops');
});

// Three slots in a window of four: the fitting margin is wider than the centering an overflowing row keeps.
const THREE = () => row(rootEntry(), ...[1, 2].map((k) => made(`s${k}`, { slots: 1, maxSlots: 64 })));
const marginOf = (container: HTMLElement): number => stripMarginOf(container);

async function openedAt1800(): Promise<ReturnType<typeof mountRow>> {
  const m = mountRow(THREE(), 1800, { tuning: { rowGesture: 'step' } });
  await advanceFrames(2000);
  return m;
}

