/**
 * A row that steps a slot at a time lands on a stop that draws the panel it was asked for whole, from every caller: the API's
 * scrollTo, a History click, a create, a pin, a close, a resize by slots and by window, and a scroll nobody steered.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { pinRig, type PinRig } from './support/pin-rig.js';
import { markerTemplate, rowScrollerFor, type ResizableWorkspace } from './support/workspace-row.js';

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

const SLOTS = { a: 2, b: 4, c: 1, d: 3, e: 1, f: 2 } as const;
const IDS = Object.keys(SLOTS);
const rig = (width = 1800, ids: readonly string[] = IDS) =>
  pinRig({
    ids,
    settings: Object.fromEntries(ids.map((id) => [id, { slots: SLOTS[id as keyof typeof SLOTS] ?? 1, maxSlots: 64 }])),
    width,
    workspace: { tuning: { rowGesture: 'step', shrinkOutOfView: 'visible' } },
  });

const wheel = async (r: PinRig, deltaX: number): Promise<void> => {
  act(() => void r.m.container.dispatchEvent(new WheelEvent('wheel', { deltaX, cancelable: true, bubbles: true })));
  await advanceFrames(520);
  act(() => void r.m.container.dispatchEvent(new Event('scroll')));
  mock.timers.tick?.(1000);
};
const stepTo = async (r: PinRig, stop: number): Promise<void> => {
  const limit = r.provided().rowNumbers.stops.length + 2;
  for (let tries = 0; r.provided().rowNumbers.atStop !== stop; tries++) {
    assert.ok(tries < limit, `stepping toward stop ${stop} is stuck on ${r.provided().rowNumbers.atStop}`);
    await wheel(r, r.provided().rowNumbers.atStop < stop ? 50 : -50);
  }
};
const settle = async (r: PinRig): Promise<void> => {
  await advanceFrames(520);
  act(() => void r.m.container.dispatchEvent(new Event('scroll')));
  mock.timers.tick?.(1000);
};

/** The panel `name` is drawn whole on the stop the row rests on, and the container is at that stop. */
function assertLanded(r: PinRig, name: string, why: string): void {
  const n = r.provided().rowNumbers;
  const k = n.ids.indexOf(r.entry(name).id);
  assert.ok(k >= 0, `${why}: ${name} is in the row`);
  const stop = n.atStop;
  const span = n.stopSpans[stop]!;
  assert.ok(k >= span.first && k < span.end, `${why}: ${name} is among the panels stop ${stop} shows (${span.first}..${span.end})`);
  assert.equal(n.drawnWidths[k], n.widths[k], `${why}: ${name} is drawn whole, not at ${n.drawnWidths[k]} of ${n.widths[k]}`);
  assert.ok(Math.abs(r.m.container.scrollLeft - n.stops[stop]!) < 1, `${why}: the container rests on the stop (${r.m.container.scrollLeft} vs ${n.stops[stop]})`);
}

test('scrollTo lands on a stop that draws the panel whole, from every stop and for every panel', async () => {
  const r = await rig();
  mock.timers.enable({ apis: ['setTimeout'] });
  const stops = r.provided().rowNumbers.stops.length;
  for (const from of [0, Math.floor(stops / 2), stops - 1]) {
    for (const name of ['root', ...IDS]) {
      await stepTo(r, from);
      const id = name === 'root' ? r.provided().rowNumbers.ids[0]! : r.entry(name).id;
      const before = r.provided().rowNumbers;
      const k = before.ids.indexOf(id);
      const wholeHere = k >= before.stopSpans[before.atStop]!.first && k < before.stopSpans[before.atStop]!.end && before.drawnWidths[k] === before.widths[k];
      act(() => void r.provided().scrollTo(id));
      await settle(r);
      assertLanded(r, name, `scrollTo ${name} from stop ${from}`);
      if (wholeHere) assert.equal(r.provided().rowNumbers.atStop, before.atStop, `scrollTo ${name}: it was whole where the row was, so the row stays on that stop`);
    }
  }
});

test('a History click (activate on the root) lands on a stop that draws History whole', async () => {
  const r = await rig();
  mock.timers.enable({ apis: ['setTimeout'] });
  await stepTo(r, r.provided().rowNumbers.stops.length - 1);
  act(() => void r.provided().activate('root'));
  await settle(r);
  assertLanded(r, 'root', 'activate root');
  assert.equal(r.provided().rowNumbers.atStop, 0);
});

test('a created panel lands whole: the row opens at a stop that draws it at its own width', async () => {
  const r = await pinRig({
    ids: ['a', 'b', 'c', 'd'],
    settings: { a: { slots: 2 }, b: { slots: 4 }, c: { slots: 1 }, d: { slots: 3 } },
    extra: [markerTemplate('z', { settings: { slots: 4, maxSlots: 64 } })],
    width: 1800,
    workspace: { tuning: { rowGesture: 'step', shrinkOutOfView: 'visible' } },
  });
  mock.timers.enable({ apis: ['setTimeout'] });
  await stepTo(r, 2);
  act(() => void r.ws.addPanel('z'));
  await settle(r);
  const n = r.provided().rowNumbers;
  const last = n.ids.length - 1;
  assert.equal(n.ids.length, 6, 'the panel was added');
  assert.equal(n.drawnWidths[last], n.widths[last], 'the new 4-slot panel is drawn whole');
  assert.equal(n.stopSpans[n.atStop]!.end, n.ids.length, 'at the end of the row');
  assert.ok(Math.abs(r.m.container.scrollLeft - n.stops[n.atStop]!) < 1);
});

test('a pin to the row start leaves the row on a stop of the new list, with the container on it', async () => {
  const r = await rig(1800, ['a', 'b', 'c', 'd']);
  mock.timers.enable({ apis: ['setTimeout'] });
  await stepTo(r, 3);
  act(() => void r.h.d!.pin());
  await settle(r);
  assert.equal(r.order()[0], 'd');
  const n = r.provided().rowNumbers;
  assert.ok(n.atStop >= 0 && n.atStop < n.stops.length, `the stop is in range (${n.atStop} of ${n.stops.length})`);
  assert.ok(Math.abs(r.m.container.scrollLeft - n.stops[n.atStop]!) < 1, 'the container is on it');
  act(() => void r.provided().scrollTo(r.entry('d').id));
  await settle(r);
  assertLanded(r, 'd', 'scrollTo the pinned d');
});

test('closing the panel the row rests on leaves a stop that exists and draws what it shows at the stop\'s sizes', async () => {
  const r = await rig(1800, ['a', 'b', 'c', 'd']);
  mock.timers.enable({ apis: ['setTimeout'] });
  const stops = r.provided().rowNumbers.stops.length;
  await stepTo(r, stops - 1);
  act(() => void r.h.d!.close());
  await settle(r);
  const n = r.provided().rowNumbers;
  assert.ok(n.atStop >= 0 && n.atStop < n.stops.length, `the stop is clamped into the new list (${n.atStop} of ${n.stops.length})`);
  assert.ok(Math.abs(r.m.container.scrollLeft - n.stops[n.atStop]!) < 1, 'the container rests on it');
});

test('a panel resized by slots lands whole where the row asks for it', async () => {
  const r = await rig(1800, ['a', 'b', 'c', 'd']);
  mock.timers.enable({ apis: ['setTimeout'] });
  await stepTo(r, 1);
  act(() => void r.provided().setSlots(r.entry('c').id, 3));
  await settle(r);
  const n = r.provided().rowNumbers;
  assert.ok(Math.abs(r.m.container.scrollLeft - n.stops[n.atStop]!) < 1, 'the container rests on the logical stop');
  assert.ok(n.atStop >= 0 && n.atStop < n.stops.length);
});

test('a window resize across a change in the slots it holds keeps the logical stop in range and the container on it', async () => {
  const r = await rig(1800, ['a', 'b', 'c', 'd']);
  mock.timers.enable({ apis: ['setTimeout'] });
  await stepTo(r, r.provided().rowNumbers.stops.length - 1);
  for (const width of [1280, 844, 1280, 1800]) {
    act(() => (r.m as ResizableWorkspace).setWidth(width));
    await settle(r);
    const n = r.provided().rowNumbers;
    assert.ok(n.atStop >= 0 && n.atStop < n.stops.length, `${width}: stop ${n.atStop} of ${n.stops.length}`);
    assert.ok(Math.abs(r.m.container.scrollLeft - n.stops[n.atStop]!) < 1, `${width}: the container is on stop ${n.atStop}`);
  }
});

test('a scroll nobody steered moves the logical stop to the nearest one, and among stops that share a position keeps the one it is on', async () => {
  const r = await rig(1800, ['a', 'b', 'c', 'd']);
  mock.timers.enable({ apis: ['setTimeout'] });
  const n0 = r.provided().rowNumbers;
  const shared = n0.stops.map((s, k) => n0.stops.indexOf(s) !== k || n0.stops.lastIndexOf(s) !== k).findIndex(Boolean);
  assert.ok(shared >= 0, 'the row has stops that share a position');
  for (let k = 0; k < n0.stops.length; k++) {
    await stepTo(r, k);
    const here = r.provided().rowNumbers;
    const scroller = rowScrollerFor(r.m.container);
    scroller.stop();
    // Nudged half a pixel off the stop and back: a browser's rounding, or a person's tiny drag.
    r.m.container.scrollLeft = here.stops[k]! + 0.4;
    act(() => void r.m.container.dispatchEvent(new Event('scroll')));
    assert.equal(r.provided().rowNumbers.atStop, k, `a nudge at stop ${k} stays on stop ${k}`);
  }
  // A scroll nobody steered that ends between two stops moves the stop number to the nearer one.
  await stepTo(r, 0);
  const stops = r.provided().rowNumbers.stops;
  rowScrollerFor(r.m.container).stop();
  r.m.container.scrollLeft = (stops[0]! + stops[1]!) / 2 + 20;
  act(() => void r.m.container.dispatchEvent(new Event('scroll')));
  const n = r.provided().rowNumbers;
  assert.equal(n.stops[n.atStop], stops[1], 'the stop is one at the nearer position');
});
