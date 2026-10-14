/**
 * rowConstants.ts is the only holder of the row's default numbers: the exported constants of the row files read from it,
 * and no row file writes a second copy.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
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

test('rowConstants: the snap-back spring equals DRAG_CLOSE.snapBack, and the direction lock is the number 8 that dragToClose.tsx imports', () => {
  assert.equal(rowConstants.SNAP_BACK_SPRING.stiffness, DRAG_CLOSE.snapBack.stiffness);
  assert.equal(rowConstants.SNAP_BACK_SPRING.damping, DRAG_CLOSE.snapBack.damping);
  assert.equal(rowConstants.DIRECTION_LOCK_PX, 8);
  const source = readFileSync(`${ROOT}dragToClose.tsx`, 'utf8');
  assert.match(source, /import \{[^}]*\bDIRECTION_LOCK_PX\b[^}]*\} from '\.\/rowConstants\.js';/, 'dragToClose.tsx reads the lock from rowConstants.ts');
  assert.doesNotMatch(source, /DIRECTION_LOCK_PX = /, 'and declares no copy of it');
});

test('rowConstants: the slide numbers equal SLOT_TRANSITION, and its close exit equals the drag-to-close exit', () => {
  assert.equal(rowConstants.SLIDE_DURATION_SEC, SLOT_TRANSITION.duration);
  assert.deepEqual([...rowConstants.SLIDE_EASE], [...SLOT_TRANSITION.ease]);
  assert.equal(rowConstants.SLIDE_CLOSE_EXIT_SECONDS, DRAG_CLOSE.exitSeconds);
});

test('rowConstants: SAVE_QUIET_MS equals WORKSPACE_SAVE_QUIET_MS, which stays exported as the one-line alias and equals the tuning default', () => {
  assert.equal(rowConstants.SAVE_QUIET_MS, WORKSPACE_SAVE_QUIET_MS);
  assert.equal(WORKSPACE_SAVE_QUIET_MS, LIBRARY_TUNING_DEFAULTS.saveQuietMs);
  assert.equal(WORKSPACE_SAVE_QUIET_MS, 500);
});

test('rowConstants: the gesture lock is the literal 60 and the hop fraction is the literal 0.5, and neither number has a second copy in the row code', () => {
  assert.equal(rowConstants.GESTURE_LOCK_MS, 60);
  assert.equal(rowConstants.HOP_FRACTION, 0.5);
  const gesture = readFileSync(`${ROOT}panels/useRowScrollGesture.ts`, 'utf8');
  const persistence = readFileSync(`${ROOT}panels/useWorkspacePersistence.ts`, 'utf8');
  assert.match(gesture, /import \{ GESTURE_LOCK_MS, GESTURE_QUIET_MS \} from '\.\.\/rowConstants\.js';/, 'the gesture imports the one constant it defaults to');
  assert.doesNotMatch(gesture, /GESTURE_LOCK_MS = /, 'no module constant of the gesture lock is left in the gesture file');
  assert.doesNotMatch(gesture, /\b60\b/, 'the number 60 is not written in the gesture file');
  assert.doesNotMatch(gesture, /\b150\b/, 'the number 150 is not written in the gesture file');
  assert.match(persistence, /import \{ SAVE_QUIET_MS \} from '\.\.\/rowConstants\.js';/, 'the persistence hook imports the one constant it defaults to');
  assert.doesNotMatch(persistence, /SAVE_QUIET_MS = 500/, 'no module constant of the save delay is left in the persistence file');
  assert.doesNotMatch(persistence, /\b500\b/, 'the number 500 is not written in the persistence file');
  assert.match(persistence, /export \{ SAVE_QUIET_MS as WORKSPACE_SAVE_QUIET_MS \};/, 'the old name stays exported by the one alias line');
  assert.doesNotMatch(persistence, /export const WORKSPACE_SAVE_QUIET_MS/, 'the old declaration is gone');
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
  assert.equal(t.gestureQuietMs, rowConstants.GESTURE_QUIET_MS);
  assert.equal(t.dragToClose.restMs, rowConstants.DRAG_REST_MS);
  assert.equal(t.dragToClose.velocityWindowMs, rowConstants.DRAG_VELOCITY_WINDOW_MS);
  assert.equal(t.slide.closeExitEase, rowConstants.CLOSE_EXIT_EASE);
  assert.equal(t.slide.glideEase, rowConstants.GLIDE_EASE);
  assert.deepEqual({ ...rowConstants.ROW_LAYER_Z }, { BASE: 1, RAISED: 2, DRAGGED: 3 });
  assert.equal(t.returnTieBreak, rowConstants.RETURN_TIE_BREAK);
  assert.equal(t.dropTieBreak, rowConstants.DROP_TIE_BREAK);
  assert.equal(t.rowGesture, rowConstants.ROW_GESTURE);
  assert.equal(t.initialScroll, rowConstants.INITIAL_SCROLL);
  assert.deepEqual({ ...t.edgeScroll }, { zonePx: rowConstants.EDGE_SCROLL_ZONE_PX, maxPxPerSec: rowConstants.EDGE_SCROLL_MAX_PX_PER_SEC, reducedStepMs: rowConstants.EDGE_SCROLL_REDUCED_STEP_MS });
  assert.deepEqual({ ...t.chrome }, { ...rowConstants.CHROME });
  assert.equal(t.shrinkOutOfView, rowConstants.SHRINK_OUT_OF_VIEW);
  assert.equal(t.phoneFit, rowConstants.PHONE_FIT);
  assert.equal(t.phoneFitMin, rowConstants.PHONE_FIT_MIN);
  assert.equal(t.phoneFitMax, rowConstants.PHONE_FIT_MAX);
  assert.equal(rowConstants.RESIZE_SETTLE_SLIDES, 1.25);
  assert.equal(rowConstants.ALL_SLOTS, 64);
  assert.equal(rowConstants.UNMEASURED_SLOTS, 3);
  assert.equal(Object.keys(rowConstants).length, 35, 'the module exports exactly the 27 constants this test compares, the 4 slot constants and the 4 slot helpers');
});

test('rowConstants: no source file outside rowConstants.ts declares its own copy of the save delay or the gesture lock', () => {
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'test', 'tools', 'dist', '.git', 'etc', 'plans', 'api-extractor-temp'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && entry.name !== 'rowConstants.ts' && /\b(GESTURE_LOCK_MS|SAVE_QUIET_MS) = \d/.test(readFileSync(path, 'utf8'))) offenders.push(path.slice(ROOT.length));
    }
  };
  walk(ROOT);
  assert.deepEqual(offenders, []);
});

test('rowConstants: the gesture and the persistence hook default to the constants, which are the tuning defaults', () => {
  assert.equal(LIBRARY_TUNING_DEFAULTS.gestureLockMs, rowConstants.GESTURE_LOCK_MS);
  assert.equal(LIBRARY_TUNING_DEFAULTS.saveQuietMs, rowConstants.SAVE_QUIET_MS);
});

const HELD_NUMBERS: ReadonlySet<number> = new Set([0.25, 80, 700, 520, 42, 0.18, 0.4, 16]);

/** The numeric literals of `text` (a negative one by its magnitude) that are in HELD_NUMBERS, comments never counted. */
function heldLiterals(text: string, name: string): number[] {
  const found: number[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNumericLiteral(node) && HELD_NUMBERS.has(Number(node.text))) found.push(Number(node.text));
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true));
  return found;
}

test('rowconstants: none of the held numbers is written outside a comment in PanelRowSlot.tsx, dragToClose.tsx or directionalTransition.ts', () => {
  assert.deepEqual(heldLiterals('const a = 16; const b = 0.4 + 80; // 700\n/* 520 */ const c = [42, 0.18, 0.25];', 'planted.ts'), [16, 0.4, 80, 42, 0.18, 0.25], 'control: a planted source is caught and its comments are not');
  for (const file of ['PanelRowSlot.tsx', 'dragToClose.tsx', 'directionalTransition.ts']) {
    assert.deepEqual(heldLiterals(readFileSync(`${ROOT}${file}`, 'utf8'), file), [], `${file} writes a number rowConstants.ts holds`);
  }
});

test('rowconstants: GAP is the one re-export line of ROW_GAP in PanelRowSlot.tsx and no file declares a gap number of its own', () => {
  const slot = readFileSync(`${ROOT}PanelRowSlot.tsx`, 'utf8');
  assert.equal(slot.split('\n').filter((line) => line === "export { ROW_GAP as GAP } from './rowConstants.js';").length, 1);
  assert.doesNotMatch(slot, /export const GAP/);
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'test', 'tools', 'dist', '.git', 'etc', 'plans', 'api-extractor-temp'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && entry.name !== 'rowConstants.ts' && /\b(ROW_GAP|GAP) = \d/.test(readFileSync(path, 'utf8'))) offenders.push(path.slice(ROOT.length));
    }
  };
  walk(ROOT);
  assert.deepEqual(offenders, []);
});
