/**
 * usePanelResizing's setDrawnWidth on a mounted row (phone 390, gap 16, phone height 700): a width a host holds on the
 * panel it is resizing by hand. The panel, its size box and the panels after it follow the px on the same
 * frame; nothing the stops, capacity or the live set read ever sees it.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { stripMarginOf } from './support/strip.js';
import * as React from 'react';
import { act } from 'react';
import { MotionConfig } from 'motion/react';
import { PanelSizeBox, usePanelResizing } from '../index.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { made, mountRow, rootEntry, row } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';
import { slotTransform } from './support/strip.js';

type Setters = { resizing: (on: boolean) => void; width: (px: number | null, pin?: 'start' | 'end') => void; renders: number };
const setters = new Map<string, Setters>();
registerTestView('override-view', ({ panel }) => {
  const [, resizing, width] = usePanelResizing();
  const entry = setters.get(panel.id) ?? { resizing, width, renders: 0 };
  entry.resizing = resizing;
  entry.width = width;
  entry.renders += 1;
  setters.set(panel.id, entry);
  const size = panel.size!;
  return React.createElement(
    PanelSizeBox,
    { width: size.width, height: typeof size.height === 'number' ? size.height : 0, children: React.createElement('i', { 'data-slot': panel.id, 'data-width': String(size.width), 'data-height': String(size.height), 'data-drawn-slots': String(panel.drawnSlots) }) },
  );
});

afterEach(() => {
  mock.timers.reset();
  setters.clear();
  cleanup();
});

const SLOT = (n: number): number => n * 390 + (n - 1) * 16;
const slotOf = (container: HTMLElement, id: string): HTMLElement => container.querySelector<HTMLElement>(`[data-row-id="${id}"]`)!;
const xOf = (container: HTMLElement, id: string): number => Number(/translateX\((-?[\d.e+-]+)px\)/.exec(slotTransform(slotOf(container, id)))?.[1] ?? 0);
const widthOf = (container: HTMLElement, id: string): number => Number.parseFloat(slotOf(container, id).style.width);
const boxWidth = (container: HTMLElement, id: string): number => Number.parseFloat(slotOf(container, id).querySelector<HTMLElement>('[data-panel-size-box]')!.style.width);
const IDS = ['s1', 's2', 's3'];
const layout = (container: HTMLElement) => IDS.map((id) => ({ id, x: xOf(container, id), width: widthOf(container, id) }));

const entries = (slots: readonly number[] = [1, 2, 1], layer: Parameters<typeof made>[1] = {}) => row(rootEntry(), ...slots.map((n, k) => made(`s${k + 1}`, { slots: n, maxSlots: 64, ...layer }, { view: 'override-view' })));
const mountAt = (width: number, over: Parameters<typeof mountRow>[2] = {}, slots?: readonly number[], wrap?: (r: React.ReactElement) => React.ReactElement, layer?: Parameters<typeof made>[1]) =>
  mountRow(entries(slots, layer), width, { ...over, tuning: { rowGesture: 'step', ...over.tuning } }, wrap);
async function opened(width: number, over: Parameters<typeof mountRow>[2] = {}, slots?: readonly number[], wrap?: (r: React.ReactElement) => React.ReactElement, layer?: Parameters<typeof made>[1]): Promise<ReturnType<typeof mountRow>> {
  const m = mountAt(width, over, slots, wrap, layer);
  await advanceFrames(100);
  act(() => void m.container.dispatchEvent(new Event('scroll')));
  mock.timers.enable({ apis: ['setTimeout'] });
  return m;
}
/** One pointer move: the setter called and the frame it asks for run. */
async function drag(id: string, px: number | null, pin?: 'start' | 'end', ms = 20): Promise<void> {
  act(() => setters.get(id)!.width(px, pin));
  await advanceFrames(ms);
}

test('a panel drawn at a held width: its slot, size box and the panels after it follow on the same frame, with no glide', async () => {
  const m = await opened(1800);
  const before = layout(m.container);
  act(() => setters.get('s2')!.resizing(true));
  const seen: Array<{ px: number; width: number; box: number; x3: number; x2: number }> = [];
  for (const px of [500, 640, 770, 900, 1010]) {
    await drag('s2', px);
    seen.push({ px, width: widthOf(m.container, 's2'), box: boxWidth(m.container, 's2'), x3: xOf(m.container, 's3'), x2: xOf(m.container, 's2') });
  }
  assert.deepEqual(
    seen.map((s) => [s.width, s.box]),
    [500, 640, 770, 900, 1010].map((px) => [px, px]),
    'the slot and the size box are at the px each time',
  );
  assert.deepEqual(
    seen.map((s) => s.x2),
    seen.map(() => before[1]!.x),
    'its left edge stays where it was',
  );
  assert.deepEqual(
    seen.map((s) => s.x3),
    seen.map((s) => before[1]!.x + s.px + 16),
    'the panel after it sits one gap past its right edge, read from the transform each time',
  );
  await drag('s2', 1010);
  assert.equal(before[2]!.width, 390, 'the neighbour keeps its own width');
  assert.equal(widthOf(m.container, 's3'), 390);
});

const sizes = (container: HTMLElement) => IDS.map((id) => widthOf(container, id));

test('outside a row the setters do nothing and the mark reads false', () => {
  let seen: ReturnType<typeof usePanelResizing> | undefined;
  function Probe(): null {
    seen = usePanelResizing();
    return null;
  }
  mount(React.createElement(Probe));
  assert.equal(seen![0], false);
  act(() => {
    seen![1](true);
    seen![2](500, 'end');
    seen![2](null);
  });
  assert.equal(seen![0], false, 'setResizing(true) outside a row marks nothing');
});

test('a width is ignored for a panel that is not marked resizing, and a value that is not a finite number is ignored', async () => {
  const m = await opened(1800);
  const stored = sizes(m.container);
  await drag('s2', 700);
  assert.deepEqual(sizes(m.container), stored, 'before setResizing(true) nothing is drawn');
  act(() => setters.get('s2')!.resizing(true));
  await drag('s2', 700);
  assert.equal(widthOf(m.container, 's2'), 700);
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -5]) {
    await drag('s2', bad);
    assert.equal(widthOf(m.container, 's2'), 700, `${bad} leaves the width where it was`);
  }
  await drag('s1', 900);
  assert.equal(widthOf(m.container, 's1'), 390, 'a panel other than the marked one is never drawn at a held width');
});

test('the width is held to one slot at the least and the most that fit at the most; the stored slots are never written', async () => {
  const m = await opened(1800);
  const stored = m.latest().entries.map((p) => [p.id, p.slots]);
  act(() => setters.get('s2')!.resizing(true));
  await drag('s2', 100);
  assert.equal(widthOf(m.container, 's2'), SLOT(1), 'below one slot reads one slot');
  await drag('s2', 0);
  assert.equal(widthOf(m.container, 's2'), SLOT(1), 'zero too');
  await drag('s2', 9000);
  assert.equal(widthOf(m.container, 's2'), SLOT(3), 'above the cap reads what fits: History keeps one of the four slots in a 1768 px window');
  await drag('s2', null);
  act(() => setters.get('s2')!.resizing(false));
  await advanceFrames(600);
  assert.equal(widthOf(m.container, 's2'), SLOT(2), 'cleared, the panel is back at its stored width');
  assert.deepEqual(
    m.latest().entries.map((p) => [p.id, p.slots]),
    stored,
    'no slot count was written',
  );
});

test("the panel's own maxSlots is the cap when it is lower than what fits", async () => {
  const m = await opened(1800, {}, undefined);
  void m;
  cleanup();
  const narrow = mountRow(row(rootEntry(), made('s1', { slots: 1, maxSlots: 2 }, { view: 'override-view' })), 1800);
  await advanceFrames(100);
  act(() => setters.get('s1')!.resizing(true));
  await drag('s1', 9000);
  assert.equal(widthOf(narrow.container, 's1'), SLOT(2));
});

test('a held width reaches the live set and the row numbers nowhere: with a cap set, a drag across the whole range parks and returns nothing', async () => {
  const m = await opened(1800, { tuning: { maxLivePanels: 2 } }, [1, 1, 1], undefined, { overflow: 'park' });
  const live = m.live();
  assert.equal(live.length, 2, 'the cap parked one of the three');
  const id = live[1]!;
  const numbers = m.latest().rowNumbers;
  const stops = numbers.stops;
  act(() => setters.get(id)!.resizing(true));
  for (const px of [390, 500, 700, 900, 1200, 9000, 400]) {
    await drag(id, px);
    assert.deepEqual(m.live(), live, `at ${px}`);
    assert.equal(m.latest().rowNumbers, numbers, `the row numbers are the same object at ${px}`);
    assert.equal(m.latest().rowNumbers.stops, stops);
  }
  await drag(id, null);
  act(() => setters.get(id)!.resizing(false));
  await advanceFrames(600);
  assert.deepEqual(m.live(), live, 'and after the release');
});

test('pinned at the end, the panel keeps its right edge and everything after it, and the panels before it make room', async () => {
  const m = await opened(1800, {}, [1, 1, 1]);
  const before = layout(m.container);
  const rightEdge = before[1]!.x + before[1]!.width;
  const history = xOf(m.container, 'root');
  act(() => setters.get('s2')!.resizing(true));
  for (const px of [450, 520, 640, 800, 1000]) {
    await drag('s2', px, 'end');
    const grown = px - 390;
    assert.equal(xOf(m.container, 's2') + widthOf(m.container, 's2'), rightEdge, `the right edge at ${px}`);
    assert.equal(xOf(m.container, 's3'), before[2]!.x, `the panel after it at ${px}`);
    assert.equal(xOf(m.container, 's1'), before[0]!.x - grown, `the panel before it at ${px}`);
    assert.equal(xOf(m.container, 'root'), history - grown, `History at ${px}`);
    assert.equal(m.container.scrollLeft, 0, 'the row does not scroll');
  }
});

test('a width on the start edge keeps the left edge, in a centred row and in a scrolling one', async () => {
  for (const slots of [[1, 1, 1], [1, 2, 1]] as const) {
    const m = await opened(1800, {}, slots);
    const before = layout(m.container);
    const left = m.container.scrollLeft;
    act(() => setters.get('s2')!.resizing(true));
    for (const px of [450, 600, 800]) {
      await drag('s2', px);
      assert.equal(xOf(m.container, 's2'), before[1]!.x, `${slots.join(',')}: left edge at ${px}`);
      assert.equal(m.container.scrollLeft, left, `${slots.join(',')}: the row did not scroll`);
    }
    mock.timers.reset();
    cleanup();
    setters.clear();
  }
});

test('one render per animation frame: calls within a frame draw once, with the last value', async () => {
  const m = await opened(1800);
  act(() => setters.get('s2')!.resizing(true));
  await drag('s2', 500);
  const one = setters.get('s2')!.renders;
  await drag('s2', 520);
  const single = setters.get('s2')!.renders - one;
  const asked: number[] = [];
  const request = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => {
    asked.push(1);
    return request(cb);
  };
  act(() => {
    for (const px of [600, 640, 700, 760, 820]) setters.get('s2')!.width(px);
  });
  globalThis.requestAnimationFrame = request;
  assert.equal(asked.length, 1, 'five calls in a frame ask for one frame');
  const before = setters.get('s2')!.renders;
  await advanceFrames(20);
  assert.equal(widthOf(m.container, 's2'), 820, 'the last value won');
  assert.equal(setters.get('s2')!.renders - before, single, 'five calls cost what one costs');
});

test('setResizing(false) with a width still held clears it; the panel closing during the drag drops the hold', async () => {
  const m = await opened(1800);
  const stored = sizes(m.container);
  act(() => setters.get('s2')!.resizing(true));
  await drag('s2', 800);
  act(() => setters.get('s2')!.resizing(false));
  await advanceFrames(600);
  assert.deepEqual(sizes(m.container), stored, 'no stale width is left');
  act(() => setters.get('s2')!.resizing(true));
  await drag('s2', 800);
  act(() => m.latest().close('s2'));
  await advanceFrames(600);
  await drag('s3', 900);
  assert.equal(widthOf(m.container, 's3'), 390, 'the mark went with the panel: a width for another panel is ignored');
  assert.equal(m.container.querySelector('[data-row-id="s2"]'), null);
  assert.equal(m.scroller.claimHeld(), false, 'the row is not left held for a drag whose panel is gone');
});

test('two drags in a row, the second beginning while the first release glide runs, start from the stored widths', async () => {
  const m = await opened(1800);
  const stored = sizes(m.container);
  act(() => setters.get('s2')!.resizing(true));
  await drag('s2', 900);
  act(() => {
    m.latest().setSlots('s2', 2);
    setters.get('s2')!.width(null);
    setters.get('s2')!.resizing(false);
  });
  await advanceFrames(20);
  act(() => setters.get('s1')!.resizing(true));
  await drag('s1', 700);
  assert.equal(widthOf(m.container, 's1'), 700);
  assert.equal(widthOf(m.container, 's2'), stored[1], 'the first drag left nothing behind: the panel next door keeps its stored width');
  assert.equal(widthOf(m.container, 's3'), stored[2]);
});

test("the hold: other panels, the row's scroll and its stop list never see the width (at each of three stops)", async () => {
  const m = await opened(1800, {}, [2, 4, 1, 3]);
  for (const stop of [0, 1, 2]) {
    if (stop > 0) {
      m.wheel({ deltaX: 50 });
      await advanceFrames(600);
      act(() => void m.container.dispatchEvent(new Event('scroll')));
    }
    const marked = IDS[stop]!;
    const others = IDS.concat(['s4']).filter((id) => id !== marked && slotOf(m.container, id) !== null);
    const widths = others.map((id) => widthOf(m.container, id));
    const left = m.container.scrollLeft;
    const numbers = m.latest().rowNumbers;
    act(() => setters.get(marked)!.resizing(true));
    for (const px of [500, 900, 1300]) {
      await drag(marked, px);
      assert.deepEqual(
        others.map((id) => widthOf(m.container, id)),
        widths,
        `stop ${stop} at ${px}: no other panel changed`,
      );
      assert.equal(m.container.scrollLeft, left, `stop ${stop}: the row did not scroll`);
      assert.equal(m.latest().rowNumbers, numbers, `stop ${stop}: the numbers are untouched`);
    }
    await drag(marked, null);
    act(() => setters.get(marked)!.resizing(false));
    await advanceFrames(600);
    act(() => void m.container.dispatchEvent(new Event('scroll')));
  }
});

const stripOf = (container: HTMLElement): HTMLElement => container.querySelector<HTMLElement>('[data-row-strip]')!;
const marginOf = (container: HTMLElement): number => stripMarginOf(container);
/** Where a slot's left and right edges sit in the window: the strip's margin, the slot's drawn x and width, less the row's scroll. */
const edges = (container: HTMLElement, id: string): { left: number; right: number } => {
  const left = marginOf(container) + xOf(container, id) - container.scrollLeft;
  return { left, right: left + widthOf(container, id) };
};
const FRAME = 16;
async function frames(count: number, read: () => number[]): Promise<number[][]> {
  const out: number[][] = [read()];
  for (let k = 0; k < count; k += 1) {
    await advanceFrames(FRAME);
    out.push(read());
  }
  return out;
}
const monotone = (values: readonly number[]): boolean => values.every((v, k) => k === 0 || v >= values[k - 1]! - 1e-6) || values.every((v, k) => k === 0 || v <= values[k - 1]! + 1e-6);

test('the release: setSlots(nearest), then null, then the mark off, glides every edge from the held width to the stored one with no frame in between and no reversal', async () => {
  const m = await opened(2200, {}, [1, 1, 1]);
  act(() => setters.get('s2')!.resizing(true));
  await drag('s2', 700);
  const held = edges(m.container, 's3').left;
  act(() => {
    m.latest().setSlots('s2', 2);
    setters.get('s2')!.width(null);
    setters.get('s2')!.resizing(false);
  });
  assert.equal(widthOf(m.container, 's2'), SLOT(2), 'the slot is at the stored width at once');
  const trace = await frames(40, () => [edges(m.container, 's3').left, m.container.scrollLeft]);
  const s3 = trace.map((t) => t[0]!);
  assert.ok(monotone(s3), `the next panel's left edge moves one way: ${s3.map((v) => v.toFixed(1)).join(' ')}`);
  assert.ok(Math.abs(s3[0]! - held) < 1, 'it starts from where the drag left it, not from a third place');
  assert.ok(Math.abs(s3.at(-1)! - s3.at(-2)!) < 0.01, 'and comes to rest');
  assert.ok(monotone(trace.map((t) => t[1]!)), 'the row scroll never reverses');
});

test('the release in a scrolling row: the scroll glide to the nearest stop and the width glide both end and neither reverses', async () => {
  const m = await opened(1800, {}, [1, 2, 1]);
  act(() => setters.get('s2')!.resizing(true));
  await drag('s2', 1100);
  const before = m.container.scrollLeft;
  act(() => {
    m.latest().setSlots('s2', 3);
    setters.get('s2')!.width(null);
    setters.get('s2')!.resizing(false);
  });
  const trace = await frames(60, () => [edges(m.container, 's3').left, edges(m.container, 's2').left, m.container.scrollLeft]);
  for (const [k, name] of ['the next panel', 'the resized panel', 'the scroll'].entries()) {
    const series = trace.map((t) => t[k]!);
    assert.ok(monotone(series), `${name} moves one way: ${series.map((v) => v.toFixed(1)).join(' ')}`);
  }
  const stops = m.latest().rowNumbers.stops;
  assert.ok(stops.some((stop) => Math.abs(stop - m.container.scrollLeft) < 1), `the row ends on a stop: ${m.container.scrollLeft} in ${stops.join(',')} (${trace.map((t) => t[2]!.toFixed(0)).join(' ')})`);
  void before;
});

test('under Reduce Motion the release is one frame', async () => {
  const m = await opened(2200, {}, [1, 1, 1], (r) => React.createElement(MotionConfig, { reducedMotion: 'always' }, r));
  act(() => setters.get('s2')!.resizing(true));
  await drag('s2', 700);
  act(() => {
    m.latest().setSlots('s2', 2);
    setters.get('s2')!.width(null);
    setters.get('s2')!.resizing(false);
  });
  await advanceFrames(FRAME);
  const settled = edges(m.container, 's3').left;
  await advanceFrames(400);
  assert.ok(Math.abs(edges(m.container, 's3').left - settled) < 0.01, `nothing moves after the first frame: ${settled} then ${edges(m.container, 's3').left}`);
});

test('the grabber stays under the pointer: the held edge does not move on screen and the other edge is exactly the width away, centred row and scrolling row, either pin', async () => {
  for (const [slots, stepToStop] of [[[1, 1, 1], 0], [[1, 2, 1], 1]] as const) {
    for (const pin of ['start', 'end'] as const) {
      const m = await opened(1800, {}, slots);
      await advanceFrames(1500);
      for (let k = 0; k < stepToStop; k += 1) {
        m.wheel({ deltaX: 50 });
        await advanceFrames(600);
        act(() => void m.container.dispatchEvent(new Event('scroll')));
      }
      const start = edges(m.container, 's2');
      const margin = marginOf(m.container);
      const scroll = m.container.scrollLeft;
      act(() => setters.get('s2')!.resizing(true));
      for (const px of [430, 520, 640, 800, 1000]) {
        await drag('s2', px, pin);
        const now = edges(m.container, 's2');
        assert.equal(marginOf(m.container), margin, `${slots.join(',')} ${pin}: the centring margin is held`);
        assert.equal(m.container.scrollLeft, scroll, `${slots.join(',')} ${pin}: no scroll`);
        if (pin === 'start') {
          assert.equal(now.left, start.left, `${slots.join(',')} start at ${px}: the left edge is where it was`);
          assert.equal(now.right - start.left, px, `${slots.join(',')} start at ${px}: the right edge is exactly the pointer's width away`);
        } else {
          assert.equal(now.right, start.right, `${slots.join(',')} end at ${px}: the right edge is where it was`);
          assert.equal(now.right - now.left, px, `${slots.join(',')} end at ${px}: the left edge is exactly the pointer's width away`);
        }
      }
      mock.timers.reset();
      cleanup();
      setters.clear();
    }
  }
});

test('the strip a pinned width leaves is as long as before; a start-pinned one grows by the width', async () => {
  const m = await opened(1800, {}, [1, 1, 1]);
  const boxOf = () => Number.parseFloat(getComputedStyle(slotOf(m.container, 's2').parentElement!).width);
  const rest = boxOf();
  act(() => setters.get('s2')!.resizing(true));
  await drag('s2', 800, 'end');
  assert.equal(boxOf(), rest, 'pinned at the end the row box keeps its length');
  await drag('s2', 800, 'start');
  assert.equal(boxOf(), rest + 800 - 390, 'pinned at the start it grows by the growth');
});

test('a width narrower than the stored one never shortens the row box, so the browser cannot clamp the scroll under the pointer', async () => {
  const m = await opened(1800, {}, [1, 3, 1]);
  const boxOf = () => Number.parseFloat(getComputedStyle(slotOf(m.container, 's2').parentElement!).width);
  const rest = boxOf();
  act(() => setters.get('s2')!.resizing(true));
  for (const pin of ['start', 'end'] as const) {
    await drag('s2', 500, pin);
    assert.equal(boxOf(), rest, `${pin}: narrower than stored, the box keeps its length`);
  }
  await drag('s2', null);
  assert.equal(boxOf(), rest, 'and cleared, with the stored width unchanged, it is the same length');
});
