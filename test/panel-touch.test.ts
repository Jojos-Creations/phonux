/** A template's `touch`: which panels it marks and how, the stylesheet it shares, and what definePanel accepts. */
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

test("touch: 'content' marks its panel for the frame only, and true for the whole panel", () => {
  const m = mountWith([definePanel({ id: 'inner', view, touch: 'content' }), definePanel({ id: 'whole', view, touch: true })]);
  const marks = [...m.container.querySelectorAll('[data-panel-root][data-panel-touch]')].map((el) => el.getAttribute('data-panel-touch')).sort();
  assert.deepEqual(marks, ['', 'content']);
  const css = document.querySelector('style[data-phonux-touch]')?.textContent ?? '';
  assert.match(css, /\[data-panel-touch="content"\] \[data-phone-frame\]/, 'under content only the frame is styled');
});

test("definePanel takes a boolean or 'content' for touch and refuses anything else", () => {
  assert.doesNotThrow(() => definePanel({ id: 'ok', view, touch: true }));
  assert.doesNotThrow(() => definePanel({ id: 'ok', view, touch: 'content' }));
  assert.doesNotThrow(() => definePanel({ id: 'ok', view, touch: undefined }));
  for (const touch of ['yes', 'header', 1, null, {}]) {
    assert.throws(
      () => definePanel({ id: 'bad', view, touch: touch as never }),
      (e: unknown) => e instanceof PanelManagerError && e.code === 'invalid-template' && e.message.includes("touch must be a boolean or 'content'"),
    );
  }
});
