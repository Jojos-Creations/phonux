/**
 * Closing a panel under the system's reduced-motion preference, with no MotionConfig around the row: the leaving panel is gone
 * at once instead of sliding and shrinking away. Motion reads the preference once, so this file has to be the process's first caller.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createWorkspace, definePanel } from '../index.js';
import type { WorkspaceHandle } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { stableIds } from './support/frame-fixtures.js';
import { flush, mountWorkspace } from './support/workspace-row.js';

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
});

const open: WorkspaceHandle[] = [];
afterEach(() => {
  cleanup();
  for (const ws of open.splice(0)) act(() => ws.dispose());
});

test('a closed panel leaves within a few frames when the system asks for reduced motion', async () => {
  const bare = (id: string) => definePanel({ id, settings: { title: id, multiple: true }, view: ({ panel }) => React.createElement('p', { 'data-body': id, 'data-slot': panel.id }, panel.id) });
  const ws = createWorkspace({ mount: false, templates: [bare('one'), bare('two')], newId: stableIds() });
  open.push(ws);
  for (const id of ['one', 'two']) ws.addPanel(id, { id: `${id}-1` });
  const m = mountWorkspace(ws, { width: 1600, withMaxLiveWidth: true });
  await flush();
  await advanceFrames(1000);
  assert.ok(m.container.querySelector('[data-body="one"]') !== null, 'control: the panel is drawn before the close');
  await act(async () => void ws.panels.get('one-1')!.close('person'));
  await advanceFrames(48);
  assert.equal(m.container.querySelector('[data-body="one"]') === null, true, 'gone three frames after the close, not still sliding out');
});
