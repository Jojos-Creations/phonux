/**
 * A drag in flight keeps the edge-scroll mode and the three edge numbers it locked with; a configure made while the
 * pointer is down reaches the next drag. jsdom has no PointerEvent, so every pointer event is a MouseEvent of the
 * pointer type name carrying the pointer fields motion reads, and time is the virtual frame clock.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose, createWorkspace, definePanel, usePanelReorderSteps } from '../index.js';
import type { ConfigureResult, PanelHandle, PanelSettings } from '../index.js';
import { LIBRARY_TUNING_DEFAULTS } from '../panelSettings.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { FRAME_MS } from './support/jsdom-globals.js';
import { markerTemplate, mountWorkspace, rowScrollerFor, type MountedWorkspace } from './support/workspace-row.js';

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
  h: Record<string, PanelHandle>;
}

/** The root and ten panels s1 to s10 in a 1000 px window; `own` is the settings a panel's template declares. */
async function mountRig(own: Record<string, PanelSettings> = {}): Promise<Rig> {
  ends.length = 0;
  const templates = Array.from({ length: 10 }, (_, k) => {
    const id = `s${k + 1}`;
    return definePanel({ id, view: () => React.createElement(EdgeBox, { id }), ...(own[id] === undefined ? {} : { settings: own[id] }) });
  });
  const ws = createWorkspace({ root: markerTemplate('root', { settings: { title: 'History' } }), templates });
  const h: Record<string, PanelHandle> = {};
  for (const template of templates) h[template.id] = ws.addPanel(template);
  const m = mountWorkspace(ws, { width: WINDOW });
  Object.defineProperty(m.container, 'clientWidth', { value: WINDOW, configurable: true });
  m.container.getBoundingClientRect = () => RECT;
  await frames(60);
  return { m, h };
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
/** `configure` inside one act, answering ok. */
async function configure(r: Rig, id: string, patch: Parameters<PanelHandle['configure']>[0]): Promise<void> {
  let result: ConfigureResult | undefined;
  await act(async () => {
    result = r.h[id]!.configure(patch);
  });
  assert.equal(result?.ok, true, `configure ${JSON.stringify(patch)} answered ${JSON.stringify(result)}`);
}
/** How far `n` frames move the row. */
async function gainOver(r: Rig, n: number): Promise<number> {
  const before = r.m.container.scrollLeft;
  await frames(n);
  return r.m.container.scrollLeft - before;
}
/** A whole drag of `id` held `n` frames at `at`, released: how far it moved the row. */
async function wholeDrag(r: Rig, n: number, at = POINTER, id = 's1'): Promise<number> {
  const before = r.m.container.scrollLeft;
  await dragTo(r, at, id);
  await frames(n);
  const after = r.m.container.scrollLeft;
  await liftAt(at);
  await frames(30);
  return after - before;
}
const near = (actual: number, expected: number, message: string): void => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual}, expected ${expected}`);

test('scrollOnDrag edge to none mid-drag: this drag keeps scrolling at the pace it began with, and its release adds the whole distance and hops over it', async () => {
  const r = await mountRig();
  await dragTo(r, POINTER);
  await warmUp();
  near(await gainOver(r, 10), 72, 'ten frames before the configure');
  await configure(r, 's1', { scrollOnDrag: 'none' });
  near(await gainOver(r, 10), 72, 'ten frames after the configure');
  near(await gainOver(r, 20), 144, 'twenty more');
  const scrolled = r.m.container.scrollLeft;
  near(scrolled, 288, 'the row at the lift');
  assert.equal(rowScrollerFor(r.m.container).claimHeld(), true, 'the claim is still held until the lift');
  await liftAt(POINTER);
  await frames(30);
  assert.equal(ends.length, 1);
  near(ends[0]!.offset, 40 + 288, 'the released offset is the pointer offset plus the distance');
  near(ends[0]!.offset, 40 + scrolled, 'the released offset counts the whole distance the row scrolled');
  assert.equal(ends[0]!.hops, 1, '328 clears the first neighbour half-span 203 and not the second 609');
  assert.equal(rowScrollerFor(r.m.container).claimHeld(), false, 'the lift gave the claim back');
  assert.equal(r.m.container.scrollLeft, scrolled, 'the row stays where the drag left it');
});

test('scrollOnDrag edge to none mid-drag: the next drag reads none, and set back to edge scrolls again', async () => {
  const r = await mountRig();
  await dragTo(r, POINTER);
  await configure(r, 's1', { scrollOnDrag: 'none' });
  await frames(10);
  await liftAt(POINTER);
  await frames(30);
  const none = await wholeDrag(r, 50);
  assert.equal(none, 0, 'a whole drag held 50 frames under none gains nothing');
  await configure(r, 's1', { scrollOnDrag: 'edge' });
  const edge = await wholeDrag(r, 50);
  assert.ok(edge > 0, `a whole drag after setting edge again gains ${edge}`);
});

test('scrollOnDrag none to edge mid-drag: this drag stays still and the next one scrolls', async () => {
  const r = await mountRig({ s2: { scrollOnDrag: 'none' } });
  await dragTo(r, POINTER, 's2');
  const before = r.m.container.scrollLeft;
  await configure(r, 's2', { scrollOnDrag: 'edge' });
  await frames(30);
  assert.equal(r.m.container.scrollLeft, before, 'the drag that began under none does not start scrolling');
  assert.equal(rowScrollerFor(r.m.container).claimHeld(), false, 'and holds no claim');
  await liftAt(POINTER);
  await frames(30);
  const next = await wholeDrag(r, 50, POINTER, 's2');
  assert.ok(next > 0, `the next drag of s2 gains ${next}`);
});

test('tuning.edgeScroll zonePx 48 to 12 mid-drag: this drag keeps its pace, and the next drag is outside the narrower band', async () => {
  const r = await mountRig();
  await dragTo(r, POINTER);
  await warmUp();
  near(await gainOver(r, 10), 72, 'ten frames before the configure');
  await configure(r, 's1', { tuning: { edgeScroll: { zonePx: 12 } } });
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
  await configure(r, 's1', { tuning: { edgeScroll: { maxPxPerSec: 450 } } });
  near(await gainOver(r, 10), 72, 'ten frames after the configure');
  await liftAt(POINTER);
  await frames(30);
  near(await wholeDrag(r, 50), whole / 2, 'the next whole drag');
});

test('tuning.edgeScroll reducedStepMs 500 to 250 mid-drag under animated false: this drag keeps jumping every 32 frames', async () => {
  const r = await mountRig({ s1: { animated: false } });
  await dragTo(r, WINDOW);
  const series: number[] = [];
  for (let frame = 0; frame < 110; frame += 1) {
    if (frame === 39) await configure(r, 's1', { tuning: { edgeScroll: { reducedStepMs: 250 } } });
    await frames(1);
    series.push(r.m.container.scrollLeft);
  }
  const jumpFrames = series.flatMap((v, k) => (v !== (k === 0 ? 0 : series[k - 1]) ? [k] : []));
  assert.ok(jumpFrames.length >= 3, `the row jumped ${jumpFrames.length} times, at frames ${jumpFrames.join(',')}`);
  const every = Math.ceil(EDGE.reducedStepMs / FRAME_MS);
  assert.equal(every, 32);
  assert.deepEqual(
    jumpFrames.slice(1).map((frame, k) => frame - jumpFrames[k]!),
    jumpFrames.slice(1).map(() => every),
    `every gap between jumps is ${every} frames, at frames ${jumpFrames.join(',')}`,
  );
});
