/**
 * What the row's look numbers produce at the library gap of 16 and the shared slide: the markup of the workspace
 * shell, the row's own offsets and width, a slot's travel and close exit, the capacity a measured row derives, and the
 * hop rule of a horizontal drag. Each pin states a literal sum, never a call back into the code under test, so a
 * change that moves any of them has to rename the pin it changes and cannot delete it.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { Workspace, useProvidePanels, GAP } from '../index.js';
import type { PanelWindow, ProvidedPanels } from '../index.js';
import { DRAG_CLOSE } from '../dragToClose.js';
import { computeRowLayout } from '../panelRowLayout.js';
import { panelRowSlotMotion } from '../PanelRowSlot.js';
import { reorderStepsForOffset } from '../panelWindow.js';
import { cleanup, mount, withHost, useSeededInput, StaticRow } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';

registerTestView('pin-look', ({ panel }) => React.createElement('i', { 'data-slot': panel.id }, panel.title));

const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({
  id,
  url: `https://${id}.example`,
  title: id.toUpperCase(),
  live: true,
  view: 'pin-look',
  collapsible: true,
  listed: true,
  ...over,
});
const twoSlots = (id: string): PanelWindow => entry(id, { slots: 2 });
const root = (): PanelWindow => entry('root', { url: '', title: 'History', collapsible: false, listed: false });

afterEach(() => cleanup());

test('GAP is the number 16', () => {
  assert.equal(GAP, 16);
});

test('Workspace markup: the top, left, right and bottom padding and the row flex gap are 16 px and the bottom one is the footer room, 40 px, the top one with topPadding omitted', () => {
  const containerRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  const rowRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  const mounted = mount(
    withHost(React.createElement(Workspace, { overflowContainerRef: containerRef, rowRef, containerWidth: 1300, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: 1, liveWidths: [], children: React.createElement('i') })),
  );
  const style = getComputedStyle(containerRef.current!);
  assert.deepEqual([style.paddingTop, style.paddingLeft, style.paddingRight, style.paddingBottom], ['16px', '16px', '16px', '40px']);
  assert.equal(rowRef.current!.style.gap, '16px');
  mounted.unmount();
});

test('Workspace markup: a given topPadding replaces only the top padding (the bottom stays the footer room, 40 px)', () => {
  const containerRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  const rowRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  const mounted = mount(
    withHost(React.createElement(Workspace, { overflowContainerRef: containerRef, rowRef, containerWidth: 1300, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: 1, liveWidths: [], topPadding: 52, children: React.createElement('i') })),
  );
  const style = getComputedStyle(containerRef.current!);
  assert.deepEqual([style.paddingTop, style.paddingLeft, style.paddingRight, style.paddingBottom], ['52px', '16px', '16px', '40px']);
  mounted.unmount();
});

const NONE: ReadonlySet<string> = new Set();
const rowOf = (entries: PanelWindow[]): React.ReactElement => withHost(React.createElement(StaticRow, { entries, rootId: 'root', closingIds: NONE, enteringViaAnchorIds: NONE }));
const slotX = (container: HTMLElement, id: string): number => {
  const slot = container.querySelector(`[data-slot="${id}"]`)?.parentElement;
  assert.ok(slot, `slot ${id} is mounted`);
  const match = /translateX\((-?[\d.]+)px\)/.exec(slot.style.transform);
  return match === null ? 0 : Number(match[1]);
};

test('PanelRow: for widths [390, 796, 390] the slot offsets are 0, 406 and 1218 and the row is 1608 wide', () => {
  const mounted = mount(rowOf([root(), twoSlots('t'), entry('p')]));
  assert.equal(slotX(mounted.container, 'root'), 0);
  assert.equal(slotX(mounted.container, 't'), 390 + 16);
  assert.equal(slotX(mounted.container, 'p'), 390 + 16 + 796 + 16);
  const box = mounted.container.firstElementChild as HTMLElement;
  assert.equal(getComputedStyle(box).width, `${390 + 16 + 796 + 16 + 390}px`);
  mounted.unmount();
});

test('panelRowSlotMotion: a slot enters one own width plus 16 beyond its rest, and a close exit takes the drag-to-close exit seconds', () => {
  const right = panelRowSlotMotion(406, 390, 700, 'right', 'left');
  assert.deepEqual(right.initial, { x: 406 + 390 + 16, opacity: 0 });
  const left = panelRowSlotMotion(406, 768, 700, 'left', 'left');
  assert.deepEqual(left.initial, { x: 406 - (768 + 16), opacity: 0 });
  assert.deepEqual(panelRowSlotMotion(406, 390, 700, 'right', 'right').exit, { x: 406 + 390 + 16, opacity: 0 });
  assert.deepEqual(panelRowSlotMotion(406, 390, 700, 'right', 'left').exit, { x: -(390 + 16), opacity: 0 });
  const down = panelRowSlotMotion(406, 390, 700, 'right', 'down').exit as { y: number; transition: { duration: number; ease: string } };
  assert.equal(down.y, 700);
  assert.equal(down.transition.duration, DRAG_CLOSE.exitSeconds);
  assert.equal(down.transition.duration, 0.18);
});

/** useProvidePanels over a root column, then `count` create() calls each in its own act: how many panels stay live. */
function liveAfterBurst(containerWidth: number, count: number): number {
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(useSeededInput({ initialEntries: [root()], containerWidth, workspaceDefaults: { overflow: 'park' } }));
    return React.createElement('output');
  }
  const mounted = mount(React.createElement(Probe));
  for (let i = 0; i < count; i += 1) {
    act(() => {
      latest!.create();
    });
  }
  const live = latest!.entries.filter((p) => p.collapsible && p.live).length;
  mounted.unmount();
  return live;
}

test('usePanelManager capacity at gap 16: the live count after a create burst is what computeRowLayout fits, 3 at 1700 and 1740 and the edge at 1640', () => {
  const fits = (containerWidth: number): number =>
    computeRowLayout({ containerWidth, phoneWidth: 390, gap: 16, fixedItemCount: 1, liveWidths: Array.from({ length: 10 }, () => 390) }).maxLiveThatFit;
  for (const [width, expected] of [[1639, 2], [1640, 3], [1700, 3], [1740, 3]] as const) {
    assert.equal(fits(width), expected, `computeRowLayout at ${width}`);
    assert.equal(liveAfterBurst(width, 10), expected, `live panels after ten creates at ${width}`);
  }
});

test('reorderStepsForOffset: equal neighbours hop at 203 and not at 202, a two-slot neighbour hops at 392, and nothing beyond the last neighbour counts', () => {
  const equal = { left: [390, 390, 390], right: [390, 390, 390] };
  assert.equal(reorderStepsForOffset(203, equal, GAP), 1);
  assert.equal(reorderStepsForOffset(202, equal, GAP), 0);
  const phoneBesideWide = { left: [], right: [768, 390] };
  assert.equal(reorderStepsForOffset(391, phoneBesideWide, GAP), 0);
  assert.equal(reorderStepsForOffset(392, phoneBesideWide, GAP), 1);
  assert.equal(reorderStepsForOffset(700, phoneBesideWide, GAP), 1);
  assert.equal(reorderStepsForOffset(987, phoneBesideWide, GAP), 2);
  const twoSlotBesidePhone = { left: [390], right: [] };
  assert.equal(reorderStepsForOffset(-203, twoSlotBesidePhone, GAP), -1);
  assert.equal(reorderStepsForOffset(203, twoSlotBesidePhone, GAP), 0);
});
