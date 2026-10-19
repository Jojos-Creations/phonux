/**
 * Releasing a width drag that was pinned at its end (a left grabber): the panel's right edge goes back to where it sat when the
 * drag began, as near as a stop allows, and the row lands on the stop nearest that scroll. Real createWorkspace and PanelRow in
 * StrictMode with the app's call order; jsdom has no layout, so every slot's rect is rebuilt from the strip margin, the slot's
 * transform and width and the row's scroll, which is what a browser would report.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
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

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
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
const marginOf = (container: HTMLElement): number => Number.parseFloat(container.querySelector<HTMLElement>('[data-row-strip]')!.style.marginLeft || '0');
/** A slot's right edge in the row's own space: before the scroll is taken off and before the container's padding is added. */
const rowRight = (container: HTMLElement, id: string): number => marginOf(container) + xOf(container, id) + widthOf(container, id);
/** Where the slot's right edge is in the window. */
const screenRight = (container: HTMLElement, id: string): number => rowRight(container, id) - container.scrollLeft;
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
      return box(PAD + marginOf(container) + xOf(container, id) - container.scrollLeft, widthOf(container, id) - (id === report.id ? report.trim : 0));
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
  r.m.container.scrollLeft = to;
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
  const began = r.m.container.scrollLeft;
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
  await frames(1200);
}

/** What the row must have done: it rests on the stop nearest the scroll that holds `edge`, and says so. */
function assertLanded(r: Rig, id: string, drag: Drag, label: string): { wanted: number; landed: number } {
  const stops = stopsOf(r);
  const wanted = rowRight(r.m.container, r.ids[id]!) - drag.edge;
  const landed = r.m.container.scrollLeft;
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
        const atRelease = r.m.container.scrollLeft;
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
  const before = r.m.container.scrollLeft;
  act(() => {
    setters.get('p3')!.width(null);
    setters.get('p3')!.resizing(false);
  });
  await frames(1200);
  assert.equal(rowScrollerFor(r.m.container).claimHeld(), false, 'the row is let go a frame after the release');
  assert.ok(Math.abs(r.m.container.scrollLeft - before) < 1, `a drag back to the stored width leaves the row where it was: ${before} then ${r.m.container.scrollLeft}`);
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
    rowScrollerFor(r.m.container).glideTo(stops[2]!, { durationSec: 0.4, instant: false, ease: 'linear' as never });
    await frames(wait);
    const mid = r.m.container.scrollLeft;
    assert.ok(mid > stops[0]! + 5 && mid < stops[2]! - 5, `${wait} ms: the glide is under way: ${mid}`);
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
  assert.equal(stopsOf(r).length === 0 || r.m.container.scrollLeft === 0, true);
  const drag = await beginDrag(r, 'p3', 300);
  void drag;
  await release(r, 'p3', 2);
  assert.equal(r.m.container.scrollLeft, 0, 'the centred row stays at scroll 0');
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
  const began = r.m.container.scrollLeft;
  act(() => setters.get('p3')!.resizing(true));
  const left = marginOf(r.m.container) + xOf(r.m.container, r.ids.p3!) - r.m.container.scrollLeft;
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
  assert.ok(Math.abs(r.m.container.scrollLeft - wanted) <= best + 0.5, `the left edge is held: wanted ${wanted.toFixed(1)}, rests ${r.m.container.scrollLeft}`);
});

test('a release that adds stops glides the margin first and settles onto the stop once it has landed', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const r = await mountRig(16, { window: 2600 });
  await frames(1500);
  assert.equal(stopsOf(r).length, 0, 'control: six slots fit the window, so nothing scrolls');
  const start = marginOf(r.m.container);
  assert.ok(start > 0, `control: a fitting row is centred (${start})`);
  const drag = await beginDrag(r, 'p1', SLOT(2, 16) - SLOT(1, 16) + 25);
  assert.equal(marginOf(r.m.container), start, 'the drag leaves the margin alone');
  act(() => {
    r.m.latest().setSlots(r.ids.p1!, 2);
    setters.get('p1')!.width(null);
    setters.get('p1')!.resizing(false);
  });
  assert.ok(stopsOf(r).length > 0, 'the release added stops');
  await frames(40);
  const mid = marginOf(r.m.container);
  assert.ok(mid > 0 && mid < start, `the margin is gliding 40 ms in: ${mid} of ${start}`);
  assert.equal(r.m.container.scrollLeft, 0, 'the scroll waits for the margin');
  act(() => mock.timers.tick(SLIDE_DURATION_SEC * 1000));
  await frames(1200);
  assert.equal(marginOf(r.m.container), 0);
  assertLanded(r, 'p1', drag, 'after the slide');
  assert.ok(r.m.container.scrollLeft > 0, 'control: the settle did move the row');
});

const wheel = (r: Rig, deltaX: number): void => void act(() => void r.m.container.dispatchEvent(new WheelEvent('wheel', { deltaX, cancelable: true, bubbles: true })));
/** Moves the mocked setTimeout clock and the frame clock together. */
async function elapse(ms: number): Promise<void> {
  act(() => mock.timers.tick(ms));
  await frames(ms);
}
const SETTLE_WAIT_MS = SLIDE_DURATION_SEC * 1000;

/** A wide window where six slots fit, then p1 grown to two slots: the release adds stops and moves the centring margin, so the settle waits. */
async function releaseMovingMargin(r: Rig, id = 'p1', pin: 'start' | 'end' = 'end'): Promise<Drag> {
  const drag = await beginDrag(r, id, SLOT(2, 16) - SLOT(1, 16) + 25, 4, 0, pin);
  act(() => {
    r.m.latest().setSlots(r.ids[id]!, 2);
    setters.get(id)!.width(null);
    setters.get(id)!.resizing(false);
  });
  return drag;
}

test('a wheel during the wait for the margin decides where the row rests; the pending settle does not undo it', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const r = await mountRig(16, { window: 2600 });
  await frames(1500);
  assert.equal(stopsOf(r).length, 0, 'control: the row fits, so it has no stops before the release');
  await releaseMovingMargin(r);
  const stops = stopsOf(r);
  assert.equal(stops.length, 2, 'control: the release added a second stop');
  await elapse(100);
  wheel(r, 50);
  assert.equal(rowScrollerFor(r.m.container).glideTarget(), stops[1], 'control: the wheel steps to the far stop');
  await elapse(200);
  assert.ok(r.m.container.scrollLeft > 0 && r.m.container.scrollLeft < stops[1]!, `control: the row is mid-glide when the wheel reverses: ${r.m.container.scrollLeft}`);
  wheel(r, -50);
  assert.equal(rowScrollerFor(r.m.container).glideTarget(), stops[0], 'control: the reversing wheel steps back to the first stop');
  await elapse(SETTLE_WAIT_MS + 1000);
  assert.equal(r.m.container.scrollLeft, stops[0], 'the row rests where the wheel put it');
  assert.equal(rowScrollerFor(r.m.container).glideTarget(), null);
});

test('a second release re-arms the settle: the first release\'s pending timer is cleared', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const armed: unknown[] = [];
  const cleared: unknown[] = [];
  const mockedSet = globalThis.setTimeout;
  const mockedClear = globalThis.clearTimeout;
  mock.method(globalThis, 'setTimeout', ((fn: () => void, ms?: number, ...rest: unknown[]) => {
    const handle = (mockedSet as typeof setTimeout)(fn, ms, ...rest);
    if (ms === SETTLE_WAIT_MS) armed.push(handle);
    return handle;
  }) as typeof setTimeout);
  mock.method(globalThis, 'clearTimeout', ((handle?: Parameters<typeof clearTimeout>[0]) => {
    cleared.push(handle);
    return (mockedClear as typeof clearTimeout)(handle);
  }) as typeof clearTimeout);
  const r = await mountRig(16, { window: 2600 });
  await frames(1500);
  await releaseMovingMargin(r);
  assert.equal(armed.length, 1, 'control: the first release armed the settle');
  assert.ok(!cleared.includes(armed[0]), 'control: nothing has cleared it yet');
  await elapse(100);
  await releaseMovingMargin(r, 'p2');
  assert.ok(cleared.includes(armed[0]), 'the second release cleared the first release\'s timer before it settled');
});

test('unmounting during the wait for the margin cancels the settle', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const r = await mountRig(16, { window: 2600 });
  await frames(1500);
  const scroller = rowScrollerFor(r.m.container);
  const glides = mock.method(scroller, 'glideTo');
  await releaseMovingMargin(r);
  await frames(100);
  assert.equal(glides.mock.callCount(), 0, 'control: the settle is still waiting for the margin');
  cleanup();
  act(() => mock.timers.tick(SETTLE_WAIT_MS + 100));
  assert.equal(glides.mock.callCount(), 0, 'the unmounted row is not scrolled');
});

/** An arrow key as the window sees it. */
const key = (name: string): void => void act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })));
function dotsOf(r: Rig): PanelDots {
  const out: { dots?: PanelDots } = {};
  const Probe = (): React.ReactElement => {
    out.dots = usePanelDots({ rowNumbers: r.m.latest().rowNumbers, entries: [], scroller: { current: r.m.container } });
    return React.createElement('i');
  };
  mount(React.createElement(Probe));
  return out.dots!;
}
/** What a person can do to a row held at its first stop that moves nothing: each is still a choice. */
const REFUSED_AT_START: Record<string, (r: Rig) => void> = {
  'a left wheel': (r) => wheel(r, -50),
  'ArrowLeft': () => key('ArrowLeft'),
  'a press on the row': (r) => void act(() => void r.m.container.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))),
  'a click on the first dot': (r) => {
    const dots = dotsOf(r);
    act(() => dots.selectDot('root'));
  },
  'a press on the oval': (r) => {
    const dots = dotsOf(r);
    act(() => dots.startOvalDrag()?.end());
  },
};
for (const [what, ask] of Object.entries(REFUSED_AT_START)) {
  test(`${what} during the wait for the margin keeps the row at the first stop it was released on, though it moves nothing`, async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const r = await mountRig(16, { window: 2600 });
    await frames(1500);
    await releaseMovingMargin(r);
    const stops = stopsOf(r);
    assert.equal(stops.length, 2, 'control: the release added a second stop for the settle to head for');
    await elapse(250);
    assert.equal(r.m.container.scrollLeft, 0, 'control: the row is held at the first stop while the margin slides');
    ask(r);
    assert.equal(r.m.container.scrollLeft, 0, 'the ask moved nothing');
    await elapse(SETTLE_WAIT_MS + 1000);
    assert.equal(r.m.container.scrollLeft, stops[0], 'the row rests at the first stop');
    assert.equal(rowScrollerFor(r.m.container).glideTarget(), null);
  });
}

test('released at the start, a step to the far stop then a step the row refuses there leave the row at the far stop', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const r = await mountRig(16, { window: 2600 });
  await frames(1500);
  await releaseMovingMargin(r, 'p1', 'start');
  const stops = stopsOf(r);
  key('ArrowRight');
  assert.equal(rowScrollerFor(r.m.container).glideTarget(), stops[1], 'control: the step heads for the far stop');
  await elapse(300);
  key('ArrowRight');
  await elapse(SETTLE_WAIT_MS + 1000);
  assert.equal(r.m.container.scrollLeft, stops[1], 'the row rests at the far stop');
});

test('a scroll that is still gliding when the wait ends decides where the row rests, even before it has moved', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const r = await mountRig(16, { window: 2600 });
  await frames(1500);
  await releaseMovingMargin(r);
  await elapse(50);
  rowScrollerFor(r.m.container).glideTo(100, { durationSec: 0.5, instant: false, ease: 'linear' as never });
  act(() => mock.timers.tick(SETTLE_WAIT_MS));
  assert.equal(r.m.container.scrollLeft, 0, 'control: no frame has run, so the row has not moved');
  await frames(1500);
  assert.equal(r.m.container.scrollLeft, 100);
});

test('a scroll that has already landed when the wait ends decides where the row rests', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const r = await mountRig(16, { window: 2600 });
  await frames(1500);
  await releaseMovingMargin(r);
  await elapse(100);
  act(() => void rowScrollerFor(r.m.container).glideTo(100, { durationSec: 0, instant: true, ease: 'linear' as never }));
  assert.equal(rowScrollerFor(r.m.container).glideTarget(), null, 'control: nothing is gliding');
  await elapse(SETTLE_WAIT_MS + 1000);
  assert.equal(r.m.container.scrollLeft, 100);
});

test('the settle onto a stop uses the stops the row has when the wait ends', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const r = await mountRig(16, { window: 2600 });
  await frames(1500);
  const drag = await releaseMovingMargin(r);
  const before = [...stopsOf(r)];
  await elapse(100);
  act(() => void r.m.latest().setSlots(r.ids.p2!, 2));
  assert.equal(rowScrollerFor(r.m.container).glideTarget(), null, 'control: the change did not scroll the row');
  assert.ok(stopsOf(r).length > 0 && !stopsOf(r).includes(before[1]!), `the stops changed: ${before.join(',')} then ${stopsOf(r).join(',')}`);
  await elapse(SETTLE_WAIT_MS + 1000);
  assertLanded(r, 'p1', drag, 'after the stops changed');
  assert.ok(r.m.container.scrollLeft > 0, 'control: the settle did move the row');
});

test('a row that has no stops when the wait ends is not settled', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const r = await mountRig(16, { window: 2600 });
  await frames(1500);
  await releaseMovingMargin(r);
  await elapse(100);
  const glides = mock.method(rowScrollerFor(r.m.container), 'glideTo');
  act(() => void r.m.latest().setSlots(r.ids.p1!, 1));
  assert.equal(stopsOf(r).length, 0, 'control: the row fits again');
  await elapse(SETTLE_WAIT_MS + 1000);
  assert.equal(glides.mock.callCount(), 0);
  assert.equal(r.m.container.scrollLeft, 0);
});
