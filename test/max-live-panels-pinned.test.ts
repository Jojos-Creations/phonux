/**
 * `tuning.maxLivePanels` beside pinned panels. Pinned is where a panel sits (left of History under the default rule), so
 * the cap counts only the panels right of it, never parks a pinned one, and follows a panel across History when the
 * person pins or unpins it by button or by drag. One test per path that reads the cap: the park at a commit, an open,
 * a show, an undo, an until-room hold and a layout reset.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag } from './support/drag-gesture.js';
import { capRig } from './support/cap-rig.js';
import type { CapRig } from './support/cap-rig.js';

afterEach(() => cleanup());

const grip = (r: CapRig, name: string): HTMLElement => {
  const found = r.m.container.querySelector<HTMLElement>(`[data-grab="${name}"]`);
  assert.ok(found, `${name} draws a drag handle`);
  return found;
};

// ---------------------------------------------------------------------------
// The count
// ---------------------------------------------------------------------------

test('pinned: two pinned panels are live beside N unpinned ones, and the leftmost unpinned one parks although the pinned sit further left', async () => {
  const r = await capRig({ count: 8, cap: 5, pinned: ['w1', 'w2'] });
  assert.equal(r.row(), 'w1 w2 root w3* w4 w5 w6 w7 w8');
  assert.deepEqual(r.pinnedLive(), ['w1', 'w2']);
  assert.equal(r.unpinnedLive().length, 5);
});

test('pinned: the tie-break between unpinned panels leaves the pinned ones alone whichever end it parks from', async () => {
  const r = await capRig({ count: 8, cap: 5, pinned: ['w1', 'w2'], tuning: { dropTieBreak: 'rightmost' } });
  assert.equal(r.row(), 'w1 w2 root w3 w4 w5 w6 w7 w8*');
});

test('pinned: a wide pinned panel is not parked in place of an unpinned one', async () => {
  const r = await capRig({ count: 8, cap: 5, width: 2500, pinned: ['w1'], own: { w1: { formFactor: 'desktop' } } });
  assert.equal(r.row(), 'w1 root w2* w3* w4 w5 w6 w7 w8', 'two unpinned panels park, exactly as many as exceed N');
});

test('pinned: a pinned panel stays draggable, placeable and parkable', async () => {
  const r = await capRig({ count: 6, cap: 5, pinned: ['w1'] });
  const { settings } = r.ws.panels.get('w1')!.getState();
  assert.deepEqual([settings.draggable, settings.placeable, settings.parkable], [true, true, true]);
});

// ---------------------------------------------------------------------------
// Opening, showing and undoing with a pinned panel present
// ---------------------------------------------------------------------------

test('pinned: opening a panel parks the leftmost live unpinned panel, never a pinned one', async () => {
  const r = await capRig({ count: 9, initial: 8, cap: 5, pinned: ['w1', 'w2'] });
  assert.equal(r.row(), 'w1 w2 root w3* w4 w5 w6 w7 w8');
  r.add('w9');
  await r.settle();
  assert.equal(r.row(), 'w1 w2 root w3* w4* w5 w6 w7 w8 w9');
});

test('pinned: opening a panel that lands pinned parks nothing, since it takes no slot', async () => {
  const r = await capRig({ count: 9, initial: 8, cap: 5, own: { w9: { placeOnAdd: 'row-start' } } });
  assert.equal(r.row(), 'root w1* w2* w3* w4 w5 w6 w7 w8');
  r.add('w9');
  await r.settle();
  assert.equal(r.row(), 'w9 root w1* w2* w3* w4 w5 w6 w7 w8');
});

test('pinned: showing a hidden panel parks exactly one unpinned panel, the farthest from it, and no pinned one', async () => {
  const r = await capRig({ count: 9, cap: 5, pinned: ['w1', 'w2'] });
  assert.equal(r.row(), 'w1 w2 root w3* w4* w5 w6 w7 w8 w9');
  const result = r.turn(() => r.h.w3!.show());
  assert.equal(result.ok, true);
  await r.settle();
  assert.equal(r.row(), 'w1 w2 root w3 w4* w5 w6 w7 w8 w9*', 'the farthest from w3 is w9; w1 and w2 sit further from it and are kept');
});

test('pinned: a History click on a hidden panel parks exactly one unpinned panel and no pinned one', async () => {
  const r = await capRig({ count: 9, cap: 5, pinned: ['w1', 'w2'] });
  r.turn(() => r.m.latest().activate(r.entry('w4').id));
  await r.settle();
  assert.equal(r.row(), 'w1 w2 root w3* w4 w5 w6 w7 w8 w9*');
});

test('pinned: showing a hidden panel at the far right parks the farthest unpinned panel, although a pinned one lies further from it', async () => {
  const r = await capRig({ count: 9, cap: 5, pinned: ['w1', 'w2'], tuning: { dropTieBreak: 'rightmost' } });
  assert.equal(r.row(), 'w1 w2 root w3 w4 w5 w6 w7 w8* w9*');
  const result = r.turn(() => r.h.w9!.show());
  assert.equal(result.ok, true);
  await r.settle();
  assert.equal(r.row(), 'w1 w2 root w3* w4 w5 w6 w7 w8* w9', 'w1 is nine places from w9 and w3 six, and w1 is not parked');
});

test('pinned: a History click on a hidden panel at the far right parks the farthest unpinned panel, not a pinned one further away', async () => {
  const r = await capRig({ count: 9, cap: 5, pinned: ['w1', 'w2'], tuning: { dropTieBreak: 'rightmost' } });
  r.turn(() => r.m.latest().activate(r.entry('w9').id));
  await r.settle();
  assert.equal(r.row(), 'w1 w2 root w3* w4 w5 w6 w7 w8* w9');
});

test('pinned: undoing the close of a live panel restores it and parks exactly one other unpinned panel', async () => {
  const r = await capRig({ count: 9, initial: 8, cap: 5, pinned: ['w1', 'w2'] });
  assert.equal(r.row(), 'w1 w2 root w3* w4 w5 w6 w7 w8');
  r.turn(() => r.h.w8!.close());
  await r.settle();
  assert.equal(r.row(), 'w1 w2 root w3* w4 w5 w6 w7', 'four unpinned are live');
  r.add('w9');
  await r.settle();
  assert.equal(r.row(), 'w1 w2 root w3* w4 w5 w6 w7 w9', 'the open fills the freed slot');
  r.turn(() => r.m.latest().undoClose());
  await r.settle();
  assert.equal(r.row(), 'w1 w2 root w3* w4* w5 w6 w7 w8 w9', 'w8 returns to its place, and the farthest unpinned panel from it parks');
});

// ---------------------------------------------------------------------------
// Pinning and unpinning
// ---------------------------------------------------------------------------

test('pinned: pinning a live panel parks nothing, and under capacityReturn manual returns nothing', async () => {
  const r = await capRig({ count: 8, cap: 5 });
  assert.equal(r.row(), 'root w1* w2* w3* w4 w5 w6 w7 w8');
  const result = r.turn(() => r.h.w5!.pin());
  assert.equal(result.ok, true);
  await r.settle();
  assert.equal(r.row(), 'w5 root w1* w2* w3* w4 w6 w7 w8', 'four unpinned are live now, the three hidden stay hidden');
});

test('pinned: pinning a live panel under capacityReturn auto lets the most recently parked panel into the slot it frees', async () => {
  const r = await capRig({ count: 8, cap: 5, returns: 'auto' });
  r.turn(() => r.h.w5!.pin());
  await r.settle();
  assert.equal(r.row(), 'w5 root w1* w2* w3 w4 w6 w7 w8');
});

test('pinned: unpinning a pinned panel with N unpinned live parks exactly one other and never the panel just unpinned', async () => {
  const r = await capRig({ count: 9, cap: 5, pinned: ['w1', 'w2'], own: { w1: { pinning: { pinned: { placement: 'row-start' }, unpinned: { placement: 'after-fixed' } } } } });
  assert.equal(r.row(), 'w1 w2 root w3* w4* w5 w6 w7 w8 w9');
  const result = r.turn(() => r.h.w1!.unpin());
  assert.equal(result.ok, true);
  await r.settle();
  assert.equal(r.row(), 'w2 root w1 w3* w4* w5* w6 w7 w8 w9', 'it lands where the leftmost unpinned panel is, and the next one parks instead');
});

test('pinned: unpinning to the end of the row parks the leftmost unpinned panel', async () => {
  const r = await capRig({ count: 9, cap: 5, pinned: ['w1', 'w2'] });
  r.turn(() => r.h.w1!.unpin());
  await r.settle();
  assert.equal(r.row(), 'w2 root w3* w4* w5* w6 w7 w8 w9 w1');
});

// ---------------------------------------------------------------------------
// Dragging across History
// ---------------------------------------------------------------------------

test('drag: dropping an unpinned panel left of History pins it: the unpinned live count drops by one and nothing unparks', async () => {
  const r = await capRig({ count: 8, cap: 5, width: 3000, grab: true });
  await advanceFrames(2000);
  assert.equal(r.row(), 'root w1* w2* w3* w4 w5 w6 w7 w8');
  await drag(grip(r, 'w4'), { dx: -420, dy: 0, steps: 12, hold: 8 });
  await advanceFrames(3000);
  assert.equal(r.row(), 'w4 root w1* w2* w3* w5 w6 w7 w8');
  assert.deepEqual([r.pinnedLive(), r.unpinnedLive().length], [['w4'], 4]);
});

test('drag: dropping a pinned panel right of History parks exactly one other and never the panel just dropped', async () => {
  const r = await capRig({ count: 8, cap: 5, width: 3000, grab: true, pinned: ['w1'] });
  await advanceFrames(2000);
  assert.equal(r.row(), 'w1 root w2* w3* w4 w5 w6 w7 w8');
  await drag(grip(r, 'w1'), { dx: 450, dy: 0, steps: 12, hold: 8 });
  await advanceFrames(3000);
  assert.equal(r.row(), 'root w1 w2* w3* w4* w5 w6 w7 w8', 'w1 is the leftmost unpinned panel now, and w4 parks instead of it');
  assert.equal(r.unpinnedLive().length, 5);
});

test('drag: moving a panel one place with the move verb across History does the same as a drag', async () => {
  const r = await capRig({ count: 8, cap: 5, pinned: ['w1'] });
  r.turn(() => r.h.w1!.move('right', 'person'));
  await r.settle();
  assert.equal(r.row(), 'root w1 w2* w3* w4* w5 w6 w7 w8');
});

test('drag: placing a panel at the start of the unpinned panels parks another one, not the panel placed', async () => {
  const r = await capRig({ count: 8, cap: 5, pinned: ['w1'] });
  const result = r.turn(() => r.h.w1!.place('after-fixed', 'person'));
  assert.equal(result.ok, true);
  await r.settle();
  assert.equal(r.row(), 'root w1 w2* w3* w4* w5 w6 w7 w8');
});

// ---------------------------------------------------------------------------
// A pinned panel that is itself parked
// ---------------------------------------------------------------------------

test('parked pinned: it does not count, and under capacityReturn manual a free slot returns nothing', async () => {
  const r = await capRig({ count: 8, cap: 5 });
  r.turn(() => r.h.w1!.pin());
  await r.settle();
  assert.equal(r.row(), 'w1* root w2* w3* w4 w5 w6 w7 w8', 'pinned while parked, it stays parked');
  r.turn(() => r.h.w5!.close());
  await r.settle();
  assert.equal(r.row(), 'w1* root w2* w3* w4 w6 w7 w8', 'a slot is free and neither the pinned panel nor an unpinned one takes it');
  r.turn(() => r.h.w1!.show());
  await r.settle();
  assert.equal(r.row(), 'w1 root w2* w3* w4 w6 w7 w8', 'shown, it takes no slot: the unpinned panels are as many as before');
});

test('parked pinned: returning ahead of the unpinned panels, it still leaves the free slot to them', async () => {
  const r = await capRig({ count: 8, cap: 5, returns: 'auto', tuning: { returnTieBreak: 'earliest-first' } });
  r.turn(() => r.h.w1!.pin());
  await r.settle();
  assert.equal(r.row(), 'w1* root w2* w3* w4 w5 w6 w7 w8');
  r.turn(() => r.h.w5!.close());
  await r.settle();
  assert.equal(r.row(), 'w1 root w2 w3* w4 w6 w7 w8', 'w1 is tried first and takes no slot, so w2 returns into the one the close freed');
});

test('parked pinned: shown while N unpinned panels are live, it takes no slot and parks none of them', async () => {
  const r = await capRig({ count: 8, cap: 5 });
  r.turn(() => r.h.w1!.pin());
  await r.settle();
  assert.equal(r.row(), 'w1* root w2* w3* w4 w5 w6 w7 w8');
  const result = r.turn(() => r.h.w1!.show());
  assert.equal(result.ok, true);
  await r.settle();
  assert.equal(r.row(), 'w1 root w2* w3* w4 w5 w6 w7 w8');
});

test('parked pinned: under capacityReturn auto it comes back in the usual order and takes no slot', async () => {
  const r = await capRig({ count: 8, cap: 5, returns: 'auto' });
  r.turn(() => r.h.w1!.pin());
  await r.settle();
  assert.equal(r.row(), 'w1* root w2* w3* w4 w5 w6 w7 w8');
  const rows: string[] = [];
  for (const name of ['w5', 'w6', 'w7']) {
    r.turn(() => r.h[name]!.close());
    await r.settle();
    rows.push(r.row());
  }
  assert.deepEqual(rows, ['w1* root w2* w3 w4 w6 w7 w8', 'w1* root w2 w3 w4 w7 w8', 'w1 root w2 w3 w4 w8'], 'w3 and w2 were parked after w1 and come back first; w1 comes last and the count stays at four');
});

// ---------------------------------------------------------------------------
// Until-room holds and layout resets read the same N
// ---------------------------------------------------------------------------

test('until-room hold: the free slots it waits for are N less the unpinned panels, a pinned one not counted', async () => {
  const r = await capRig({ count: 6, cap: 5, pinned: ['w1'], settings: { hideStickiness: 'until-room' } });
  assert.equal(r.row(), 'w1 root w2 w3 w4 w5 w6');
  r.turn(() => r.h.w3!.hide());
  await r.settle();
  assert.equal(r.row(), 'w1 root w2 w3* w4 w5 w6', 'hidden with one slot free, which is the one its own hide left');
  r.turn(() => r.h.w4!.close());
  await r.settle();
  assert.equal(r.row(), 'w1 root w2 w3 w5 w6', 'a second slot is free, so the hold lets w3 back');
});

test('until-room hold: pinning a live panel opens a slot the hold counts, so the hidden panel comes back', async () => {
  const r = await capRig({ count: 6, cap: 5, pinned: ['w1'], settings: { hideStickiness: 'until-room' } });
  r.turn(() => r.h.w3!.hide());
  await r.settle();
  assert.equal(r.row(), 'w1 root w2 w3* w4 w5 w6');
  r.turn(() => r.h.w5!.pin('person'));
  await r.settle();
  assert.equal(r.row(), 'w5 w1 root w2 w3 w4 w6', 'w5 left the unpinned panels, which are four against a hold taken at four with one slot free');
});

test('layout reset: a pinned panel reset to the end of the row parks exactly one other, and one reset into the pinned start frees a slot', async () => {
  const r = await capRig({ count: 4, cap: 2, pinned: ['w1'], returns: 'auto' });
  assert.equal(r.row(), 'w1 root w2* w3 w4');
  r.turn(() => r.h.w1!.unpin('person'));
  await r.settle();
  assert.equal(r.row(), 'root w2* w3* w4 w1', 'three unpinned would exceed 2, and w3 parks');
  const reset = r.turn(() => r.ws.panels.resetLayout('w1'));
  assert.deepEqual({ ...reset }, { ok: true, changed: true, panels: ['w1'], parked: [], returned: ['w3'] }, 'back at the pinned start it frees a slot, which the most recently parked panel is planned to fill');
  await r.settle();
  assert.equal(r.row(), 'w1 root w2* w3 w4');
});

test('layout reset: a wide panel that a reset moves back to the pinned start is not parked in place of an unpinned one', async () => {
  const r = await capRig({ count: 9, cap: 5, width: 2500, pinned: ['w1'], own: { w1: { formFactor: 'desktop' } } });
  r.turn(() => r.h.w1!.move('right', 'person'));
  r.turn(() => r.h.w8!.pin('person'));
  r.turn(() => r.h.w9!.pin('person'));
  r.turn(() => r.h.w2!.show());
  r.turn(() => r.h.w3!.show());
  await r.settle();
  assert.equal(r.row(), 'w9 w8 root w1 w2 w3 w4* w5* w6 w7', 'five unpinned panels are live, w1 among them');
  const reset = r.turn(() => r.ws.panels.resetLayout('all'));
  assert.deepEqual(reset.ok && reset.parked, ['w2'], 'w8 and w9 are unpinned again and w1 is pinned, so one panel parks, and it is not w1');
  await r.settle();
  assert.equal(r.row(), 'w1 root w2* w3 w4* w5* w6 w7 w8 w9');
});

test('layout reset: a pinned panel reset to the end of the row lists the unpinned panel it parks', async () => {
  const r = await capRig({ count: 6, cap: 5 });
  r.turn(() => r.h.w3!.pin('person'));
  r.turn(() => r.h.w1!.show());
  await r.settle();
  assert.equal(r.row(), 'w3 root w1 w2 w4 w5 w6');
  const reset = r.turn(() => r.ws.panels.resetLayout('w3'));
  assert.deepEqual({ ...reset }, { ok: true, changed: true, panels: ['w3'], parked: ['w1'], returned: [] });
  await r.settle();
  assert.equal(r.row(), 'root w1* w2 w4 w5 w6 w3');
});
