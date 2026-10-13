/**
 * Panel's static markup for four literal Panels, compared by string equality with the files in
 * test/fixtures/panel-header-golden. A fresh emotion cache per render puts each rule in its own markup, so a test run
 * alone renders what a full run does. The files hold the markup with a newline between tags, so a review reads a diff
 * line by line. A deliberate change to the header's markup rewrites its golden in the same commit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
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

/** `RECORD_GOLDEN=1` rewrites the files from the markup instead of comparing: a deliberate change to the header's markup. */
function check(actual: string, name: string): void {
  if (process.env.RECORD_GOLDEN === '1') writeFileSync(new URL(`./fixtures/panel-header-golden/${name}.html`, import.meta.url), actual);
  else assert.equal(actual, golden(name));
}

function golden(name: string): string {
  const text = readFileSync(new URL(`./fixtures/panel-header-golden/${name}.html`, import.meta.url), 'utf8');
  assert.ok(text.length > 0, `${name}.html is empty, so the comparison would prove nothing`);
  return text;
}

test('Panel golden: no title renders no header row', () => {
  check(render({}), 'no-title');
});

test('Panel golden: a title renders the header pill with the placeholder actions icon', () => {
  check(render({ title: 'Sessions' }), 'title');
});

test('Panel golden: a title with actions renders the actions in the right-hand cluster', () => {
  check(render({ title: 'Sessions', actions: createElement('button', { type: 'button' }, 'Edit') }), 'title-actions');
});

test('Panel golden: a title with grabProps adds the grab bar above the frame', () => {
  check(render({ title: 'Sessions', grabProps: { 'aria-label': 'Drag panel', 'data-grab': '' } }), 'title-grab');
});

const declared = (over: Record<string, unknown> = {}) => ({ pin: { icon: createElement('i', { 'data-icon': 'pin' }), label: 'Pin panel', onClick: () => undefined, ...over } });

test('Panel golden: every declared slot hidden is the title golden, because Panel passes undefined and the placeholder renders', () => {
  check(staticPanel({ slots: declared({ hidden: true }), props: { title: 'Sessions' } }), 'title');
});

test('Panel golden: a declared slot and a view passing falsy actions draw the cluster and no placeholder', () => {
  const html = staticPanel({ slots: declared(), props: { title: 'Sessions', actions: false } });
  check(html, 'title-header-buttons');
  assert.equal(html.includes('data-header-placeholder-action'), false);
});
