/**
 * A stepping row under tuning.shrinkOutOfView 'visible' moves one slot at a time: every panel steps through every size on its way
 * in and out. The pure arithmetic against a unit-window reference written independently of rowNumbers.ts, then the stability of
 * the strip between stops and what 'off' and 'hidden' keep.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { resolvePanelSettings } from '../index.js';
import type { PanelWindow } from '../index.js';
import { applyTemplate } from '../panelSettings.js';
import { appendPanel, createHistoryPanel } from '../panelWindow.js';
import { computeRowNumbers, fadeAt, maxScrollOf, nearestStopIndex, snapToStop, type RowNumbers } from '../rowNumbers.js';
import { slotWidth } from '../rowConstants.js';

const ROOT = 'root';
const PHONE = 390;
type Mode = 'off' | 'visible' | 'hidden';
/** A panel with this many slots, or a hand-built entry that cannot be drawn smaller, at this width. */
type Item = number | { width: number };

const made = (id: string, slots: number): PanelWindow => {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'v' }, id, ROOT)[0]!;
  return applyTemplate(skeleton, resolvePanelSettings({ template: { overflow: 'scroll', slots, maxSlots: 64 } as never }).value, 'create');
};
const slotless = (id: string, width: number): PanelWindow => {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'v' }, id, ROOT)[0]!;
  const formFactor = width === PHONE ? 'phone' : 'desktop';
  return { ...skeleton, collapsible: true, live: true, formFactor, size: { formFactor, width, height: 700 }, settings: { overflow: 'scroll' } as never };
};
const history = (): PanelWindow => applyTemplate({ ...createHistoryPanel(ROOT), view: 'v' }, resolvePanelSettings({ template: { title: 'History', overflow: 'scroll' } as never }, { root: true }).value, 'create');
const row = (items: readonly Item[]): PanelWindow[] => items.map((it, k) => (typeof it === 'number' ? made(`p${k}`, it) : slotless(`p${k}`, it.width)));
const numbers = (entries: PanelWindow[], container: number, gap: number, shrink: Mode, atFirst = 0): RowNumbers =>
  computeRowNumbers({ entries, phoneWidth: PHONE, containerWidth: container, gap, wholePanels: true, shrink, atFirst });
const sw = (n: number, gap: number): number => n * PHONE + (n - 1) * gap;

interface RefStop { from: number; start: number; end: number; margin: number; units: number[] }
interface Ref { window: number; fit: number; natural: number[]; offsets: number[]; strip: number; stops: RefStop[]; rowMargin: number; endPad: number; positions: number[]; kept: number[] }

/** Every window of consecutive slot units that fits, from the unit grid alone: the independent reference. */
function reference(items: readonly Item[], container: number, gap: number): Ref {
  const window = container - 2 * gap;
  const fit = Math.max(1, Math.floor((window + gap) / (PHONE + gap)));
  const grid: { panel: number; width: number }[] = [];
  const natural = items.map((it, panel) => {
    if (typeof it !== 'number') {
      grid.push({ panel, width: it.width });
      return it.width;
    }
    const n = Math.min(it, fit);
    for (let k = 0; k < n; k++) grid.push({ panel, width: PHONE });
    return sw(n, gap);
  });
  const offsets = natural.map((_, p) => natural.slice(0, p).reduce((s, w) => s + w + gap, 0));
  const strip = natural.reduce((s, w) => s + w, 0) + (natural.length - 1) * gap;
  const stops: RefStop[] = [];
  for (let from = 0; from < grid.length; from++) {
    let to = from;
    let used = grid[from]!.width;
    while (to + 1 < grid.length && used + gap + grid[to + 1]!.width <= window) used += gap + grid[++to]!.width;
    const units = items.map(() => 0);
    for (let g = from; g <= to; g++) units[grid[g]!.panel]!++;
    stops.push({ from, start: grid[from]!.panel, end: grid[to]!.panel + 1, margin: Math.max(0, (window - used) / 2), units });
    if (to === grid.length - 1) break;
  }
  const rowMargin = stops.reduce((m, s) => Math.max(m, s.margin - offsets[s.start]!), 0);
  const drawnShort = (s: RefStop): number => s.units.reduce((sum, u, p) => (typeof items[p] === 'number' && u > 0 && u < Math.min(items[p] as number, fit) ? sum + natural[p]! - sw(u, gap) : sum), 0);
  const reach = Math.max(...stops.map((s) => offsets[s.start]! - s.margin + window - strip));
  const endPad = Math.max(0, reach + Math.max(...stops.map(drawnShort)));
  const positions: number[] = [];
  const kept: number[] = [];
  stops.forEach((s, k) => {
    const at = rowMargin + offsets[s.start]! - s.margin;
    if (positions.length > 0 && at < positions[positions.length - 1]!) return;
    positions.push(at);
    kept.push(k);
  });
  return { window, fit, natural, offsets, strip, stops, rowMargin, endPad, positions, kept };
}


/** `numbers` at every stop of the row: element k is the row as drawn on stop k. */
function walk(items: readonly Item[], container: number, gap: number, shrink: Mode = 'visible'): RowNumbers[] {
  const entries = row(items);
  const base = numbers(entries, container, gap, shrink);
  return base.stopFirsts.map((first) => numbers(entries, container, gap, shrink, first));
}
/** The width the reference draws panel `p` at on a stop, or null when the stop does not show it. */
function drawnBy(ref: Ref, items: readonly Item[], gap: number, stop: RefStop, p: number): number | null {
  const it = items[p]!;
  const units = stop.units[p]!;
  if (units === 0) return null;
  return typeof it === 'number' ? sw(units, gap) : it.width;
}

const TABLES: { gap: number; container: number; items: Item[] }[] = [];
for (const [gap, containers] of [[16, [1800, 1280, 844]], [24, [1800, 1280, 844]]] as const) {
  for (const container of containers) {
    for (const items of [[1, 4, 1, 2], [1, 1, 4, 1], [2, 4, 1, 1], [1, 2, 4, 1, 3], [6, 1, 2, 1, 64], [1, { width: 600 }, 2, 1], [{ width: 600 }, 3, 1, { width: 600 }]] as Item[][]) {
      TABLES.push({ gap, container, items });
    }
  }
}
const label = (t: { gap: number; container: number; items: Item[] }): string => `${t.items.map((i) => (typeof i === 'number' ? i : `w${i.width}`)).join(',')} @${t.container}/${t.gap}`;

test('worked table, [1,4,1,2] at 1768 (gap 16): 5 stops, the 4-slot panel drawn 3, 4, 3, 2, 1, one constant margin and the stated end pad', () => {
  const stops = walk([1, 4, 1, 2], 1800, 16);
  const n = stops[0]!;
  assert.equal(n.stops.length, 5);
  assert.equal(n.rowMarginLeft, 80, 'every window holds four slots: 1768 less 1608 is 160, 80 each side');
  assert.deepEqual(n.stops, [0, 406, 406, 406, 406], 'the scroll moves once, off the first panel; the other steps only redraw');
  assert.equal(n.endPad, 80, 'the strip drawn on the last stop is 1218 shorter than the whole one: 406 - 80 + 1768 - 3232 + 1218');
  assert.deepEqual(n.stopFirsts, [0, 1, 2, 3, 4]);
  assert.deepEqual(stops.map((s, k) => s.drawnWidths.map((w, p) => (p >= s.stopSpans[k]!.first && p < s.stopSpans[k]!.end ? Math.round((w + 16) / 406) : 0))), [
    [1, 3, 0, 0],
    [0, 4, 0, 0],
    [0, 3, 1, 0],
    [0, 2, 1, 1],
    [0, 1, 1, 2],
  ]);
  assert.deepEqual(stops.map((s, k) => s.stopShrinks[k]), [
    [{ index: 1, slots: 3 }],
    [],
    [{ index: 1, slots: 3 }],
    [{ index: 1, slots: 2 }, { index: 3, slots: 1 }],
    [{ index: 1, slots: 1 }],
  ]);
});

test('every table row matches the unit-window reference: drawn widths, shown panels, stop count and positions, endPad and the one margin', () => {
  for (const t of TABLES) {
    const ref = reference(t.items, t.container, t.gap);
    const at = walk(t.items, t.container, t.gap);
    const base = at[0]!;
    assert.equal(base.stops.length, ref.kept.length, `${label(t)}: stop count`);
    assert.equal(base.rowMarginLeft, ref.rowMargin, `${label(t)}: margin`);
    assert.equal(base.endPad, ref.endPad, `${label(t)}: endPad`);
    assert.deepEqual(base.stops, ref.positions, `${label(t)}: positions`);
    for (const [k, r] of ref.kept.map((j) => ref.stops[j]!).entries()) {
      const n = at[k]!;
      assert.deepEqual(n.stopSpans[k], { first: r.start, end: r.end }, `${label(t)}: stop ${k} shown`);
      for (let p = 0; p < t.items.length; p++) {
        const want = drawnBy(ref, t.items, t.gap, r, p);
        if (want !== null) assert.equal(n.drawnWidths[p], want, `${label(t)}: stop ${k} panel ${p}`);
        else assert.equal(n.drawnWidths[p], n.widths[p], `${label(t)}: stop ${k} panel ${p} is not shown and keeps its own width`);
      }
    }
  }
});

test('every panel steps through every size: in 1, 2, ... its own width, out its own width, ... 2, 1, never a size skipped, and the same walking back', () => {
  for (const t of TABLES.filter((x) => x.items.every((i) => typeof i === 'number'))) {
    const ref = reference(t.items, t.container, t.gap);
    for (let p = 0; p < t.items.length; p++) {
      const seen = ref.stops.map((s) => s.units[p]!);
      const shown = seen.filter((u) => u > 0);
      const own = Math.min(t.items[p] as number, ref.fit);
      for (let k = 1; k < shown.length; k++) assert.ok(Math.abs(shown[k]! - shown[k - 1]!) <= 1, `${label(t)} panel ${p}: ${seen.join(',')} skips a size`);
      const firstShown = seen.findIndex((u) => u > 0);
      if (firstShown > 0) assert.equal(seen[firstShown], 1, `${label(t)} panel ${p}: arrives at 1 slot (${seen.join(',')})`);
      const lastShown = seen.length - 1 - [...seen].reverse().findIndex((u) => u > 0);
      if (lastShown < seen.length - 1) assert.equal(seen[lastShown], 1, `${label(t)} panel ${p}: leaves from 1 slot (${seen.join(',')})`);
      assert.ok(Math.max(...seen) <= own);
    }
  }
});

test('a step moves the window one slot: the panel at its left edge gives up a slot or leaves and the one at its right edge takes one or arrives', () => {
  for (const t of TABLES.filter((x) => x.items.every((i) => typeof i === 'number'))) {
    const ref = reference(t.items, t.container, t.gap);
    for (let k = 0; k + 1 < ref.stops.length; k++) {
      const a = ref.stops[k]!.units;
      const b = ref.stops[k + 1]!.units;
      const diff = b.map((u, p) => u - a[p]!);
      assert.equal(diff.reduce((s, d) => s + Math.abs(d), 0) % 2, 0);
      assert.ok(diff.every((d) => Math.abs(d) <= 1), `${label(t)} step ${k}: ${diff.join(',')}`);
      assert.equal(diff.filter((d) => d < 0).length, 1, `${label(t)} step ${k}: one panel gives a slot up`);
      assert.equal(diff.filter((d) => d > 0).length, 1, `${label(t)} step ${k}: one panel takes a slot`);
    }
  }
});

test('a wide entry never rests cut longer than the window holds: a drawn-smaller panel is at most as many slots as the window holds', () => {
  for (const t of TABLES) {
    const ref = reference(t.items, t.container, t.gap);
    for (const [k, n] of walk(t.items, t.container, t.gap).entries()) {
      for (const shrunk of n.stopShrinks[k]!) assert.ok(shrunk.slots >= 1 && shrunk.slots <= ref.fit, `${label(t)} stop ${k}: ${shrunk.slots} of ${ref.fit}`);
    }
  }
  const huge = walk([1, 64, 1], 1800, 16);
  assert.deepEqual(huge.map((n, k) => (n.drawnWidths[1] === n.widths[1] ? 'whole' : n.stopShrinks[k]!.map((x) => x.slots).join())), ['3', 'whole', '3'], 'a 64-slot panel is capped at the 4 the window holds');
});

test('an indivisible entry is one unit as wide as itself: the window passes over it whole and it is never drawn smaller', () => {
  for (const t of TABLES.filter((x) => x.items.some((i) => typeof i !== 'number'))) {
    for (const [k, n] of walk(t.items, t.container, t.gap).entries()) {
      for (const [p, item] of t.items.entries()) {
        if (typeof item === 'number') continue;
        assert.equal(n.drawnWidths[p], n.widths[p], `${label(t)} stop ${k}: entry ${p} keeps its width`);
        assert.ok(n.stopShrinks[k]!.every((s) => s.index !== p));
      }
    }
  }
});

test('stops never go left and every stop is a real scroll position: 0 <= scrollLeft <= what the strip drawn on that stop gives', () => {
  for (const t of TABLES) {
    const at = walk(t.items, t.container, t.gap);
    for (const [k, n] of at.entries()) {
      const drawnStrip = n.drawnOffsets[n.drawnOffsets.length - 1]! + n.drawnWidths[n.drawnWidths.length - 1]!;
      const scrollable = n.rowMarginLeft + drawnStrip + n.endPad - n.windowWidth;
      assert.ok(n.stops[k]! >= -1e-9, `${label(t)} stop ${k}: ${n.stops[k]} >= 0`);
      assert.ok(n.stops[k]! <= scrollable + 1e-9, `${label(t)} stop ${k}: ${n.stops[k]} <= ${scrollable}`);
      assert.ok(n.stops[k]! <= maxScrollOf(n) + 1e-9);
      if (k > 0) assert.ok(n.stops[k]! >= n.stops[k - 1]!, `${label(t)}: stops never go left (${k})`);
    }
  }
});

test('the strip drawn on any stop reaches the position of every stop: the browser never clamps the scroll on a step', () => {
  for (const t of TABLES) {
    const at = walk(t.items, t.container, t.gap);
    const farthest = Math.max(...at[0]!.stops);
    for (const [k, n] of at.entries()) {
      const drawnStrip = n.drawnOffsets[n.drawnOffsets.length - 1]! + n.drawnWidths[n.drawnWidths.length - 1]!;
      const scrollable = n.rowMarginLeft + drawnStrip + n.endPad - n.windowWidth;
      assert.ok(farthest <= scrollable + 1e-9, `${label(t)} drawn on stop ${k}: ${farthest} <= ${scrollable}`);
    }
  }
});

test('the strip does not move with the stop: rowMarginLeft, endPad and the chosen widths and offsets are the same on every stop', () => {
  const at = walk([1, 2, 4, 1, 3], 1800, 16);
  for (const n of at) {
    assert.equal(n.rowMarginLeft, at[0]!.rowMarginLeft);
    assert.equal(n.endPad, at[0]!.endPad);
    assert.deepEqual(n.widths, at[0]!.widths);
    assert.deepEqual(n.leftOffsets, at[0]!.leftOffsets);
    assert.equal(n.stripWidth, at[0]!.stripWidth);
    assert.deepEqual(n.stops, at[0]!.stops);
  }
});

test('stepping 0, 1, 0 returns to the first drawing: a stop is named by its number, so a second visit draws what the first did', () => {
  const entries = row([1, 2, 4, 1, 3]);
  const base = numbers(entries, 1800, 16, 'visible');
  const visit = (k: number) => {
    const n = numbers(entries, 1800, 16, 'visible', base.stopFirsts[k]);
    return { stop: n.stops[k], widths: [...n.drawnWidths], offsets: [...n.drawnOffsets], at: n.atStop };
  };
  const first = visit(0);
  const second = visit(1);
  assert.notDeepEqual(second.widths, first.widths);
  assert.deepEqual(visit(0), first);
  assert.deepEqual(visit(1), second);
});

test('no step lands on an identical view: neighbouring stops differ in position, shown panels or drawn widths', () => {
  for (const t of TABLES) {
    const at = walk(t.items, t.container, t.gap);
    const view = (k: number) => JSON.stringify({ stop: at[k]!.stops[k], shown: at[k]!.stopSpans[k], widths: at[k]!.drawnWidths });
    for (let k = 0; k + 1 < at.length; k++) assert.notEqual(view(k), view(k + 1), `${label(t)}: stop ${k} and ${k + 1}`);
  }
});

test('nothing is cut at rest: at every stop the shown panels, as drawn, lie inside the window', () => {
  for (const t of TABLES) {
    for (const [k, n] of walk(t.items, t.container, t.gap).entries()) {
      const span = n.stopSpans[k]!;
      const window = n.stops[k]!;
      for (let p = span.first; p < span.end; p++) {
        const left = n.rowMarginLeft + n.drawnOffsets[p]!;
        const right = left + n.drawnWidths[p]!;
        assert.ok(left >= window - 0.5 && right <= window + n.windowWidth + 0.5, `${label(t)} stop ${k} panel ${p}: ${left}..${right} in ${window}..${window + n.windowWidth}`);
      }
    }
  }
});

test('a fade at rest follows the logical stop, so stops that share a scroll position dim by what they show', () => {
  for (const t of TABLES) {
    for (const [k, n] of walk(t.items, t.container, t.gap).entries()) {
      const span = n.stopSpans[k]!;
      const only = t.items.map((_, i) => (i >= span.first && i < span.end ? 1 : 0));
      assert.equal(n.atStop, k);
      assert.deepEqual(fadeAt(n, n.stops[k]!), only, `${label(t)} stop ${k}`);
    }
  }
});

test('snapToStop gives the nearest stop that draws the panel whole: a stop that draws it smaller does not count', () => {
  const at = walk([1, 4, 1, 2], 1800, 16);
  const n = at[0]!;
  assert.equal(snapToStop(n, 1, 0), 406, 'the 4-slot panel is whole on stop 1 only; stop 0 draws it at 3');
  assert.equal(snapToStop(n, 0, 9999), 0, 'the first panel is whole on stop 0 only');
  assert.equal(snapToStop(n, 3, 0), 406, 'the 2-slot panel is whole on none of them: it is drawn at 1 on stop 3 and 2 on stop 4, which is whole');
  for (const t of TABLES) {
    const m = walk(t.items, t.container, t.gap);
    const first = m[0]!;
    for (let p = 0; p < t.items.length; p++) {
      const wholeAt = first.stops.filter((_, k) => k < first.stopSpans.length && first.stopSpans[k]!.first <= p && p < first.stopSpans[k]!.end && m[k]!.stopShrinks[k]!.every((s) => s.index !== p));
      if (wholeAt.length === 0) continue;
      for (const target of [0, first.stops[first.stops.length - 1]! / 2, 99999]) {
        const got = snapToStop(first, p, target);
        const best = wholeAt.reduce((b, s) => (Math.abs(s - target) < Math.abs(b - target) ? s : b));
        assert.equal(Math.abs(got - target), Math.abs(best - target), `${label(t)} panel ${p} toward ${target}`);
        assert.ok(wholeAt.includes(got), `${label(t)} panel ${p}: ${got} draws it whole`);
      }
    }
  }
});

test("'off' and 'hidden' never resize: every stop, margin and drawn width equals the chosen layout, with no shrink and no logical stop", () => {
  const entries = row([1, 2, 4, 1, 3]);
  const off = numbers(entries, 1800, 16, 'off');
  assert.equal(off.stops.length, 4);
  for (const mode of ['off', 'hidden'] as const) {
    for (const at of off.stopFirsts) {
      const n = numbers(entries, 1800, 16, mode, at);
      assert.deepEqual(n.stops, off.stops, mode);
      assert.deepEqual(n.stopSpans, off.stopSpans);
      assert.deepEqual(n.drawnWidths, n.widths);
      assert.ok(n.stopShrinks.every((s) => s.length === 0));
      assert.equal(n.atStop, -1);
    }
  }
});

test("'hidden' at rest on a stop, to within the half pixel a browser rounds to, shows only that stop's panels", () => {
  const entries = row([1, 2, 4, 1, 3]);
  const hidden = numbers(entries, 1800, 16, 'hidden');
  for (const [k, stop] of hidden.stops.entries()) {
    const span = hidden.stopSpans[k]!;
    const only = entries.map((_, i) => (i >= span.first && i < span.end ? 1 : 0));
    for (const at of [stop, stop - 0.4, stop + 0.4]) assert.deepEqual(fadeAt(hidden, at), only, `stop ${k} at ${at}`);
  }
});

test("'hidden' draws no panel part way: mid-glide a panel is whole or hidden, while 'off' keeps the cross-fade", () => {
  const entries = row([1, 2, 4, 1, 3]);
  const hidden = numbers(entries, 1800, 16, 'hidden');
  const off = numbers(entries, 1800, 16, 'off');
  const mid = (hidden.stops[0]! + hidden.stops[1]!) / 2;
  for (const v of fadeAt(hidden, mid)) assert.ok(v === 0 || v === 1, `hidden: ${v}`);
  assert.ok(fadeAt(off, mid).some((v) => v > 0 && v < 1), "'off' still cross-fades");
  const a = hidden.stopSpans[0]!;
  const b = hidden.stopSpans[1]!;
  assert.deepEqual(
    fadeAt(hidden, mid),
    entries.map((_, k) => ((k >= a.first && k < a.end) || (k >= b.first && k < b.end) ? 1 : 0)),
    'the union of the two stops shown panels is visible, nothing else',
  );
});

test('a hand-built entry without slots keeps its own width in every mode, where the same widths with slots step through sizes', () => {
  const widths = [PHONE, slotWidth(2, PHONE, 16), slotWidth(3, PHONE, 16), PHONE, slotWidth(2, PHONE, 16)];
  const slotlessRow = widths.map((w, k) => slotless(`e${k}`, w));
  const control = walk([1, 2, 3, 1, 2], 1800, 16);
  assert.ok(control.some((n, k) => n.stopShrinks[k]!.length > 0), 'the control: the same widths with slots are drawn smaller on some stop');
  for (const mode of ['off', 'visible', 'hidden'] as const) {
    const base = numbers(slotlessRow, 1800, 16, mode);
    for (const [k, first] of base.stopFirsts.entries()) {
      const n = numbers(slotlessRow, 1800, 16, mode, first);
      assert.deepEqual(n.drawnWidths, widths, `${mode} stop ${k}: every entry is drawn at its own width`);
      assert.ok(n.stopShrinks.every((s) => s.length === 0), mode);
    }
  }
});

test('a window of one slot has one stop per panel and nothing drawn smaller', () => {
  const n = numbers(row([1, 2, 4, 1, 3]), 844, 24, 'visible');
  assert.ok(n.stopShrinks.every((s) => s.length === 0));
  assert.equal(n.stops.length, 5);
});

test('History and a pinned panel follow the same rule as any panel with slots', () => {
  const h = history();
  assert.equal(h.slots, 1);
  const pinned = [made('pin', 3), h, made('b', 4), made('c', 1), made('d', 3)];
  const base = numbers(pinned, 1800, 16, 'visible');
  const shrunk = base.stopFirsts.flatMap((first, k) => numbers(pinned, 1800, 16, 'visible', first).stopShrinks[k]!);
  assert.ok(shrunk.some((s) => s.index === 0), 'a 3-slot panel left of History steps through its sizes');
  assert.ok(shrunk.every((s) => s.index !== 1), 'History is one slot and has no smaller size');
  assert.equal(nearestStopIndex(base, base.stops[2]!), base.stops.indexOf(base.stops[2]!), 'the earliest stop at a shared position');
});
