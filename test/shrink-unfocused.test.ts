/**
 * `tuning.shrinkUnfocused`: a panel wider than one phone rests at one phone while another panel is active or after a
 * press outside every panel, and goes back to its own width the next time it is active. The width it goes back to is the one saved.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { projectWorkspaceState } from '../workspaceState.js';
import { differential, differentialsCovered } from './support/differential.js';
import { cleanup } from './support/mount-harness.js';
import { matrixRig, type MatrixRig } from './support/configure-matrix.js';
import { act } from 'react';
import { memoryWorkspaceStorage } from '../fakeHost.js';

afterEach(() => {
  cleanup();
  mock.timers.reset();
});

const rig = async (shrinkUnfocused = true): Promise<MatrixRig> => {
  const r = await matrixRig({ workspace: { tuning: { shrinkUnfocused } } });
  await r.settle();
  return r;
};
const press = (r: MatrixRig, id: string): void => r.turn(() => void r.slot(id)!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })));
const widths = (r: MatrixRig, id: string): unknown[] => [r.entry(id).slots, r.entry(id).savedSlots];

test('a press on the dot bar moves the row and rests nothing, while a press beside it rests the wide panel', async () => {
  const r = await rig();
  r.turn(() => r.h.b!.setSlots(2, 'person'));
  press(r, 'b');
  assert.deepEqual(widths(r, 'b'), [2, undefined], 'control: b in use stays wide');
  const bar = document.body.appendChild(document.createElement('div'));
  bar.setAttribute('data-dot-bar', '');
  r.turn(() => void bar.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })));
  assert.deepEqual(widths(r, 'b'), [2, undefined], 'the dot bar rests nothing');
  r.turn(() => void document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })));
  assert.deepEqual(widths(r, 'b'), [1, 2], 'control: a press outside the bar still rests it');
  bar.remove();
});

test("a press on a resting panel's own header button keeps it at one phone; a press on its content brings it back", async () => {
  const r = await rig();
  r.turn(() => r.h.b!.setSlots(2, 'person'));
  press(r, 'a');
  assert.deepEqual(widths(r, 'b'), [1, 2], 'control: b rests');
  const header = document.createElement('div');
  header.setAttribute('data-panel-chrome-part', 'header');
  const close = header.appendChild(document.createElement('button'));
  r.slot('b')!.appendChild(header);
  r.turn(() => void close.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })));
  r.turn(() => close.focus());
  assert.deepEqual(widths(r, 'b'), [1, 2], 'a close or size button acts on the panel as drawn, without growing it first');
  press(r, 'b');
  assert.deepEqual(widths(r, 'b'), [2, undefined]);
});

test('a press outside every panel rests the wide panel in use', async () => {
  const r = await rig();
  r.turn(() => r.h.b!.setSlots(2, 'person'));
  press(r, 'b');
  assert.deepEqual(widths(r, 'b'), [2, undefined], 'control: b in use stays wide');
  r.turn(() => void document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })));
  assert.deepEqual(widths(r, 'b'), [1, 2]);
  press(r, 'b');
  assert.deepEqual(widths(r, 'b'), [2, undefined], 'and a press inside brings it back');
});

test('the saved file keeps the width a resting panel goes back to', async () => {
  const r = await rig();
  r.turn(() => r.h.b!.setSlots(2, 'person'));
  press(r, 'a');
  assert.deepEqual(widths(r, 'b'), [1, 2]);
  const saved = projectWorkspaceState(r.provided().entries, r.ws.rootId);
  assert.deepEqual(saved.panels.map((p) => p.slots), [undefined, 2, undefined], 'b is saved two wide while it rests at one');
});

test('a view reads the width a resting panel goes back to on its summary, and nothing once it is back', async () => {
  const r = await rig();
  const summary = () => r.provided().panelList.find((s) => s.id === r.entry('b').key)!;
  r.turn(() => r.h.b!.setSlots(2, 'person'));
  press(r, 'b');
  assert.deepEqual([summary().slots, 'savedSlots' in summary()], [2, false], 'control: in use, no saved width is listed');
  press(r, 'a');
  assert.deepEqual([summary().slots, summary().savedSlots], [1, 2]);
  press(r, 'b');
  assert.deepEqual([summary().slots, 'savedSlots' in summary()], [2, false]);
});

test('a width set while a panel rests replaces the one it goes back to', async () => {
  const r = await rig();
  r.turn(() => r.h.b!.setSlots(2, 'person'));
  press(r, 'a');
  r.turn(() => r.h.b!.setSlots(3));
  assert.deepEqual(widths(r, 'b'), [3, undefined], 'a resize from code is the width now');
  press(r, 'a');
  assert.deepEqual(widths(r, 'b'), [1, 3], 'used elsewhere, it rests and keeps three');
});

test('turning the tuning off leaves no panel stuck: the next activation still brings it back', async () => {
  const r = await rig();
  r.turn(() => r.h.b!.setSlots(2, 'person'));
  press(r, 'a');
  r.turn(() => r.ws.panels.configureTuning({ shrinkUnfocused: false }));
  press(r, 'b');
  assert.deepEqual(widths(r, 'b'), [2, undefined]);
  press(r, 'a');
  assert.deepEqual(widths(r, 'b'), [2, undefined], 'off: another panel active leaves b wide');
});

test('a launch keeps every saved wide panel at its saved width, and a press changes nothing about it', async () => {
  const settleSave = (): Promise<void> => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 150))));
  const store = memoryWorkspaceStorage();
  const launch = async (shrinkUnfocused: boolean): Promise<MatrixRig> => {
    const r = await matrixRig({ workspace: { storage: store, tuning: { saveQuietMs: 5, shrinkUnfocused } } });
    await settleSave();
    return r;
  };
  let r = await launch(true);
  r.turn(() => r.h.b!.setSlots(2, 'person'));
  press(r, 'b');
  await settleSave();
  r.m.unmount();
  assert.equal((await store.load())!.panels.find((p) => p.key === 'b')?.slots, 2, 'control: b was saved two wide');
  r = await launch(true);
  assert.deepEqual(widths(r, 'b'), [2, undefined], 'the next launch starts b at its saved two, not resting');
  await settleSave();
  assert.equal((await store.load())!.panels.find((p) => p.key === 'b')?.slots, 2, 'the file still holds two');
  press(r, 'b');
  assert.deepEqual(widths(r, 'b'), [2, undefined], 'pressed: still two');
  r.m.unmount();
  r = await launch(false);
  assert.deepEqual(widths(r, 'b'), [2, undefined], 'off: a launch restores b two wide');
  r.m.unmount();
});

test('differential tuning.shrinkUnfocused: using another panel rests a wide one only when it is on', async () => {
  const after = async (on: boolean): Promise<unknown[]> => {
    const r = await rig(on);
    r.turn(() => r.h.b!.setSlots(2, 'person'));
    press(r, 'a');
    const out = widths(r, 'b');
    r.m.unmount();
    return out;
  };
  const seen = { off: await after(false), on: await after(true) };
  differential('tuning.shrinkUnfocused', (run) => {
    for (const value of [false, true]) run(value, () => seen[value ? 'on' : 'off']);
  });
});

test('every name this file owns has a completed differential', () => {
  assert.ok(differentialsCovered().length > 0, 'no differential completed, so the equality below would prove nothing');
  assert.deepEqual(differentialsCovered(), ['tuning.shrinkUnfocused']);
});
