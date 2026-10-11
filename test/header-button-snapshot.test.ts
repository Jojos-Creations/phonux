/** A panel with header buttons added after mount must not make React report an unstable useSyncExternalStore snapshot. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act, createElement } from 'react';
import { Panel, createWorkspace, definePanel } from '../index.js';
import { flush, markerTemplate, mountWorkspace } from './support/workspace-row.js';
import { cleanup } from './support/mount-harness.js';

afterEach(() => cleanup());

test('adding a panel with headerButtons after mount logs no getSnapshot caching error', async () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.map(String).join(' '));
  try {
    const template = definePanel({
      id: 'a',
      settings: { headerButtons: { x: { icon: createElement('i'), label: 'X', onClick: () => undefined } } },
      view: ({ panel }) => createElement(Panel, { title: panel.id, children: null }),
    });
    const ws = createWorkspace({ root: markerTemplate('root', { settings: { title: 'History' } }), templates: [template] });
    mountWorkspace(ws, { width: 4000 });
    await flush();
    act(() => {
      ws.addPanel('a');
    });
    await flush();
  } finally {
    console.error = original;
  }
  assert.deepEqual(errors.filter((e) => e.includes('getSnapshot')), []);
});
