/** A template's `touch` flag: which panels it marks, the stylesheet it shares, and what definePanel accepts. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { Panel, PanelFrame, PanelManagerError, createWorkspace, definePanel } from '../index.js';
import { cleanup } from './support/mount-harness.js';
import { markerTemplate, mountWorkspace } from './support/workspace-row.js';

afterEach(() => cleanup());

const h = React.createElement;
const view = (): React.ReactElement => h(Panel, { title: 'T', children: h(PanelFrame, { children: 'body' }) });
const sheets = (): number => document.querySelectorAll('style[data-phonux-touch]').length;

function mountWith(templates: ReturnType<typeof definePanel>[]) {
  const ws = createWorkspace({ mount: false, root: markerTemplate('root', { settings: { title: 'History' } }), templates });
  for (const t of templates) ws.addPanel(t);
  return mountWorkspace(ws);
}

test('only panels from a touch template are marked, and they share one stylesheet that leaves with the last of them', () => {
  const m = mountWith([definePanel({ id: 'phone', view, touch: true }), definePanel({ id: 'phone2', view, touch: true }), definePanel({ id: 'desk', view })]);
  const roots = [...m.container.querySelectorAll('[data-panel-root]')];
  assert.equal(roots.length >= 3, true, `three panel roots drew, saw ${roots.length}`);
  assert.equal(m.container.querySelectorAll('[data-panel-root][data-panel-touch]').length, 2, 'the two touch panels are marked and the other is not');
  assert.equal(sheets(), 1, 'one stylesheet for both');
  m.unmount();
  assert.equal(sheets(), 0, 'the stylesheet goes with the last touch panel');
});

test('a workspace with no touch template adds no stylesheet', () => {
  mountWith([definePanel({ id: 'desk', view, touch: false })]);
  assert.equal(document.querySelectorAll('[data-panel-touch]').length, 0);
  assert.equal(sheets(), 0);
});

test('definePanel takes a boolean touch and refuses anything else', () => {
  assert.doesNotThrow(() => definePanel({ id: 'ok', view, touch: true }));
  assert.doesNotThrow(() => definePanel({ id: 'ok', view, touch: undefined }));
  for (const touch of ['yes', 1, null, {}]) {
    assert.throws(
      () => definePanel({ id: 'bad', view, touch: touch as never }),
      (e: unknown) => e instanceof PanelManagerError && e.code === 'invalid-template' && e.message.includes('touch must be a boolean'),
    );
  }
});
