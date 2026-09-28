/**
 * shared/phone/directionalTransition.ts, proven directly (pure function, no DOM needed): the shared
 * preset's exact value and formulas, plus a POSITIVE CONTROL that panelRowSlotMotion produces exactly
 * those numbers for a uniform row (`leftOffset = index * slot`, `width = PHONE_WIDTH`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SLOT_TRANSITION, directionalTransition } from 'phonux/internal/directionalTransition';
import { panelRowSlotMotion } from '../client/src/shared/phone/PanelRowSlot.js';
import { anchorTargetOf, resolveEnterDirection } from '../client/src/shared/phone/panelRowOrder.js';
import { createHistoryPanel, HISTORY_PANEL_ID } from '../client/src/desktop/panels/panelWindow.js';
import { DRAG_CLOSE, GAP, PANEL_TRANSITION } from 'phonux';

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

test('directionalTransition: a nonzero rest offsets every value by the same amount (PanelRowSlot\'s own case: rest = index * slot)', () => {
  const t = directionalTransition('x', 300, 116); // index 2, slot 116 (phoneWidth 100 + GAP 16)
  assert.deepEqual(t.initial, { x: 416, opacity: 0 });
  assert.deepEqual(t.animate, { x: 300, opacity: 1 });
  assert.deepEqual(t.exit, { x: 184, opacity: 0 }, 'the symmetric default -- PanelRowSlot does NOT use this value for its own exit, see below');
});

test('directionalTransition: a negative distance enters/exits from the opposite side', () => {
  const t = directionalTransition('x', 0, -50);
  assert.deepEqual(t.initial, { x: -50, opacity: 0 });
  assert.deepEqual(t.exit, { x: 50, opacity: 0 });
});

// ---------------------------------------------------------------------------
// positive control: panelRowSlotMotion matches these exact numbers
// ---------------------------------------------------------------------------

const PHONE_WIDTH = 320;
const PHONE_HEIGHT = 640;
const SLOT = PHONE_WIDTH + GAP; // 336

test('panelRowSlotMotion: with enterDirection "right" (the pre-refactor, still-default case), initial/animate are EXACTLY the pre-refactor formulas, for several indices, both exit directions', () => {
  for (const index of [0, 1, 2]) {
    for (const exitDirection of ['down', 'left'] as const) {
      const m = panelRowSlotMotion(index * SLOT, PHONE_WIDTH, PHONE_HEIGHT, 'right', exitDirection);
      assert.deepEqual(m.initial, { x: (index + 1) * SLOT, opacity: 0 }, `initial, index ${index}, ${exitDirection}`);
      assert.deepEqual(m.animate, { x: index * SLOT, opacity: 1 }, `animate, index ${index}, ${exitDirection}`);
      assert.equal(m.transition, PANEL_TRANSITION, `transition, index ${index}, ${exitDirection}`);
    }
  }
});

test('panelRowSlotMotion: exit "down" is EXACTLY the pre-refactor formula (x stays at rest, y goes to phoneHeight, DRAG_CLOSE.exitSeconds timing), for either enter direction', () => {
  for (const index of [0, 1, 2]) {
    for (const enterDirection of ['left', 'right'] as const) {
      const m = panelRowSlotMotion(index * SLOT, PHONE_WIDTH, PHONE_HEIGHT, enterDirection, 'down');
      assert.deepEqual(m.exit, { x: index * SLOT, y: PHONE_HEIGHT, opacity: 0, transition: { duration: DRAG_CLOSE.exitSeconds, ease: 'easeIn' } }, `index ${index}, enter ${enterDirection}`);
    }
  }
});

test('panelRowSlotMotion: exit "right" is `rest + slot` (relative to rest, unlike the absolute -slot "left" target), for either enter direction -- the far-side park', () => {
  for (const index of [0, 1, 2]) {
    for (const enterDirection of ['left', 'right'] as const) {
      const m = panelRowSlotMotion(index * SLOT, PHONE_WIDTH, PHONE_HEIGHT, enterDirection, 'right');
      assert.deepEqual(m.exit, { x: index * SLOT + SLOT, opacity: 0 }, `index ${index}, enter ${enterDirection}`);
    }
  }
});

test('panelRowSlotMotion: exit "left" is EXACTLY the pre-refactor formula (-slot, independent of index -- NOT directionalTransition\'s symmetric default), for either enter direction', () => {
  for (const index of [0, 1, 2]) {
    for (const enterDirection of ['left', 'right'] as const) {
      const m = panelRowSlotMotion(index * SLOT, PHONE_WIDTH, PHONE_HEIGHT, enterDirection, 'left');
      assert.deepEqual(m.exit, { x: -SLOT, opacity: 0 }, `index ${index}, enter ${enterDirection}`);
    }
  }
});

// ---------------------------------------------------------------------------
// enterDirection 'left': a panel starts one slot LEFT of its rest (mirroring the -slot exit target above);
// red if enterDirection is ignored and every panel enters from the right.
// ---------------------------------------------------------------------------

test('panelRowSlotMotion: enterDirection "left" enters from -slot relative to rest (index * slot - slot), for several indices, both exit directions', () => {
  for (const index of [0, 1, 2]) {
    for (const exitDirection of ['down', 'left'] as const) {
      const m = panelRowSlotMotion(index * SLOT, PHONE_WIDTH, PHONE_HEIGHT, 'left', exitDirection);
      assert.deepEqual(m.initial, { x: (index - 1) * SLOT, opacity: 0 }, `initial, index ${index}, ${exitDirection}`);
      assert.deepEqual(m.animate, { x: index * SLOT, opacity: 1 }, `animate (rest is unaffected by enter direction), index ${index}, ${exitDirection}`);
    }
  }
});

test('panelRowSlotMotion: enterDirection flips ONLY initial\'s sign relative to rest -- animate and exit are identical to the "right" case (isolating the one thing this parameter controls)', () => {
  for (const index of [0, 1, 2]) {
    const right = panelRowSlotMotion(index * SLOT, PHONE_WIDTH, PHONE_HEIGHT, 'right', 'down');
    const left = panelRowSlotMotion(index * SLOT, PHONE_WIDTH, PHONE_HEIGHT, 'left', 'down');
    assert.deepEqual(right.animate, left.animate, `index ${index}`);
    assert.deepEqual(right.exit, left.exit, `index ${index}`);
    assert.notDeepEqual(right.initial, left.initial, `index ${index}: the two enter directions must actually differ`);
  }
});

// ---------------------------------------------------------------------------
// panelRowOrder.ts: each panel's own anchor target, and resolveEnterDirection's formula
// (anchorIndex < ownIndex ? 'left' : 'right') over arbitrary row-slot indices.
// ---------------------------------------------------------------------------

test('anchorTargetOf: a panel with no anchor (History itself, or a record built without one) targets HISTORY_PANEL_ID; an explicit anchor targets its own panel -- red if the default is not History or a per-panel target is ignored', () => {
  assert.equal(anchorTargetOf(createHistoryPanel(), HISTORY_PANEL_ID), HISTORY_PANEL_ID, 'History carries no anchor and resolves against itself');
  assert.equal(anchorTargetOf({}, HISTORY_PANEL_ID), HISTORY_PANEL_ID, 'no anchor: the default target');
  assert.equal(anchorTargetOf({ anchor: { panel: HISTORY_PANEL_ID, position: 'left', priority: 0 } }, HISTORY_PANEL_ID), HISTORY_PANEL_ID);
  assert.equal(anchorTargetOf({ anchor: { panel: 'b', position: 'left', priority: 0 } }, HISTORY_PANEL_ID), 'b', 'an anchor naming another panel targets that panel, not History');
  // The default is whatever root the caller passes, so phonux holds no app id of its own.
  assert.equal(anchorTargetOf({}, 'some-other-root'), 'some-other-root', 'no anchor: the root passed in, not a built-in id');
});

test('resolveEnterDirection: the anchor sitting BEFORE the panel (a lower row-slot index) resolves LEFT -- a panel right of its anchor', () => {
  assert.equal(resolveEnterDirection(0, 1), 'left', 'anchor at slot 0 (e.g. History alone), panel at slot 1 (the first live panel)');
  assert.equal(resolveEnterDirection(1, 3), 'left', 'anchor at slot 1 (History, with Settings at slot 0), panel at slot 3 (a later live panel)');
});

test('resolveEnterDirection: the anchor sitting AT OR AFTER the panel (equal or higher row-slot index) resolves RIGHT -- a fixed column comparing against itself, or a panel to the anchor\'s own left', () => {
  assert.equal(resolveEnterDirection(0, 0), 'right', 'History compared against itself (FixedColumns.tsx\'s own call, anchorIndex === ownIndex): equal is not less-than');
  assert.equal(resolveEnterDirection(1, 0), 'right', "a hypothetical panel at slot 0 with the anchor at slot 1 (Settings' own position relative to History, before Settings left fixedColumns)");
  assert.equal(resolveEnterDirection(5, 2), 'right', 'a higher anchor index than the panel\'s own, however far apart');
});

test('resolveEnterDirection: -1 (the anchor, or the panel itself, not found in the row it was asked about) falls back to \'right\' rather than guessing', () => {
  assert.equal(resolveEnterDirection(-1, 0), 'right', 'anchor missing from the row entirely');
  assert.equal(resolveEnterDirection(0, -1), 'right', 'the panel itself missing from the row it was asked about');
  assert.equal(resolveEnterDirection(-1, -1), 'right', 'both missing');
});
