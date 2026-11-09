/**
 * What a view may rely on in the first frame of an auto-mounted workspace: exactly the values given to createWorkspace, and
 * absence for a member nobody supplied. workspace.update carries what arrives or changes later.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { HostProvider, createWorkspace, definePanel, useHost } from '../index.js';
import { createFakeHost } from '../fakeHost.js';
import { rigCleanup, slots, track, until } from './support/auto-rig.js';

afterEach(rigCleanup);

/** One entry per render of the view: whether `useHost().snapshots` was there in that pass. */
const passes: string[] = [];
/** The same passes for the device width. */
const sizes: number[] = [];
const reader = definePanel({
  id: 'reader',
  view: ({ handle }) => {
    const { snapshots, device } = useHost();
    sizes.push(device.size.width);
    const seen = snapshots === undefined ? 'absent' : 'present';
    passes.push(seen);
    return React.createElement('i', { 'data-slot': handle.id }, seen);
  },
});

test('a view that reads useHost().snapshots on the first render of a workspace created without it renders its fallback', async () => {
  passes.length = 0;
  const ws = track(createWorkspace({ templates: [reader] }));
  ws.addPanel('reader');
  await until('the panel', () => slots(document.body).length === 1);
  assert.equal(document.body.querySelector('[data-slot]')!.textContent, 'absent');
  assert.deepEqual([...new Set(passes)], ['absent']);
});

test('snapshots and device given to createWorkspace are on the very first render pass of a view', async () => {
  passes.length = 0;
  sizes.length = 0;
  const given = createFakeHost();
  const size = { width: 411, height: 731, modelId: 'test-phone' };
  const ws = track(createWorkspace({ templates: [reader], snapshots: given.snapshots!, device: { ...given.device, size } }));
  ws.addPanel('reader');
  await until('the panel', () => slots(document.body).length === 1);
  assert.equal(passes[0], 'present', 'the first pass already had the value, not a later pass after an effect');
  assert.deepEqual([...new Set(passes)], ['present']);
  assert.equal(sizes[0], 411, 'the device seed is on the first pass');
  assert.deepEqual([...new Set(sizes)], [411]);
});

test('a later workspace.update changes what the view reads', async () => {
  passes.length = 0;
  const given = createFakeHost();
  const ws = track(createWorkspace({ templates: [reader] }));
  ws.addPanel('reader');
  await until('the panel', () => slots(document.body).length === 1);
  await act(async () => ws.update({ snapshots: given.snapshots! }));
  assert.equal(document.body.querySelector('[data-slot]')!.textContent, 'present');
  assert.equal(passes[0], 'absent');
});

test('createFakeHost({ absent }) leaves snapshots out, and the default supplies them', () => {
  const none = createFakeHost({ absent: ['snapshots'] });
  assert.equal(none.snapshots, undefined);
  assert.notEqual(none.panels, undefined);
  assert.notEqual(createFakeHost().snapshots, undefined);
});

test('a view reading snapshots renders its fallback under a HostProvider whose fake leaves them out', () => {
  const View = (): React.ReactElement => {
    const { snapshots } = useHost();
    return React.createElement('b', null, snapshots === undefined ? 'absent' : 'present');
  };
  const root = document.createElement('div');
  document.body.appendChild(root);
  const r = createRoot(root);
  act(() => r.render(React.createElement(HostProvider, { host: createFakeHost({ absent: ['snapshots'] }), children: React.createElement(View) })));
  assert.equal(root.textContent, 'absent');
  act(() => r.unmount());
  root.remove();
});
