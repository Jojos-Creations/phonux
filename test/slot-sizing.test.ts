/**
 * Slot sizing: a panel is n whole slots wide and a measured amount taller per slot. The pure arithmetic first, then a
 * mounted PanelRow for the widths, the heights, the alignment and the summary a view reads, one differential per
 * setting this entry owns, and the resolver rules for slots against maxSlots.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { resolvePanelSettings } from '../panelSettings.js';
import type { PanelSummary, PanelWindow, WorkspaceTuning } from '../index.js';
import { RowHeightContext } from '../panelTuning.js';
import { applyTemplate } from '../panelSettings.js';
import { appendPanel, createHistoryPanel, setSlots } from '../panelWindow.js';
import { projectWorkspaceState } from '../workspaceState.js';
import { ALL_SLOTS, fitSlots, slotWidth } from '../rowConstants.js';
import { differential, differentialsCovered } from './support/differential.js';
import { advanceFrames, cleanup, mount, withHost, StaticRow } from './support/mount-harness.js';
import { drawnSlotsOf } from '../panelTiers.js';
import { made as scrollMade, mountRow, rootEntry, row } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';

const ROOT = 'root';
const NONE: ReadonlySet<string> = new Set();
const OWNED = ['slots', 'maxSlots'];
const summaries = new Map<string, PanelSummary>();

registerTestView('slot-view', ({ panel }) => {
  summaries.set(panel.id, panel);
  return React.createElement('i', { 'data-slot': panel.id }, panel.title);
});

afterEach(() => {
  summaries.clear();
  cleanup();
});

/** An entry as a creation path builds it, with the template's slot settings. */
function made(id: string, template: Record<string, unknown> = {}): PanelWindow {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'slot-view' }, id, ROOT)[0]!;
  return applyTemplate(skeleton, resolvePanelSettings({ template: { overflow: 'park', ...template } as never }).value, 'create');
}

const rowOf = (entries: PanelWindow[], tuning?: WorkspaceTuning, available = 0, maxLiveWidth = Number.POSITIVE_INFINITY): React.ReactElement =>
  React.createElement(RowHeightContext.Provider, { value: available }, withHost(React.createElement(StaticRow, { entries, rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE, maxLiveWidth, ...(tuning === undefined ? {} : { tuning }) })));

const slotOf = (container: HTMLElement, id: string): HTMLElement => {
  const slot = container.querySelector(`[data-slot="${id}"]`)?.parentElement;
  assert.ok(slot, `slot ${id} is mounted`);
  return slot as HTMLElement;
};
const boxHeight = (container: HTMLElement): number => px(getComputedStyle(container.firstElementChild as HTMLElement).height);
const px = (value: string): number => Number.parseFloat(value);

/** The row's phone height and width, read from a one-slot row so no number here is typed in twice. */
function phone(): { width: number; height: number } {
  const mounted = mount(rowOf([made('p')]));
  const out = { width: px(slotOf(mounted.container, 'p').style.width), height: px(slotOf(mounted.container, 'p').style.height) };
  mounted.unmount();
  return out;
}

test('slotWidth is n phone widths with the gap between them, and fitSlots is the most that fit', () => {
  assert.deepEqual([1, 2, 3].map((n) => slotWidth(n, 390, 16)), [390, 796, 1202]);
  assert.deepEqual([[1800 - 32, 4], [1280 - 32, 3], [844 - 32, 2], [390, 1], [796, 2], [1202, 3], [795, 1], [Number.POSITIVE_INFINITY, 3]].map(([room, n]) => [fitSlots(room!, 390, 16), n]), [[4, 4], [3, 3], [2, 2], [1, 1], [2, 2], [3, 3], [1, 1], [3, 3]]);
});

test('at the app gap of 24 the edge padding is the rowGap tuning: slots are 804 and 1632 wide, and 844 fits 1, 1280 fits 3 and 1800 fits 4', () => {
  assert.deepEqual([1, 2, 3, 4].map((n) => slotWidth(n, 390, 24)), [390, 804, 1218, 1632]);
  // The window is the container less one gap each side: the same constant the row pads its container with.
  assert.deepEqual([844, 1280, 1800].map((container) => fitSlots(container - 2 * 24, 390, 24)), [1, 3, 4]);
  assert.deepEqual([844, 1280, 1800].map((container) => fitSlots(container - 2 * 16, 390, 16)), [2, 3, 4], 'at the library gap of 16, 844 fits 2');
  const wide = mount(rowOf([made('a', { slots: 2, maxSlots: 2 }), made('b', { slots: 4, maxSlots: 4 })], { rowGap: 24 }, 0, 1800 - 2 * 24));
  assert.equal(px(slotOf(wide.container, 'a').style.width), 804);
  assert.equal(px(slotOf(wide.container, 'b').style.width), 1632);
});

test('differential slots: a panel of two slots is one phone and a gap wider than a panel of one', () => {
  differential('slots', (run) => {
    for (const slots of [1, 2]) {
      run(slots, () => {
        const mounted = mount(rowOf([made('a', { slots, maxSlots: 3 })]));
        const width = px(slotOf(mounted.container, 'a').style.width);
        mounted.unmount();
        return width;
      });
    }
  });
});

test('differential maxSlots: a panel asked for three slots is drawn at the cap', () => {
  differential('maxSlots', (run) => {
    for (const maxSlots of [1, 3]) {
      run(maxSlots, () => {
        const mounted = mount(rowOf([made('a', { slots: 3, maxSlots })]));
        const width = px(slotOf(mounted.container, 'a').style.width);
        mounted.unmount();
        return width;
      });
    }
  });
});

test('widths follow the window: three slots asked in a window that fits two draw two, and the setting is kept', () => {
  const { width } = phone();
  const entry = made('a', { slots: 3, maxSlots: 3 });
  const mounted = mount(rowOf([entry], undefined, 0, slotWidth(2, width, 16)));
  assert.equal(px(slotOf(mounted.container, 'a').style.width), slotWidth(2, width, 16));
  assert.equal(summaries.get('a')!.slots, 3, 'the choice is unchanged');
  assert.equal(summaries.get('a')!.drawnSlots, 2, 'the drawn count is what fits');
  mounted.unmount();
});

test('heights: panels of every slot count keep the phone height, measured room or not, and a view is told it', () => {
  const { height } = phone();
  const counts = [1, 2, 3, ALL_SLOTS];
  const entries = counts.map((n) => made(`n${n}`, { slots: n, maxSlots: ALL_SLOTS }));
  for (const room of [height + 400, 0]) {
    const mounted = mount(rowOf(entries, undefined, room));
    assert.deepEqual(counts.map((n) => px(slotOf(mounted.container, `n${n}`).style.height)), counts.map(() => height));
    assert.equal(boxHeight(mounted.container), height, 'the row box is the phone height');
    assert.deepEqual(counts.map((n) => summaries.get(`n${n}`)!.size?.height), counts.map(() => height), 'the summary carries the drawn height');
    mounted.unmount();
  }
});

test('setSlots keeps the phone height in a row that has room to grow', async () => {
  const proto = HTMLElement.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, 'clientHeight');
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => 2000 });
  try {
    const m = mountRow(row(rootEntry(), ...[2, 4, 1, 3].map((n, k) => scrollMade(`s${k + 1}`, { slots: n, maxSlots: ALL_SLOTS }))), 1800, { tuning: { rowGesture: 'step' } });
    await advanceFrames(100);
    const heights = (): number[] => [...m.container.querySelectorAll<HTMLElement>('[data-row-slot]')].map((el) => px(el.style.height)).filter((h) => !Number.isNaN(h));
    const { height } = phone();
    for (const n of [1, 2, 3, ALL_SLOTS]) {
      act(() => void m.latest().setSlots('s2', n));
      await advanceFrames(400);
      assert.ok(heights().length > 0 && heights().every((h) => h === height), `setSlots(${n}): every drawn panel is ${height} tall (${heights().join(',')})`);
    }
  } finally {
    if (original === undefined) delete (proto as unknown as Record<string, unknown>).clientHeight;
    else Object.defineProperty(proto, 'clientHeight', original);
  }
});

test('a hand-built entry without slots keeps the phone height and the older width rule', () => {
  const { height } = phone();
  const entry: PanelWindow = { id: 'h', url: 'https://h.example', title: 'h', live: true, view: 'slot-view', collapsible: true, listed: true };
  const mounted = mount(rowOf([entry], undefined, height + 400));
  assert.equal(boxHeight(mounted.container), height);
  assert.equal(slotOf(mounted.container, 'h').style.height, '', 'the slot fills the row');
  mounted.unmount();
});

test('setSlots clamps to maxSlots, ignores the resizable setting and no-ops on an unchanged count', () => {
  const rows = [made('a', { slots: 1, maxSlots: 3 })];
  const two = setSlots(rows, 'a', 2);
  assert.equal(two[0]!.slots, 2);
  assert.equal(setSlots(two, 'a', 2), two, 'unchanged: the same array');
  assert.equal(setSlots(two, 'a', 9)[0]!.slots, 3, 'clamped to maxSlots');
  assert.equal(setSlots(two, 'a', 0)[0]!.slots, 1, 'clamped to one');
  const frozen = [made('f', { resizable: false })];
  assert.equal(setSlots(frozen, 'f', 2)[0]!.slots, 2, 'resizable limits a person\'s gesture, not this call');
});

test('resolver: the later layer wins when both ask for slots, and slots above maxSlots are forced down to it', () => {
  const later = resolvePanelSettings({ template: { slots: 3 } as never, instance: { slots: 1 } as never }).value;
  assert.equal(later.slots, 1, 'the instance layer is after the template');
  const capped = resolvePanelSettings({ template: { slots: 5, maxSlots: 4 } as never });
  assert.equal(capped.value.slots, 4, 'slots is held to maxSlots');
  assert.deepEqual(capped.conflicts.map((c) => [c.key, c.rule, c.forcedBy]), [['slots', 'C4', 'maxSlots']]);
});

test('resolver: a fixed column keeps the size settings its own layers asked for, and is forced to one slot otherwise', () => {
  const own = resolvePanelSettings({ template: { parkable: false } as never, instance: { resizable: true, maxSlots: 3, slots: 2 } as never }).value;
  assert.deepEqual([own.resizable, own.maxSlots, own.slots], [true, 3, 2], 'an instance-asked History size stands');
  const workspace = resolvePanelSettings({ workspace: { resizable: true, maxSlots: 3 } as never, template: { parkable: false } as never });
  assert.deepEqual([workspace.value.resizable, workspace.value.maxSlots, workspace.value.slots], [false, 1, 1], 'the workspace default does not unlock a fixed column');
  assert.deepEqual(workspace.conflicts, []);
});

test('resolver: resizable set with maxSlots at 1 is kept and noted', () => {
  const res = resolvePanelSettings({ instance: { resizable: true, maxSlots: 1 } as never });
  assert.equal(res.value.resizable, true);
  assert.ok(res.notes.some((n) => n.code === 'resizable-capped'));
});

test('the root\'s slot count is saved as rootSlots only when it is more than one slot', () => {
  const root = (slots?: number): PanelWindow => ({ ...createHistoryPanel(ROOT), ...(slots === undefined ? {} : { slots }) });
  assert.equal(projectWorkspaceState([root(3)], ROOT).rootSlots, 3);
  assert.equal(projectWorkspaceState([root(1)], ROOT).rootSlots, undefined);
  assert.equal(projectWorkspaceState([root()], ROOT).rootSlots, undefined);
});

test('this file completed the differential of every name it owns', () => {
  assert.deepEqual(differentialsCovered(), [...OWNED].sort());
});

test('drawnSlotsOf holds an entry to its own maxSlots even if its slots were stored above it', () => {
  const entry = (slots: number, maxSlots: number): Parameters<typeof drawnSlotsOf>[0] => ({ slots, settings: { maxSlots } as never });
  assert.equal(drawnSlotsOf(entry(4, 2), 390, 1608, 16), 2, 'capped at maxSlots although four fit');
  assert.equal(drawnSlotsOf(entry(4, 4), 390, 796, 16), 2, 'and at what fits');
  assert.equal(drawnSlotsOf({ slots: undefined, settings: undefined }, 390, 1608, 16), undefined, 'a hand-built entry has no slot count');
});

test('setSlots above a panel maxSlots warns once, as a template asking too much does, and still clamps', () => {
  const warn = mock.method(console, 'warn', () => undefined);
  try {
    const m = mountRow(row(rootEntry(), scrollMade('a', { slots: 1, maxSlots: 2 })), 1000);
    act(() => void m.latest().setSlots('a', 5));
    act(() => void m.latest().setSlots('a', 5));
    assert.equal(m.latest().entries.find((p) => p.id === 'a')!.slots, 2, 'clamped to maxSlots');
    const warnings = warn.mock.calls.map((c) => String(c.arguments[0])).filter((t) => t.includes('maxSlots'));
    assert.equal(warnings.length, 1, 'one warning for the same ask');
    assert.match(warnings[0]!, /'a'.*setSlots\(5\).*maxSlots \(2\)/);
  } finally {
    warn.mock.restore();
  }
});

test('a view is told fitSlots, the slots that fit the window at the row gap: 844 gives 2 at 16 and 1 at 24, 1280 gives 3, 1800 gives 4', () => {
  const fitFor = (container: number, rowGap: number): number | undefined => {
    const mounted = mount(rowOf([made('a')], { rowGap }, 0, container - 2 * rowGap));
    const out = summaries.get('a')!.fitSlots;
    mounted.unmount();
    return out;
  };
  assert.deepEqual([844, 1280, 1800].map((c) => fitFor(c, 16)), [2, 3, 4]);
  assert.deepEqual([844, 1280, 1800].map((c) => fitFor(c, 24)), [1, 3, 4]);
});
