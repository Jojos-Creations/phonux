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

/** One entry per render of the view: what `useHost().history` was in that pass. */
const passes: string[] = [];
const reader = definePanel({
  id: 'reader',
  view: ({ handle }) => {
    const { history } = useHost();
    const seen = history === undefined ? 'absent' : history.locked ? 'locked' : 'open';
    passes.push(seen);
    return React.createElement('i', { 'data-slot': handle.id }, seen);
  },
});

test('a view that reads useHost().history on the first render of a workspace created without it renders its fallback', async () => {
  passes.length = 0;
  const ws = track(createWorkspace({ templates: [reader] }));
  ws.addPanel('reader');
  await until('the panel', () => slots(document.body).length === 1);
  assert.equal(document.body.querySelector('[data-slot]')!.textContent, 'absent');
  assert.deepEqual([...new Set(passes)], ['absent']);
});

test('history, device and settings given to createWorkspace are on the very first render pass of a view', async () => {
  passes.length = 0;
  const given = createFakeHost();
  const ws = track(createWorkspace({ templates: [reader], history: { ...given.history!, locked: true }, device: given.device, settings: given.settings }));
  ws.addPanel('reader');
  await until('the panel', () => slots(document.body).length === 1);
  assert.equal(passes[0], 'locked', 'the first pass already had the value, not a later pass after an effect');
  assert.deepEqual([...new Set(passes)], ['locked']);
});

test('a later workspace.update changes what the view reads', async () => {
  passes.length = 0;
  const given = createFakeHost();
  const ws = track(createWorkspace({ templates: [reader] }));
  ws.addPanel('reader');
  await until('the panel', () => slots(document.body).length === 1);
  await act(async () => ws.update({ history: { ...given.history!, locked: false } }));
  assert.equal(document.body.querySelector('[data-slot]')!.textContent, 'open');
  assert.equal(passes[0], 'absent');
});

test('createFakeHost({ absent }) leaves history and snapshots out, and the default still supplies both', () => {
  const none = createFakeHost({ absent: ['history', 'snapshots'] });
  assert.equal(none.history, undefined);
  assert.equal(none.snapshots, undefined);
  assert.notEqual(none.panels, undefined);
  const all = createFakeHost();
  assert.notEqual(all.history, undefined);
  assert.notEqual(all.snapshots, undefined);
  const onlyHistory = createFakeHost({ absent: ['history'] });
  assert.equal(onlyHistory.history, undefined);
  assert.notEqual(onlyHistory.snapshots, undefined);
});

test('a view reading history renders its fallback under a HostProvider whose fake leaves history out', () => {
  passes.length = 0;
  const View = (): React.ReactElement => {
    const { history } = useHost();
    return React.createElement('b', null, history === undefined ? 'absent' : 'present');
  };
  const root = document.createElement('div');
  document.body.appendChild(root);
  const r = createRoot(root);
  act(() => r.render(React.createElement(HostProvider, { host: createFakeHost({ absent: ['history'] }), children: React.createElement(View) })));
  assert.equal(root.textContent, 'absent');
  act(() => r.unmount());
  root.remove();
});
