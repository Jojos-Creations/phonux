/**
 * The Workspace's own resize settle: the row's centring margin snaps while the container width is moving and glides
 * once it has held still for 1.25 slide durations, with no help from the host. A host-supplied `rowResizeSettled` wins.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { Workspace } from '../index.js';
import { resizeSettleDelayMs, useResizeSettled } from '../Workspace.js';
import { LIBRARY_TUNING_DEFAULTS } from '../panelSettings.js';
import { advanceFrames, cleanup, mount, withHost } from './support/mount-harness.js';

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

test('the settle delay is 1.25 slide durations: 500 ms at the default, scaling with the slide, 0 for no slide', () => {
  assert.equal(resizeSettleDelayMs(LIBRARY_TUNING_DEFAULTS.slide), 500);
  assert.equal(resizeSettleDelayMs({ ...LIBRARY_TUNING_DEFAULTS.slide, durationSec: 0.8 }), 1000);
  assert.equal(resizeSettleDelayMs({ ...LIBRARY_TUNING_DEFAULTS.slide, durationSec: 0 }), 0);
});

function Probe({ width, delayMs, instant, log }: { width: number; delayMs: number; instant: boolean; log: boolean[] }): React.ReactElement {
  log.push(useResizeSettled(width, delayMs, instant));
  return React.createElement('i');
}
const settledNow = (log: boolean[]): boolean => log[log.length - 1]!;

test('a width that changes reads unsettled in that render, and settled once it has held for the delay', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const log: boolean[] = [];
  const m = mount(React.createElement(Probe, { width: 0, delayMs: 500, instant: false, log }));
  assert.equal(settledNow(log), true, 'the first width is the settled one');
  m.rerender(React.createElement(Probe, { width: 800, delayMs: 500, instant: false, log }));
  assert.equal(settledNow(log), false, 'moving');
  act(() => mock.timers.tick(499));
  assert.equal(settledNow(log), false, 'one ms short');
  act(() => mock.timers.tick(1));
  assert.equal(settledNow(log), true, 'held for the delay');
});

test('each change in a burst restarts the wait', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const log: boolean[] = [];
  const m = mount(React.createElement(Probe, { width: 0, delayMs: 500, instant: false, log }));
  for (const width of [800, 810, 820]) {
    m.rerender(React.createElement(Probe, { width, delayMs: 500, instant: false, log }));
    act(() => mock.timers.tick(400));
    assert.equal(settledNow(log), false, `${width}: 400 ms after the latest change`);
  }
  act(() => mock.timers.tick(100));
  assert.equal(settledNow(log), true);
});

test('with animation off the width is settled at once', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const log: boolean[] = [];
  const m = mount(React.createElement(Probe, { width: 0, delayMs: 500, instant: true, log }));
  const before = log.length;
  m.rerender(React.createElement(Probe, { width: 800, delayMs: 500, instant: true, log }));
  assert.equal(settledNow(log), true);
  assert.equal(log.slice(before).every(Boolean), true, 'not even the render that sees the new width reads unsettled');
});

function workspaceAt(width: number, liveWidths: number[] = [], extra: Record<string, unknown> = {}, wrap: (ui: React.ReactElement) => React.ReactElement = (ui) => ui): React.ReactElement {
  return wrap(
    withHost(
      React.createElement(Workspace, {
        overflowContainerRef: React.createRef<HTMLDivElement>(),
        rowRef: React.createRef<HTMLDivElement>(),
        containerWidth: width,
        phoneWidth: 390,
        fixedColumnCount: 1,
        liveWidths,
        children: React.createElement('i'),
        ...extra,
      } as never),
    ),
  );
}
const marginOf = (container: HTMLElement): number => Number.parseFloat((container.querySelector('[data-row-strip]') as HTMLElement).style.marginLeft);

/**
 * Whether the row's margin glides when a panel joins: true when, 32 ms after the change, the margin is neither where it
 * started nor where it ends. `before` is run first, with the width already at `width`.
 */
async function glidesWhenAPanelJoins(width: number, before: (m: ReturnType<typeof mount>) => void, extra: Record<string, unknown> = {}, wrap?: (ui: React.ReactElement) => React.ReactElement): Promise<boolean> {
  const m = mount(workspaceAt(width, [], extra, wrap));
  before(m);
  await advanceFrames(2000);
  const start = marginOf(m.container);
  m.rerender(workspaceAt(width, [390], extra, wrap));
  await advanceFrames(32);
  const mid = marginOf(m.container);
  await advanceFrames(2000);
  const end = marginOf(m.container);
  m.unmount();
  assert.notEqual(start, end, 'control: the margin does move when a panel joins');
  return mid !== start && mid !== end;
}

test('a Workspace given no rowResizeSettled snaps its margin while the width moves and glides once it holds', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const moving = await glidesWhenAPanelJoins(1000, () => undefined);
  assert.equal(moving, true, 'a width that has not moved is settled from the start');
  const m0 = mount(workspaceAt(1000));
  m0.rerender(workspaceAt(1200));
  await advanceFrames(2000);
  m0.rerender(workspaceAt(1200, [390]));
  await advanceFrames(32);
  const snapped = marginOf(m0.container);
  await advanceFrames(2000);
  assert.equal(snapped, marginOf(m0.container), 'right after a width change the margin snaps');
  m0.unmount();
});

test('and glides again after the delay', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const m = mount(workspaceAt(1000));
  m.rerender(workspaceAt(1200));
  act(() => mock.timers.tick(500));
  await advanceFrames(2000);
  const start = marginOf(m.container);
  m.rerender(workspaceAt(1200, [390]));
  await advanceFrames(32);
  const mid = marginOf(m.container);
  await advanceFrames(2000);
  const end = marginOf(m.container);
  assert.ok(mid !== start && mid !== end, `32 ms in the margin is between ${start} and ${end}: ${mid}`);
});

test("the wait follows the workspace's slide", async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const slow = { tuning: { slide: { durationSec: 0.8 } } };
  const m = mount(workspaceAt(1000, [], slow));
  m.rerender(workspaceAt(1200, [], slow));
  act(() => mock.timers.tick(999));
  m.rerender(workspaceAt(1200, [390], slow));
  await advanceFrames(32);
  const early = marginOf(m.container);
  await advanceFrames(2000);
  assert.equal(early, marginOf(m.container), '999 ms is one short of 1.25 x 0.8 s: still snapping');
});

test('a supplied rowResizeSettled wins, either way', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  assert.equal(await glidesWhenAPanelJoins(1000, () => undefined, { rowResizeSettled: false }), false, 'false keeps it snapping');
  assert.equal(await glidesWhenAPanelJoins(1000, () => undefined, { rowResizeSettled: true }), true, 'true glides');
});
