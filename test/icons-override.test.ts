import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { PanelHeaderRow } from '../index.js';
import { HostProvider, type HostInput } from '../hostApi.js';
import { resolveIcons } from '../icons.js';
import { refusedLiveKeys } from '../workspaceLive.js';

const panels = {} as HostInput['panels'];

function renderDom(el: ReturnType<typeof createElement>): Document {
  return new JSDOM(`<body>${renderToStaticMarkup(el)}</body>`).window.document;
}

test('icons: with no host the empty header draws the default glyph, an inline svg', () => {
  const doc = renderDom(createElement(PanelHeaderRow, { title: 'x', actions: false }));
  assert.ok(doc.querySelector('[data-header-placeholder-action] svg path'));
});

test("icons: a host's icon replaces the default where the library draws it", () => {
  const mine = createElement('i', { 'data-mine': '' });
  const doc = renderDom(createElement(HostProvider, { host: { panels, icons: { noActions: mine } }, children: createElement(PanelHeaderRow, { title: 'x', actions: false }) }));
  assert.ok(doc.querySelector('[data-header-placeholder-action] [data-mine]'));
  assert.equal(doc.querySelector('[data-header-placeholder-action] svg'), null);
});

test('icons: a key left out or given as undefined keeps its default', () => {
  const size = (slots: number) => `size ${slots}`;
  const icons = resolveIcons({ size, grab: undefined });
  assert.equal(icons.size, size);
  assert.equal(icons.grab, resolveIcons().grab);
});

test('icons: update may change icons, like labels', () => {
  assert.deepEqual(refusedLiveKeys({ icons: {}, labels: {} }), []);
});

test('icons: the package no longer depends on @mui/icons-material', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, Record<string, string> | undefined>;
  for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) assert.equal(pkg[field]?.['@mui/icons-material'], undefined, field);
});
