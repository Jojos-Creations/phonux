/**
 * Releasing a width drag that was pinned at its end (a left grabber): the panel's right edge goes back to where it sat when the
 * drag began, as near as a stop allows, and the row lands on the stop nearest that scroll. Real createWorkspace and PanelRow in
 * StrictMode with the app's call order; jsdom has no layout, so every slot's rect is rebuilt from the strip margin, the slot's
 * transform and width and the row's scroll, which is what a browser would report.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { stripMarginOf, setRowOffset, rowOffsetOf } from './support/strip.js';
import * as React from 'react';
import { act } from 'react';
import { MotionConfig } from 'motion/react';
import { createWorkspace, definePanel, usePanelDots, usePanelResizing } from '../index.js';
import type { WorkspaceHandle } from '../index.js';
import { SLIDE_DURATION_SEC } from '../rowConstants.js';
import type { PanelDots } from '../index.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { markerTemplate, mountWorkspace, rowScrollerFor, type ResizableWorkspace } from './support/workspace-row.js';

type Setters = { resizing: (on: boolean) => void; width: (px: number | null, pin?: 'start' | 'end') => void };
const setters = new Map<string, Setters>();
const PAD = 120;
/** How far left of its style the marked slot's reported right edge is, while it is set: the element is the truth, not the numbers. */
const report = { id: '', trim: 0 };
const rectOf = Element.prototype.getBoundingClientRect;

function Grab({ id }: { id: string }): React.ReactElement {
  const [, resizing, width] = usePanelResizing();
  setters.set(id, { resizing, width });
  return React.createElement('i', { 'data-slot': id });
}

/** The mocked clock moves the frame clock with it, so every test that mounts a row runs on it; enabling twice would drop the wrappers a test set up. */
let timersOn = false;
function ensureMockTimers(): void {
  if (timersOn) return;
  mock.timers.enable({ apis: ['setTimeout'] });
  timersOn = true;
}

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
  timersOn = false;
  report.id = '';
  report.trim = 0;
  Element.prototype.getBoundingClientRect = rectOf;
  setters.clear();
  cleanup();
});

const IDS = ['p1', 'p2', 'p3', 'p4', 'p5'];
const slotOf = (container: HTMLElement, id: string): HTMLElement => container.querySelector<HTMLElement>(`[data-row-id="${id}"]`)!;
const xOf = (container: HTMLElement, id: string): number => Number(/translateX\((-?[\d.e+-]+)px\)/.exec(slotOf(container, id).style.transform)?.[1] ?? 0);
const widthOf = (container: HTMLElement, id: string): number => Number.parseFloat(slotOf(container, id).style.width);
const marginOf = (container: HTMLElement): number => stripMarginOf(container);
/** A slot's right edge in the row's own space: before the scroll is taken off and before the container's padding is added. */
const rowRight = (container: HTMLElement, id: string): number => marginOf(container) + xOf(container, id) + widthOf(container, id);
/** Where the slot's right edge is in the window. */
const screenRight = (container: HTMLElement, id: string): number => rowRight(container, id) - rowOffsetOf(container);
const SLOT = (n: number, gap: number): number => n * 390 + (n - 1) * gap;

interface Rig {
  m: ResizableWorkspace;
  ws: WorkspaceHandle;
  window: number;
  /** The row id the workspace gave each template's panel, in the order they were added. */
  ids: Record<string, string>;
}

/** The root and p1..p5, one slot each, in a `window` px window; the container pads PAD px, as a themed one would. */
async function mountRig(gap: number, o: { window?: number; reduced?: boolean; slots?: number[] } = {}): Promise<Rig> {
  ensureMockTimers();
  const window = o.window ?? 1500;
  const templates = IDS.map((id, k) => definePanel({ id, view: () => React.createElement(Grab, { id }), settings: { slots: o.slots?.[k] ?? 1, maxSlots: 64 } }));
  const ws = createWorkspace({ mount: false, root: markerTemplate('root', { settings: { title: 'History' } }), templates, tuning: { rowGesture: 'step', rowGap: gap } });
  for (const template of templates) ws.addPanel(template);
  const m = mountWorkspace(ws, { width: window, strict: true, ...(o.reduced === true ? { wrap: (tree: React.ReactElement) => React.createElement(MotionConfig, { reducedMotion: 'always' }, tree) } : {}) });
  Object.defineProperty(m.container, 'clientWidth', { value: window, configurable: true });
  m.container.style.paddingLeft = `${PAD}px`;
  const container = m.container;
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const box = (left: number, width: number): DOMRect => ({ left, right: left + width, top: 0, bottom: 700, width, height: 700, x: left, y: 0, toJSON: () => ({}) });
    if (this === container) return box(0, window);
    if (this instanceof HTMLElement && this.dataset.rowId !== undefined && container.contains(this)) {
      const id = this.dataset.rowId;
      return box(PAD + marginOf(container) + xOf(container, id) - rowOffsetOf(container), widthOf(container, id) - (id === report.id ? report.trim : 0));
    }
    return rectOf.call(this);
  };
  await advanceFrames(400);
  const rowIds = [...container.querySelectorAll<HTMLElement>('[data-row-id]')].map((n) => n.dataset.rowId!).filter((id) => id !== 'root');
  const ids = Object.fromEntries(IDS.map((name, k) => [name, rowIds[k]!]));
  return { m, ws, window, ids };
}

const frames = (ms: number): Promise<void> => advanceFrames(ms);
const stopsOf = (r: Rig): readonly number[] => r.m.latest().rowNumbers.stops;

/** Puts the row on `to` as a person's scroll would: set, then the scroll event the provider listens for. */
async function scrollTo(r: Rig, to: number): Promise<void> {
  setRowOffset(r.m.container, to);
  act(() => void r.m.container.dispatchEvent(new Event('scroll')));
  await frames(600);
}

/** The first stop nearest `at`, by distance alone. */
const nearestIndex = (stops: readonly number[], at: number): number => {
  let best = 0;
  for (const [k, stop] of stops.entries()) if (Math.abs(stop - at) < Math.abs(stops[best]! - at)) best = k;
  return best;
};

interface Drag {
  /** The pinned right edge in the window when the mark began. */
  edge: number;
  /** The scroll when the mark began. */
  began: number;
}

/** Marks `id` resizing and widens it from its left grabber by `extra` px, pin 'end'. */
async function beginDrag(r: Rig, id: string, extra: number, steps = 4, trim = 0, pin: 'start' | 'end' = 'end'): Promise<Drag> {
  const began = rowOffsetOf(r.m.container);
  report.id = r.ids[id]!;
  report.trim = trim;
  act(() => setters.get(id)!.resizing(true));
  report.trim = 0;
  const edge = screenRight(r.m.container, r.ids[id]!) - trim;
  const start = widthOf(r.m.container, r.ids[id]!);
  for (let k = 1; k <= steps; k += 1) {
    act(() => setters.get(id)!.width(start + (extra * k) / steps, pin));
    await frames(20);
  }
  return { edge, began };
}

type Order = 'together' | 'apart';
/** The release in the app's order: setSlots(nearest), width null, the mark off. `apart` puts setSlots in an act of its own after the other two. */
async function release(r: Rig, id: string, slots: number, order: Order = 'together'): Promise<void> {
  if (order === 'together') {
    act(() => {
      r.m.latest().setSlots(r.ids[id]!, slots);
      setters.get(id)!.width(null);
      setters.get(id)!.resizing(false);
    });
  } else {
    act(() => {
      setters.get(id)!.width(null);
      setters.get(id)!.resizing(false);
    });
    act(() => void r.m.latest().setSlots(r.ids[id]!, slots));
  }
  await frames(40);
  act(() => mock.timers.tick(SLIDE_DURATION_SEC * 1000));
  await frames(1200);
}

/** What the row must have done: it rests on the stop nearest the scroll that holds `edge`, and says so. */
function assertLanded(r: Rig, id: string, drag: Drag, label: string): { wanted: number; landed: number } {
  const stops = stopsOf(r);
  const wanted = rowRight(r.m.container, r.ids[id]!) - drag.edge;
  const landed = rowOffsetOf(r.m.container);
  assert.ok(stops.length > 0, `${label}: the row has stops`);
  const best = Math.min(...stops.map((s) => Math.abs(s - wanted)));
  assert.ok(stops.some((s) => Math.abs(s - landed) < 0.5), `${label}: it rests on a stop: ${landed} in ${stops.join(',')}`);
  assert.ok(Math.abs(landed - wanted) <= best + 0.5, `${label}: it rests on the stop nearest ${wanted.toFixed(1)}, which is ${best.toFixed(1)} away; it is ${Math.abs(landed - wanted).toFixed(1)} away at ${landed}`);
  return { wanted, landed };
}

const startStops = (stops: readonly number[], where: 'first' | 'middle' | 'last'): number => stops[where === 'first' ? 0 : where === 'last' ? stops.length - 1 : Math.floor(stops.length / 2)]!;
const PANEL = { first: 'p1', middle: 'p3', last: 'p5' } as const;

test('the case table: a left-grabber release lands on the stop that holds the right edge, whichever panel, growth and gap', async () => {
  const different: string[] = [];
  let cases = 0;
  for (const gap of [16, 24]) {
    for (const where of ['first', 'middle', 'last'] as const) {
      for (const grow of [2, 3]) {
        const id = PANEL[where];
        const r = await mountRig(gap);
        await scrollTo(r, startStops(stopsOf(r), where));
        const label = `gap ${gap} ${id} 1 to ${grow}`;
        const drag = await beginDrag(r, id, SLOT(grow, gap) - SLOT(1, gap) + 25);
        assert.ok(Math.abs(screenRight(r.m.container, r.ids[id]!) - drag.edge) < 0.5, `${label}: the drag itself holds the right edge`);
        const atRelease = rowOffsetOf(r.m.container);
        await release(r, id, grow);
        const { wanted } = assertLanded(r, id, drag, label);
        if (nearestIndex(stopsOf(r), atRelease) !== nearestIndex(stopsOf(r), wanted) && Math.abs(stopsOf(r)[nearestIndex(stopsOf(r), atRelease)]! - stopsOf(r)[nearestIndex(stopsOf(r), wanted)]!) > 1) different.push(label);
        cases += 1;
        cleanup();
      }
    }
  }
  assert.equal(cases, 12);
  assert.ok(different.length >= 2, `the table has cases where holding the edge lands elsewhere than the scroll at release would (${different.length}): ${different.join('; ')}`);
});

test('setSlots in an act of its own after the mark ends is the same release', async () => {
  const r = await mountRig(16);
  await scrollTo(r, startStops(stopsOf(r), 'middle'));
  const drag = await beginDrag(r, 'p3', SLOT(2, 16) - SLOT(1, 16) + 25);
  await release(r, 'p3', 2, 'apart');
  assertLanded(r, 'p3', drag, 'apart');
});

test('a release that never changes the slot count lands as it would have: nearest the scroll it had', async () => {
  const r = await mountRig(16);
  await scrollTo(r, startStops(stopsOf(r), 'middle'));
  const drag = await beginDrag(r, 'p3', 60);
  void drag;
  const before = rowOffsetOf(r.m.container);
  act(() => {
    setters.get('p3')!.width(null);
    setters.get('p3')!.resizing(false);
  });
  await frames(1200);
  assert.equal(rowScrollerFor(r.m.container).claimHeld(), false, 'the row is let go a frame after the release');
  assert.ok(Math.abs(rowOffsetOf(r.m.container) - before) < 1, `a drag back to the stored width leaves the row where it was: ${before} then ${rowOffsetOf(r.m.container)}`);
});

test('under Reduce Motion the release is held and snapped in one frame', async () => {
  const r = await mountRig(16, { reduced: true });
  await scrollTo(r, startStops(stopsOf(r), 'middle'));
  const drag = await beginDrag(r, 'p3', SLOT(2, 16) - SLOT(1, 16) + 25);
  await release(r, 'p3', 2);
  assertLanded(r, 'p3', drag, 'reduced motion');
});

test('a mark that begins while the row is gliding holds the edge the panel is drawn at, not the one it is heading for', async () => {
  const landed = new Set<number>();
  for (const wait of [40, 80, 120, 160, 200, 240]) {
    const r = await mountRig(16);
    const stops = stopsOf(r);
    await scrollTo(r, stops[0]!);
    // Gliding to the far stop puts the six begin points either side of the scroll midway between two stops of the released row.
    rowScrollerFor(r.m.container).glideTo(stops[3]!, { durationSec: 0.4, instant: false, ease: 'linear' as never });
    await frames(wait);
    const mid = rowOffsetOf(r.m.container);
    assert.ok(mid > stops[0]! + 5 && mid < stops[3]! - 5, `${wait} ms: the glide is under way: ${mid}`);
    const drag = await beginDrag(r, 'p2', SLOT(2, 16) - SLOT(1, 16) + 25, 2);
    assert.ok(Math.abs(drag.edge - screenRight(r.m.container, r.ids.p2!)) < 0.5);
    assert.ok(drag.edge > 0 && drag.edge <= r.window, `${wait} ms: the pinned edge is in the window: ${drag.edge}`);
    await release(r, 'p2', 2);
    landed.add(assertLanded(r, 'p2', drag, `begun ${wait} ms into a glide`).landed);
    cleanup();
  }
  assert.ok(landed.size >= 2, `the six begin points land on more than one stop: ${[...landed].join(',')}`);
});

test('a panel cut off by the window when the mark begins keeps its edge held', async () => {
  const r = await mountRig(16);
  await scrollTo(r, stopsOf(r)[0]!);
  const drag = await beginDrag(r, 'p3', SLOT(2, 16) - SLOT(1, 16) + 25);
  assert.ok(drag.edge > r.window, `the edge is past the window: ${drag.edge}`);
  await release(r, 'p3', 2);
  assertLanded(r, 'p3', drag, 'cut off');
});

test('a row that fits has no stops to hold: nothing scrolls on the release', async () => {
  const r = await mountRig(16, { window: 3200 });
  assert.equal(stopsOf(r).length === 0 || rowOffsetOf(r.m.container) === 0, true);
  const drag = await beginDrag(r, 'p3', 300);
  void drag;
  await release(r, 'p3', 2);
  assert.equal(rowOffsetOf(r.m.container), 0, 'the centered row stays at scroll 0');
});

test('the edge held is the one the element reports when the mark begins, which the numbers can be ahead of', async () => {
  const landed = new Set<number>();
  for (const trim of [0, -100, -200, -300, -400]) {
    const r = await mountRig(16);
    await scrollTo(r, startStops(stopsOf(r), 'middle'));
    const drag = await beginDrag(r, 'p3', SLOT(2, 16) - SLOT(1, 16) + 25, 4, trim);
    assert.equal(drag.edge, screenRight(r.m.container, r.ids.p3!) - trim);
    await release(r, 'p3', 2);
    landed.add(assertLanded(r, 'p3', drag, `reported ${trim} px short`).landed);
    cleanup();
  }
  assert.ok(landed.size >= 2, `the edge reported moves the landing: ${[...landed].join(',')}`);
});

test('pinned at the start, a right-grabber release holds the left edge by the same rule', async () => {
  const r = await mountRig(16);
  await scrollTo(r, startStops(stopsOf(r), 'middle'));
  const began = rowOffsetOf(r.m.container);
  act(() => setters.get('p3')!.resizing(true));
  const left = marginOf(r.m.container) + xOf(r.m.container, r.ids.p3!) - rowOffsetOf(r.m.container);
  const start = widthOf(r.m.container, r.ids.p3!);
  for (let k = 1; k <= 4; k += 1) {
    act(() => setters.get('p3')!.width(start + 100 * k, 'start'));
    await frames(20);
  }
  void began;
  await release(r, 'p3', 2);
  const stops = stopsOf(r);
  const wanted = marginOf(r.m.container) + xOf(r.m.container, r.ids.p3!) - left;
  const best = Math.min(...stops.map((s) => Math.abs(s - wanted)));
  assert.ok(Math.abs(rowOffsetOf(r.m.container) - wanted) <= best + 0.5, `the left edge is held: wanted ${wanted.toFixed(1)}, rests ${rowOffsetOf(r.m.container)}`);
});

test('a release that adds stops settles onto the stop at once, beside the margin glide', async () => {
  ensureMockTimers();
  const r = await mountRig(16, { window: 2932 });
  await frames(1500);
  assert.equal(stopsOf(r).length, 0, 'control: six slots fit the window, so nothing scrolls');
  const start = marginOf(r.m.container);
  assert.ok(start > 0, `control: a fitting row is centered (${start})`);
  const drag = await beginDrag(r, 'p1', SLOT(3, 16) - SLOT(1, 16) + 25);
  assert.equal(marginOf(r.m.container), start, 'the drag leaves the margin alone');
  act(() => {
    r.m.latest().setSlots(r.ids.p1!, 3);
    setters.get('p1')!.width(null);
    setters.get('p1')!.resizing(false);
  });
  assert.ok(stopsOf(r).length > 0, 'the release added stops');
  assert.ok(rowScrollerFor(r.m.container).glideTarget() !== null, 'the settle glide starts with the release');
  await frames(40);
  const mid = marginOf(r.m.container);
  assert.ok(mid > 0 && mid < start, `the margin is gliding 40 ms in: ${mid} of ${start}`);
  assert.ok(rowOffsetOf(r.m.container) > 0, 'the scroll glides beside the margin');
  act(() => mock.timers.tick(SLIDE_DURATION_SEC * 1000));
  await frames(1200);
  assert.equal(marginOf(r.m.container), r.m.latest().rowNumbers.rowMarginLeft);
  assertLanded(r, 'p1', drag, 'after the slide');
  assert.ok(rowOffsetOf(r.m.container) > 0, 'control: the settle did move the row');
});

const wheel = (r: Rig, deltaX: number): void => void act(() => void r.m.container.dispatchEvent(new WheelEvent('wheel', { deltaX, cancelable: true, bubbles: true })));
/** Moves the mocked setTimeout clock and the frame clock together. */
async function elapse(ms: number): Promise<void> {
  act(() => mock.timers.tick(ms));
  await frames(ms);
}
const SETTLE_WAIT_MS = SLIDE_DURATION_SEC * 1000;

/**
 * A 2932 px window where six slots fit, then the panel grown to three slots: the release adds one stop (0 and the row's end)
 * and moves the margin from 240 to 0, since an overflowing row sits flush. Two slots would still fit and add no stop.
 */
async function releaseMovingMargin(r: Rig, id = 'p1', pin: 'start' | 'end' = 'end'): Promise<Drag> {
  const drag = await beginDrag(r, id, SLOT(3, 16) - SLOT(1, 16) + 25, 4, 0, pin);
  act(() => {
    r.m.latest().setSlots(r.ids[id]!, 3);
    setters.get(id)!.width(null);
    setters.get(id)!.resizing(false);
  });
  return drag;
}

test('a wheel while the settle glides decides where the row rests', async () => {
  ensureMockTimers();
  const r = await mountRig(16, { window: 2932 });
  await frames(1500);
  assert.equal(stopsOf(r).length, 0, 'control: the row fits, so it has no stops before the release');
  await releaseMovingMargin(r);
  const stops = stopsOf(r);
  assert.equal(stops.length, 2, 'control: the release added a second stop');
  await elapse(100);
  wheel(r, 50);
  assert.equal(rowScrollerFor(r.m.container).glideTarget(), stops[1], 'control: the wheel steps to the far stop');
  await elapse(200);
  assert.ok(rowOffsetOf(r.m.container) > 0 && rowOffsetOf(r.m.container) < stops[1]!, `control: the row is mid-glide when the wheel reverses: ${rowOffsetOf(r.m.container)}`);
  wheel(r, -50);
  assert.equal(rowScrollerFor(r.m.container).glideTarget(), stops[0], 'control: the reversing wheel steps back to the first stop');
  await elapse(SETTLE_WAIT_MS + 1000);
  assert.equal(rowOffsetOf(r.m.container), stops[0], 'the row rests where the wheel put it');
  assert.equal(rowScrollerFor(r.m.container).glideTarget(), null);
});

test('a second release during the first one\'s glide settles for its own edge', async () => {
  ensureMockTimers();
  const r = await mountRig(16, { window: 2932 });
  await frames(1500);
  await releaseMovingMargin(r);
  await elapse(100);
  const drag = await releaseMovingMargin(r, 'p2');
  await elapse(SETTLE_WAIT_MS + 1000);
  assertLanded(r, 'p2', drag, 'after the second release');
  assert.equal(rowScrollerFor(r.m.container).glideTarget(), null);
});

test('unmounting while the settle glides leaves no further scroll', async () => {
  ensureMockTimers();
  const r = await mountRig(16, { window: 2932 });
  await frames(1500);
  const scroller = rowScrollerFor(r.m.container);
  const glides = mock.method(scroller, 'glideTo');
  await releaseMovingMargin(r);
  await frames(100);
  assert.equal(glides.mock.callCount(), 1, 'control: the release settled once');
  cleanup();
  act(() => mock.timers.tick(SETTLE_WAIT_MS + 100));
  assert.equal(glides.mock.callCount(), 1, 'the unmounted row is not scrolled again');
});

/** An arrow key as the window sees it. */
const key = (name: string): void => void act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })));
function dotsOf(r: Rig): PanelDots {
  const out: { dots?: PanelDots } = {};
  const Probe = (): React.ReactElement => {
    out.dots = usePanelDots({ rowNumbers: r.m.latest().rowNumbers, entries: [], scroller: { current: r.m.container }, tuning: r.m.latest().tuning });
    return React.createElement('i');
  };
  mount(React.createElement(Probe));
  return out.dots!;
}
/** What a person can do while the settle glides towards the far stop; each but a bare press asks for the first stop. */
const ASKS_FOR_FIRST_STOP: Record<string, (r: Rig) => void> = {
  'a left wheel': (r) => wheel(r, -50),
  'ArrowLeft': () => key('ArrowLeft'),
  'a click on the first dot': (r) => {
    const dots = dotsOf(r);
    act(() => dots.selectDot('root'));
  },
};
for (const [what, ask] of Object.entries(ASKS_FOR_FIRST_STOP)) {
  test(`${what} while the settle glides sends the row to the first stop`, async () => {
    ensureMockTimers();
    const r = await mountRig(16, { window: 2932 });
    await frames(1500);
    await releaseMovingMargin(r);
    const stops = stopsOf(r);
    assert.equal(stops.length, 2, 'control: the release added a second stop for the settle to head for');
    assert.equal(rowScrollerFor(r.m.container).glideTarget(), stops[1], 'control: the settle heads for the far stop');
    await elapse(50);
    ask(r);
    assert.equal(rowScrollerFor(r.m.container).glideTarget(), stops[0], 'the ask replaced the settle');
    await elapse(SETTLE_WAIT_MS + 1000);
    assert.equal(rowOffsetOf(r.m.container), stops[0], 'the row rests at the first stop');
    assert.equal(rowScrollerFor(r.m.container).glideTarget(), null);
  });
}

test('a press that moves nothing does not stop the settle', async () => {
  ensureMockTimers();
  const r = await mountRig(16, { window: 2932 });
  await frames(1500);
  await releaseMovingMargin(r);
  const stops = stopsOf(r);
  await elapse(50);
  act(() => void r.m.container.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
  await elapse(SETTLE_WAIT_MS + 1000);
  assert.equal(rowOffsetOf(r.m.container), stops[1], 'the row rests at the far stop the settle chose');
});

test('taking the oval while the settle glides keeps the row where it was taken', async () => {
  ensureMockTimers();
  const r = await mountRig(16, { window: 2932 });
  await frames(1500);
  await releaseMovingMargin(r);
  const stops = stopsOf(r);
  await elapse(100);
  const dots = dotsOf(r);
  let drag: ReturnType<PanelDots['startOvalDrag']> = null;
  act(() => void (drag = dots.startOvalDrag()));
  assert.ok(drag !== null, 'control: the oval was taken');
  const taken = rowOffsetOf(r.m.container);
  assert.ok(taken > 0 && taken < stops[1]!, `control: the settle was part way: ${taken} of ${stops[1]}`);
  assert.equal(rowScrollerFor(r.m.container).glideTarget(), null, 'the settle glide is over');
  await elapse(SETTLE_WAIT_MS + 1000);
  act(() => drag?.end());
  await elapse(SETTLE_WAIT_MS + 1000);
  assert.equal(rowOffsetOf(r.m.container), taken);
});

test('released at the start, a step to the far stop then a step the row refuses there leave the row at the far stop', async () => {
  ensureMockTimers();
  const r = await mountRig(16, { window: 2932 });
  await frames(1500);
  await releaseMovingMargin(r, 'p1', 'start');
  const stops = stopsOf(r);
  key('ArrowRight');
  assert.equal(rowScrollerFor(r.m.container).glideTarget(), stops[1], 'control: the step heads for the far stop');
  await elapse(300);
  key('ArrowRight');
  await elapse(SETTLE_WAIT_MS + 1000);
  assert.equal(rowOffsetOf(r.m.container), stops[1], 'the row rests at the far stop');
});

test('a scroll asked while the settle glides replaces it', async () => {
  ensureMockTimers();
  const r = await mountRig(16, { window: 2932 });
  await frames(1500);
  await releaseMovingMargin(r);
  await elapse(50);
  rowScrollerFor(r.m.container).glideTo(100, { durationSec: 0.5, instant: false, ease: 'linear' as never });
  await elapse(SETTLE_WAIT_MS + 1000);
  assert.equal(rowOffsetOf(r.m.container), 100);
});

test('a scroll that has already landed after the settle decides where the row rests', async () => {
  ensureMockTimers();
  const r = await mountRig(16, { window: 2932 });
  await frames(1500);
  await releaseMovingMargin(r);
  await elapse(100);
  act(() => void rowScrollerFor(r.m.container).glideTo(100, { durationSec: 0, instant: true, ease: 'linear' as never }));
  assert.equal(rowScrollerFor(r.m.container).glideTarget(), null, 'control: nothing is gliding');
  await elapse(SETTLE_WAIT_MS + 1000);
  assert.equal(rowOffsetOf(r.m.container), 100);
});

test('a later change to the stops does not scroll a row the settle has placed', async () => {
  ensureMockTimers();
  const r = await mountRig(16, { window: 2932 });
  await frames(1500);
  const drag = await releaseMovingMargin(r);
  await elapse(SETTLE_WAIT_MS + 1000);
  assertLanded(r, 'p1', drag, 'after the release');
  const placed = rowOffsetOf(r.m.container);
  const before = [...stopsOf(r)];
  act(() => void r.m.latest().setSlots(r.ids.p2!, 2));
  assert.ok(stopsOf(r).length > before.length, `the stops changed: ${before.join(',')} then ${stopsOf(r).join(',')}`);
  await elapse(SETTLE_WAIT_MS + 1000);
  assert.equal(rowScrollerFor(r.m.container).glideTarget(), null, 'nothing scrolls the row');
  assert.equal(rowOffsetOf(r.m.container), placed);
  assert.ok(placed > 0, 'control: the settle did move the row');
});

test('a row that fits again after the settle rests at the start', async () => {
  ensureMockTimers();
  const r = await mountRig(16, { window: 2932 });
  await frames(1500);
  await releaseMovingMargin(r);
  await elapse(100);
  act(() => void r.m.latest().setSlots(r.ids.p1!, 1));
  assert.equal(stopsOf(r).length, 0, 'control: the row fits again');
  await elapse(SETTLE_WAIT_MS + 1000);
  assert.equal(rowScrollerFor(r.m.container).glideTarget(), null);
  assert.equal(rowOffsetOf(r.m.container), 0);
});
