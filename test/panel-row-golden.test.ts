/**
 * PanelRow's static markup for three literal rows, compared by string equality with the files in
 * test/fixtures/panel-row-golden. A fresh emotion cache per render puts each rule in its own markup, so a test run
 * alone renders what a full run does. The files hold the markup with a newline between tags, so a review reads a diff
 * line by line. A deliberate change to the row's markup rewrites its golden in the same commit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { HostProvider, type PanelWindow } from '../index.js';
import { createFakeHost } from '../fakeHost.js';
import { StaticRow } from './support/seed-workspace.js';
import { registerTestView } from './support/test-views.js';

registerTestView('golden-view', ({ panel }) => createElement('span', { 'data-golden-view': panel.id }, panel.title));

const NONE: ReadonlySet<string> = new Set();

const root: PanelWindow = {
  id: 'root', url: '', title: 'History', live: true, view: 'golden-view', collapsible: false, listed: false,
  layer: 'raised', anchoredEnter: true, size: { width: 390, height: 700 },
};
const phone = (id: string, title: string, priority: number, live = true): PanelWindow => ({
  id, url: `https://${id}.example`, title, live, view: 'golden-view', collapsible: true, listed: true,
  anchor: { panel: 'root', position: 'right', priority }, layer: 'base', anchoredEnter: false,
  size: { width: 390, height: 700 },
});
const twoSlots = (id: string, title: string, priority: number): PanelWindow => ({
  ...phone(id, title, priority), slots: 2, size: { width: 796, height: 'fill' },
});

function render(entries: PanelWindow[]): string {
  const row: ReactElement = createElement(StaticRow, { entries, rootId: 'root', closingIds: NONE, enteringViaAnchorIds: NONE });
  const tree = createElement(CacheProvider, { value: createCache({ key: 'css' }), children: createElement(HostProvider, { host: createFakeHost(), children: row }) });
  return `${renderToStaticMarkup(tree).replace(/></g, '>\n<')}\n`;
}

function golden(name: string): string {
  const text = readFileSync(new URL(`./fixtures/panel-row-golden/${name}.html`, import.meta.url), 'utf8');
  assert.ok(text.length > 0, `${name}.html is empty, so the comparison would prove nothing`);
  return text;
}

test('PanelRow golden: the root alone', () => {
  assert.equal(render([root]), golden('root-only'));
});

test('PanelRow golden: the root, a one-slot panel and a two-slot panel, both live', () => {
  assert.equal(render([root, phone('a', 'Alpha', 0), twoSlots('b', 'Beta', 1)]), golden('root-two-live'));
});

test('PanelRow golden: the root, one live panel and one parked panel (the parked one renders nothing)', () => {
  assert.equal(render([root, phone('a', 'Alpha', 0), phone('p', 'Parked', 1, false)]), golden('root-live-parked'));
});
