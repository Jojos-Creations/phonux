/**
 * The row gap reaches every site that prices or draws the row, from the one resolved value: literal arithmetic at
 * gaps 0, 16 and 40 over widths [390, two slots, 390] with one fixed column, a seeded consistency property between the
 * capacity and the layout budget, and the single-render rule for a PanelRow inside a Workspace. Every expected
 * number is written from its sum, never read back from the code under test.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { Workspace, useProvidePanels, usePanelTuning } from '../index.js';
import type { PanelWindow, ProvidedPanels, WorkspaceHandle, WorkspaceTuning } from '../index.js';
import { computeMaxLiveWidth, computeRowLayout } from '../panelRowLayout.js';
import { panelRowSlotMotion } from '../PanelRowSlot.js';
import { workspaceShellStyle } from '../Workspace.js';
import { cleanup, mount, withHost, useSeededInput, StaticRow, plainTemplate } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';

const GAPS = [0, 16, 40] as const;
const ROOT = 'root';

const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({
  id,
  url: `https://${id}.example`,
  title: id.toUpperCase(),
  live: true,
  locked: false,
  view: 'gap-view',
  collapsible: true,
  listed: true,
  ...over,
});
const fixedRoot = (): PanelWindow => entry(ROOT, { url: '', title: 'History', locked: true, collapsible: false, listed: false });
const twoSlots = (id: string): PanelWindow => entry(id, { slots: 2, size: { width: 796, height: 'fill' } });

registerTestView('gap-view', ({ panel }) => React.createElement('i', { 'data-slot': panel.id }, panel.title));

afterEach(() => {
  mock.restoreAll();
  cleanup();
});

const NONE: ReadonlySet<string> = new Set();
const rowOf = (entries: PanelWindow[], tuning?: WorkspaceTuning): React.ReactElement =>
  withHost(React.createElement(StaticRow, { entries, rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE, ...(tuning === undefined ? {} : { tuning }) }));
const slotX = (container: HTMLElement, id: string): number => {
  const slot = container.querySelector(`[data-slot="${id}"]`)?.parentElement;
  assert.ok(slot, `slot ${id} is mounted`);
  const match = /translateX\((-?[\d.]+)px\)/.exec(slot.style.transform);
  return match === null ? 0 : Number(match[1]);
};

/** useProvidePanels over the fixed root column at `containerWidth`, after `count` creates each in its own act. */
function provided(rowGap: number, containerWidth: number, count = 0): { now: () => ProvidedPanels; live: () => number; unmount: () => void } {
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(useSeededInput({ initialEntries: [fixedRoot()], containerWidth, workspaceDefaults: { overflow: 'park' }, tuning: { rowGap } }));
    return React.createElement('output');
  }
  const mounted = mount(React.createElement(Probe));
  for (let i = 0; i < count; i += 1) {
    act(() => {
      latest!.create();
    });
  }
  return { now: () => latest!, live: () => latest!.entries.filter((p) => p.collapsible && p.live).length, unmount: mounted.unmount };
}

const SITES = [
  'PanelRow slot offsets',
  'PanelRow reserved width',
  'panelRowSlotMotion travel',
  'Workspace padding and flex gap',
  'workspaceShellStyle marginLeft',
  'computeMaxLiveWidth',
  'capacity through useProvidePanels',
  'useProvidePanels maxLiveWidth',
] as const;

test('the gap threads through every site at gaps 0, 16 and 40, from literal sums', () => {
  let executed = 0;
  // Capacity: live panels after a burst at a 1950 and a 1700 px container, (width - 2 gap - 390) / (390 + gap) rounded down.
  const capacity: Record<number, [number, number]> = { 0: [4, 3], 16: [3, 3], 40: [3, 2] };
  const margin: Record<number, number> = { 0: 426, 16: 394, 40: 346 };
  const maxLive: Record<number, number> = { 0: 2010, 16: 1962, 40: 1890 };
  for (const gap of GAPS) {
    // Site 1 and 2: three present entries of 390, two slots wide and 390.
    const row = mount(rowOf([fixedRoot(), twoSlots('t'), entry('p')], { rowGap: gap }));
    assert.deepEqual([slotX(row.container, ROOT), slotX(row.container, 't'), slotX(row.container, 'p')], [0, 390 + gap, 390 + gap + (780 + gap) + gap], `offsets at gap ${gap}`);
    executed += 1;
    assert.equal(getComputedStyle(row.container.firstElementChild!).width, `${390 + (780 + gap) + 390 + 2 * gap}px`, `reserved width at gap ${gap}`);
    executed += 1;
    row.unmount();
    // Site 3: the travel of a slot entering from the right is its own width plus the gap.
    assert.deepEqual(panelRowSlotMotion(0, 390, 700, 'right', 'left', gap).initial, { x: 390 + gap, opacity: 0 }, `travel at gap ${gap}`);
    executed += 1;
    // Site 4: the markup of the shell.
    const containerRef = { current: null } as React.RefObject<HTMLDivElement | null>;
    const rowRef = { current: null } as React.RefObject<HTMLDivElement | null>;
    const shell = mount(
      withHost(
        React.createElement(Workspace, {
          overflowContainerRef: containerRef,
          rowRef,
          containerWidth: 2400,
          rowResizeSettled: true,
          phoneWidth: 390,
          fixedColumnCount: 1,
          liveWidths: [768, 390],
          tuning: { rowGap: gap },
          children: React.createElement('i'),
        }),
      ),
    );
    const style = getComputedStyle(containerRef.current!);
    assert.deepEqual([style.paddingTop, style.paddingLeft, style.paddingRight, style.paddingBottom], Array(4).fill(`${gap}px`), `padding at gap ${gap}, the top one with topPadding omitted`);
    assert.equal(rowRef.current!.style.gap, `${gap}px`);
    executed += 1;
    shell.unmount();
    // Site 5: (2400 - 2 gap - (390 + (768 + gap) + (390 + gap))) / 2.
    assert.equal(workspaceShellStyle({ containerWidth: 2400, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: 1, liveWidths: [768, 390], gap }).marginLeft, margin[gap], `margin at gap ${gap}`);
    executed += 1;
    // Site 6: 2400 - 2 gap - 390 - gap.
    assert.equal(computeMaxLiveWidth({ containerWidth: 2400, phoneWidth: 390, gap, fixedItemCount: 1 }), maxLive[gap], `max live width at gap ${gap}`);
    executed += 1;
    // Site 7: the capacity the manager derives, seen as the live count after a burst of ten creates.
    const [wide, narrow] = capacity[gap]!;
    const atWide = provided(gap, 1950, 10);
    assert.equal(atWide.live(), wide, `capacity at 1950 and gap ${gap}`);
    atWide.unmount();
    const atNarrow = provided(gap, 1700, 10);
    assert.equal(atNarrow.live(), narrow, `capacity at 1700 and gap ${gap}`);
    atNarrow.unmount();
    executed += 1;
    // Site 8: the provider's own maxLiveWidth.
    const priced = provided(gap, 2400);
    assert.equal(priced.now().maxLiveWidth, maxLive[gap], `provided maxLiveWidth at gap ${gap}`);
    assert.equal(priced.now().tuning.rowGap, gap);
    priced.unmount();
    executed += 1;
  }
  assert.equal(executed, GAPS.length * SITES.length);
});

type Rng = () => number;
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('property: over 300 seeded rows the live panels that fit never exceed the layout budget, and the manager capacity is the fixed column plus what fits', () => {
  const rng = mulberry32(11);
  let checked = 0;
  for (let n = 0; n < 300; n += 1) {
    const containerWidth = 400 + Math.floor(rng() * 2600);
    const gap = Math.floor(rng() * 61);
    const liveWidths = Array.from({ length: 1 + Math.floor(rng() * 6) }, () => (rng() < 0.5 ? 390 : 768));
    // The budget: max(0, containerWidth - 2 gap) - (1 x 390 + 0 x gap), the width left beside the one fixed column.
    const budget = Math.max(0, containerWidth - 2 * gap) - 390;
    const layout = computeRowLayout({ containerWidth, phoneWidth: 390, gap, fixedItemCount: 1, liveWidths });
    const used = liveWidths.slice(0, layout.effectiveLiveCount).reduce((sum, width) => sum + width + gap, 0);
    assert.ok(used - gap <= Math.max(0, budget), `row ${n}: ${used - gap} px of panels, the last without its trailing gap, inside a budget of ${budget}`);
    assert.ok(used <= Math.max(0, budget), `row ${n}: every panel counted with its gap stays inside the budget`);
    // Phone panels only: the fit count is floor(budget / (390 + gap)), and the live count of a burst has a floor of one.
    const phones = computeRowLayout({ containerWidth, phoneWidth: 390, gap, fixedItemCount: 1, liveWidths: Array.from({ length: 12 }, () => 390) });
    const fits = Math.max(0, Math.floor(budget / (390 + gap)));
    assert.equal(Math.min(phones.maxLiveThatFit, 12), Math.min(fits, 12), `row ${n}: the layout fit count`);
    const p = provided(gap, containerWidth, fits + 2);
    assert.equal(p.live(), Math.max(1, fits), `row ${n}: container ${containerWidth}, gap ${gap}`);
    p.unmount();
    checked += 1;
  }
  assert.equal(checked, 300);
});

// ---------------------------------------------------------------------------
// One value per render
// ---------------------------------------------------------------------------

interface Commit {
  slotGap: number;
  padding: number;
  flexGap: number;
  boxGap: number;
  capacityGap: number;
}

test('a PanelRow inside a Workspace at rowGap 40 draws, pads and prices at 40, and a change of tuning reaches every consumer in one commit', () => {
  const log: Commit[] = [];
  const containerRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  const rowRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  let provided2: ProvidedPanels | undefined;
  /** Rendered as the last view of the row: its layout effect runs after the whole commit's DOM writes. */
  registerTestView('gap-probe', () => {
    const slotGap = usePanelTuning().rowGap;
    React.useLayoutEffect(() => {
      // The refs are attached after this effect on a first commit, so the nodes are found from the first slot: slot, row box, flex row, scroll container.
      const box = document.querySelector('[data-slot="a"]')!.parentElement!.parentElement!;
      const padding = Number.parseFloat(getComputedStyle(box.parentElement!.parentElement!).paddingLeft);
      const flexGap = Number.parseFloat(box.parentElement!.style.gap);
      // Two present panels of 390: the row box is 780 + gap wide.
      const boxGap = Number.parseFloat(getComputedStyle(box).width) - 780;
      // maxLiveWidth = 2400 - 2 gap - 390 - gap.
      log.push({ slotGap, padding, flexGap, boxGap, capacityGap: (2010 - provided2!.maxLiveWidth) / 3 });
    });
    return React.createElement('i', { 'data-probe': '' });
  });
  let shared: WorkspaceHandle | undefined;
  function Host(): React.ReactElement {
    const input = useSeededInput({ initialEntries: [fixedRoot()], containerWidth: 2400, workspaceDefaults: { overflow: 'park' }, tuning: { rowGap: 40 }, templates: [plainTemplate('gap-probe')] });
    shared = input.workspace;
    provided2 = useProvidePanels(input);
    const tuning = { rowGap: provided2.tuning.rowGap };
    return withHost(
      React.createElement(Workspace, {
        overflowContainerRef: containerRef,
        rowRef,
        containerWidth: 2400,
        rowResizeSettled: true,
        phoneWidth: 390,
        fixedColumnCount: 1,
        liveWidths: [],
        tuning,
        children: React.createElement(StaticRow, { workspace: input.workspace, entries: [entry('a'), entry('b', { view: 'gap-probe' })], rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE }),
      }),
    );
  }
  mount(React.createElement(Host));
  assert.ok(log.length > 0, 'the probe committed');
  for (const commit of log) assert.deepEqual(commit, { slotGap: 40, padding: 40, flexGap: 40, boxGap: 40, capacityGap: 40 });
  const before = log.length;
  act(() => shared!.panels.configureTuning({ rowGap: 16 }));
  assert.ok(log.length > before, 'the change committed');
  const after = log.slice(before);
  for (const commit of after) assert.deepEqual(commit, { slotGap: 16, padding: 16, flexGap: 16, boxGap: 16, capacityGap: 16 });
  const gaps = new Set(log.flatMap((commit) => [commit.slotGap, commit.padding, commit.flexGap, commit.boxGap, commit.capacityGap]));
  assert.deepEqual([...gaps].sort((x, y) => x - y), [16, 40]);
  for (const commit of log) assert.equal(new Set(Object.values(commit)).size, 1, 'no commit holds two gaps');
});

const NO_ROW_REF = (): React.RefObject<HTMLDivElement | null> => ({ current: null });
/** A Workspace at `workspace` over one PanelRow carrying `row` as its own tuning prop, when given. */
const inWorkspace = (
  workspace: WorkspaceTuning,
  row: WorkspaceTuning | undefined,
  entries: PanelWindow[] = [entry('a')],
  rowRef: React.RefObject<HTMLDivElement | null> = NO_ROW_REF(),
  liveWidths: number[] = [],
): React.ReactElement =>
  withHost(
    React.createElement(Workspace, {
      overflowContainerRef: NO_ROW_REF(),
      rowRef,
      containerWidth: 2400,
      rowResizeSettled: true,
      phoneWidth: 390,
      fixedColumnCount: 1,
      liveWidths,
      tuning: workspace,
      children: React.createElement(StaticRow, { entries, rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE, ...(row === undefined ? {} : { tuning: row }) }),
    }),
  );
/** How many warnings one mount of a Workspace at `workspace` over a PanelRow carrying `row` prints. */
function warnsFor(workspace: WorkspaceTuning, row: WorkspaceTuning | undefined): number {
  const warn = mock.method(console, 'warn', () => undefined);
  const mounted = mount(inWorkspace(workspace, row));
  const count = warn.mock.callCount();
  mounted.unmount();
  warn.mock.restore();
  return count;
}
/** The props of the nearest motion component above `el` that carries `key`. */
function motionProps(el: Element, key: string): Record<string, unknown> {
  const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  assert.ok(fiberKey, 'the node has a React fiber');
  for (let fiber = (el as unknown as Record<string, { return: unknown; memoizedProps?: Record<string, unknown> }>)[fiberKey]!; fiber; fiber = fiber.return as typeof fiber) {
    if (fiber.memoizedProps !== undefined && key in fiber.memoizedProps) return fiber.memoizedProps;
  }
  assert.fail(`no motion component above the node carries ${key}`);
}

test('a PanelRow with its own tuning that differs from its Workspace warns once in development; equal tuning warns never', () => {
  const warn = mock.method(console, 'warn', () => undefined);
  const equal = mount(inWorkspace({ rowGap: 40 }, { rowGap: 40 }));
  equal.rerender(inWorkspace({ rowGap: 40 }, { rowGap: 40 }));
  assert.equal(warn.mock.callCount(), 0, 'equal values');
  equal.unmount();
  const none = mount(inWorkspace({ rowGap: 40 }, undefined));
  assert.equal(warn.mock.callCount(), 0, 'no prop at all');
  none.unmount();
  const differs = mount(inWorkspace({ rowGap: 40 }, { rowGap: 24 }));
  assert.equal(warn.mock.callCount(), 1, 'a differing gap warns');
  differs.rerender(inWorkspace({ rowGap: 40 }, { rowGap: 24 }));
  differs.rerender(inWorkspace({ rowGap: 40 }, { rowGap: 24, hopFraction: 0.3 }));
  assert.equal(warn.mock.callCount(), 1, 'and only once per instance, however many renders follow');
  differs.unmount();
  const alone = mount(rowOf([entry('a')], { rowGap: 24 }));
  assert.ok(alone.container.querySelector('[data-slot="a"]'), 'a row with a tuning prop and no Workspace above it renders');
  assert.equal(warn.mock.callCount(), 1, 'and does not warn: there is nothing to disagree with');
  mount(inWorkspace({ rowGap: 40 }, { rowGap: 24 }));
  assert.equal(warn.mock.callCount(), 2, 'a second instance warns on its own');
});

test('a PanelRow prop beats the Workspace tuning in what the row draws', () => {
  mock.method(console, 'warn', () => undefined);
  const mounted = mount(inWorkspace({ rowGap: 40 }, { rowGap: 24 }, [entry('a'), entry('b')]));
  assert.equal(slotX(mounted.container, 'b'), 390 + 24, 'the second slot rests one prop gap beyond the first column, not one Workspace gap');
});

test('the row gap reaches the slot that is entering: through a PanelRow at gap 40 it starts one own span, 40 included, beyond its rest', () => {
  const mounted = mount(rowOf([entry('a')], { rowGap: 40 }));
  mounted.rerender(rowOf([entry('a'), entry('b')], { rowGap: 40 }));
  assert.equal(slotX(mounted.container, 'b'), 390 + 40 + (390 + 40), 'rest 430 plus the slot span 430');
});

test('the Workspace hands its row gap to the shell margin: with live widths [768, 390] at gap 40 the shell sits 346 left', () => {
  const rowRef = NO_ROW_REF();
  mount(inWorkspace({ rowGap: 40 }, undefined, [entry('a')], rowRef, [768, 390]));
  assert.deepEqual(motionProps(rowRef.current!, 'animate').animate, { marginLeft: 346 });
});

test('a differing look leaf warns, whichever of the five it is', () => {
  const differing: Array<[string, WorkspaceTuning]> = [
    ['rowGap', { rowGap: 24 }],
    ['dragToClose', { dragToClose: { minDistancePx: 100 } }],
    ['slide', { slide: { durationSec: 0.9 } }],
    ['hopFraction', { hopFraction: 0.3 }],
    ['edgeScroll', { edgeScroll: { zonePx: 60 } }],
  ];
  for (const [leaf, row] of differing) assert.equal(warnsFor({}, row), 1, `${leaf} differs from the Workspace default`);
});

test('a leaf the row does not read does not warn when it differs', () => {
  assert.equal(warnsFor({}, { saveQuietMs: 900 }), 0, 'saveQuietMs is the host persistence cadence, not part of the look');
});

test('the warning is once per instance for its lifetime: it does not come again when the disagreement ends and returns', () => {
  const warn = mock.method(console, 'warn', () => undefined);
  const mounted = mount(inWorkspace({ rowGap: 40 }, { rowGap: 24 }));
  mounted.rerender(inWorkspace({ rowGap: 24 }, { rowGap: 24 }));
  mounted.rerender(inWorkspace({ rowGap: 40 }, { rowGap: 24 }));
  assert.equal(warn.mock.callCount(), 1);
});

test('the warning is for development only: nothing prints when NODE_ENV is production, and it does when it is not', () => {
  const before = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.equal(warnsFor({}, { rowGap: 24 }), 0, 'production');
    process.env.NODE_ENV = 'development';
    assert.equal(warnsFor({}, { rowGap: 24 }), 1, 'development');
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
});
