/**
 * The row gap reaches every site that prices or draws the row, from the one resolved value: literal arithmetic at
 * gaps 0, 16 and 40 over widths [390, two slots, 390] with one fixed column, a seeded consistency property between the
 * capacity and the layout budget, and the single-render rule for a PanelRow inside a Workspace. Every expected
 * number is written from its sum, never read back from the code under test.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { stripMarginOf } from './support/strip.js';
import * as React from 'react';
import { act } from 'react';
import { Workspace, createWorkspace, useProvidePanels, usePanelTuning } from '../index.js';
import type { PanelWindow, ProvidedPanels, WorkspaceHandle, WorkspaceTuning } from '../index.js';
import { computeMaxLiveWidth, computeRowLayout } from '../panelRowLayout.js';
import { panelRowSlotMotion } from '../PanelRowSlot.js';
import { workspaceShellStyle } from '../Workspace.js';
import { cleanup, mount, withHost, useSeededInput, StaticRow, plainTemplate } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';
import { made, mountRow, rootEntry, row } from './support/scroll-row.js';
import { slotTransform } from './support/strip.js';

const GAPS = [0, 16, 40] as const;
const ROOT = 'root';

const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({
  id,
  url: `https://${id}.example`,
  title: id.toUpperCase(),
  live: true,
  view: 'gap-view',
  collapsible: true,
  listed: true,
  ...over,
});
const fixedRoot = (): PanelWindow => entry(ROOT, { url: '', title: 'History', collapsible: false, listed: false });
const twoSlots = (id: string): PanelWindow => entry(id, { slots: 2 });

registerTestView('gap-view', ({ panel }) => React.createElement('i', { 'data-slot': panel.id }, panel.title));

afterEach(() => {
  mock.restoreAll();
  cleanup();
});

const NONE: ReadonlySet<string> = new Set();
const rowOf = (entries: PanelWindow[], tuning?: WorkspaceTuning): React.ReactElement =>
  withHost(React.createElement(StaticRow, { entries, rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE, ...(tuning === undefined ? {} : { seed: { tuning } }) }));
const slotX = (container: HTMLElement, id: string): number => {
  const slot = container.querySelector(`[data-slot="${id}"]`)?.closest<HTMLElement>('[data-row-slot]');
  assert.ok(slot, `slot ${id} is mounted`);
  const match = /translateX\((-?[\d.]+)px\)/.exec(slotTransform(slot));
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

const NO_ROW_REF = (): React.RefObject<HTMLDivElement | null> => ({ current: null });
/** A Workspace shell over one PanelRow, both reading a workspace made with `tuning`. */
const inWorkspace = (
  tuning: WorkspaceTuning,
  entries: PanelWindow[] = [entry('a')],
  rowRef: React.RefObject<HTMLDivElement | null> = NO_ROW_REF(),
  liveWidths: number[] = [],
): React.ReactElement => {
  const workspace = createWorkspace({ mount: false, tuning });
  return withHost(
    React.createElement(Workspace, {
      overflowContainerRef: NO_ROW_REF(),
      rowRef,
      containerWidth: 2400,
      rowResizeSettled: true,
      phoneWidth: 390,
      fixedColumnCount: 1,
      liveWidths,
      workspace,
      children: React.createElement(StaticRow, { workspace, entries, rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE }),
    }),
  );
};

test('the row gap reaches the slot that is entering: through a PanelRow at gap 40 it starts one own span, 40 included, beyond its rest', () => {
  const m = mountRow(row(rootEntry(), made('a')), 2400, { tuning: { rowGap: 40 } });
  assert.equal(slotX(m.container, 'a'), 390 + 40, 'control: a rests one column and one gap in');
  act(() => void m.latest().create({ view: 'scroll-row-view' }));
  const slots = [...m.container.querySelectorAll('[data-slot]')].map((el) => el.getAttribute('data-slot')!);
  assert.equal(slots.length, 3, 'the new slot is mounted');
  const id = slots[2]!;
  assert.equal(slotX(m.container, id), 2 * (390 + 40) + (390 + 40), 'rest 860 plus the slot span 430');
});

