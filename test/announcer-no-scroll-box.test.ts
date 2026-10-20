/**
 * The workspace's polite status region is a 1px clipped box, never one the size of its parent: a box that big, placed after the
 * row, gives a host's own scrolling container something to scroll, which draws a native scrollbar beside the panels.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { createWorkspace, definePanel } from '../index.js';
import type { WorkspaceHandle } from '../index.js';
import { cleanup } from './support/mount-harness.js';
import { flush, mountWorkspace } from './support/workspace-row.js';

const open: WorkspaceHandle[] = [];
afterEach(() => {
  cleanup();
  for (const ws of open.splice(0)) act(() => ws.dispose());
});

test('the status region is 1px by 1px with a -1px margin, so it adds no scrollable area to a host', async () => {
  const ws = createWorkspace({ mount: false, root: definePanel({ id: 'root', settings: { title: 'History' }, view: () => null }), templates: [] });
  open.push(ws);
  const m = mountWorkspace(ws, { width: 1000 });
  await flush();
  const region = m.container.parentElement!.querySelector<HTMLElement>('[data-workspace-announcer]');
  assert.ok(region, 'the workspace draws its status region');
  const style = getComputedStyle(region);
  assert.deepEqual([style.position, style.width, style.height, style.margin], ['absolute', '1px', '1px', '-1px']);
});
