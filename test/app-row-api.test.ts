/**
 * The row API an app's wrap uses: `useWorkspaceRow()` reads the mounted row inside `wrap` and nowhere else, a cell whose
 * children function returns undefined draws the library's own row, and the row's top room and phone height are tuning.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createWorkspace, createWorkspaceColumn, definePanel, useWorkspaceRow, WorkspaceColumn, type WorkspaceRow } from '../index.js';
import type { WorkspaceColumnHandle, WorkspaceWrapProps } from '../index.js';
import { mount, withHost } from './support/mount-harness.js';
import { rigCleanup, slots, track, until } from './support/auto-rig.js';

const columns: WorkspaceColumnHandle[] = [];
afterEach(() => {
  for (const c of columns.splice(0)) act(() => c.dispose());
  rigCleanup();
});

const probe = definePanel({
  id: 'probe',
  view: ({ handle }) => React.createElement('i', { 'data-slot': handle.id }),
});

test('useWorkspaceRow inside wrap returns the row: its entries, a scroller and the phone size', async () => {
  const seen: WorkspaceRow[] = [];
  const Wrap = ({ children }: WorkspaceWrapProps): React.ReactElement => {
    seen.push(useWorkspaceRow());
    return React.createElement(React.Fragment, null, children);
  };
  const ws = track(createWorkspace({ templates: [probe], wrap: Wrap }));
  ws.addPanel('probe');
  await until('the probe', () => slots(document.body).includes('probe'));
  const last = seen[seen.length - 1]!;
  assert.ok(last.entries.some((e) => e.id !== '__root__'), 'the added panel is in the row');
  assert.ok(last.scroller !== undefined && 'current' in last.scroller);
  assert.ok(last.phoneSize.width > 0 && last.phoneSize.height > 0);
  assert.equal(last.maxFitPanels, null, 'an unfitted row has no fit count');
});

test('the scroller is the element that scrolls the row: the one marked data-row-scroller, with the panels inside it', async () => {
  let scroller: React.RefObject<HTMLElement | null> | undefined;
  const Wrap = ({ children }: WorkspaceWrapProps): React.ReactElement => {
    scroller = useWorkspaceRow().scroller;
    return React.createElement(React.Fragment, null, children);
  };
  const ws = track(createWorkspace({ templates: [probe], wrap: Wrap }));
  ws.addPanel('probe');
  await until('the probe', () => slots(document.body).includes('probe'));
  const marked = document.querySelector('[data-row-scroller]');
  assert.ok(marked !== null && scroller?.current === marked, 'the row scroller is the marked container');
  assert.ok(marked.contains(document.querySelector('[data-slot="probe"]')), 'the panel is inside the scroller');
});

test('a cell whose children function returns undefined draws the library row, and a cell returning null draws nothing', async () => {
  const c = createWorkspaceColumn({ templates: [probe], mount: false });
  columns.push(c);
  act(() => {
    c.addWorkspace().addPanel('probe');
  });
  mount(withHost(React.createElement(WorkspaceColumn, { column: c, children: () => undefined })));
  await until('the library row', () => document.querySelector('[data-row-scroller]') !== null);
  assert.equal(document.querySelectorAll('[data-row-scroller]').length, 1);
  rigCleanup();
  const empty = createWorkspaceColumn({ templates: [probe], mount: false });
  columns.push(empty);
  act(() => {
    empty.addWorkspace().addPanel('probe');
  });
  mount(withHost(React.createElement(WorkspaceColumn, { column: empty, children: () => null })));
  await until('the cell', () => document.querySelector('[data-workspace-name-input]') !== null || document.querySelector('[data-workspace-neighbour]') !== null);
  assert.equal(document.querySelectorAll('[data-row-scroller]').length, 0, 'a null cell draws no library row');
});

test('rowTop and phoneHeight are workspace tuning: a valid value is accepted, an out-of-range one is refused', () => {
  const ws = track(createWorkspace({ templates: [probe] }));
  assert.equal(ws.panels.configureTuning({ rowTop: 162, phoneHeight: 'auto' }).ok, true);
  assert.equal(ws.panels.configureTuning({ rowTop: null }).ok, true);
  assert.throws(() => ws.panels.configureTuning({ rowTop: 401 }));
  assert.throws(() => ws.panels.configureTuning({ phoneHeight: 'tall' as never }));
});
