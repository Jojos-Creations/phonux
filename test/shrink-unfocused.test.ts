/**
 * `tuning.shrinkUnfocused`: a panel wider than one phone rests at one phone while another panel is active or after the
 * person moves the row, and goes back to its own width the next time it is active. The width it goes back to is the one saved.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { projectWorkspaceState } from '../workspaceState.js';
import { cleanup } from './support/mount-harness.js';
import { matrixRig, type MatrixRig } from './support/configure-matrix.js';
import { rowScrollerFor } from './support/workspace-row.js';

afterEach(() => {
  cleanup();
  mock.timers.reset();
});

const rig = async (): Promise<MatrixRig> => {
  const r = await matrixRig({ workspace: { tuning: { shrinkUnfocused: true } } });
  await r.settle();
  return r;
};
const press = (r: MatrixRig, id: string): void => r.turn(() => void r.slot(id)!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })));
const widths = (r: MatrixRig, id: string): unknown[] => [r.entry(id).slots, r.entry(id).restoreSlots];

test('moving the row rests every wide panel at one phone, the active one too, and a press brings it back', async () => {
  const r = await rig();
  r.turn(() => r.h.b!.setSlots(2, 'person'));
  r.turn(() => r.h.c!.setSlots(3, 'person'));
  press(r, 'c');
  assert.deepEqual([widths(r, 'b'), widths(r, 'c')], [[1, 2], [3, undefined]], 'control: c active, b rests');
  r.turn(() => rowScrollerFor(r.m.container).noteMove());
  assert.deepEqual([widths(r, 'b'), widths(r, 'c')], [[1, 2], [1, 3]], 'a move of the row rests c as well');
  r.turn(() => rowScrollerFor(r.m.container).noteInput());
  assert.deepEqual(widths(r, 'c'), [1, 3], 'a press on the row that moves nothing is not a move');
  press(r, 'c');
  assert.deepEqual([widths(r, 'b'), widths(r, 'c')], [[1, 2], [3, undefined]], 'c active again is three wide; b still rests');
});

test('the saved file keeps the width a resting panel goes back to', async () => {
  const r = await rig();
  r.turn(() => r.h.b!.setSlots(2, 'person'));
  press(r, 'a');
  assert.deepEqual(widths(r, 'b'), [1, 2]);
  const saved = projectWorkspaceState(r.provided().entries, r.ws.rootId);
  assert.deepEqual(saved.panels.map((p) => p.slots), [undefined, 2, undefined], 'b is saved two wide while it rests at one');
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
