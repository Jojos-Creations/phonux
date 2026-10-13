/**
 * Slot sizing: a panel is n whole slots wide and a measured amount taller per slot. The pure arithmetic first, then a
 * mounted PanelRow for the widths, the heights, the alignment and the summary a view reads, one differential per
 * setting this entry owns, and the resolver rules for slots against formFactor.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { PanelRow, registerView, resolvePanelSettings } from '../index.js';
import type { PanelSummary, PanelWindow, WorkspaceTuning } from '../index.js';
import { drawnSlotsOf } from '../panelTiers.js';
import { RowHeightContext, resolveWorkspaceTuning } from '../panelTuning.js';
import { applyTemplate } from '../panelSettings.js';
import { appendPanel, createHistoryPanel, setFormFactor, setSlots } from '../panelWindow.js';
import { projectWorkspaceState } from '../workspaceState.js';
import { ALL_SLOTS, EDGE_PADDING, fitSlots, slotHeight, slotWidth, slotsOfTier, tierOfSlots } from '../rowConstants.js';
import { differential, differentialsCovered } from './support/differential.js';
import { computeRowNumbers } from '../rowNumbers.js';
import { Workspace } from '../Workspace.js';
import { advanceFrames, cleanup, mount, withHost } from './support/mount-harness.js';
import { pinRig } from './support/pin-rig.js';
import { markerTemplate } from './support/workspace-row.js';

const ROOT = 'root';
const NONE: ReadonlySet<string> = new Set();
const OWNED = ['slots', 'maxSlots', 'tuning.heightPerSlot', 'tuning.rowAlign', 'tuning.edgePadding'];
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

const fitAt = (container: number, gap: number, edge: number): number => fitSlots(computeRowNumbers({ entries: [made('a')], phoneWidth: 390, containerWidth: container, gap, edge }).windowWidth, 390, gap);

test('the edge padding is its own tuning: the window is the container less it each side, whatever the row gap, and the default is 24', () => {
  assert.equal(computeRowNumbers({ entries: [made('a')], phoneWidth: 390, containerWidth: 1000, gap: 16, edge: 24 }).windowWidth, 952);
  assert.equal(computeRowNumbers({ entries: [made('a')], phoneWidth: 390, containerWidth: 1000, gap: 16 }).windowWidth, 968, 'without an edge the gap stands in, as 0.1.0 priced it');
  assert.equal(EDGE_PADDING, 24);
  // Fit per gap at an edge padding of 24 (the app's): the window at 844 is 796, exactly two slots at gap 16 and one short of two at gap 24.
  assert.deepEqual([844, 1280, 1800].map((container) => fitAt(container, 16, 24)), [2, 3, 4]);
  assert.deepEqual([844, 1280, 1800].map((container) => fitAt(container, 24, 24)), [1, 3, 4]);
  assert.deepEqual([843, 844].map((container) => fitAt(container, 16, 24)), [1, 2], 'one pixel less than 844 loses the second slot');
  assert.deepEqual([843, 844].map((container) => fitAt(container, 16, 16)), [2, 2], 'at 16 of padding the same pixel changes nothing');
});

test('the edge padding does not follow the row gap, and a refused value falls back to 24', () => {
  assert.equal(resolveWorkspaceTuning({ rowGap: 40 }).edgePadding, 24);
  assert.equal(resolveWorkspaceTuning({ rowGap: 40, edgePadding: 8 }).edgePadding, 8);
  assert.equal(resolveWorkspaceTuning({ edgePadding: -1 }).edgePadding, 24);
  assert.equal(resolveWorkspaceTuning(undefined).edgePadding, EDGE_PADDING);
});

test('differential tuning.edgePadding: a wider padding leaves the strip a narrower window and the container more padding', () => {
  differential('tuning.edgePadding', (run) => {
    for (const edgePadding of [16, 24]) {
      run(edgePadding, () => {
        const containerRef = { current: null as HTMLDivElement | null };
        const rowRef = { current: null as HTMLDivElement | null };
        const mounted = mount(withHost(React.createElement(Workspace, { overflowContainerRef: containerRef, rowRef, containerWidth: 1000, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: 1, liveWidths: [], tuning: { edgePadding }, children: React.createElement('i') })));
        const style = getComputedStyle(containerRef.current!);
        const out = [style.paddingTop, style.paddingLeft, style.paddingRight, style.paddingBottom, computeRowNumbers({ entries: [made('a')], phoneWidth: 390, containerWidth: 1000, gap: 16, edge: edgePadding }).windowWidth];
        mounted.unmount();
        return out;
      });
    }
  });
});

test('drawnSlotsOf holds a panel to its maxSlots even when its slots say more, and to what fits when that is less', () => {
  const entry = (slots: number | undefined, maxSlots: number | undefined) => ({ slots, settings: maxSlots === undefined ? undefined : { maxSlots } }) as never;
  assert.equal(drawnSlotsOf(entry(4, 2), 390, 5000), 2, 'slots above the cap');
  assert.equal(drawnSlotsOf(entry(4, 4), 390, slotWidth(3, 390, 16)), 3, 'a window that fits three');
  assert.equal(drawnSlotsOf(entry(2, undefined), 390, 5000), 2, 'no cap on the entry');
  assert.equal(drawnSlotsOf(entry(undefined, 2), 390, 5000), undefined, 'a hand-built entry keeps its tier');
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

test('a closing panel leaves the row box at once: the row is as tall as the tallest panel that stays', () => {
  const { height } = phone();
  const tall = made('b', { slots: 3, maxSlots: 3 });
  const room = height + 400;
  const mounted = mount(rowOf([made('a'), tall], undefined, room, slotWidth(3, 390, 16)));
  const withTall = boxHeight(mounted.container);
  assert.ok(withTall > height, 'positive control: a three-slot panel makes the row taller than a phone');
  mounted.rerender(rowOf([made('a')], undefined, room, slotWidth(3, 390, 16)));
  assert.equal(boxHeight(mounted.container), height, 'with the tall panel gone the row box is a phone tall again, while the panel animates out');
  mounted.unmount();
});

test('History resized while the row is scrolled to its end: the strip grows by the slot and the gap, nothing parks, and the position stays inside the new strip', async () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const root = markerTemplate('root', { settings: { title: 'History', resizable: true, maxSlots: 3, formFactors: ['phone', 'tablet', 'desktop'] } });
  const r = await pinRig({ ids, width: 1000, settings: Object.fromEntries(ids.map((id) => [id, { overflow: 'scroll' } as never])), workspace: { tuning: { rowGesture: 'free', edgePadding: 16 }, root } as never });
  await r.settle();
  const numbers = () => r.m.latest().rowNumbers;
  const before = numbers();
  const farthest = before.stripWidth - before.windowWidth;
  r.m.container.scrollLeft = farthest;
  const live = r.live();
  assert.equal(before.widths[0], 390, 'positive control: History starts at one slot');
  const res = r.turn(() => r.ws.panels.get('root')!.setSlots(2));
  assert.deepEqual({ ...res }, { ok: true, changed: true });
  await advanceFrames(900);
  const after = numbers();
  assert.equal(after.widths[0], slotWidth(2, 390, 16));
  assert.equal(after.stripWidth - before.stripWidth, 390 + 16, 'one more phone width and its gap');
  assert.deepEqual(r.live(), live, 'a scrolling row parks nothing');
  assert.ok(r.m.container.scrollLeft <= after.stripWidth - after.windowWidth, 'the position is inside the new strip');
  assert.equal(after.leftOffsets[after.leftOffsets.length - 1]! + after.widths[after.widths.length - 1]!, after.stripWidth, 'the last panel still ends the strip');
});
