/**
 * Whole panels only: with tuning.shrinkOutOfView on, the neighbour a stop's group would leave cut off by the window edge
 * is drawn smaller by whole slots, on the side the row is leaning toward, or never drawn at all. The pure arithmetic
 * against a slot-grid reference written independently of rowNumbers.ts, then the stability of the strip between stops.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { resolvePanelSettings } from '../index.js';
import type { PanelWindow } from '../index.js';
import { applyTemplate } from '../panelSettings.js';
import { appendPanel, createHistoryPanel } from '../panelWindow.js';
import { computeRowNumbers, fadeAt, maxScrollOf, nearestStopIndex, type RowNumbers } from '../rowNumbers.js';
import { slotWidth } from '../rowConstants.js';

const ROOT = 'root';
const PHONE = 390;
type Mode = 'off' | 'visible' | 'hidden';
type Lean = 'forward' | 'backward';

const made = (id: string, slots: number): PanelWindow => {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'v' }, id, ROOT)[0]!;
  return applyTemplate(skeleton, resolvePanelSettings({ template: { overflow: 'scroll', slots, maxSlots: 64 } as never }).value, 'create');
};
const history = (): PanelWindow => applyTemplate({ ...createHistoryPanel(ROOT), view: 'v' }, resolvePanelSettings({ template: { title: 'History', overflow: 'scroll' } as never }, { root: true }).value, 'create');
const row = (slots: readonly number[]): PanelWindow[] => slots.map((n, k) => made(`p${k}`, n));
const numbers = (entries: PanelWindow[], container: number, gap: number, shrink: Mode, lean: Lean = 'forward', atFirst = 0): RowNumbers =>
  computeRowNumbers({ entries, phoneWidth: PHONE, containerWidth: container, gap, wholePanels: true, shrink, lean, atFirst });

/** The shown panels of one stop and the drawn slots, from the slot grid alone: the independent reference. */
function reference(slots: readonly number[], container: number, gap: number, lean: Lean) {
  const window = container - 2 * gap;
  const fit = Math.max(1, Math.floor((window + gap) / (PHONE + gap)));
  const chosen = slots.map((s) => Math.min(s, fit));
  const sw = (n: number): number => n * PHONE + (n - 1) * gap;
  const out: { first: number; groupEnd: number; free: number; shown: { first: number; end: number }; shrink: { index: number; slots: number } | null; margin: number }[] = [];
  for (let first = 0; first < chosen.length; first++) {
    let used = sw(chosen[first]!);
    let end = first + 1;
    while (end < chosen.length && used + gap + sw(chosen[end]!) <= window) used += gap + sw(chosen[end++]!);
    const free = Math.floor((window - used) / (PHONE + gap));
    let shown = { first, end };
    let shrink: { index: number; slots: number } | null = null;
    let total = used;
    const forwardPick = () => {
      if (end < chosen.length && free >= 1) {
        shrink = { index: end, slots: free };
        shown = { first, end: end + 1 };
        total = used + gap + sw(free);
      }
    };
    if (lean === 'forward' || first === 0 || free < 1 || chosen[first - 1]! <= free) forwardPick();
    else {
      shrink = { index: first - 1, slots: free };
      shown = { first: first - 1, end };
      total = used + gap + sw(free);
    }
    out.push({ first, groupEnd: end, free, shown, shrink, margin: Math.max(0, (window - total) / 2) });
    if (end === chosen.length) break;
  }
  return out;
}

const TABLES: { gap: number; container: number; slots: number[] }[] = [
  { gap: 16, container: 1800, slots: [1, 2, 4, 1, 3] },
  { gap: 16, container: 1280, slots: [1, 2, 4, 1, 3] },
  { gap: 16, container: 844, slots: [1, 2, 4, 1, 3] },
  { gap: 24, container: 1800, slots: [1, 2, 4, 1, 3] },
  { gap: 24, container: 1280, slots: [1, 2, 4, 1, 3] },
  { gap: 24, container: 844, slots: [1, 2, 4, 1, 3] },
  { gap: 16, container: 1800, slots: [6, 1, 2, 1, 64] },
  { gap: 24, container: 1800, slots: [6, 1, 2, 1, 64] },
];

test('worked table, 1800 at gap 16: the stops, who is shrunk to what, and the margins, forward and backward', () => {
  const entries = row([1, 2, 4, 1, 3]);
  const forward = numbers(entries, 1800, 16, 'visible', 'forward');
  assert.deepEqual(forward.stopShrinks, [{ index: 2, slots: 1 }, { index: 2, slots: 2 }, null, null]);
  assert.deepEqual(forward.stopSpans, [{ first: 0, end: 3 }, { first: 1, end: 3 }, { first: 2, end: 3 }, { first: 3, end: 5 }]);
  assert.equal(forward.rowMarginLeft, 80, 'stop 0 forward: 1768 less 1 + 2 + 1 slots, even margin');
  assert.deepEqual(forward.stops, [0, 406, 1218, 2842]);
  const backward = numbers(entries, 1800, 16, 'visible', 'backward');
  assert.deepEqual(backward.stops, forward.stops, 'every panel behind a group here already fits, so backward is forward');
  assert.deepEqual(backward.stopShrinks, forward.stopShrinks);
  assert.equal(backward.rowMarginLeft, forward.rowMarginLeft, 'the lean never moves the strip');
  assert.equal(backward.endPad, forward.endPad);
});

test('a panel behind the group that does not fit the free slots is the one drawn smaller when the row leans backward', () => {
  const entries = row([4, 1, 4, 1, 1, 1]);
  const forward = numbers(entries, 1800, 16, 'visible', 'forward');
  const backward = numbers(entries, 1800, 16, 'visible', 'backward');
  assert.deepEqual(forward.stopFirsts, [0, 1, 2, 3]);
  assert.deepEqual(forward.stopShrinks[1], { index: 2, slots: 3 }, 'leaning forward, the 4-slot panel after stop 1 takes the 3 free slots');
  const at1 = backward.stopFirsts.indexOf(1);
  assert.deepEqual(backward.stopShrinks[at1], { index: 0, slots: 3 }, 'leaning backward, the 4-slot panel before it does');
  assert.equal(backward.rowMarginLeft, forward.rowMarginLeft);
  assert.equal(backward.stops[at1], backward.stops[0], 'the two stops share a scroll position and differ only in what they draw');
});

test('every table row and lean matches the slot-grid reference: shown panels, shrink, margin and stop position', () => {
  for (const t of TABLES) {
    for (const lean of ['forward', 'backward'] as const) {
      const entries = row(t.slots);
      const n = numbers(entries, t.container, t.gap, 'visible', lean);
      const expected = reference(t.slots, t.container, t.gap, lean);
      const label = `${t.slots.join(',')} @${t.container}/${t.gap} ${lean}`;
      if (lean === 'forward') assert.equal(n.stops.length, expected.length, `${label}: stop count`);
      assert.ok(n.stops.length > 0 && n.stops.length <= expected.length);
      for (const [k, first] of n.stopFirsts.entries()) {
        const e = expected.find((x) => x.first === first)!;
        assert.deepEqual(n.stopShrinks[k], e.shrink, `${label}: shrink of stop ${first}`);
        assert.deepEqual(n.stopSpans[k], e.shown, `${label}: shown of stop ${first}`);
        assert.equal(n.stops[k], n.rowMarginLeft + n.leftOffsets[e.shown.first]! - e.margin, `${label}: stop ${first}`);
        assert.ok(n.stops[k]! >= -1e-9, `${label}: stop ${first} is not left of the strip (${n.stops[k]})`);
        if (k > 0) assert.ok(n.stops[k]! >= n.stops[k - 1]!, `${label}: stops never go left (${first})`);
      }
    }
  }
});

test('nothing is cut at rest: at every stop of every lean the shown panels, drawn, lie inside the window', () => {
  for (const t of TABLES) {
    for (const lean of ['forward', 'backward'] as const) {
      const base = numbers(row(t.slots), t.container, t.gap, 'visible', lean);
      for (const k of base.stops.keys()) {
        const n = numbers(row(t.slots), t.container, t.gap, 'visible', lean, base.stopFirsts[k]);
        const span = n.stopSpans[k]!;
        const window = n.stops[k]!;
        for (let p = span.first; p < span.end; p++) {
          const left = n.rowMarginLeft + n.drawnOffsets[p]!;
          const right = left + n.drawnWidths[p]!;
          assert.ok(left >= window - 0.5 && right <= window + n.windowWidth + 0.5, `${t.slots.join(',')} @${t.container}/${t.gap} ${lean} stop ${k} panel ${p}: ${left}..${right} in ${window}..${window + n.windowWidth}`);
        }
        assert.ok(n.stops[k]! <= maxScrollOf(n) + 0.5, `${lean} stop ${k} is reachable: ${n.stops[k]} <= ${maxScrollOf(n)}`);
      }
    }
  }
});

test('the strip does not move with the lean or the stop: rowMarginLeft, endPad and the chosen widths and offsets are the same', () => {
  const entries = row([1, 2, 4, 1, 3]);
  const first = numbers(entries, 1800, 16, 'visible', 'forward', 0);
  for (const lean of ['forward', 'backward'] as const) {
    for (const at of first.stopFirsts) {
      const n = numbers(entries, 1800, 16, 'visible', lean, at);
      assert.equal(n.rowMarginLeft, first.rowMarginLeft);
      assert.equal(n.endPad, first.endPad);
      assert.deepEqual(n.widths, first.widths);
      assert.deepEqual(n.leftOffsets, first.leftOffsets);
      assert.equal(n.stripWidth, first.stripWidth);
    }
  }
});

test('stepping 0, 1, 0 returns to the first position: the same scroll, the same drawn widths and offsets', () => {
  const entries = row([1, 2, 4, 1, 3]);
  const visit = (lean: Lean, at: number) => {
    const n = numbers(entries, 1800, 16, 'visible', lean, at);
    return { stop: n.stops[at], widths: [...n.drawnWidths], offsets: [...n.drawnOffsets] };
  };
  const first = visit('forward', 0);
  const second = visit('forward', 1);
  const back = visit('backward', 0);
  assert.notEqual(second.stop, first.stop);
  assert.deepEqual(back, first, 'stop 0 leaning backward is stop 0 leaning forward: no neighbour behind it');
  const again = visit('forward', 1);
  assert.deepEqual(again, second, 'a second visit to stop 1 is the first visit');
});

test('reversing at a stop: the neighbour on the old side returns to its own size and the new leading one shrinks', () => {
  const entries = row([4, 1, 4, 1, 1, 1]);
  const forward = numbers(entries, 1800, 16, 'visible', 'forward', 1);
  const stop1 = forward.stopShrinks[1];
  assert.deepEqual(stop1, { index: 2, slots: 3 }, 'leaning forward at stop 1 the panel after it is drawn at the 3 free slots');
  assert.equal(forward.drawnWidths[2], slotWidth(3, PHONE, 16));
  const backward = numbers(entries, 1800, 16, 'visible', 'backward', 2);
  assert.equal(backward.drawnWidths[2], forward.widths[2], 'panel 2 is back at its own size');
  assert.deepEqual(backward.stopShrinks[2], null, 'stop 2 is a 4-slot group, nothing is left free');
  const reversed = numbers(entries, 1800, 16, 'visible', 'backward', 1);
  assert.equal(reversed.drawnWidths[2], reversed.widths[2], 'panel 2 is not the neighbour any more');
  assert.deepEqual(reversed.stopShrinks[1], { index: 0, slots: 3 }, 'leaning backward at stop 1 the 4-slot panel behind it is drawn at the 3 free slots');
  assert.equal(reversed.drawnWidths[0], slotWidth(3, PHONE, 16));
});

test("'off' and 'hidden' never resize: every stop, margin and drawn width equals the chosen layout in both leans", () => {
  const entries = row([1, 2, 4, 1, 3]);
  const off = numbers(entries, 1800, 16, 'off');
  for (const mode of ['off', 'hidden'] as const) {
    for (const lean of ['forward', 'backward'] as const) {
      for (const at of off.stopFirsts) {
        const n = numbers(entries, 1800, 16, mode, lean, at);
        assert.deepEqual(n.stops, off.stops, `${mode} ${lean}`);
        assert.deepEqual(n.stopSpans, off.stopSpans);
        assert.deepEqual(n.drawnWidths, n.widths);
        assert.ok(n.stopShrinks.every((s) => s === null));
      }
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

test('a fade at rest follows the logical stop, so two stops that share a scroll position dim differently', () => {
  for (const t of TABLES) {
    const base = numbers(row(t.slots), t.container, t.gap, 'visible', 'backward');
    for (const [k, first] of base.stopFirsts.entries()) {
      const n = numbers(row(t.slots), t.container, t.gap, 'visible', 'backward', first);
      const span = n.stopSpans[k]!;
      const only = row(t.slots).map((_, i) => (i >= span.first && i < span.end ? 1 : 0));
      assert.deepEqual(fadeAt(n, n.stops[k]!), only, `${t.slots.join(',')} @${t.container}/${t.gap} stop ${k}`);
    }
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
    entries.map((_, k) => (k >= a.first && k < a.end) || (k >= b.first && k < b.end) ? 1 : 0),
    'the union of the two stops shown panels is visible, nothing else',
  );
});

test('a hand-built entry without slots keeps its own width in every mode and lean, where the same widths with slots would shrink', () => {
  const widthByEntry = (id: string, width: number): PanelWindow => {
    const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'v' }, id, ROOT)[0]!;
    const formFactor = width === PHONE ? 'phone' : width === slotWidth(2, PHONE, 16) ? 'tablet' : 'desktop';
    return { ...skeleton, collapsible: true, live: true, formFactor, size: { formFactor, width, height: 700 }, settings: { overflow: 'scroll' } as never };
  };
  const widths = [PHONE, slotWidth(2, PHONE, 16), slotWidth(3, PHONE, 16), PHONE, slotWidth(2, PHONE, 16)];
  const slotless = widths.map((w, k) => widthByEntry(`e${k}`, w));
  const withSlots = row([1, 2, 3, 1, 2]);
  const control = numbers(withSlots, 1800, 16, 'visible');
  assert.ok(control.stopShrinks.some((s) => s !== null), 'the control: the same widths with slots shrink a neighbour');
  for (const mode of ['off', 'visible', 'hidden'] as const) {
    for (const lean of ['forward', 'backward'] as const) {
      const n = numbers(slotless, 1800, 16, mode, lean);
      assert.deepEqual(n.drawnWidths, widths, `${mode} ${lean}: every entry is drawn at its own width`);
      assert.ok(n.stopShrinks.every((s) => s === null), `${mode} ${lean}: none is shrunk`);
    }
  }
});

test('a window of one slot has nothing free at any stop: no shrink in either lean', () => {
  for (const lean of ['forward', 'backward'] as const) {
    const n = numbers(row([1, 2, 4, 1, 3]), 844, 24, 'visible', lean);
    assert.ok(n.stopShrinks.every((s) => s === null));
    assert.equal(n.stops.length, 5);
  }
});

test('History and a pinned panel follow the same rule as any panel with slots', () => {
  const h = history();
  assert.equal(h.slots, 1);
  const entries = [h, made('a', 1), made('b', 4), made('c', 1), made('d', 3)];
  const n = numbers(entries, 1800, 16, 'visible');
  assert.deepEqual(n.stopShrinks[0], { index: 2, slots: 2 }, 'a 4-slot panel after History and one phone is drawn at the two free slots');
  const leftOfHistory = [made('pin', 3), h, made('b', 4), made('c', 1), made('d', 3)];
  const m = numbers(leftOfHistory, 1800, 16, 'visible', 'backward');
  assert.ok(m.stopShrinks.some((s) => s !== null && s.index === 1) || m.stopShrinks.every((s) => s === null || s.index !== 1), 'History is eligible as the neighbour');
  assert.deepEqual(nearestStopIndex(n, n.stops[2]!), 2);
});

test('every stop of either lean is a real scroll position: 0 <= scrollLeft <= the scrollWidth the drawn strip gives', () => {
  for (const t of TABLES) {
    for (const lean of ['forward', 'backward'] as const) {
      const base = numbers(row(t.slots), t.container, t.gap, 'visible', lean);
      for (const k of base.stops.keys()) {
        const n = numbers(row(t.slots), t.container, t.gap, 'visible', lean, base.stopFirsts[k]);
        const drawnStrip = n.drawnOffsets[n.drawnOffsets.length - 1]! + n.drawnWidths[n.drawnWidths.length - 1]!;
        const scrollable = n.rowMarginLeft + drawnStrip + n.endPad - n.windowWidth;
        const label = `${t.slots.join(',')} @${t.container}/${t.gap} ${lean} stop ${k}`;
        assert.ok(n.stops[k]! >= 0, `${label}: ${n.stops[k]} >= 0`);
        assert.ok(n.stops[k]! <= scrollable + 1e-9, `${label}: ${n.stops[k]} <= ${scrollable}`);
        assert.ok(n.stops[k]! <= maxScrollOf(n) + 1e-9, label);
      }
    }
  }
});

test('a lean flip never clamps the scroll: the strip drawn at any stop reaches the position of every stop of either lean', () => {
  for (const t of TABLES) {
    const positions = (['forward', 'backward'] as const).flatMap((lean) => numbers(row(t.slots), t.container, t.gap, 'visible', lean).stops);
    for (const lean of ['forward', 'backward'] as const) {
      const base = numbers(row(t.slots), t.container, t.gap, 'visible', lean);
      for (const first of base.stopFirsts) {
        const n = numbers(row(t.slots), t.container, t.gap, 'visible', lean, first);
        const drawnStrip = n.drawnOffsets[n.drawnOffsets.length - 1]! + n.drawnWidths[n.drawnWidths.length - 1]!;
        const scrollable = n.rowMarginLeft + drawnStrip + n.endPad - n.windowWidth;
        assert.ok(Math.max(...positions) <= scrollable + 1e-9, `${t.slots.join(',')} @${t.container}/${t.gap} ${lean} at ${first}: ${Math.max(...positions)} <= ${scrollable}`);
      }
    }
  }
});

test('no step lands on an identical view: neighbouring stops differ in position, shown panels or drawn widths, in both leans', () => {
  for (const t of TABLES) {
    for (const lean of ['forward', 'backward'] as const) {
      const entries = row(t.slots);
      const base = numbers(entries, t.container, t.gap, 'visible', lean);
      const view = (l: Lean, k: number) => {
        const list = numbers(entries, t.container, t.gap, 'visible', l);
        const n = numbers(entries, t.container, t.gap, 'visible', l, list.stopFirsts[k]);
        return JSON.stringify({ stop: n.stops[k], shown: n.stopSpans[k], widths: n.drawnWidths });
      };
      for (let k = 0; k + 1 < base.stops.length; k++) {
        assert.notEqual(view(lean, k), view(lean, k + 1), `${t.slots.join(',')} @${t.container}/${t.gap} ${lean}: stop ${k} and ${k + 1}`);
      }
    }
  }
});

test("'hidden' keeps its no-fade contract across a reversal: the same two panels sets are whole in either lean", () => {
  const entries = row([1, 2, 4, 1, 3]);
  const forward = numbers(entries, 1800, 16, 'hidden', 'forward');
  const backward = numbers(entries, 1800, 16, 'hidden', 'backward');
  for (const n of [forward, backward]) {
    for (let k = 0; k + 1 < n.stops.length; k++) {
      const mid = (n.stops[k]! + n.stops[k + 1]!) / 2;
      for (const v of fadeAt(n, mid)) assert.ok(v === 0 || v === 1);
    }
  }
  assert.deepEqual(backward.stops, forward.stops);
});
