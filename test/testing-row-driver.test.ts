/**
 * The row driver on the `phonux/testing/row` entry: a workspace rendered with the real engine on the virtual frame clock.
 * Each test below is a claim the entry makes to a consumer's test suite, and fails if the driver stops keeping it.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAME_MS, frameClock, renderWorkspace, type RenderedWorkspace } from '../testingRow.js';
import * as React from 'react';
import { createWorkspace, definePanel, type WorkspaceHandle } from '../index.js';
import { memoryWorkspaceStorage } from '../fakeHost.js';
import type { WorkspaceState } from '../workspaceState.js';

const open: RenderedWorkspace[] = [];
afterEach(async () => {
  for (const rendered of open.splice(0)) await rendered.dispose();
});

const view = (id: string) => definePanel({ id, view: () => React.createElement('i', { 'data-marker': id }, id) });
const keysInOrder = (ws: WorkspaceHandle): string[] =>
  ws.panels.list({ status: 'live' }).map((h) => h.getState()).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((s) => s.id);

async function render(ws: WorkspaceHandle, width = 1600): Promise<RenderedWorkspace> {
  const rendered = await renderWorkspace(ws, { width });
  open.push(rendered);
  return rendered;
}

async function threePanels(over: { storage?: ReturnType<typeof memoryWorkspaceStorage> } = {}): Promise<WorkspaceHandle> {
  const ws = createWorkspace({ root: view('root'), templates: [view('a'), view('b'), view('c')], storage: over.storage ?? memoryWorkspaceStorage() });
  ws.addPanel('a');
  ws.addPanel('b');
  ws.addPanel('c');
  return ws;
}

test('the entry exports the frame clock, and frames() moves it by whole frames and nothing else does', async () => {
  const rendered = await render(await threePanels());
  const before = frameClock.now();
  await rendered.frames(3);
  assert.equal(frameClock.now() - before, 3 * FRAME_MS, 'three frames, three FRAME_MS');
  const idle = frameClock.now();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(frameClock.now(), idle, 'the clock reads no real time');
});

test('panel(id) answers with the drawn parts of a panel by its key, and undefined for a panel the row does not hold', async () => {
  const ws = createWorkspace({ root: view('root'), templates: [definePanel({ id: 'withfooter', view: () => React.createElement('i', null, 'x'), footer: () => React.createElement('b', { 'data-footer-marker': '' }, 'foot') })], storage: memoryWorkspaceStorage() });
  ws.addPanel('withfooter');
  const rendered = await render(ws);
  const panel = rendered.panel('withfooter');
  assert.ok(panel, 'the panel is in the row');
  assert.ok(panel.root.querySelector('[data-footer-marker]') !== null, 'root holds the panel\'s drawn view');
  assert.ok(panel.footer?.contains(panel.root.querySelector('[data-footer-marker]')), 'the footer part holds the footer');
  assert.ok(panel.header !== null, 'a framed panel draws a header');
  assert.equal(rendered.panel('nobody'), undefined);
  assert.ok(rendered.scroller.contains(panel.root), 'the panel sits in the scroller the driver reports');
});

test('a drag on a grab bar reorders the row with no wait on real time: the virtual clock supplies all of it', async () => {
  const ws = await threePanels();
  const rendered = await render(ws);
  assert.deepEqual(keysInOrder(ws), ['root', 'a', 'b', 'c']);
  const grab = rendered.panel('b')?.grabBar;
  assert.ok(grab, 'panel b draws a grab bar');
  const started = frameClock.now();
  await rendered.drag(grab, { dx: 420, dy: 0, steps: 12 });
  assert.deepEqual(keysInOrder(ws), ['root', 'a', 'c', 'b'], 'dragging b one panel right moved it past c');
  assert.ok(frameClock.now() - started >= 20 * FRAME_MS, 'the drag was played in virtual frames');
  assert.equal(frameClock.pendingCount(), 0, 'every animation has finished when drag resolves');
});

test('keepDown holds the pointer, release lets go, and nothing is reordered before the release', async () => {
  const ws = await threePanels();
  const rendered = await render(ws);
  await rendered.drag(rendered.panel('b')!.grabBar!, { dx: 420, dy: 0, steps: 12, keepDown: true });
  assert.deepEqual(keysInOrder(ws), ['root', 'a', 'b', 'c'], 'held');
  await rendered.release(420, 0);
  assert.deepEqual(keysInOrder(ws), ['root', 'a', 'c', 'b'], 'released');
});

test('setWidth gives the row a new window: a panel that no longer fits parks, and it comes back when the window grows', async () => {
  const ws = createWorkspace({ root: view('root'), templates: [view('a'), view('b')], defaults: { overflow: 'park' }, storage: memoryWorkspaceStorage() });
  ws.addPanel('a');
  ws.addPanel('b');
  const rendered = await render(ws, 1600);
  assert.equal(ws.panels.get('a')?.getState().status, 'live');
  await rendered.setWidth(900);
  assert.equal(rendered.scroller.clientWidth, 900, 'the scroller reports the new width');
  assert.equal(ws.panels.get('a')?.getState().status, 'parked', 'a no longer fits');
  assert.equal(rendered.panel('a'), undefined, 'and a parked panel has no slot');
  assert.equal(frameClock.pendingCount(), 0, 'setWidth resolved with every animation finished');
  await rendered.setWidth(1600);
  assert.equal(ws.panels.get('a')?.getState().status, 'live');
  assert.ok(rendered.panel('a'), 'a is drawn again');
});

test('press clicks a control the way a person does, once its panel is in use', async () => {
  const seen: string[] = [];
  const ws = createWorkspace({
    root: view('root'),
    templates: [definePanel({ id: 'btn', view: () => React.createElement('button', { 'data-press': '', onPointerDown: () => seen.push('down'), onPointerUp: () => seen.push('up'), onClick: () => seen.push('click') }, 'go') })],
    storage: memoryWorkspaceStorage(),
  });
  ws.addPanel('btn');
  const rendered = await render(ws);
  const button = rendered.panel('btn')!.root.querySelector('[data-press]')!;
  await rendered.press(button);
  assert.deepEqual(seen, ['down', 'up'], 'the first press only puts the panel in use');
  await rendered.press(button);
  assert.deepEqual(seen, ['down', 'up', 'down', 'up', 'click']);
});

test('a workspace that does not render itself fails with a message that says so', async () => {
  const ws = createWorkspace({ root: view('root'), mount: false, storage: memoryWorkspaceStorage() });
  await assert.rejects(renderWorkspace(ws), /never drew its row/);
  ws.dispose();
});

test('memoryWorkspaceStorage.saved is null until the first save and then a copy of what was saved', async () => {
  const storage = memoryWorkspaceStorage();
  assert.equal(storage.saved, null);
  const ws = createWorkspace({ root: view('root'), templates: [view('a'), view('b'), view('c')], storage, tuning: { saveQuietMs: 1 } });
  ws.addPanel('a');
  ws.addPanel('b');
  ws.addPanel('c');
  await render(ws);
  assert.equal(storage.saved, null, 'opening saves nothing');
  // Opening saves nothing, so a change (a title) is what makes the first save.
  ws.panels.get('a')!.configure({ title: 'Saved' });
  // The save waits out its quiet period on a real timer, which the virtual clock does not move.
  for (let turn = 0; turn < 100 && storage.saved === null; turn += 1) await new Promise((resolve) => setTimeout(resolve, 30));
  const saved = (): WorkspaceState | null => storage.saved;
  const first = saved();
  assert.ok(first, 'the workspace saved');
  assert.deepEqual(first.panels.map((p) => p.key), ['a', 'b', 'c'], 'the host\'s root column is not in the file');
  first.panels.length = 0;
  assert.equal(saved()?.panels.length, 3, 'a mutated copy changes nothing held');
});

test('the undocumented window.__panelsApiForTests hook is gone from the library', () => {
  const dir = fileURLToPath(new URL('..', import.meta.url));
  const holders = [...walk(dir)].filter((file) => readFileSync(file, 'utf8').includes('__panelsApiForTests'));
  assert.deepEqual(holders.map((file) => relative(dir, file)), []);
});

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'fixtures', 'dist', 'api-extractor-temp'].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(tsx?|mjs)$/.test(entry.name) && full !== fileURLToPath(import.meta.url)) yield full;
  }
}

test('panel(id).header and .grabBar are different parts, each marked as what it is', async () => {
  const rendered = await render(await threePanels());
  const panel = rendered.panel('a')!;
  assert.ok(panel.header && panel.grabBar);
  assert.notEqual(panel.header, panel.grabBar);
  assert.equal(panel.header.getAttribute('data-panel-chrome-part'), 'header');
  assert.equal(panel.grabBar.getAttribute('data-panel-chrome-part'), 'grab-bar');
});

test('dispose takes the workspace away and empties the document', async () => {
  const ws = await threePanels();
  const rendered = await renderWorkspace(ws, { width: 1600 });
  document.body.append(document.createElement('hr'));
  assert.ok(document.body.childElementCount > 1, 'control: the row and a stray node are in the document');
  await rendered.dispose();
  assert.equal(document.body.childElementCount, 0);
  assert.equal(ws.status, 'disposed');
});

test('a storage made with an initial state still reports saved as null until the first save', () => {
  const storage = memoryWorkspaceStorage({ version: 1, panels: [] });
  assert.equal(storage.saved, null);
  storage.save({ version: 1, panels: [] });
  assert.deepEqual(storage.saved, { version: 1, panels: [] });
});

test('setWidth with a height gives the scroller that height, and without one keeps it', async () => {
  const rendered = await render(await threePanels(), 1600);
  await rendered.setWidth(1500, 640);
  assert.equal(rendered.scroller.clientHeight, 640);
  await rendered.setWidth(1400);
  assert.equal(rendered.scroller.clientHeight, 640);
});
