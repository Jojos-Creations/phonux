/**
 * The closed-pages panel: grouping, search, choosing a row, the empty and loading states, and the template in a workspace.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { ClosedPagesPanel, createClosedPagesTemplate, createWorkspace } from '../index.js';
import type { ClosedPageEntry, ClosedPagesList } from '../index.js';
import { cleanup, mount, withHost } from './support/mount-harness.js';
import { createFakeHost } from '../fakeHost.js';
import { markerTemplate, mountWorkspace } from './support/workspace-row.js';

afterEach(() => cleanup());

const h = React.createElement;

const ENTRIES: ClosedPageEntry[] = [
  { id: 'a', title: 'Alpha docs', url: 'https://alpha.example/docs', closedAt: '2026-09-14T09:00:00.000Z' },
  { id: 'b', title: 'Beta', closedAt: '2026-09-14T11:30:00.000Z' },
  { id: 'c', title: 'Gamma', url: 'https://gamma.example', closedAt: '2026-09-13T08:00:00.000Z' },
];

function fakeList(entries: readonly ClosedPageEntry[], loaded = true): ClosedPagesList & { touched: string[] } {
  const touched: string[] = [];
  return {
    loaded,
    entries,
    touched,
    add: () => {},
    touch: (id) => {
      touched.push(id);
    },
  };
}

const rows = (container: HTMLElement): string[] => [...container.querySelectorAll('[data-closed-pages-row] button > span:first-child')].map((r) => r.textContent ?? '');

function typeInto(input: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  React.act(() => {
    set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('the panel lists every entry, newest day first and newest entry first within a day', () => {
  const m = mount(withHost(h(ClosedPagesPanel, { list: fakeList(ENTRIES), onReopen: () => {} })));
  const order = rows(m.container);
  assert.deepEqual(order, ['Beta', 'Alpha docs', 'Gamma']);
  const headings = [...m.container.querySelectorAll('[data-closed-pages] ul')].length;
  assert.equal(headings, 2, 'one list per day');
});

test('the search matches title or url without regard to case, and says so when nothing matches', () => {
  const m = mount(withHost(h(ClosedPagesPanel, { list: fakeList(ENTRIES), onReopen: () => {} })));
  const input = m.container.querySelector('input') as HTMLInputElement;
  typeInto(input, 'GAMMA.EXAMPLE');
  assert.deepEqual(rows(m.container), ['Gamma']);
  typeInto(input, 'zzz');
  assert.equal(m.container.querySelector('[data-closed-pages-empty]')?.textContent, 'No matches');
});

test('choosing a row touches its entry, then calls onReopen with it', () => {
  const list = fakeList(ENTRIES);
  const seen: string[] = [];
  const m = mount(withHost(h(ClosedPagesPanel, { list, onReopen: (e) => seen.push(`reopen:${e.id}`) })));
  (m.container.querySelectorAll('[data-closed-pages-row] button')[2] as HTMLButtonElement).click();
  assert.deepEqual(list.touched, ['c']);
  assert.deepEqual(seen, ['reopen:c']);
});

test('an empty log and a log not yet read show their own states', () => {
  const empty = mount(withHost(h(ClosedPagesPanel, { list: fakeList([]), onReopen: () => {} })));
  assert.equal(empty.container.querySelector('[data-closed-pages-empty]')?.textContent, 'No closed pages yet');
  empty.unmount();
  const loading = mount(withHost(h(ClosedPagesPanel, { list: fakeList([], false), onReopen: () => {} })));
  assert.equal(loading.container.querySelector('[data-closed-pages-empty]'), null);
  assert.equal(loading.container.textContent?.includes('Loading'), true);
});

test('createClosedPagesTemplate returns a template with its id and title, and mounts in a workspace', () => {
  const template = createClosedPagesTemplate({ list: fakeList(ENTRIES), onReopen: () => {}, title: 'Recent' });
  assert.equal(template.id, 'closed-pages');
  assert.equal(template.settings?.title, 'Recent');
  const ws = createWorkspace({ mount: false, root: markerTemplate('root', { settings: { title: 'Home' } }), templates: [template] });
  ws.addPanel(template);
  const m = mountWorkspace(ws);
  assert.equal(m.container.querySelectorAll('[data-closed-pages-row]').length, 3);
});

test('panel text comes from the host labels, with English defaults when none are given', () => {
  const host = { ...createFakeHost(), labels: { closedPagesEmpty: 'Nothing yet', closedPagesSearch: 'Find' } };
  const m = mount(withHost(h(ClosedPagesPanel, { list: fakeList([]), onReopen: () => {} }), host));
  assert.equal(m.container.querySelector('[data-closed-pages-empty]')?.textContent, 'Nothing yet');
  assert.equal(m.container.querySelector('input')?.getAttribute('placeholder'), 'Find');
});
