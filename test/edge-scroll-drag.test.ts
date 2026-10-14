/**
 * Edge scrolling through a mounted DragToClose and through a mounted row. jsdom has no PointerEvent, so every pointer
 * event is a MouseEvent of the pointer type name carrying the pointer fields motion reads.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose, registerView, usePanelReorderSteps } from '../index.js';
import type { PanelSettings } from '../index.js';
import { LIBRARY_TUNING_DEFAULTS, resolvePanelSettings } from '../panelSettings.js';
import { PanelSlotContext, type PanelSlotValue } from '../panelSlotContext.js';
import { slotTuning } from '../panelTuning.js';
import { reorderStepsForOffset } from '../panelWindow.js';
import { edgeScrollStep } from '../edgeScroll.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { drag } from './support/drag-gesture.js';
import { FRAME_MS } from './support/jsdom-globals.js';
import { made, mountRow, rootEntry, row, type MountedRow } from './support/scroll-row.js';

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
// Through a mounted row: eleven panels (phone 390, gap 16), the window 1000 wide, maxScroll 3482 from the row numbers
// ---------------------------------------------------------------------------

const ends: Array<{ id: string; offset: number; hops: number }> = [];
const closes: string[] = [];
function EdgeBox({ id }: { id: string }): React.ReactElement {
  const steps = usePanelReorderSteps();
  return React.createElement(DragToClose, {
    onClose: () => void closes.push(id),
    reorder: { onDragEnd: (offset: number) => void ends.push({ id, offset, hops: steps(offset) }) },
    children: (handle) => React.createElement('div', { 'data-handle': id, onPointerDown: handle.onPointerDown }, 'grab'),
  });
}
registerView('edge-view', ({ panel }) => React.createElement(EdgeBox, { id: panel.id }));

const WINDOW = 1000;
const MAX_SCROLL = 3482;
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
/** How many of the five 390 neighbours' hop thresholds `offset` reaches. */
const hopsAt = (offset: number): number => [203, 609, 1015, 1421, 1827].filter((threshold) => offset >= threshold).length;
const FIVE_NEIGHBOURS = { left: [], right: [390, 390, 390, 390, 390] };

test('held at the right edge for 100 frames the row scrolls 99 steps; held mid-window it stays; the release adds the distance and hops over it', async () => {
  const m = mountEdgeRow();
  await dragTo(m, 1000);
  await frames(100);
  const distance = walked(99);
  assert.ok(Math.abs(m.container.scrollLeft - distance) < 1e-6, `scrollLeft ${m.container.scrollLeft}, expected ${distance} (99 x ${(EDGE.maxPxPerSec * FRAME_MS) / 1000})`);
  assert.equal(ends.length, 0, 'nothing hops during the drag');
  await liftAt(1000);
  await frames(30);
  assert.equal(ends.length, 1);
  assert.ok(Math.abs(ends[0]!.offset - (40 + distance)) < 1e-6, `released offset ${ends[0]!.offset}`);
  assert.equal(ends[0]!.hops, hopsAt(40 + distance));
  assert.equal(hopsAt(40 + distance), 4, '1465.6 clears 1421 and not 1827');
  assert.equal(reorderStepsForOffset(ends[0]!.offset, FIVE_NEIGHBOURS, 16, LIBRARY_TUNING_DEFAULTS.hopFraction), 4);
  assert.ok(Math.abs(m.container.scrollLeft - distance) < 1e-6, 'the row stays where the pointer left it');

  cleanup();
  const mid = mountEdgeRow();
  await dragTo(mid, 500);
  await frames(100);
  assert.equal(mid.container.scrollLeft, 0, 'the pointer is outside both bands');
  await liftAt(500);
  await frames(30);
  assert.deepEqual(ends.map((e) => e.offset), [40], 'the pointer offset alone');
});

test('the drawn position is the pointer offset plus the scroll distance at every frame', async () => {
  const m = mountEdgeRow();
  const box = boxOf(m);
  await dragTo(m, 1000);
  for (let frame = 0; frame < 100; frame += 1) {
    await frames(1);
    const expected = 40 + m.container.scrollLeft;
    assert.ok(Math.abs(drawnX(box) - expected) < 1e-6, `frame ${frame}: drawn ${drawnX(box)}, expected ${expected}`);
  }
  assert.ok(m.container.scrollLeft > 1000, 'the loop ran');
});

test('the strip bounds the scroll: a scrollWidth inflated by the box never lifts scrollLeft past the row numbers', async () => {
  const m = mountEdgeRow();
  const box = boxOf(m);
  Object.defineProperty(m.container, 'scrollWidth', { get: () => 4482 + drawnX(box), configurable: true });
  await dragTo(m, 1000);
  await frames(400);
  assert.equal(m.container.scrollLeft, MAX_SCROLL);
  await frames(40);
  assert.equal(m.container.scrollLeft, MAX_SCROLL, 'and stays there');
  await liftAt(1000);
  await frames(30);
  assert.equal(ends[0]!.offset, 40 + MAX_SCROLL);
});

test('released with nothing to hop over, the box springs home as one: both translations start returning in one frame and reach 0 in one frame', async () => {
  const m = mountEdgeRow({ crossable: false });
  const box = boxOf(m);
  await dragTo(m, 1000);
  await frames(100);
  const before = { x: drawnX(box), transform: box.style.transform, translate: box.style.translate };
  assert.ok(before.x > 1000);
  await liftAt(1000);
  const xs: number[] = [];
  const translates: number[] = [];
  for (let frame = 0; frame < 60; frame += 1) {
    await frames(1);
    xs.push(/translateX\((-?[\d.e+-]+)px\)/.test(box.style.transform) ? Number(/translateX\((-?[\d.e+-]+)px\)/.exec(box.style.transform)![1]) : 0);
    translates.push(/^(-?[\d.e+-]+)px/.test(box.style.translate) ? Number(/^(-?[\d.e+-]+)px/.exec(box.style.translate)![1]) : 0);
  }
  const firstMoved = (values: number[], from: number): number => values.findIndex((v) => v !== from);
  const startedAt = firstMoved(xs, 40);
  assert.ok(startedAt >= 0, 'x returns');
  assert.equal(firstMoved(translates, Number(/^(-?[\d.e+-]+)px/.exec(before.translate)![1])), startedAt, 'the scroll distance starts returning in the same frame');
  const settled = (values: number[]): number => values.findIndex((_, k) => values.slice(k).every((v) => v === 0));
  assert.ok(settled(xs) > 0 && settled(xs) < 60, 'x settled');
  assert.equal(settled(translates), settled(xs), 'both reach 0 in the same frame');
  assert.equal(box.style.transform, 'none');
  assert.ok(['', 'none', '0px 0px', '0px'].includes(box.style.translate), `translate settled at ${JSON.stringify(box.style.translate)}`);
  assert.ok(Math.abs(m.container.scrollLeft - walked(99)) < 1e-6, 'the row is not snapped back');
});

test('released after the edge scroll carried the drag over hops, the box is at rest the frame after the release: no spring', async () => {
  const m = mountEdgeRow();
  const box = boxOf(m);
  await dragTo(m, 1000);
  await frames(100);
  assert.ok(drawnX(box) > 1000);
  await liftAt(1000);
  await frames(1);
  assert.ok(ends[0]!.hops > 0, 'the release reports hops');
  assert.equal(box.style.transform, 'none');
  assert.ok(['', 'none', '0px 0px', '0px'].includes(box.style.translate), JSON.stringify(box.style.translate));
});

test('released with a scroll distance and no hop, the box still settles at rest', async () => {
  const m = mountEdgeRow();
  const box = boxOf(m);
  await dragTo(m, 1000);
  await frames(6);
  assert.ok(m.container.scrollLeft > 0);
  await liftAt(1000);
  await frames(60);
  assert.equal(ends[0]!.hops, 0);
  assert.equal(box.style.transform, 'none');
  assert.ok(['', 'none', '0px 0px', '0px'].includes(box.style.translate), JSON.stringify(box.style.translate));
});

test('hop rule: the released offset is hopped over by the view alone, at the tuned hopFraction', () => {
  assert.equal(reorderStepsForOffset(1750, FIVE_NEIGHBOURS, 16, 0.25), 5);
  assert.equal(reorderStepsForOffset(1750, FIVE_NEIGHBOURS, 16, 0.5), 4);
  assert.equal(reorderStepsForOffset(1500, FIVE_NEIGHBOURS, 16, 0.5), 4);
  assert.equal(reorderStepsForOffset(1500, FIVE_NEIGHBOURS, 16, 0.75), 3);
});

// ---------------------------------------------------------------------------
// Reduced motion: one instant jump per interval, to a panel start
// ---------------------------------------------------------------------------

/** Frames per reduced-motion interval: the loop counts whole frames, and the first of a hold has dt 0. */
const intervalFrames = (ms: number): number => Math.ceil(ms / FRAME_MS);

/** Holds at 1000 and returns scrollLeft after every frame. */
async function heldSeries(m: MountedRow, n: number): Promise<number[]> {
  await dragTo(m, 1000);
  const series: number[] = [];
  for (let frame = 0; frame < n; frame += 1) {
    await frames(1);
    series.push(m.container.scrollLeft);
  }
  return series;
}
const jumps = (series: number[]): Array<{ frame: number; to: number }> => series.flatMap((v, k) => (v !== (k === 0 ? 0 : series[k - 1]) ? [{ frame: k, to: v }] : []));

test('matchMedia reduce: no continuous scroll; the row jumps once per interval to panel starts 406, 812, 1218 and 1624 and the release reports 1664', async () => {
  reduceMotion(true);
  const m = mountEdgeRow();
  const box = boxOf(m);
  const per = intervalFrames(EDGE.reducedStepMs);
  assert.equal(per, 32);
  const series = await heldSeries(m, 4 * per + 1);
  const seen = jumps(series);
  assert.deepEqual(seen.map((j) => j.to), [406, 812, 1218, 1624]);
  assert.deepEqual(seen.slice(1).map((j, k) => j.frame - seen[k]!.frame), [per, per, per], 'one jump per interval, nothing between');
  assert.ok(Math.abs(drawnX(box) - (40 + 1624)) < 1e-6, 'the two translations jump together');
  await liftAt(1000);
  await frames(30);
  assert.deepEqual(ends.map((e) => [e.offset, e.hops]), [[1664, 4]]);
});

test('reduced motion: a pointer that leaves the band before one interval causes no jump', async () => {
  reduceMotion(true);
  const m = mountEdgeRow();
  await dragTo(m, 1000);
  await frames(intervalFrames(EDGE.reducedStepMs) - 4);
  await moveTo(500);
  await frames(intervalFrames(EDGE.reducedStepMs) * 2);
  assert.equal(m.container.scrollLeft, 0);
});

test('reduced motion: half the interval doubles the jumps, and twelve intervals end at the strip bound and stop', async () => {
  reduceMotion(true);
  const held = async (m: MountedRow, n: number): Promise<number[]> => {
    const series = await heldSeries(m, n);
    await liftAt(1000);
    await frames(5);
    cleanup();
    return series;
  };
  const whole = await held(mountEdgeRow(), 130);
  const half = await held(mountEdgeRow({ tuning: { edgeScroll: { reducedStepMs: EDGE.reducedStepMs / 2 } } }), 130);
  assert.equal(jumps(whole).length, 4);
  assert.equal(jumps(half).length, 8);
  const long = await held(mountEdgeRow(), 12 * intervalFrames(EDGE.reducedStepMs) + 40);
  assert.equal(long[long.length - 1], MAX_SCROLL);
  assert.equal(jumps(long).at(-1)!.to, MAX_SCROLL);
  assert.equal(jumps(long).length, 9, 'eight panel starts and then the bound');
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
    assert.equal(m.container.scrollLeft, 0, `dy ${dy}`);
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

test('a panel that cannot be closed still edge-scrolls and reorders', async () => {
  const m = mountEdgeRow({ closable: false });
  await dragTo(m, 1000);
  await frames(100);
  assert.ok(m.container.scrollLeft > 1000);
  await liftAt(1000);
  await frames(30);
  assert.equal(ends[0]!.hops, 4);
});

const bareSlot = (): PanelSlotValue => ({
  ...resolvePanelSettings().value,
  collapsible: true,
  neighborWidths: { left: [], right: [] },
  pinned: false,
  tuning: slotTuning(LIBRARY_TUNING_DEFAULTS, undefined),
  dragScroll: { mode: 'edge', zonePx: EDGE.zonePx, maxPxPerSec: EDGE.maxPxPerSec, reducedStepMs: EDGE.reducedStepMs, instant: false, maxScroll: MAX_SCROLL, stops: [], settleStops: [], settleSec: 0.4, settleEase: 'cubic-out' },
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

test('the last panel dragged to the right edge is drawn no further than the row end, so the scrollable width does not grow, and the hop rule still reads the pointer', async () => {
  const m = mountEdgeRow();
  const box = boxOf(m, 's10');
  const ROW_END = 4466;
  // jsdom lays nothing out: the row's end and the box's drawn right edge are stated here, in screen px, from the scroll position and the drawn offset.
  const strip = m.container.querySelector('[data-row-strip]');
  assert.ok(strip, 'the row carries its strip mark');
  const rect = (right: number) => ({ left: right - 390, right, top: 0, bottom: 700, width: 390, height: 700, x: right - 390, y: 0, toJSON: () => ({}) });
  strip.getBoundingClientRect = () => rect(ROW_END - m.container.scrollLeft) as DOMRect;
  box.getBoundingClientRect = () => rect(ROW_END - m.container.scrollLeft + drawnX(box)) as DOMRect;
  await dragTo(m, 1000, 's10');
  let furthest = Number.NEGATIVE_INFINITY;
  for (let frame = 0; frame < 400; frame += 1) {
    await frames(1);
    furthest = Math.max(furthest, drawnX(box));
  }
  assert.equal(m.container.scrollLeft, MAX_SCROLL, 'the loop reached the strip end');
  assert.ok(furthest <= 0.5, `the box was drawn ${furthest} px past the row end`);
  await liftAt(1000);
  await frames(30);
  assert.equal(ends[0]!.offset, 40 + MAX_SCROLL, 'the hop rule reads the pointer offset plus the scroll distance, not the drawn one');
});

test('held at the right edge the row previews exactly the hops the release then reports, scroll distance included', async () => {
  const m = mountEdgeRow();
  const slotX = (id: string): number => {
    const slot = handleOf(m, id).closest<HTMLElement>('[data-drag-to-close]')!.parentElement!;
    return Number(/translateX\((-?[\d.e+-]+)px\)/.exec(slot.style.transform)?.[1] ?? 0);
  };
  const ids = Array.from({ length: 9 }, (_, k) => `s${k + 2}`);
  const rest = ids.map(slotX);
  await dragTo(m, 1000);
  await frames(100);
  const shifted = ids.filter((id, k) => slotX(id) < rest[k]! - 1).length;
  assert.ok(m.container.scrollLeft > 1000, 'control: the row scrolled');
  assert.ok(shifted >= 4, `the preview counts the scroll distance, not only the ${1000 - 40} px of pointer travel (${shifted} shifted)`);
  await liftAt(1000);
  await frames(30);
  assert.equal(ends[0]!.hops, shifted);
});
