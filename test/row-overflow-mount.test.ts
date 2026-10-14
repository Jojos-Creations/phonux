/**
 * Mounted rows driven by useProvidePanels: who parks, who scrolls, and which cap prices a wide panel.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { PanelRow, Workspace, registerView, resolvePanelSettings, useProvidePanels } from '../index.js';
import type { PanelSettings, PanelWindow, ProvidedPanels } from '../index.js';
import { createFakeHost } from '../fakeHost.js';
import { applyTemplate } from '../panelSettings.js';
import { computeMaxLiveWidth } from '../panelRowLayout.js';
import { appendPanel, createHistoryPanel } from '../panelWindow.js';
import { computeRowNumbers } from '../rowNumbers.js';
import { fitSlots, slotWidth } from '../rowConstants.js';
import { cleanup, mount, panelsInput, withHost } from './support/mount-harness.js';

afterEach(() => cleanup());

const legacyRoot = (): PanelWindow => ({ id: 'root', url: '', title: 'History', live: true, locked: true, view: 'web', collapsible: false, listed: false });

test('pin R4: a row of hand-built entries at container 1000 keeps History and the newest panel live', () => {
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(panelsInput({ initialEntries: [legacyRoot()], containerWidth: 1000 }));
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  for (let i = 0; i < 3; i += 1) act(() => latest!.create());
  const ids = latest!.entries.map((p) => p.id);
  assert.equal(ids.length, 4);
  assert.deepEqual(latest!.entries.filter((p) => p.live).map((p) => p.id), ['root', ids[3]]);
});

const scrollEntry = (id: string, over: PanelSettings = {}): PanelWindow => {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'ro-view' }, id, 'root')[0]!;
  return applyTemplate(skeleton, resolvePanelSettings({ template: over }).value, 'create');
};
const scrollRoot = (): PanelWindow =>
  applyTemplate({ ...createHistoryPanel('root'), view: 'ro-view' }, resolvePanelSettings({ template: { title: 'History' } }, { root: true }).value, 'create');
registerView('ro-view', ({ panel }) => React.createElement('i', { 'data-slot': panel.id }, panel.title));

const NONE: ReadonlySet<string> = new Set();
function Shell({ provided, containerWidth }: { provided: ProvidedPanels; containerWidth: number }): React.ReactElement {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  return React.createElement(
    Workspace,
    { overflowContainerRef: ref, rowRef, containerWidth, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: provided.fixedViewCount, liveWidths: provided.liveWidths, rowScroll: provided.rowScroll, rowNumbers: provided.rowNumbers, 'data-shell': '' } as never,
    React.createElement(PanelRow, { entries: provided.entries, rootId: 'root', closingIds: NONE, enteringViaAnchorIds: NONE, rowNumbers: provided.rowNumbers }),
  );
}

test('a mount of 11 scroll panels at a measured container of 1000 renders every slot in a strip wider than its window, with overflow-x auto', () => {
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(panelsInput({ initialEntries: [scrollRoot()], containerWidth: 1000, workspaceDefaults: {} }));
    return withHost(React.createElement(Shell, { provided: latest, containerWidth: 1000 }), createFakeHost({ panels: latest }));
  }
  const mounted = mount(React.createElement(Probe));
  for (let i = 0; i < 10; i += 1) act(() => latest!.create({ view: 'ro-view' }));
  assert.equal(mounted.container.querySelectorAll('[data-slot]').length, 11, 'every slot is rendered');
  assert.equal(latest!.rowScroll, true);
  assert.equal(latest!.rowNumbers.stripWidth, 4450);
  assert.equal(latest!.rowNumbers.windowWidth, 968);
  const shell = mounted.container.querySelector('[data-shell]') as HTMLElement;
  assert.equal(getComputedStyle(shell).overflowX, 'auto');
});

test('a row that stops scrolling resets the container scrollLeft to 0 in the same commit', () => {
  const rowNumbers = (entries: PanelWindow[]) => computeRowNumbers({ entries, phoneWidth: 390, containerWidth: 1000, gap: 16 });
  const ref = React.createRef<HTMLDivElement>();
  const rowRef = React.createRef<HTMLDivElement>();
  const at = (entries: PanelWindow[]): React.ReactElement =>
    withHost(React.createElement(Workspace, { overflowContainerRef: ref, rowRef, containerWidth: 1000, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: 1, liveWidths: [], rowNumbers: rowNumbers(entries), children: null }));
  const scrolling = [scrollRoot(), scrollEntry('a')];
  const mounted = mount(at(scrolling));
  ref.current!.scrollLeft = 300;
  mounted.rerender(at(scrolling));
  assert.equal(ref.current!.scrollLeft, 300, 'a row that still scrolls keeps its offset');
  mounted.rerender(at([{ ...createHistoryPanel('root'), view: 'ro-view' }]));
  assert.equal(ref.current!.scrollLeft, 0);
});

test('maxLiveWidth comes from computeRowNumbers at every gap: a 64-slot panel is drawn at the slots that fit the window', () => {
  const expected: Record<number, { rows: number; legacy: number }> = { 0: { rows: 1000, legacy: 610 }, 16: { rows: 968, legacy: 562 }, 40: { rows: 920, legacy: 490 } };
  let gaps = 0;
  for (const gap of [0, 16, 40]) {
    gaps += 1;
    let latest: ProvidedPanels | undefined;
    const entries = [scrollRoot(), scrollEntry('d', { slots: 64 }), scrollEntry('a'), scrollEntry('b'), scrollEntry('c')];
    function Probe(): React.ReactElement {
      latest = useProvidePanels(panelsInput({ initialEntries: entries, containerWidth: 1000, tuning: { rowGap: gap } }));
      return React.createElement('output');
    }
    const mounted = mount(React.createElement(Probe));
    const numbers = computeRowNumbers({ entries, phoneWidth: 390, containerWidth: 1000, gap });
    const legacy = computeMaxLiveWidth({ containerWidth: 1000, phoneWidth: 390, gap, fixedItemCount: 1 });
    assert.equal(numbers.maxLiveWidth, expected[gap]!.rows);
    assert.equal(legacy, expected[gap]!.legacy);
    const fit = fitSlots(numbers.maxLiveWidth, 390, gap);
    assert.equal(latest!.liveWidths[0], slotWidth(fit, 390, gap), `gap ${gap}: the 64-slot panel is priced at the slots that fit the row numbers' cap`);
    assert.ok(latest!.liveWidths[0]! <= numbers.maxLiveWidth);
    assert.equal(latest!.maxLiveWidth, numbers.maxLiveWidth);
    mounted.unmount();
  }
  assert.equal(gaps, 3, 'the gap loop ran three times');
});
