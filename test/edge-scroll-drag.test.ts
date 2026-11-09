/**
 * Edge scrolling through a mounted DragToClose and through a mounted row. jsdom has no PointerEvent, so every pointer
 * event is a MouseEvent of the pointer type name carrying the pointer fields motion reads.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { rowOffsetOf } from './support/strip.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose, usePanelReorderSteps } from '../index.js';
import type { PanelSettings } from '../index.js';
import { LIBRARY_TUNING_DEFAULTS, resolvePanelSettings } from '../panelSettings.js';
import { PanelSlotContext, PanelVerticalDragContext, type PanelSlotValue } from '../panelSlotContext.js';
import { slotTuning } from '../panelTuning.js';
import { reorderStepsForOffset } from '../panelWindow.js';
import { edgeScrollStep } from '../edgeScroll.js';
import { SLIDE_DURATION_SEC } from '../rowConstants.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { drag } from './support/drag-gesture.js';
import { FRAME_MS } from './support/jsdom-globals.js';
import { made, mountRow, rootEntry, row, type MountedRow } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';
import { slotTransform } from './support/strip.js';

// jsdom has no matchMedia. Motion reads the query once and then follows its 'change' event, so the stub exists before
// the first mount and a test flips it with `reduceMotion(true)` before mounting.
const reduced = { matches: false, listeners: new Set<() => void>() };
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    media: query,
    get matches() {
      return reduced.matches;
    },
    addEventListener: (_type: string, listener: () => void) => void reduced.listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void reduced.listeners.delete(listener),
  }),
});
function reduceMotion(on: boolean): void {
  reduced.matches = on;
  for (const listener of [...reduced.listeners]) listener();
}

afterEach(async () => {
  // A test that left the pointer down must not leave motion's window listeners live for the next one.
  document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  await frames(5);
  cleanup();
  reduceMotion(false);
});

test('pin: a 40 px horizontal drag on a reorder DragToClose reports onDragEnd(40)', async () => {
  const offsets: number[] = [];
  const mounted = mount(
    React.createElement(
      'div',
      { 'data-row-scroller': '' },
      React.createElement(DragToClose, {
        reorder: { onDragEnd: (offsetX: number) => void offsets.push(offsetX) },
        children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
      }),
    ),
  );
  const handle = mounted.container.querySelector('[data-handle]');
  assert.ok(handle, 'the handle rendered');
  await drag(handle, { dx: 40, dy: 0 });
  await advanceFrames(30 * 16);
  assert.deepEqual(offsets, [40]);
});

// ---------------------------------------------------------------------------
// Through a mounted row: eleven panels (phone 390, gap 16), the window 1000 wide, maxScroll 3654 from the row numbers
// ---------------------------------------------------------------------------

const ends: Array<{ id: string; offset: number; hops: number }> = [];
const closes: string[] = [];
function EdgeBox({ id }: { id: string }): React.ReactElement {
  const steps = usePanelReorderSteps();
  // The close test below drags down, which a row allows only under a template's verticalDrag.
  const box = React.createElement(DragToClose, {
    onClose: () => void closes.push(id),
    reorder: { onDragEnd: (offset: number) => void ends.push({ id, offset, hops: steps(offset) }) },
    children: (handle) => React.createElement('div', { 'data-handle': id, onPointerDown: handle.onPointerDown }, 'grab'),
  });
  return React.createElement(PanelVerticalDragContext.Provider, { value: true, children: box });
}
registerTestView('edge-view', ({ panel }) => React.createElement(EdgeBox, { id: panel.id }));

const WINDOW = 1000;
const MAX_SCROLL = 3654;
const EDGE = LIBRARY_TUNING_DEFAULTS.edgeScroll;

function mountEdgeRow(layer: PanelSettings = {}, over: Parameters<typeof mountRow>[2] = {}): MountedRow {
  ends.length = 0;
  closes.length = 0;
  const entries = row(rootEntry(), ...Array.from({ length: 10 }, (_, k) => made(`s${k + 1}`, layer, { view: 'edge-view' })));
  const m = mountRow(entries, WINDOW, over);
  Object.defineProperty(m.container, 'clientWidth', { value: WINDOW, configurable: true });
  m.container.getBoundingClientRect = () => ({ left: 0, right: WINDOW, top: 0, bottom: 700, width: WINDOW, height: 700, x: 0, y: 0, toJSON: () => ({}) });
  return m;
}

function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', x: number, y = 100): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1 });
  for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true })) Object.defineProperty(event, key, { value });
  return event;
}
const press = (target: Element, x: number): Promise<void> => act(async () => void target.dispatchEvent(pointer('pointerdown', x)));
const moveTo = (x: number, y = 100): Promise<void> => act(async () => void document.dispatchEvent(pointer('pointermove', x, y)));
const liftAt = (x: number, y = 100): Promise<void> => act(async () => void document.dispatchEvent(pointer('pointerup', x, y)));
const frames = (n: number): Promise<void> => advanceFrames(n * FRAME_MS);
/** Frames for a default-slide glide to land and the box spring to finish. */
const GLIDE_FRAMES = Math.ceil((SLIDE_DURATION_SEC * 1000) / FRAME_MS) + 10;
const handleOf = (m: MountedRow, id: string): Element => {
  const handle = m.container.querySelector(`[data-handle="${id}"]`);
  assert.ok(handle, `${id}'s grab bar rendered`);
  return handle;
};
const boxOf = (m: MountedRow, id = 's1'): HTMLElement => {
  const box = handleOf(m, id).closest<HTMLElement>('[data-drag-to-close]');
  assert.ok(box, `${id}'s box rendered`);
  return box;
};
/** The box's drawn x: Motion's transform plus the translate property. */
const drawnX = (box: HTMLElement): number => {
  const transform = /translateX\((-?[\d.e+-]+)px\)/.exec(box.style.transform);
  const translate = /^(-?[\d.e+-]+)px/.exec(box.style.translate);
  return (transform === null ? 0 : Number(transform[1])) + (translate === null ? 0 : Number(translate[1]));
};
/** A horizontal drag of s1 from 40 px left of `at` to `at`: the axis locks x, and a frame lets the lock take. */
async function dragTo(m: MountedRow, at: number, id = 's1'): Promise<void> {
  await press(handleOf(m, id), at - 40);
  await moveTo(at);
  await frames(1);
}
/** The distance `n` frames of a held pointer scrolls, by the same repeated additions the loop makes. */
function walked(n: number, from = 0): number {
  let scrollLeft = from;
  for (let frame = 0; frame < n; frame += 1) scrollLeft += edgeScrollStep({ speed: EDGE.maxPxPerSec, dtMs: FRAME_MS, scrollLeft, maxScroll: MAX_SCROLL });
  return scrollLeft;
}
/** How many of the five 390 neighbors' hop thresholds `offset` reaches. */
const hopsAt = (offset: number): number => [203, 609, 1015, 1421, 1827].filter((threshold) => offset >= threshold).length;
const FIVE_NEIGHBOURS = { left: [], right: [390, 390, 390, 390, 390] };
/**
 * The row's stops: the one-phone grid (390 + the 16 gap apart) from 0 to MAX_SCROLL. 86, half of (968 + 16) % 406, before and
 * after the strip centers the whole slots the window shows at every stop.
 */
const STOPS = Array.from({ length: 10 }, (_, k) => 406 * k);
/** Where a free row comes to rest after a scroll to `at`: the nearest of its stops. */
const settledAt = (at: number): number => STOPS.reduce((best, stop) => (Math.abs(stop - at) < Math.abs(best - at) ? stop : best));

test('hop rule: the released offset is hopped over by the view alone, at the tuned hopFraction', () => {
  assert.equal(reorderStepsForOffset(1750, FIVE_NEIGHBOURS, 16, 0.25), 5);
  assert.equal(reorderStepsForOffset(1750, FIVE_NEIGHBOURS, 16, 0.5), 4);
  assert.equal(reorderStepsForOffset(1500, FIVE_NEIGHBOURS, 16, 0.5), 4);
  assert.equal(reorderStepsForOffset(1500, FIVE_NEIGHBOURS, 16, 0.75), 3);
});

// ---------------------------------------------------------------------------
// Reduced motion: one instant jump per interval, to a grid stop
// ---------------------------------------------------------------------------

/** Frames per reduced-motion interval: the loop counts whole frames, and the first of a hold has dt 0. */
const intervalFrames = (ms: number): number => Math.ceil(ms / FRAME_MS);

/** Holds at 1000 and returns scrollLeft after every frame. */
async function heldSeries(m: MountedRow, n: number): Promise<number[]> {
  await dragTo(m, 1000);
  const series: number[] = [];
  for (let frame = 0; frame < n; frame += 1) {
    await frames(1);
    series.push(rowOffsetOf(m.container));
  }
  return series;
}
const jumps = (series: number[]): Array<{ frame: number; to: number }> => series.flatMap((v, k) => (v !== (k === 0 ? 0 : series[k - 1]) ? [{ frame: k, to: v }] : []));

test('reduced motion: a pointer that leaves the band before one interval causes no jump', async () => {
  reduceMotion(true);
  const m = mountEdgeRow();
  await dragTo(m, 1000);
  await frames(intervalFrames(EDGE.reducedStepMs) - 4);
  await moveTo(500);
  await frames(intervalFrames(EDGE.reducedStepMs) * 2);
  assert.equal(rowOffsetOf(m.container), 0);
});

// ---------------------------------------------------------------------------
// Drag-to-close is unaffected
// ---------------------------------------------------------------------------

test('a vertical-locked drag held at the edge scrolls nothing and closes by the close rule alone', async () => {
  for (const [dy, closed] of [[120, 1], [70, 0]] as const) {
    const m = mountEdgeRow();
    await press(handleOf(m, 's1'), 995);
    await moveTo(1000, 100 + dy);
    await frames(100);
    assert.equal(rowOffsetOf(m.container), 0, `dy ${dy}`);
    await liftAt(1000, 100 + dy);
    await frames(60);
    assert.equal(ends.length, 0, 'no reorder');
    assert.equal(closes.length, closed, `dy ${dy}`);
    cleanup();
  }
});

test('a horizontal-locked edge-scroll drag released after a 300 px vertical wobble never closes', async () => {
  const m = mountEdgeRow();
  await dragTo(m, 1000);
  await frames(20);
  await moveTo(1000, 400);
  await frames(5);
  await liftAt(1000, 400);
  await frames(60);
  assert.deepEqual(closes, []);
  assert.equal(ends.length, 1);
});

const bareSlot = (): PanelSlotValue => ({
  ...resolvePanelSettings().value,
  collapsible: true,
  neighborWidths: { left: [], right: [] },
  tuning: slotTuning(LIBRARY_TUNING_DEFAULTS),
  dragScroll: { mode: 'edge', zonePx: EDGE.zonePx, maxPxPerSec: EDGE.maxPxPerSec, reducedStepMs: EDGE.reducedStepMs, maxScroll: MAX_SCROLL, stops: [], settleStops: [], settleSec: 0.4, settleEase: 'cubic-out' },
});

test('a DragToClose without reorder never scrolls, whatever its slot offers', async () => {
  const mounted = mount(
    React.createElement(
      PanelSlotContext.Provider,
      { value: bareSlot() },
      React.createElement(
        'div',
        { 'data-row-scroller': '' },
        React.createElement(DragToClose, { children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab') }),
      ),
    ),
  );
  const scroller = mounted.container.querySelector<HTMLElement>('[data-row-scroller]')!;
  scroller.getBoundingClientRect = () => ({ left: 0, right: WINDOW, top: 0, bottom: 700, width: WINDOW, height: 700, x: 0, y: 0, toJSON: () => ({}) });
  await press(mounted.container.querySelector('[data-handle]')!, 960);
  await moveTo(1000);
  await frames(50);
  assert.equal(scroller.scrollLeft, 0);
  await liftAt(1000);
});

// ---------------------------------------------------------------------------
// Idle: DragToClose installs no listener while no drag is held
// ---------------------------------------------------------------------------

/** Counts the pointer and scroll listeners live on window and document, through wrappers that are removed again by `stop`. */
function trackListeners(): { count: () => number; types: () => string; stop: () => void } {
  const live: Array<{ target: EventTarget; type: string; listener: unknown; capture: boolean }> = [];
  const restores = [window, document].map((target) => {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    const captureOf = (options: unknown): boolean => options === true || (typeof options === 'object' && options !== null && (options as { capture?: boolean }).capture === true);
    target.addEventListener = ((type: string, listener: unknown, options?: unknown) => {
      if (!live.some((l) => l.target === target && l.type === type && l.listener === listener && l.capture === captureOf(options))) live.push({ target, type, listener, capture: captureOf(options) });
      return add(type, listener as EventListener, options as AddEventListenerOptions);
    }) as typeof target.addEventListener;
    target.removeEventListener = ((type: string, listener: unknown, options?: unknown) => {
      const at = live.findIndex((l) => l.target === target && l.type === type && l.listener === listener && l.capture === captureOf(options));
      if (at >= 0) live.splice(at, 1);
      return remove(type, listener as EventListener, options as EventListenerOptions);
    }) as typeof target.removeEventListener;
    return () => {
      target.addEventListener = add as typeof target.addEventListener;
      target.removeEventListener = remove as typeof target.removeEventListener;
    };
  });
  const wanted = (l: { type: string }): boolean => /^(pointer|mouse|touch|scroll|wheel)/.test(l.type);
  return { count: () => live.filter(wanted).length, types: () => live.filter(wanted).map((l) => l.type).join(','), stop: () => restores.forEach((restore) => restore()) };
}

test('no listener is installed while no drag is held: the count after mounting, after a drag and after its release equals the count before', async () => {
  const listeners = trackListeners();
  try {
    const before = listeners.count();
    const alone = mount(
      React.createElement(
        'div',
        { 'data-row-scroller': '' },
        React.createElement(DragToClose, { reorder: { onDragEnd: () => undefined }, children: () => React.createElement('i') }),
      ),
    );
    assert.equal(listeners.count(), before, `a mounted DragToClose adds none, saw ${listeners.types()}`);
    alone.unmount();
    const m = mountEdgeRow();
    const idle = listeners.count();
    await dragTo(m, 1000);
    await frames(20);
    assert.ok(listeners.count() > idle, 'a drag holds listeners (the control: the counter sees them)');
    await liftAt(1000);
    await frames(60);
    assert.equal(listeners.count(), idle, 'the release gave every one back');
    await press(handleOf(m, 's2'), 500);
    await liftAt(500);
    await frames(10);
    assert.equal(listeners.count(), idle, 'a click that never became a drag gave them back too');
  } finally {
    listeners.stop();
  }
});

test('the listener counter itself sees a listener a component adds on mount', () => {
  const listeners = trackListeners();
  try {
    const before = listeners.count();
    function Planted(): React.ReactElement {
      React.useEffect(() => {
        const noop = (): void => undefined;
        window.addEventListener('pointermove', noop);
        return () => window.removeEventListener('pointermove', noop);
      }, []);
      return React.createElement('i');
    }
    mount(React.createElement(Planted));
    assert.equal(listeners.count(), before + 1);
    cleanup();
    assert.equal(listeners.count(), before);
  } finally {
    listeners.stop();
  }
});

