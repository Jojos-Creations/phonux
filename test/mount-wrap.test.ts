/**
 * What `wrap` gives an app: the providers it draws sit around the row, inside the host, so a panel view, a footer and the shell see
 * them; they cannot reach the mount's own hooks. Every workspace of a column gets the wrap, once.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { MotionConfig, useReducedMotionConfig } from 'motion/react';
import { createWorkspace, createWorkspaceColumn, definePanel, useHost } from '../index.js';
import type { WorkspaceColumnHandle, WorkspaceWrapProps } from '../index.js';
import { rigCleanup, slots, track, until } from './support/auto-rig.js';

const columns: WorkspaceColumnHandle[] = [];
afterEach(() => {
  for (const c of columns.splice(0)) act(() => c.dispose());
  rigCleanup();
});

const Probe = React.createContext('none');
const effects = { mounts: 0, cleanups: 0 };

const probed = definePanel({
  id: 'probed',
  view: ({ handle }) => {
    const seen = React.useContext(Probe);
    const host = useHost();
    React.useEffect(() => {
      effects.mounts += 1;
      return () => void (effects.cleanups += 1);
    }, []);
    return React.createElement('i', { 'data-slot': handle.id, 'data-probe': seen, 'data-host': String(host.panels !== undefined) });
  },
  footer: () => React.createElement('b', { 'data-footer': React.useContext(Probe) }),
});

/** The wrap reads the host itself, so a mount that drew it outside the host would throw here. */
const providers = ({ children }: WorkspaceWrapProps): React.ReactElement => {
  const host = useHost();
  assert.notEqual(host.panels, undefined, 'the wrap sits inside the host');
  return React.createElement(React.StrictMode, null, React.createElement(Probe.Provider, { value: 'wrapped' }, children));
};

test('a wrap with StrictMode and a context puts both around a panel view and its footer, inside the host', async () => {
  const ws = track(createWorkspace({ templates: [probed], wrap: providers }));
  ws.addPanel('probed');
  await until('the panel', () => slots(document.body).length === 1);
  const view = document.querySelector<HTMLElement>('[data-slot="probed"]')!;
  assert.equal(view.dataset.probe, 'wrapped');
  assert.equal(view.dataset.host, 'true', 'the host is above the wrap');
  assert.equal(document.querySelector<HTMLElement>('[data-footer]')?.dataset.footer ?? 'no footer', 'wrapped');
});

test('StrictMode in the wrap double-runs a view effect pair in development and the workspace still settles', async () => {
  effects.mounts = 0;
  effects.cleanups = 0;
  const ws = track(createWorkspace({ templates: [probed], wrap: providers }));
  ws.addPanel('probed');
  await until('the panel', () => slots(document.body).length === 1);
  // The row remounts its panels once when the restore settles, and StrictMode runs the pair on each mount.
  assert.equal(effects.mounts, 4, 'mount, simulated unmount, mount, then the same again after the remount');
  assert.equal(effects.cleanups, 3);
  assert.equal(ws.panels.list().length, 1, 'one panel, no duplicate');
  assert.equal(document.querySelectorAll('[data-slot="probed"]').length, 1);
});

test('a wrap keeps one identity: an update re-renders it and never remounts it', async () => {
  let mounts = 0;
  const Counting = ({ children }: WorkspaceWrapProps): React.ReactElement => {
    React.useEffect(() => void (mounts += 1), []);
    return React.createElement(React.Fragment, null, children);
  };
  const ws = track(createWorkspace({ templates: [probed], wrap: Counting }));
  ws.addPanel('probed');
  await until('the panel', () => slots(document.body).length === 1);
  await act(async () => ws.update({ topInset: 10 }));
  await act(async () => ws.update({ topInset: 20 }));
  assert.equal(mounts, 1);
});

test('MotionConfig reducedMotion="always" in the wrap reaches a panel view, where the slot reads it too', async () => {
  const reads = definePanel({
    id: 'reads',
    view: ({ handle }) => React.createElement('i', { 'data-slot': handle.id, 'data-reduced': String(useReducedMotionConfig()) }),
  });
  const ws = track(createWorkspace({ templates: [reads], wrap: ({ children }) => React.createElement(MotionConfig, { reducedMotion: 'always' }, children) }));
  ws.addPanel('reads');
  await until('the panel', () => slots(document.body).length === 1);
  assert.equal(document.querySelector<HTMLElement>('[data-slot="reads"]')!.dataset.reduced, 'true');
});

test('every workspace of a column renders with the wrap, once each', async () => {
  const wrapped: string[] = [];
  const Marked = ({ children, workspace }: WorkspaceWrapProps): React.ReactElement => {
    React.useEffect(() => void wrapped.push(workspace.id), [workspace]);
    return React.createElement(Probe.Provider, { value: 'column-wrapped' }, children);
  };
  const c = createWorkspaceColumn({ templates: [probed], wrap: Marked });
  columns.push(c);
  act(() => {
    c.addWorkspace({ id: 'one' }).addPanel('probed');
    c.addWorkspace({ id: 'two' }).addPanel('probed');
  });
  await until('two panels', () => document.querySelectorAll('[data-slot="probed"]').length === 2);
  for (const view of document.querySelectorAll<HTMLElement>('[data-slot="probed"]')) assert.equal(view.dataset.probe, 'column-wrapped');
  assert.deepEqual([...wrapped].sort(), ['one', 'two']);
});
