/**
 * The pure scroll targets, as literals: eleven phone panels (left = 16 + 406k), a 1000 px container, maxScroll 3482.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gestureTarget, scrollTargetFor, stepTarget } from '../scrollTargets.js';

const GAP = 16;
const eleven = (scrollLeft: number, k: number, align: 'into-view' | 'start' | 'center'): number =>
  scrollTargetFor({ left: GAP + 406 * k, width: 390, scrollLeft, clientWidth: 1000, maxScroll: 3482, gap: GAP, align });

test('scrollTargetFor: panel 8 from scrollLeft 0 gives 2670 into view, 3248 at the start and 2959 centred', () => {
  assert.equal(eleven(0, 8, 'into-view'), 2670);
  assert.equal(eleven(0, 8, 'start'), 3248);
  assert.equal(eleven(0, 8, 'center'), 2959);
});

test('scrollTargetFor: the start of panel 10 clamps to the strip end, 3482', () => {
  assert.equal(eleven(0, 10, 'start'), 3482);
});

test('scrollTargetFor: a panel already inside the window is left where it is, and one past the left edge comes back to it', () => {
  assert.equal(eleven(0, 1, 'into-view'), 0);
  assert.equal(eleven(1000, 0, 'into-view'), 0);
  assert.equal(eleven(1000, 2, 'into-view'), 812);
});

test('scrollTargetFor: into-view keeps one gap of padding on the right', () => {
  // Panel 2 ends at 1218; a window of 1000 from 0 shows up to 984, so it needs 1218 + 16 - 1000.
  assert.equal(eleven(0, 2, 'into-view'), 234);
});

test('scrollTargetFor: a panel wider than the window is aligned by its left edge', () => {
  assert.equal(scrollTargetFor({ left: 516, width: 2000, scrollLeft: 0, clientWidth: 1000, maxScroll: 4000, gap: GAP, align: 'into-view' }), 500);
});

const starts = Array.from({ length: 11 }, (_, k) => k * 406);

test('stepTarget over eleven panel starts', () => {
  assert.equal(stepTarget('right', 0, starts, 3482), 406);
  assert.equal(stepTarget('right', 406, starts, 3482), 812);
  assert.equal(stepTarget('right', 3248, starts, 3482), 3482, 'the last step clamps to the strip end');
  assert.equal(stepTarget('right', 3482, starts, 3482), null);
  assert.equal(stepTarget('left', 812, starts, 3482), 406);
  assert.equal(stepTarget('left', 0, starts, 3482), null);
  assert.equal(stepTarget('left', 3482, starts, 3482), 3248);
});

test('stepTarget takes the next start, not the nearest panel centre', () => {
  // Between starts 406 and 812 the center of panel 1 (601) is nearer than 812, and a nearest-center step would stay put.
  assert.equal(stepTarget('right', 600, starts, 3482), 812);
  assert.equal(stepTarget('left', 700, starts, 3482), 406);
});

const hidden = (over: Partial<{ id: string; liveBefore: number; held: boolean; policy: 'edges' | 'any' | 'never' }> = {}) => ({ id: 'h', liveBefore: 1, held: true, policy: 'edges' as const, ...over });
const strip = (n: number) => ({ liveStarts: Array.from({ length: n }, (_, k) => k * 406), liveWidths: Array.from({ length: n }, () => 390) });
const gesture = (direction: 'left' | 'right', base: number, n: number, list: ReturnType<typeof hidden>[]) =>
  gestureTarget({ direction, base, clientWidth: 1000, maxScroll: (n - 1) * 406 - 98, gap: GAP, hidden: list, ...strip(n) });

test('gestureTarget: with nothing hidden it steps, and at the end it does nothing', () => {
  assert.deepEqual(gesture('right', 0, 4, []), { kind: 'scroll', to: 406 });
  assert.deepEqual(gesture('right', 1120, 4, []), { kind: 'none' }, 'at the strip end (1120)');
});

test('gestureTarget: a held panel after the last panel in view comes back, and one behind live panels is stepped toward', () => {
  assert.deepEqual(gesture('right', 0, 4, [hidden({ liveBefore: 4 })]), { kind: 'scroll', to: 406 }, 'D lies beyond the window and before B');
  assert.deepEqual(gesture('right', 0, 4, [hidden({ liveBefore: 3 })]), { kind: 'show', id: 'h' }, 'B follows the last panel in view');
  const near = gestureTarget({ direction: 'right', base: 0, clientWidth: 500, maxScroll: 800, gap: GAP, liveStarts: [0, 406, 812], liveWidths: [390, 390, 390], hidden: [hidden({ liveBefore: 2 })] });
  assert.deepEqual(near, { kind: 'show', id: 'h' }, 'a held panel returns although a live panel lies beyond the window after it');
});

test('gestureTarget: an engine-parked panel under edges waits for the strip end, under any it is reached like a held one, under never it is skipped', () => {
  const base = { direction: 'right' as const, base: 0, clientWidth: 500, maxScroll: 800, gap: GAP, liveStarts: [0, 406, 812], liveWidths: [390, 390, 390] };
  const parked = (policy: 'edges' | 'any' | 'never') => gestureTarget({ ...base, hidden: [hidden({ liveBefore: 2, held: false, policy })] });
  assert.deepEqual(parked('edges'), { kind: 'scroll', to: 406 }, 'live panels lie beyond the window');
  assert.deepEqual(parked('any'), { kind: 'show', id: 'h' });
  assert.deepEqual(parked('never'), { kind: 'scroll', to: 406 });
  const atEnd = gestureTarget({ ...base, base: 800, hidden: [hidden({ liveBefore: 3, held: false })] });
  assert.deepEqual(atEnd, { kind: 'show', id: 'h' }, 'nothing is beyond the window, so the parked panel returns');
});

test('gestureTarget: a swipe toward a hidden panel past four live panels steps over them until none lies between the window and it', () => {
  const base = { direction: 'right' as const, clientWidth: 500, maxScroll: 1500, gap: GAP, liveStarts: [0, 406, 812, 1218], liveWidths: [390, 390, 390, 390], hidden: [hidden({ liveBefore: 4 })] };
  assert.deepEqual(gestureTarget({ ...base, base: 0 }), { kind: 'scroll', to: 406 });
  assert.deepEqual(gestureTarget({ ...base, base: 406 }), { kind: 'scroll', to: 812 });
  assert.deepEqual(gestureTarget({ ...base, base: 812 }), { kind: 'show', id: 'h' }, 'L4 is in view, so no live panel lies between the window and H');
});

test('gestureTarget: a wide panel the window edge cuts comes in before the parked panel past it', () => {
  const row = { direction: 'right' as const, base: 0, clientWidth: 1000, maxScroll: 800, liveStarts: [0, 344], liveWidths: [320, 1352], stops: [0, 344, 688, 800], gap: 24, hidden: [{ id: 'next', liveBefore: 2, held: false, policy: 'edges' as const }] };
  assert.deepEqual(gestureTarget({ ...row, phoneWidth: 320 }), { kind: 'scroll', to: 344 });
  assert.deepEqual(gestureTarget({ ...row, base: 800, phoneWidth: 320 }).kind, 'show');
});

test('gestureTarget: a root off the window is no panel a parked one waits behind, and any other live panel still is', () => {
  const row = { direction: 'left' as const, base: 344, clientWidth: 700, maxScroll: 344, liveStarts: [0, 344, 688], liveWidths: [320, 320, 320], stops: [0, 344], gap: 24, hidden: [{ id: 'prev', liveBefore: 1, held: false, policy: 'edges' as const }] };
  assert.equal(gestureTarget(row).kind, 'scroll');
  assert.deepEqual(gestureTarget({ ...row, rootAt: 0 }), { kind: 'show', id: 'prev' });
  assert.equal(gestureTarget({ ...row, rootAt: 2 }).kind, 'scroll');
});
