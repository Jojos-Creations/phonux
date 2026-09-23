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
import { ANCHOR_PANEL_ID, resolveEnterDirection } from '../client/src/desktop/panels/anchorPanel.js';
import { HISTORY_PANEL_ID } from '../client/src/desktop/panels/useFixedPanels.js';
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

test('panelSlotMotion: with enterDirection "right" (the pre-refactor, still-default case), initial/animate are EXACTLY the pre-refactor formulas, for several indices, both exit directions', () => {
  for (const index of [0, 1, 2]) {
    for (const exitDirection of ['down', 'left'] as const) {
      const m = panelSlotMotion(index, PHONE_WIDTH, PHONE_HEIGHT, 'right', exitDirection);
      assert.deepEqual(m.initial, { x: (index + 1) * SLOT, opacity: 0 }, `initial, index ${index}, ${exitDirection}`);
      assert.deepEqual(m.animate, { x: index * SLOT, opacity: 1 }, `animate, index ${index}, ${exitDirection}`);
      assert.equal(m.transition, PANEL_TRANSITION, `transition, index ${index}, ${exitDirection}`);
    }
  }
});

test('panelSlotMotion: exit "down" is EXACTLY the pre-refactor formula (x stays at rest, y goes to phoneHeight, DRAG_CLOSE.exitSeconds timing), for either enter direction', () => {
  for (const index of [0, 1, 2]) {
    for (const enterDirection of ['left', 'right'] as const) {
      const m = panelSlotMotion(index, PHONE_WIDTH, PHONE_HEIGHT, enterDirection, 'down');
      assert.deepEqual(m.exit, { x: index * SLOT, y: PHONE_HEIGHT, opacity: 0, transition: { duration: DRAG_CLOSE.exitSeconds, ease: 'easeIn' } }, `index ${index}, enter ${enterDirection}`);
    }
  }
});

test('panelSlotMotion: exit "left" is EXACTLY the pre-refactor formula (-slot, independent of index -- NOT directionalTransition\'s symmetric default), for either enter direction', () => {
  for (const index of [0, 1, 2]) {
    for (const enterDirection of ['left', 'right'] as const) {
      const m = panelSlotMotion(index, PHONE_WIDTH, PHONE_HEIGHT, enterDirection, 'left');
      assert.deepEqual(m.exit, { x: -SLOT, opacity: 0 }, `index ${index}, enter ${enterDirection}`);
    }
  }
});

// ---------------------------------------------------------------------------
// ux-reveal-direction-and-fixed-column-animation: enterDirection 'left' -- a NEGATIVE distance, i.e. a
// panel starting to the LEFT of its rest position, mirroring the -slot exit target directly above, red on
// break against a mutant that leaves enterDirection unconsumed (always entering from the right regardless
// of the argument).
// ---------------------------------------------------------------------------

test('panelSlotMotion: enterDirection "left" enters from -slot relative to rest (index * slot - slot), for several indices, both exit directions', () => {
  for (const index of [0, 1, 2]) {
    for (const exitDirection of ['down', 'left'] as const) {
      const m = panelSlotMotion(index, PHONE_WIDTH, PHONE_HEIGHT, 'left', exitDirection);
      assert.deepEqual(m.initial, { x: (index - 1) * SLOT, opacity: 0 }, `initial, index ${index}, ${exitDirection}`);
      assert.deepEqual(m.animate, { x: index * SLOT, opacity: 1 }, `animate (rest is unaffected by enter direction), index ${index}, ${exitDirection}`);
    }
  }
});

test('panelSlotMotion: enterDirection flips ONLY initial\'s sign relative to rest -- animate and exit are identical to the "right" case (isolating the one thing this parameter controls)', () => {
  for (const index of [0, 1, 2]) {
    const right = panelSlotMotion(index, PHONE_WIDTH, PHONE_HEIGHT, 'right', 'down');
    const left = panelSlotMotion(index, PHONE_WIDTH, PHONE_HEIGHT, 'left', 'down');
    assert.deepEqual(right.animate, left.animate, `index ${index}`);
    assert.deepEqual(right.exit, left.exit, `index ${index}`);
    assert.notDeepEqual(right.initial, left.initial, `index ${index}: the two enter directions must actually differ`);
  }
});

// ---------------------------------------------------------------------------
// ux-reveal-direction-and-fixed-column-animation: anchorPanel.ts's resolveEnterDirection, the "computed,
// not hardcoded" formula the plan record specifies verbatim (anchorIndex < ownIndex ? 'left' : 'right').
// Proven generically over arbitrary row-slot indices, not just the ONE degenerate case (History comparing
// against itself) production currently calls it with -- this is what makes the "computed, not hardcoded"
// property real rather than merely asserted in prose.
// ---------------------------------------------------------------------------

test('resolveEnterDirection: ANCHOR_PANEL_ID really is HISTORY_PANEL_ID today (the owner\'s own default)', () => {
  assert.equal(ANCHOR_PANEL_ID, HISTORY_PANEL_ID);
});

test('resolveEnterDirection: the anchor sitting BEFORE the panel (a lower row-slot index) resolves LEFT -- the live-panel reveal/undo case (History is always to a live panel\'s left)', () => {
  assert.equal(resolveEnterDirection(0, 1), 'left', 'anchor at slot 0 (e.g. History alone), panel at slot 1 (the first live panel)');
  assert.equal(resolveEnterDirection(1, 3), 'left', 'anchor at slot 1 (History, with Settings at slot 0), panel at slot 3 (a later live panel)');
});

test('resolveEnterDirection: the anchor sitting AT OR AFTER the panel (equal or higher row-slot index) resolves RIGHT -- a fixed column comparing against itself, or a hypothetical panel to the anchor\'s own left', () => {
  assert.equal(resolveEnterDirection(0, 0), 'right', 'History compared against itself (FixedColumns.tsx\'s own call, anchorIndex === ownIndex): equal is not less-than');
  assert.equal(resolveEnterDirection(1, 0), 'right', "a hypothetical panel at slot 0 with the anchor at slot 1 (Settings' own position relative to History, before Settings left fixedColumns)");
  assert.equal(resolveEnterDirection(5, 2), 'right', 'a higher anchor index than the panel\'s own, however far apart');
});

test('resolveEnterDirection: -1 (the anchor, or the panel itself, not found in the row it was asked about) falls back to \'right\' rather than guessing', () => {
  assert.equal(resolveEnterDirection(-1, 0), 'right', 'anchor missing from the row entirely');
  assert.equal(resolveEnterDirection(0, -1), 'right', 'the panel itself missing from the row it was asked about');
  assert.equal(resolveEnterDirection(-1, -1), 'right', 'both missing');
});
