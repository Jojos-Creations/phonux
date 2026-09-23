/**
 * shared/phone/directionalTransition.ts, proven directly (pure function, no
 * DOM needed) -- ux-history-column-card-transitions. Two things this file
 * pins:
 *
 *  - the shared preset itself: SLOT_TRANSITION's exact value, and
 *    directionalTransition's initial/animate/exit formulas for both axes;
 *  - a POSITIVE CONTROL that the LivePanelSlot refactor which consumes it
 *    (panelSlotMotion, exported from client/src/desktop/panels/LivePanelSlot.tsx)
 *    produces EXACTLY the pre-refactor numbers, for both exit directions,
 *    against literal values hand-computed from the ORIGINAL (pre-refactor)
 *    formulas in that file's git history:
 *      initial: { x: (index + 1) * slot, opacity: 0 }
 *      animate: { x: index * slot, opacity: 1 }
 *      exit (down): { x: index * slot, y: phoneHeight, opacity: 0, transition: { duration: DRAG_CLOSE.exitSeconds, ease: 'easeIn' } }
 *      exit (left): { x: -slot, opacity: 0 }
 *      transition: PANEL_TRANSITION === { duration: 0.4, ease: [0.2, 0, 0, 1] }
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SLOT_TRANSITION, directionalTransition } from '../client/src/shared/phone/directionalTransition.js';
import { GAP, PANEL_TRANSITION, panelSlotMotion } from '../client/src/desktop/panels/LivePanelSlot.js';
import { DRAG_CLOSE } from '../client/src/shared/phone/dragToClose.js';

test('SLOT_TRANSITION is the tuned duration/easing (0.4s, the [0.2,0,0,1] cubic-bezier), and PANEL_TRANSITION is the SAME object, not a copy', () => {
  assert.deepEqual(SLOT_TRANSITION, { duration: 0.4, ease: [0.2, 0, 0, 1] });
  assert.equal(PANEL_TRANSITION, SLOT_TRANSITION, 'row/useRowShell.ts and its test key off reference equality with LivePanelSlot.tsx\'s own PANEL_TRANSITION export');
});

test('directionalTransition: x axis, rest 0, distance 100 -- enters from the right, exits to the left, both faded, sharing the one transition', () => {
  const t = directionalTransition('x', 0, 100);
  assert.deepEqual(t.initial, { x: 100, opacity: 0 });
  assert.deepEqual(t.animate, { x: 0, opacity: 1 });
  assert.deepEqual(t.exit, { x: -100, opacity: 0 });
  assert.equal(t.transition, SLOT_TRANSITION);
});

test('directionalTransition: y axis, rest 0, distance 24 (History\'s own call) -- enters from below, exits upward', () => {
  const t = directionalTransition('y', 0, 24);
  assert.deepEqual(t.initial, { y: 24, opacity: 0 });
  assert.deepEqual(t.animate, { y: 0, opacity: 1 });
  assert.deepEqual(t.exit, { y: -24, opacity: 0 });
});

test('directionalTransition: a nonzero rest offsets every value by the same amount (LivePanelSlot\'s own case: rest = index * slot)', () => {
  const t = directionalTransition('x', 300, 116); // index 2, slot 116 (phoneWidth 100 + GAP 16)
  assert.deepEqual(t.initial, { x: 416, opacity: 0 });
  assert.deepEqual(t.animate, { x: 300, opacity: 1 });
  assert.deepEqual(t.exit, { x: 184, opacity: 0 }, 'the symmetric default -- LivePanelSlot does NOT use this value for its own exit, see below');
});

test('directionalTransition: a negative distance enters/exits from the opposite side', () => {
  const t = directionalTransition('x', 0, -50);
  assert.deepEqual(t.initial, { x: -50, opacity: 0 });
  assert.deepEqual(t.exit, { x: 50, opacity: 0 });
});

// ---------------------------------------------------------------------------
// positive control: panelSlotMotion matches the pre-refactor LivePanelSlot numbers exactly
// ---------------------------------------------------------------------------

const PHONE_WIDTH = 320;
const PHONE_HEIGHT = 640;
const SLOT = PHONE_WIDTH + GAP; // 336

test('panelSlotMotion: initial/animate are EXACTLY the pre-refactor formulas, for several indices, both exit directions', () => {
  for (const index of [0, 1, 2]) {
    for (const exitDirection of ['down', 'left'] as const) {
      const m = panelSlotMotion(index, PHONE_WIDTH, PHONE_HEIGHT, exitDirection);
      assert.deepEqual(m.initial, { x: (index + 1) * SLOT, opacity: 0 }, `initial, index ${index}, ${exitDirection}`);
      assert.deepEqual(m.animate, { x: index * SLOT, opacity: 1 }, `animate, index ${index}, ${exitDirection}`);
      assert.equal(m.transition, PANEL_TRANSITION, `transition, index ${index}, ${exitDirection}`);
    }
  }
});

test('panelSlotMotion: exit "down" is EXACTLY the pre-refactor formula (x stays at rest, y goes to phoneHeight, DRAG_CLOSE.exitSeconds timing)', () => {
  for (const index of [0, 1, 2]) {
    const m = panelSlotMotion(index, PHONE_WIDTH, PHONE_HEIGHT, 'down');
    assert.deepEqual(m.exit, { x: index * SLOT, y: PHONE_HEIGHT, opacity: 0, transition: { duration: DRAG_CLOSE.exitSeconds, ease: 'easeIn' } }, `index ${index}`);
  }
});

test('panelSlotMotion: exit "left" is EXACTLY the pre-refactor formula (-slot, independent of index -- NOT directionalTransition\'s symmetric default)', () => {
  for (const index of [0, 1, 2]) {
    const m = panelSlotMotion(index, PHONE_WIDTH, PHONE_HEIGHT, 'left');
    assert.deepEqual(m.exit, { x: -SLOT, opacity: 0 }, `index ${index}`);
  }
});
