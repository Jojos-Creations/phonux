/**
 * undoClose through the real provider: the batch is consumed from the ref a first call empties, a panel whose key is
 * already in the row is skipped and not reported, and a hand-built entry (its key is its id) behaves as before.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { useProvidePanels, type PanelWindow, type ProvidedPanels } from '../index.js';
import { cleanup, mount, useSeededInput } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';

registerTestView('undo-view', ({ panel }) => React.createElement('i', { 'data-slot': panel.id }, panel.title));

const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({
  id,
  url: `https://${id}.example`,
  title: id,
  live: true,
  locked: false,
  view: 'undo-view',
  collapsible: true,
  listed: true,
  ...over,
});
const root = (): PanelWindow => entry('root', { url: '', title: 'History', locked: true, collapsible: false, listed: false });

function provide(initialEntries: PanelWindow[]): { now: () => ProvidedPanels; ids: () => string[]; restored: string[][]; closed: string[] } {
  let latest: ProvidedPanels | undefined;
  const restored: string[][] = [];
  const closed: string[] = [];
  function Probe(): React.ReactElement {
    latest = useProvidePanels(useSeededInput({ initialEntries, onPanelsClosed: (e) => closed.push(e.id), onPanelsRestored: (logIds) => restored.push(logIds) }));
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  const now = (): ProvidedPanels => {
    assert.ok(latest, 'the probe never rendered, so there is no provider value to read');
    return latest;
  };
  return { now, ids: () => now().entries.map((p) => p.id), restored, closed };
}

afterEach(() => cleanup());

test('two undoClose calls in one handler restore once and report once; a call after the window closed does nothing', () => {
  const p = provide([root(), entry('a'), entry('b')]);
  act(() => p.now().close('a'));
  act(() => {
    const stale = p.now();
    stale.undoClose();
    stale.undoClose();
  });
  assert.deepEqual(p.ids(), ['root', 'a', 'b']);
  assert.deepEqual(p.restored, [[p.closed[0]!]], 'one report with the one log id');
  act(() => p.now().undoClose());
  assert.deepEqual(p.restored.length, 1, 'with the window empty a later call reports nothing');
  assert.equal(p.now().recentlyClosed, null);
});

test('one undoClose after two closes restores both in one report, in close order', () => {
  const p = provide([root(), entry('a'), entry('b'), entry('c')]);
  act(() => p.now().close('a'));
  act(() => p.now().close('c'));
  assert.deepEqual(p.ids(), ['root', 'b']);
  act(() => {
    const stale = p.now();
    stale.undoClose();
    stale.undoClose();
  });
  assert.deepEqual(p.ids(), ['root', 'a', 'b', 'c']);
  assert.deepEqual(p.restored, [p.closed.slice(0, 2)], 'both log ids once, in close order');
});

test('a closed panel whose key is already in the row under another id is skipped and reported as nothing', () => {
  const p = provide([root(), entry('a', { key: 'k' }), entry('twin', { key: 'k' }), entry('b')]);
  act(() => p.now().close('a'));
  assert.deepEqual(p.ids(), ['root', 'twin', 'b']);
  act(() => p.now().undoClose());
  assert.deepEqual(p.ids(), ['root', 'twin', 'b'], 'the key k is present, so a does not come back a second time');
  assert.deepEqual(p.restored, [], 'and nothing is reported');
});

test('a compat caller seeding a locked, collapsible entry under the closed panel\'s key: nothing comes back and nothing is reported', () => {
  const p = provide([root(), entry('a', { key: 'k' }), entry('seed', { key: 'k', locked: true, collapsible: true })]);
  act(() => p.now().close('a'));
  act(() => p.now().undoClose());
  assert.deepEqual(p.ids(), ['root', 'seed']);
  assert.deepEqual(p.restored, []);
});

test('a hand-built entry has its id for its key, so an undo with no twin restores it and reports it', () => {
  const p = provide([root(), entry('a'), entry('seed', { locked: true, collapsible: true })]);
  act(() => p.now().close('a'));
  act(() => p.now().undoClose());
  assert.deepEqual(p.ids(), ['root', 'a', 'seed']);
  assert.deepEqual(p.restored, [[p.closed[0]!]]);
});

test('source: undoClose reads the batch from closedRef, and the skip check names the key', () => {
  const dir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'panels');
  const source = readFileSync(join(dir, 'usePanelClosing.ts'), 'utf8');
  const body = source.slice(source.indexOf('const undoClose = () => {'));
  assert.ok(body.length < source.length, 'the function was found');
  const head = body.slice(0, body.indexOf('stopWindow();'));
  assert.ok(head.includes('closedRef.current'), 'the batch comes from the ref');
  assert.ok(!/\bclosed\b/.test(head.replace(/\/\/.*$/gm, '')), 'and not from the render-time closed list');
  assert.ok(body.includes('panelKey(p) === panelKey(panel)'), 'the skip check compares keys');
});
