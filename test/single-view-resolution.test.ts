/**
 * A row resolves a panel's `view` one way: the template its workspace holds under that id, else the placeholder. There is no
 * plain-view registry beside it, and a row (or the hook that feeds one) without a workspace does not exist.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as index from '../index.js';
import { HostProvider, PanelManagerError, PanelRow, createWorkspace, useProvidePanels } from '../index.js';
import { createFakeHost } from '../fakeHost.js';
import { resolveViewIn } from '../templateView.js';
import { placeholderFor } from '../viewRegistry.js';
import { cleanup } from './support/mount-harness.js';
import { flush, markerTemplate, mountWorkspace } from './support/workspace-row.js';

afterEach(() => cleanup());

const NONE: ReadonlySet<string> = new Set();
const isInvalidOptions = (e: unknown): boolean => e instanceof PanelManagerError && e.code === 'invalid-options';

test('a template of the row\'s workspace draws its panel, and a key no template answers to draws the placeholder naming the key', async () => {
  const known = markerTemplate('known');
  const ws = createWorkspace({ mount: false, templates: [known] });
  ws.addPanel(known);
  const m = mountWorkspace(ws);
  await flush();
  assert.equal(m.container.querySelectorAll('[data-template="known"]').length, 1, 'the template view drew its panel');
  assert.equal(m.container.querySelectorAll('[data-unregistered-panel-view]').length, 0, 'control: nothing is a placeholder yet');
  act(() => m.latest().create({ view: 'nowhere' }));
  const placeholder = m.container.querySelector('[data-unregistered-panel-view="nowhere"]');
  assert.ok(placeholder, 'an unknown key draws a placeholder');
  assert.equal(placeholder.querySelector('[data-unregistered-panel-view-key]')?.textContent, 'nowhere');
  assert.equal(m.container.querySelectorAll('[data-template="known"]').length, 1, 'the known panel is untouched');
});

test('resolveViewIn answers a template with its adapter and anything else with the one placeholder of that key', () => {
  const t = markerTemplate('held');
  const found = resolveViewIn((id) => (id === 'held' ? t : undefined), 'held');
  assert.notEqual(found, placeholderFor('held'), 'a template is not the placeholder');
  assert.equal(resolveViewIn((id) => (id === 'held' ? t : undefined), 'held'), found, 'one adapter per template');
  assert.equal(resolveViewIn(() => undefined, 'missing'), placeholderFor('missing'));
  assert.equal(placeholderFor('missing'), placeholderFor('missing'), 'one placeholder per key, so a row does not remount it');
  assert.notEqual(placeholderFor('missing'), placeholderFor('other'));
});

test('a PanelRow without a workspace throws invalid-options', () => {
  const row = React.createElement(PanelRow, { entries: [], rootId: 'root', closingIds: NONE, enteringViaAnchorIds: NONE } as never);
  assert.throws(() => renderToStaticMarkup(React.createElement(HostProvider, { host: createFakeHost(), children: row })), isInvalidOptions);
});

test('useProvidePanels without a workspace throws invalid-options', () => {
  function Probe(): React.ReactElement {
    useProvidePanels({ phoneWidth: 390, containerWidth: 1000, overflowContainerRef: { current: null } } as never);
    return React.createElement('i');
  }
  assert.throws(() => renderToStaticMarkup(React.createElement(Probe)), isInvalidOptions);
});

test('the barrel has no registerView or resolveView', () => {
  assert.equal('registerView' in index, false);
  assert.equal('resolveView' in index, false);
  assert.equal(typeof index.definePanel, 'function', 'control: the barrel is the real one');
});
