/**
 * Panel's static markup for four literal Panels, compared by string equality with the files in
 * test/fixtures/panel-header-golden. A fresh emotion cache per render puts each rule in its own markup, so a test run
 * alone renders what a full run does. The files hold the markup with a newline between tags, so a review reads a diff
 * line by line. A deliberate change to the header's markup rewrites its golden in the same commit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { HostProvider, Panel, type PanelProps } from '../index.js';
import { createFakeHost } from '../fakeHost.js';
import { staticPanel } from './support/static-panel.js';

function render(props: Omit<PanelProps, 'children'>): string {
  const panel: ReactElement = createElement(Panel, { ...props, children: 'Body' });
  const tree = createElement(CacheProvider, { value: createCache({ key: 'css' }), children: createElement(HostProvider, { host: createFakeHost(), children: panel }) });
  return `${renderToStaticMarkup(tree).replace(/></g, '>\n<')}\n`;
}

function golden(name: string): string {
  const text = readFileSync(new URL(`./fixtures/panel-header-golden/${name}.html`, import.meta.url), 'utf8');
  assert.ok(text.length > 0, `${name}.html is empty, so the comparison would prove nothing`);
  return text;
}

test('Panel golden: no title renders no header row', () => {
  assert.equal(render({}), golden('no-title'));
});

test('Panel golden: a title renders the header pill with the placeholder actions icon', () => {
  assert.equal(render({ title: 'Sessions' }), golden('title'));
});

test('Panel golden: a title with actions renders the actions in the right-hand cluster', () => {
  assert.equal(render({ title: 'Sessions', actions: createElement('button', { type: 'button' }, 'Edit') }), golden('title-actions'));
});

test('Panel golden: a title with grabProps adds the grab bar above the frame', () => {
  assert.equal(render({ title: 'Sessions', grabProps: { 'aria-label': 'Drag panel', 'data-grab': '' } }), golden('title-grab'));
});

const declared = (over: Record<string, unknown> = {}) => ({ pin: { icon: createElement('i', { 'data-icon': 'pin' }), label: 'Pin panel', onClick: () => undefined, ...over } });

test('Panel golden: every declared slot hidden is the title golden, because Panel passes undefined and the placeholder renders', () => {
  assert.equal(staticPanel({ slots: declared({ hidden: true }), props: { title: 'Sessions' } }), golden('title'));
});

test('Panel golden: a declared slot and a view passing falsy actions draw the cluster and no placeholder', () => {
  const html = staticPanel({ slots: declared(), props: { title: 'Sessions', actions: false } });
  assert.equal(html, golden('title-header-buttons'));
  assert.equal(html.includes('data-header-placeholder-action'), false);
});
