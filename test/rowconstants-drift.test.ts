/**
 * The default numbers in rowConstants.ts equal the live constants they will replace, so the two sources cannot
 * drift apart while the row code still reads its own.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GAP } from '../PanelRowSlot.js';
import { DRAG_CLOSE } from '../dragToClose.js';
import { SLOT_TRANSITION } from '../directionalTransition.js';
import { WORKSPACE_SAVE_QUIET_MS } from '../panels/useWorkspacePersistence.js';
import * as rowConstants from '../rowConstants.js';
import { LIBRARY_TUNING_DEFAULTS } from '../panelSettings.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('rowConstants: ROW_GAP equals the live GAP, and both are the number 16', () => {
  assert.equal(rowConstants.ROW_GAP, GAP);
  assert.equal(GAP, 16);
});

test('rowConstants: the six drag-to-close numbers equal DRAG_CLOSE, key for key', () => {
  const live = { distanceFraction: DRAG_CLOSE.distanceFraction, minDistancePx: DRAG_CLOSE.minDistancePx, flickVelocity: DRAG_CLOSE.flickVelocity, flickMinDistancePx: DRAG_CLOSE.flickMinDistancePx, cancelVelocity: DRAG_CLOSE.cancelVelocity, exitSeconds: DRAG_CLOSE.exitSeconds };
  assert.deepEqual({ ...rowConstants.DRAG_CLOSE_NUMBERS }, live);
  assert.equal(Object.keys(rowConstants.DRAG_CLOSE_NUMBERS).length, 6);
});

test('rowConstants: the snap-back spring equals DRAG_CLOSE.snapBack, and the direction lock is the 8 px the drag code locks at', () => {
  assert.equal(rowConstants.SNAP_BACK_SPRING.stiffness, DRAG_CLOSE.snapBack.stiffness);
  assert.equal(rowConstants.SNAP_BACK_SPRING.damping, DRAG_CLOSE.snapBack.damping);
  assert.equal(rowConstants.DIRECTION_LOCK_PX, 8);
  const source = readFileSync(`${ROOT}dragToClose.tsx`, 'utf8');
  assert.match(source, /const DIRECTION_LOCK_PX = 8;/, 'the live constant is not exported, so its source line is held instead');
});

test('rowConstants: the slide numbers equal SLOT_TRANSITION, and its close exit equals the drag-to-close exit', () => {
  assert.equal(rowConstants.SLIDE_DURATION_SEC, SLOT_TRANSITION.duration);
  assert.deepEqual([...rowConstants.SLIDE_EASE], [...SLOT_TRANSITION.ease]);
  assert.equal(rowConstants.SLIDE_CLOSE_EXIT_SECONDS, DRAG_CLOSE.exitSeconds);
});

test('rowConstants: SAVE_QUIET_MS equals WORKSPACE_SAVE_QUIET_MS', () => {
  assert.equal(rowConstants.SAVE_QUIET_MS, WORKSPACE_SAVE_QUIET_MS);
});

test('rowConstants: the gesture lock is the literal 350 and the hop fraction is the literal 0.5', () => {
  assert.equal(rowConstants.GESTURE_LOCK_MS, 350);
  assert.equal(rowConstants.HOP_FRACTION, 0.5);
  const gesture = readFileSync(`${ROOT}panels/useRowScrollGesture.ts`, 'utf8');
  assert.match(gesture, /const GESTURE_LOCK_MS = 350;/, 'the live gesture lock is private, so its source line is held instead');
});

test('rowConstants: the remaining defaults are the strings and numbers the tuning defaults carry', () => {
  assert.equal(rowConstants.RETURN_TIE_BREAK, 'latest-first');
  assert.equal(rowConstants.DROP_TIE_BREAK, 'leftmost');
  assert.equal(rowConstants.ROW_GESTURE, 'step');
  assert.equal(rowConstants.INITIAL_SCROLL, 'start');
  assert.equal(rowConstants.EDGE_SCROLL_ZONE_PX, 48);
  assert.equal(rowConstants.EDGE_SCROLL_MAX_PX_PER_SEC, 900);
  assert.equal(rowConstants.EDGE_SCROLL_REDUCED_STEP_MS, 500);
});

test('rowConstants: every exported constant reaches LIBRARY_TUNING_DEFAULTS, so none is dead', () => {
  const t = LIBRARY_TUNING_DEFAULTS;
  assert.equal(t.rowGap, rowConstants.ROW_GAP);
  assert.equal(t.dragToClose.distanceFraction, rowConstants.DRAG_CLOSE_NUMBERS.distanceFraction);
  assert.equal(t.dragToClose.minDistancePx, rowConstants.DRAG_CLOSE_NUMBERS.minDistancePx);
  assert.equal(t.dragToClose.flickVelocity, rowConstants.DRAG_CLOSE_NUMBERS.flickVelocity);
  assert.equal(t.dragToClose.flickMinDistancePx, rowConstants.DRAG_CLOSE_NUMBERS.flickMinDistancePx);
  assert.equal(t.dragToClose.cancelVelocity, rowConstants.DRAG_CLOSE_NUMBERS.cancelVelocity);
  assert.equal(t.dragToClose.directionLockPx, rowConstants.DIRECTION_LOCK_PX);
  assert.deepEqual({ ...t.dragToClose.snapBack }, { ...rowConstants.SNAP_BACK_SPRING });
  assert.equal(t.slide.durationSec, rowConstants.SLIDE_DURATION_SEC);
  assert.deepEqual([...t.slide.ease], [...rowConstants.SLIDE_EASE]);
  assert.equal(t.slide.closeExitSeconds, rowConstants.SLIDE_CLOSE_EXIT_SECONDS);
  assert.equal(t.hopFraction, rowConstants.HOP_FRACTION);
  assert.equal(t.saveQuietMs, rowConstants.SAVE_QUIET_MS);
  assert.equal(t.gestureLockMs, rowConstants.GESTURE_LOCK_MS);
  assert.equal(t.returnTieBreak, rowConstants.RETURN_TIE_BREAK);
  assert.equal(t.dropTieBreak, rowConstants.DROP_TIE_BREAK);
  assert.equal(t.rowGesture, rowConstants.ROW_GESTURE);
  assert.equal(t.initialScroll, rowConstants.INITIAL_SCROLL);
  assert.deepEqual({ ...t.edgeScroll }, { zonePx: rowConstants.EDGE_SCROLL_ZONE_PX, maxPxPerSec: rowConstants.EDGE_SCROLL_MAX_PX_PER_SEC, reducedStepMs: rowConstants.EDGE_SCROLL_REDUCED_STEP_MS });
  assert.ok(Object.keys(rowConstants).length >= 19, 'the module exports its whole set');
});
