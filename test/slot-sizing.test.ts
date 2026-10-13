/**
 * Slot sizing: a panel is n whole slots wide and a measured amount taller per slot. The pure arithmetic first, then a
 * mounted PanelRow for the widths, the heights, the alignment and the summary a view reads, one differential per
 * setting this entry owns, and the resolver rules for slots against formFactor.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { PanelRow, registerView, resolvePanelSettings } from '../index.js';
import type { PanelSummary, PanelWindow, WorkspaceTuning } from '../index.js';
import { RowHeightContext } from '../panelTuning.js';
import { applyTemplate } from '../panelSettings.js';
import { appendPanel, createHistoryPanel, setFormFactor, setSlots } from '../panelWindow.js';
import { projectWorkspaceState } from '../workspaceState.js';
import { ALL_SLOTS, fitSlots, slotHeight, slotWidth, slotsOfTier, tierOfSlots } from '../rowConstants.js';
import { differential, differentialsCovered } from './support/differential.js';
import { advanceFrames, cleanup, mount, withHost } from './support/mount-harness.js';
import { drawnSlotsOf } from '../panelTiers.js';
import { made as scrollMade, mountRow, rootEntry, row } from './support/scroll-row.js';

const ROOT = 'root';
const NONE: ReadonlySet<string> = new Set();
const OWNED = ['slots', 'maxSlots', 'tuning.heightPerSlot', 'tuning.rowAlign'];
const summaries = new Map<string, PanelSummary>();

registerView('slot-view', ({ panel }) => {
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
  React.createElement(RowHeightContext.Provider, { value: available }, withHost(React.createElement(PanelRow, { entries, rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE, maxLiveWidth, ...(tuning === undefined ? {} : { tuning }) })));

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

test('slotHeight adds the per-slot amount, never below the phone height and never above the room', () => {
  assert.deepEqual([1, 2, 3].map((n) => slotHeight(n, 844, 48, 2000)), [844, 892, 940]);
  assert.equal(slotHeight(3, 844, 48, 900), 900, 'capped at the room');
  assert.equal(slotHeight(3, 844, 48, 0), 844, 'unmeasured: the phone height');
  assert.equal(slotHeight(3, 844, 48, 500), 844, 'a room shorter than the phone never shrinks it');
});

test('a tier is the slot count it stands for, and a slot count reports the tier it falls in', () => {
  assert.deepEqual((['phone', 'tablet', 'desktop'] as const).map(slotsOfTier), [1, 2, ALL_SLOTS]);
  assert.deepEqual([1, 2, 3, 9].map(tierOfSlots), ['phone', 'tablet', 'desktop', 'desktop']);
});

test('differential slots: a panel of two slots is one phone and a gap wider than a panel of one', () => {
  differential('slots', (run) => {
    for (const slots of [1, 2]) {
      run(slots, () => {
        const mounted = mount(rowOf([made('a', { slots, maxSlots: 3, formFactors: ['phone', 'tablet', 'desktop'] })]));
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
        const mounted = mount(rowOf([made('a', { slots: 3, maxSlots, formFactors: ['phone', 'tablet', 'desktop'] })]));
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

test('differential tuning.heightPerSlot: a two-slot panel is taller by the per-slot amount', () => {
  const { height } = phone();
  differential('tuning.heightPerSlot', (run) => {
    for (const heightPerSlot of [0, 48]) {
      run(heightPerSlot, () => {
        const mounted = mount(rowOf([made('a', { slots: 2, maxSlots: 3 })], { heightPerSlot }, height + 400));
        const out = px(slotOf(mounted.container, 'a').style.height);
        mounted.unmount();
        return out;
      });
    }
  });
});

test('heights: the row is as tall as its tallest panel, capped at the measured room, and a view is told its drawn height', () => {
  const { height } = phone();
  const entries = [made('a'), made('b', { slots: 2, maxSlots: 3 }), made('c', { slots: 3, maxSlots: 3 })];
  const room = mount(rowOf(entries, undefined, height + 400));
  assert.deepEqual(['a', 'b', 'c'].map((id) => px(slotOf(room.container, id).style.height)), [height, height + 48, height + 96]);
  assert.equal(boxHeight(room.container), height + 96, 'the row box grows to the tallest panel');
  assert.deepEqual(['a', 'b', 'c'].map((id) => summaries.get(id)!.size?.height), [height, height + 48, height + 96], 'the summary carries the drawn height');
  room.unmount();
  const tight = mount(rowOf(entries, undefined, height + 60));
  assert.equal(px(slotOf(tight.container, 'c').style.height), height + 60, 'capped at the room');
  tight.unmount();
  const unmeasured = mount(rowOf(entries, undefined, 0));
  assert.deepEqual(['a', 'b', 'c'].map((id) => px(slotOf(unmeasured.container, id).style.height)), [height, height, height], 'unmeasured: every panel keeps the phone height');
  unmeasured.unmount();
});

test('differential tuning.rowAlign: a shorter panel sits at the top, the middle or the bottom of the row box', () => {
  const { height } = phone();
  const topOf = (rowAlign: 'top' | 'center' | 'bottom'): number => {
    const mounted = mount(rowOf([made('a'), made('b', { slots: 3, maxSlots: 3 })], { rowAlign }, height + 400));
    const out = px(slotOf(mounted.container, 'a').style.top);
    mounted.unmount();
    return out;
  };
  assert.deepEqual(['top', 'center', 'bottom'].map((a) => topOf(a as 'top')), [0, 48, 96], 'the phone panel beside a three-slot one: 0, half and all of the 96 px difference');
  differential('tuning.rowAlign', (run) => {
    for (const rowAlign of ['top', 'bottom'] as const) run(rowAlign, () => topOf(rowAlign));
  });
});

test('a hand-built entry without slots keeps the phone height and the older width rule', () => {
  const { height } = phone();
  const entry: PanelWindow = { id: 'h', url: 'https://h.example', title: 'h', live: true, locked: false, view: 'slot-view', collapsible: true, listed: true };
  const mounted = mount(rowOf([entry], undefined, height + 400));
  assert.equal(boxHeight(mounted.container), height);
  assert.equal(slotOf(mounted.container, 'h').style.height, '', 'the slot fills the row');
  mounted.unmount();
});

test('setSlots clamps to maxSlots, needs a resizable panel and no-ops on an unchanged count; setFormFactor is slots by tier', () => {
  const rows = [made('a', { slots: 1, maxSlots: 3, formFactors: ['phone', 'tablet', 'desktop'] })];
  const two = setSlots(rows, 'a', 2);
  assert.equal(two[0]!.slots, 2);
  assert.equal(setSlots(two, 'a', 2), two, 'unchanged: the same array');
  assert.equal(setSlots(two, 'a', 9)[0]!.slots, 3, 'clamped to maxSlots');
  assert.equal(setSlots(two, 'a', 0)[0]!.slots, 1, 'clamped to one');
  const frozen = [made('f', { resizable: false })];
  assert.equal(setSlots(frozen, 'f', 2), frozen, 'a panel that is not resizable refuses');
  assert.equal(setFormFactor(rows, 'a', 'tablet')[0]!.slots, 2, 'tablet is two slots');
  assert.equal(setFormFactor(rows, 'a', 'desktop')[0]!.slots, 3, 'desktop is every slot the panel may take');
});

test('resolver: formFactor is the view of slots, and the later layer wins when both are asked', () => {
  const both = resolvePanelSettings({ template: { slots: 3 } as never, instance: { formFactor: 'phone' } as never }).value;
  assert.deepEqual([both.slots, both.formFactor], [1, 'phone'], 'the instance layer is after the template');
  const earlier = resolvePanelSettings({ template: { formFactor: 'phone' } as never, instance: { slots: 3 } as never }).value;
  assert.deepEqual([earlier.slots, earlier.formFactor], [3, 'desktop']);
  const capped = resolvePanelSettings({ template: { slots: 5, maxSlots: 4 } as never }).value;
  assert.equal(capped.slots, 4, 'slots is held to maxSlots');
});

test('resolver: a fixed column keeps the size settings its own layers asked for, and is forced to one slot otherwise', () => {
  const own = resolvePanelSettings({ template: { parkable: false } as never, instance: { resizable: true, maxSlots: 3, slots: 2 } as never }).value;
  assert.deepEqual([own.resizable, own.maxSlots, own.slots], [true, 3, 2], 'an instance-asked History size stands');
  const workspace = resolvePanelSettings({ workspace: { resizable: true, maxSlots: 3 } as never, template: { parkable: false } as never });
  assert.deepEqual([workspace.value.resizable, workspace.value.maxSlots, workspace.value.slots], [false, 1, 1], 'the workspace default does not unlock a fixed column');
  assert.deepEqual(workspace.conflicts, []);
});

test('resolver: resizable set with maxSlots at 1 is kept and noted', () => {
  const res = resolvePanelSettings({ instance: { resizable: true, formFactors: ['phone'] } as never });
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

test('a panel closing out of a tall row leaves by the row bottom, not the phone height', async () => {
  const { height } = phone();
  const rowBottom = height + 96;
  const closing = new Set(['b']);
  const ui = (entries: PanelWindow[]): React.ReactElement =>
    React.createElement(RowHeightContext.Provider, { value: height + 400 }, withHost(React.createElement(PanelRow, { entries, rootId: ROOT, closingIds: closing, enteringViaAnchorIds: NONE })));
  const mounted = mount(ui([made('a'), made('b', { slots: 3, maxSlots: 3 })]));
  mounted.rerender(ui([made('a')]));
  let y = 0;
  for (let frame = 0; frame < 120; frame += 1) {
    await advanceFrames(16);
    const slot = mounted.container.querySelector('[data-slot="b"]')?.parentElement;
    if (!slot) break;
    y = Number(/translateY\((-?[\d.e+-]+)px\)/.exec(slot.style.transform)?.[1] ?? y);
  }
  mounted.unmount();
  assert.ok(y > height, `the slot dropped past the phone height (${y})`);
  assert.ok(y <= rowBottom, `and no further than the row bottom (${y})`);
});

test('setSlots above a panel maxSlots warns once, as a template asking too much does, and still clamps', () => {
  const warn = mock.method(console, 'warn', () => undefined);
  try {
    const m = mountRow(row(rootEntry(), scrollMade('a', { slots: 1, maxSlots: 2, formFactors: ['phone', 'tablet'] })), 1000);
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
