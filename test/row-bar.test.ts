/**
 * The dot bar as the row's ruler drawn small (rowBar.ts), pure: a dot is as many phone dashes as its panel is phones wide and sits at
 * its panel's place on the ruler, the oval is the window's span on the same ruler, and the property below holds that over generated rows.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOT_GAP_PX, DOT_PHONE_PX, barOf, centreScroll } from '../rowBar.js';
import { computeRowNumbers, maxScrollOf, type RowNumbers } from '../rowNumbers.js';
import type { WorkspaceRowEntry } from '../workspaceRow.js';

const SLOT = DOT_PHONE_PX + DOT_GAP_PX;
const PHONE = 390;
const GAP = 16;
const near = (a: number, b: number, what: string): void => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} vs ${b}`);
const entry = (id: string, o: object = {}): WorkspaceRowEntry => ({ id, ...o }) as unknown as WorkspaceRowEntry;

// Three phones 390 wide with a 16 gap, seen through 600: one slot is 406 strip px and 30 track px (a 22 dash and an 8 gap).
const numbers = (o: Partial<RowNumbers> = {}): RowNumbers => ({ rowScroll: true, windowWidth: 600, stripWidth: 1202, rowMarginLeft: 0, stripStart: 0, stripWindow: 600, leftInset: 0, rightInset: 0, held: [], stuck: [], endPad: 0, ids: ['a', 'b', 'c'], widths: [390, 390, 390], leftOffsets: [0, 406, 812], ...o }) as unknown as RowNumbers;
const abc = [entry('a'), entry('b'), entry('c')];
const row = { ids: ['a', 'b', 'c'], widths: [390, 390, 390], leftOffsets: [0, 406, 812], windowWidth: 600, maxScroll: 602 };

test('a dot is one phone dash per slot its panel spans, with one dot gap between dots, the odd one hollow', () => {
  const n = numbers({ widths: [390, 796, 390], leftOffsets: [0, 406, 1218] });
  const bar = barOf(n, [entry('a'), entry('b', { settings: { hollowDot: true } }), entry('c')], 0);
  assert.deepEqual(bar.dots.map((d) => d.width), [22, 52, 22]);
  assert.deepEqual(bar.dots.map((d) => d.left), [0, 30, 90]);
  assert.deepEqual(bar.dots.map((d) => d.hollow), [false, true, false]);
  assert.equal(bar.width, 112);
});

test('the oval keeps one width at every scroll, as many slots as the window holds, and moves with the scroll at one rate, a wide panel included', () => {
  const width = ((600 + GAP) / 406) * SLOT - DOT_GAP_PX;
  const n = numbers({ widths: [390, 796, 390], leftOffsets: [0, 406, 1218] });
  for (const s of [0, 100, 203, 405, 406, 500, 900]) {
    near(barOf(n, abc, s).oval.width, width, `width at ${s}`);
    near(barOf(n, abc, s).oval.left, (s * SLOT) / 406, `left at ${s}`);
  }
});

test('a row that fits, or whose window is not measured, shows the oval over the whole bar', () => {
  assert.deepEqual(barOf(numbers({ windowWidth: 2000 }), abc, 0).oval, { left: 0, width: 82 });
  assert.deepEqual(barOf(numbers({ windowWidth: Infinity }), abc, 0).oval, { left: 0, width: 82 });
});

test('the oval stops at the bar end even when the scroll would carry it past', () => {
  const bar = barOf(numbers(), abc, 5000);
  near(bar.oval.left + bar.oval.width, bar.width, 'right edge');
});

test('an empty row and a single panel lay out without a dot gap or a divide by zero', () => {
  const none = barOf(numbers({ ids: [], widths: [], leftOffsets: [], windowWidth: Infinity }), [], 0);
  assert.equal(none.width, 0);
  assert.deepEqual(none.dots, []);
  const one = barOf(numbers({ ids: ['a'], widths: [390], leftOffsets: [0] }), [entry('a', { settings: { hollowDot: true } })], 0);
  assert.deepEqual(one.dots, [{ id: 'a', left: 0, width: DOT_PHONE_PX, hollow: true, riding: false }]);
});

test('a click centres a 390 panel, as near as the row allows at either end', () => {
  assert.equal(centreScroll({ ...row, index: 1 }), 406 + 195 - 300);
  assert.equal(centreScroll({ ...row, index: 0 }), 0);
  assert.equal(centreScroll({ ...row, index: 2 }), 602);
});

test('a row that cannot scroll, or an unmeasured window, gives no centring target', () => {
  assert.equal(centreScroll({ ...row, index: 1, maxScroll: 0 }), null);
  assert.equal(centreScroll({ ...row, index: 1, windowWidth: Infinity }), null);
});

test('parked panels get dots at their places on the ruler, and the oval sits over the drawn dots', () => {
  const parked = (id: string, slots = 1, o: object = {}) => entry(id, { live: false, slots, ...o });
  const bar = barOf(numbers(), [parked('p0'), parked('p1', 2), ...abc, parked('p3', 1, { settings: { hollowDot: true } })], 0);
  assert.deepEqual(bar.dots.map((d) => d.id), ['p0', 'p1', 'a', 'b', 'c', 'p3']);
  assert.deepEqual(bar.dots.map((d) => d.left), [0, 30, 90, 120, 150, 180]);
  assert.equal(bar.dots[1]!.width, 52, 'a parked panel two phones wide draws a two-phone dot');
  assert.equal(bar.dots[5]!.hollow, true);
  assert.equal(bar.width, 202);
  near(bar.oval.left, 90, 'the oval sits over the drawn dots, past the parked ones on the left');
  assert.deepEqual([...bar.parked], ['p0', 'p1', 'p3']);
  assert.equal(barOf(numbers(), [entry('x', { live: false, marker: true }), entry('y', { live: false, settings: { revealOnScroll: 'never' } }), ...abc], 0).dots.length, 3, 'control: a marker and a panel that never reveals have no dot');
});

test('an always-shown panel the rest have moved away from rides the oval over the dots beneath it, and those dots keep their places', () => {
  const root = entry('a', { collapsible: false, settings: { hollowDot: true } });
  const parked = (id: string) => entry(id, { live: false });
  const bar = barOf(numbers(), [root, parked('p0'), parked('p1'), entry('b'), entry('c'), parked('p9')], 0);
  assert.deepEqual(Object.fromEntries(bar.dots.map((d) => [d.id, d.left])), { a: 60, p0: 30, p1: 60, b: 90, c: 120, p9: 150 });
  near(bar.oval.left, 60, 'the oval starts one slot before the first panel the row moves');
  assert.equal(bar.dots.find((d) => d.id === 'a')!.riding, true);
  assert.equal(bar.run.left, 90);
  assert.equal(barOf(numbers(), [root, entry('b'), entry('c')], 0).dots[0]!.riding, false, 'control: at its own place it rides nothing');
});

test('a parked panel inside a run of panels the row moves waits on the side a step reaches it from, so the oval stays one span', () => {
  const n = numbers({ ids: ['a', 'b', 'c', 'd'], widths: [390, 390, 390, 390], leftOffsets: [0, 406, 812, 1218] });
  const bar = barOf(n, [entry('a'), entry('x', { live: false }), entry('b'), entry('c'), entry('y', { live: false }), entry('d')], 0);
  assert.deepEqual(bar.dots.map((d) => d.id), ['x', 'a', 'b', 'c', 'd', 'y']);
});

// A plain generator, so a failure names its seed. The oracle below adds slots along the list and shares no code with rowBar.ts.
function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

interface Row { name: string; entries: WorkspaceRowEntry[]; n: RowNumbers; order: string[]; drawn: string[]; rider: string | null; side: 'left' | 'right' }

function generate(r: () => number): Row {
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const count = 3 + Math.floor(r() * 9);
  const slots = Array.from({ length: count }, () => pick([1, 1, 1, 2, 3]));
  const kind = pick(['scroll', 'held', 'heldRight', 'parked', 'parkedHeld', 'aside', 'passed'] as const);
  const fit = 3 + Math.floor(r() * 4);
  const containerWidth = fit * (PHONE + GAP) + 2 * GAP + Math.floor(r() * 300);
  const runLength = kind === 'scroll' || kind === 'held' || kind === 'heldRight' ? count : 2 + Math.floor(r() * (count - 1));
  const from = Math.floor(r() * (count - runLength + 1));
  slots[from] = 1;
  const live = (k: number): boolean => k >= from && k < from + runLength;
  const hold = kind === 'held' || kind === 'parkedHeld' ? 'left' : kind === 'heldRight' ? 'right' : undefined;
  const root = { id: 'root', slots: 1, live: kind !== 'aside', collapsible: false, settings: { overflow: 'scroll', ...(hold === undefined ? {} : { edgeHold: hold }) } };
  const rest = slots.map((s, k) => ({ id: `p${k}`, slots: s, live: live(k), collapsible: true, settings: { overflow: 'scroll' } }));
  const entries = [root, ...rest] as unknown as WorkspaceRowEntry[];
  const n = computeRowNumbers({ entries: entries as never, phoneWidth: PHONE, containerWidth, gap: GAP, wholePanels: true });
  const held = n.held[0];
  const order = entries.map((e) => e.id);
  if (held?.side === 'right') order.push(order.shift()!);
  const drawn = [...n.held.map((h) => h.id), ...n.ids];
  const rootDrawn = drawn.includes('root');
  const passed = rootDrawn && held === undefined && from > 0;
  return { name: `${kind} slots ${slots.join(',')} live ${from}+${runLength} in ${containerWidth}`, entries, n, order, drawn, rider: held?.id ?? (passed ? 'root' : null), side: held?.side ?? 'left' };
}

test('property: every dot is its panel on the ruler scaled and the oval is the window on it, in rows held, parked and stepped aside', () => {
  const kinds = new Set<string>();
  let rows = 0;
  let riders = 0;
  let scrolled = 0;
  for (let seed = 1; seed <= 3000; seed += 1) {
    const r = rng(seed);
    const row = generate(r);
    const { n, entries, order } = row;
    if (n.ids.length < 2) continue;
    const max = maxScrollOf(n);
    const scroll = n.stops.length > 1 && r() < 0.7 ? n.stops[Math.floor(r() * n.stops.length)]! + (r() < 0.5 ? r() * 200 : 0) : 0;
    const at = Math.min(scroll, max);
    const bar = barOf(n, entries, at);
    const slotsOf = (e: WorkspaceRowEntry): number => (e as unknown as { slots: number }).slots;
    const home = new Map<string, number>();
    let x = 0;
    for (const id of order) {
      home.set(id, x * SLOT);
      x += slotsOf(entries.find((e) => e.id === id)!);
    }
    const what = `seed ${seed}: ${row.name} at ${at}`;
    near(bar.width, x * SLOT - DOT_GAP_PX, `${what}: the bar is the ruler's length`);
    assert.equal(bar.dots.length, order.length, `${what}: every panel has a dot`);
    near(bar.scale, SLOT / (PHONE + GAP), `${what}: one slot of row is one slot of bar`);
    const firstRun = order.find((id) => id !== row.rider && row.drawn.includes(id))!;
    const riderSlots = row.rider !== null && row.side === 'left' ? slotsOf(entries.find((e) => e.id === row.rider)!) * SLOT : 0;
    const want = home.get(firstRun)! - riderSlots + at * bar.scale;
    const span = row.drawn.reduce((s, id) => s + slotsOf(entries.find((e) => e.id === id)!) * SLOT, -DOT_GAP_PX);
    near(bar.oval.left, Math.min(Math.max(want, 0), Math.max(0, bar.width - bar.oval.width)), `${what}: the oval is the window on the ruler`);
    assert.ok(bar.oval.width <= span + 1e-6, `${what}: the oval is no wider than the panels on screen`);
    for (const d of bar.dots) {
      const e = entries.find((p) => p.id === d.id)!;
      near(d.width, slotsOf(e) * SLOT - DOT_GAP_PX, `${what}: ${d.id}'s width`);
      assert.equal(d.riding, d.id === row.rider, `${what}: ${d.id} rides only as the held or passed panel`);
      if (d.id !== row.rider) near(d.left, home.get(d.id)!, `${what}: ${d.id} sits at its place on the ruler`);
      else if (row.side === 'left') near(d.left, Math.max(home.get(d.id)!, bar.oval.left), `${what}: the rider is at the oval's left`);
      else near(d.left + d.width, Math.min(home.get(d.id)! + d.width, bar.oval.left + bar.oval.width), `${what}: the rider is at the oval's right`);
      assert.equal(bar.parked.has(d.id), !row.drawn.includes(d.id), `${what}: ${d.id} is parked exactly when the row does not draw it`);
    }
    rows += 1;
    if (row.rider !== null) riders += 1;
    if (at > 0) scrolled += 1;
    kinds.add(row.name.split(' ')[0]!);
  }
  assert.deepEqual([...kinds].sort(), ['aside', 'held', 'heldRight', 'parked', 'parkedHeld', 'passed', 'scroll'], 'every kind of row was generated');
  assert.ok(rows > 1500 && riders > 300 && scrolled > 300, `the property saw enough: ${rows} rows, ${riders} with a rider, ${scrolled} scrolled`);
});
