/**
 * useWorkspace: a view reaches its workspace's manager and handles by key, and nothing of the workspace's own life.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createWorkspace, definePanel, useWorkspace } from '../index.js';
import type { ViewWorkspace } from '../index.js';
import { cleanup, mount } from './support/mount-harness.js';
import { flush, markerTemplate, mountWorkspace } from './support/workspace-row.js';

afterEach(() => cleanup());

function rig() {
  const seen: { ws: ViewWorkspace | undefined; renders: ViewWorkspace[] } = { ws: undefined, renders: [] };
  const driver = definePanel({
    id: 'driver',
    settings: { frame: 'none' },
    view: () => {
      const ws = useWorkspace();
      seen.ws = ws;
      if (ws !== undefined) seen.renders.push(ws);
      return React.createElement('i', { 'data-driver': '' });
    },
  });
  const target = markerTemplate('target');
  const extra = markerTemplate('extra');
  const w = createWorkspace({ mount: false, templates: [driver, target, extra] });
  w.addPanel(driver);
  w.addPanel(target);
  const m = mountWorkspace(w);
  return { w, m, seen, extra };
}

test('a view calls useWorkspace() and closes, shows and creates another panel by key', async () => {
  const { w, m, seen } = rig();
  await flush();
  const ws = seen.ws!;
  assert.ok(ws, 'positive control: the view got a workspace');
  const target = ws.panels.get('target')!;
  assert.equal(target.getState().status, 'live');
  act(() => void ws.panels.get('target')!.hide());
  await flush();
  assert.equal(w.panels.get('target')!.getState().status, 'parked', 'hide, by key');
  act(() => void ws.panels.get('target')!.show());
  await flush();
  assert.equal(w.panels.get('target')!.getState().status, 'live', 'show, by key');
  act(() => void ws.panels.get('target')!.close());
  await flush();
  assert.equal(w.panels.get('target')!.getState().status, 'closed', 'close, by key');
  act(() => void ws.panels.addPanel('extra'));
  await flush();
  assert.equal(w.panels.get('extra')?.getState().status, 'live', 'addPanel makes a panel');
  assert.ok(m.container.querySelector('[data-template="extra"]'), 'and its view is drawn');
});

test('useWorkspace is undefined outside a PanelRow that has a workspace', () => {
  let got: ViewWorkspace | undefined | 'unset' = 'unset';
  function Probe(): null {
    got = useWorkspace();
    return null;
  }
  mount(React.createElement(Probe));
  assert.equal(got, undefined);
});

test('the workspace a view gets is the manager and addPanel, and none of dispose, update or rename', async () => {
  const { seen } = rig();
  await flush();
  const ws = seen.ws!;
  assert.deepEqual(Object.keys(ws), ['panels']);
  assert.deepEqual(Object.keys(ws.panels).sort(), ['addPanel', 'configure', 'configureTemplate', 'configureTuning', 'get', 'getSnapshot', 'list', 'resetLayout', 'subscribe']);
  for (const name of ['dispose', 'update', 'rename', 'registerTemplate', 'tuning', 'status']) assert.equal(name in ws, false, name);
});

test('useWorkspace is the same object on every render', async () => {
  const { seen, w } = rig();
  await flush();
  act(() => void w.panels.configureTuning({ rowGap: 20 }));
  await flush();
  assert.ok(seen.renders.length >= 2, 'control: the view rendered again');
  assert.ok(seen.renders.every((r) => r === seen.renders[0]));
});


test('an unknown key gives undefined from panels.get, and a handle never reaches a panel of another workspace', async () => {
  const { seen, w } = rig();
  await flush();
  const other = markerTemplate('target');
  const w2 = createWorkspace({ mount: false, templates: [other] });
  w2.addPanel(other);
  assert.equal(seen.ws!.panels.get('no-such-panel'), undefined, 'unknown key');
  assert.deepEqual(seen.ws!.panels.list().map((h) => h.id).sort(), ['driver', 'target'], 'control: this workspace lists its own panels');
  act(() => void w2.panels.get('target')!.close());
  await flush();
  assert.equal(w.panels.get('target')!.getState().status, 'live', 'closing the other workspace\'s panel of the same key leaves this one alone');
});

test('the calling view is unchanged when it closes another panel', async () => {
  const { seen, w } = rig();
  await flush();
  act(() => void seen.ws!.panels.get('target')!.close());
  await flush();
  assert.equal(w.panels.get('driver')!.getState().status, 'live');
  assert.ok(seen.ws!.panels.get('driver'), 'it still reaches itself by key');
});

test('addPanel on a disposed workspace does not draw a panel', async () => {
  const { seen, w, m } = rig();
  await flush();
  const ws = seen.ws!;
  act(() => void w.dispose());
  await flush();
  let threw = false;
  try {
    act(() => void ws.panels.addPanel('extra'));
  } catch {
    threw = true;
  }
  await flush();
  assert.equal(m.container.querySelector('[data-template="extra"]'), null, `no panel is drawn (addPanel ${threw ? 'threw' : 'returned'})`);
});
