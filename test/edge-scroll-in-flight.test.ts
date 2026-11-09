/**
 * A drag in flight keeps the three edge numbers it locked with; a configure made while the pointer is down
 * reaches the next drag. jsdom has no PointerEvent, so every pointer event is a MouseEvent of the
 * pointer type name carrying the pointer fields motion reads, and time is the virtual frame clock.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { rowOffsetOf } from './support/strip.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose, createWorkspace, definePanel, usePanelReorderSteps } from '../index.js';
import type { ConfigureResult, PanelHandle, PanelSettings } from '../index.js';
import { LIBRARY_TUNING_DEFAULTS } from '../panelSettings.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { FRAME_MS } from './support/jsdom-globals.js';
import { markerTemplate, mountWorkspace, type MountedWorkspace } from './support/workspace-row.js';

afterEach(async () => {
  // A test that left the pointer down must not leave motion's window listeners live for the next one.
  document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  await frames(5);
  cleanup();
});

const WINDOW = 1000;
const EDGE = LIBRARY_TUNING_DEFAULTS.edgeScroll;
/** Half a zone inside the right edge: depth 0.5, so 450 px/s, 7.2 px a frame and 72 px in ten frames. */
const POINTER = WINDOW - EDGE.zonePx / 2;
assert.equal(POINTER, 976);
const RECT = { left: 0, right: WINDOW, top: 0, bottom: 700, width: WINDOW, height: 700, x: 0, y: 0, toJSON: () => ({}) };

const ends: Array<{ id: string; offset: number; hops: number }> = [];
function EdgeBox({ id }: { id: string }): React.ReactElement {
  const steps = usePanelReorderSteps();
  return React.createElement(DragToClose, {
    reorder: { onDragEnd: (offset: number) => void ends.push({ id, offset, hops: steps(offset) }) },
    children: (handle) => React.createElement('div', { 'data-handle': id, onPointerDown: handle.onPointerDown }, 'grab'),
  });
}

interface Rig {
  m: MountedWorkspace;
  ws: ReturnType<typeof createWorkspace>;
  h: Record<string, PanelHandle>;
}

/** The root and ten panels s1 to s10 in a 1000 px window; `own` is the settings a panel's template declares. */
async function mountRig(own: Record<string, PanelSettings> = {}): Promise<Rig> {
  ends.length = 0;
  const templates = Array.from({ length: 10 }, (_, k) => {
    const id = `s${k + 1}`;
    return definePanel({ id, view: () => React.createElement(EdgeBox, { id }), ...(own[id] === undefined ? {} : { settings: own[id] }) });
  });
  const ws = createWorkspace({ mount: false, root: markerTemplate('root', { settings: { title: 'History' } }), templates, tuning: { rowGesture: 'step' } });
  const h: Record<string, PanelHandle> = {};
  for (const template of templates) h[template.id] = ws.addPanel(template);
  const m = mountWorkspace(ws, { width: WINDOW });
  Object.defineProperty(m.container, 'clientWidth', { value: WINDOW, configurable: true });
  m.container.getBoundingClientRect = () => RECT;
  await frames(60);
  return { m, ws, h };
}

function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y = 100): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
  for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true })) Object.defineProperty(event, key, { value });
  return event;
}
const press = (target: Element, x: number): Promise<void> => act(async () => void target.dispatchEvent(pointer('pointerdown', x)));
const moveTo = (x: number): Promise<void> => act(async () => void document.dispatchEvent(pointer('pointermove', x)));
const liftAt = (x: number): Promise<void> => act(async () => void document.dispatchEvent(pointer('pointerup', x)));
const frames = (n: number): Promise<void> => advanceFrames(n * FRAME_MS);
const handleOf = (r: Rig, id: string): Element => {
  const handle = r.m.container.querySelector(`[data-handle="${id}"]`);
  assert.ok(handle, `${id}'s grab bar rendered`);
  return handle;
};
/** A horizontal drag of `id` from 40 px left of `at` to `at`, and a frame for the axis lock to take. */
async function dragTo(r: Rig, at: number, id = 's1'): Promise<void> {
  await press(handleOf(r, id), at - 40);
  await moveTo(at);
  await frames(1);
}
/** The loop's first frame has dt 0, so the first two frames after the move gain nothing: one frame of warm-up opens a window that gains 7.2 a frame. */
const warmUp = (): Promise<void> => frames(1);
/** `configureTuning` inside one act, answering ok. */
async function configure(r: Rig, patch: Parameters<Rig['ws']['panels']['configureTuning']>[0]): Promise<void> {
  let result: ConfigureResult | undefined;
  await act(async () => {
    result = r.ws.panels.configureTuning(patch);
  });
  assert.equal(result?.ok, true, `configure ${JSON.stringify(patch)} answered ${JSON.stringify(result)}`);
}
/** How far `n` frames move the row. */
async function gainOver(r: Rig, n: number): Promise<number> {
  const before = rowOffsetOf(r.m.container);
  await frames(n);
  return rowOffsetOf(r.m.container) - before;
}
/** A whole drag of `id` held `n` frames at `at`, released: how far it moved the row. */
async function wholeDrag(r: Rig, n: number, at = POINTER, id = 's1'): Promise<number> {
  const before = rowOffsetOf(r.m.container);
  await dragTo(r, at, id);
  await frames(n);
  const after = rowOffsetOf(r.m.container);
  await liftAt(at);
  await frames(30);
  return after - before;
}
const near = (actual: number, expected: number, message: string): void => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual}, expected ${expected}`);

test('tuning.edgeScroll zonePx 48 to 12 mid-drag: this drag keeps its pace, and the next drag is outside the narrower band', async () => {
  const r = await mountRig();
  await dragTo(r, POINTER);
  await warmUp();
  near(await gainOver(r, 10), 72, 'ten frames before the configure');
  await configure(r, { edgeScroll: { zonePx: 12 } });
  near(await gainOver(r, 10), 72, 'ten frames after the configure');
  await liftAt(POINTER);
  await frames(30);
  assert.equal(await wholeDrag(r, 50), 0, '24 px from the edge is outside a 12 px band');
});

test('tuning.edgeScroll maxPxPerSec 900 to 450 mid-drag: this drag keeps its pace, and the next drag scrolls half as far', async () => {
  const r = await mountRig();
  const whole = await wholeDrag(r, 50);
  near(whole, 352.8, 'the control drag: 49 frames of 7.2');
  await dragTo(r, POINTER);
  await warmUp();
  near(await gainOver(r, 10), 72, 'ten frames before the configure');
  await configure(r, { edgeScroll: { maxPxPerSec: 450 } });
  near(await gainOver(r, 10), 72, 'ten frames after the configure');
  await liftAt(POINTER);
  await frames(30);
  near(await wholeDrag(r, 50), whole / 2, 'the next whole drag');
});
