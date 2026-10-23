/**
 * The root marker: an entry with `marker: true` holds the anchor point of a row that has no History panel. It orders
 * the row like any root, and nothing else reads it: it is not drawn, not priced, not counted as a fixed column and not
 * hopped over. `isPresent` is the one reader of presence, so every one of those follows from it.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { useProvidePanels, usePanelNeighborWidths, type PanelWindow, type ProvidedPanels } from '../index.js';
import { isPresent } from '../panelRowEntry.js';
import { movePanel } from '../panelWindow.js';
import type { UsePanelManagerResult } from '../panels/usePanelManager.js';
import { cleanup, mount, usePanelManagerWith, withHost, useSeededInput, StaticRow } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';

const MARKER = '__root__';

const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({
  id,
  url: `https://${id}.example`,
  title: id.toUpperCase(),
  live: true,
  view: 'marker-probe',
  collapsible: true,
  listed: true,
  ...over,
});
const marker = (): PanelWindow => entry(MARKER, { url: '', title: '', collapsible: false, listed: false, marker: true });
const history = (): PanelWindow => entry('root', { url: '', title: 'History', collapsible: false, listed: false });
const ids = (panels: readonly PanelWindow[]): string[] => panels.map((p) => p.id);

registerTestView('marker-probe', ({ panel }) => {
  const widths = usePanelNeighborWidths();
  return React.createElement('i', { 'data-slot': panel.id, 'data-widths': JSON.stringify(widths) }, panel.title);
});

const NONE: ReadonlySet<string> = new Set();
const rowOf = (entries: PanelWindow[], rootId: string): React.ReactElement =>
  withHost(React.createElement(StaticRow, { entries, rootId, closingIds: NONE, enteringViaAnchorIds: NONE }));
const slotOf = (container: HTMLElement, id: string): HTMLElement | null => container.querySelector(`[data-slot="${id}"]`)?.parentElement ?? null;
/** The row root: the parent of the panel's hold line, which every panel has (the host is `display: contents` unless held). */
const rowRootOf = (container: HTMLElement, id: string): HTMLElement => slotOf(container, id)!.closest<HTMLElement>('[data-row-hold-line]')!.parentElement!;
const slotIds = (container: HTMLElement): string[] => [...container.querySelectorAll('[data-slot]')].map((n) => (n as HTMLElement).dataset.slot!);
const xOf = (container: HTMLElement, id: string): number => {
  const slot = slotOf(container, id);
  assert.ok(slot, `slot ${id} is mounted`);
  const match = /translateX\((-?[\d.]+)px\)/.exec(slot.style.transform);
  return match === null ? 0 : Number(match[1]);
};

function mountProvider(initialEntries: PanelWindow[], over: Partial<Parameters<typeof useSeededInput>[0]> = {}): () => ProvidedPanels {
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(useSeededInput({ initialEntries, ...over }));
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  return () => {
    assert.ok(latest, 'the probe never rendered, so there is no provider value to read');
    return latest;
  };
}

afterEach(() => cleanup());

test('isPresent: a marker is never present, and an unmarked entry is present when fixed or live', () => {
  const rows: Array<[{ collapsible: boolean; live: boolean; marker?: boolean }, boolean]> = [
    [{ collapsible: false, live: true }, true],
    [{ collapsible: false, live: false }, true],
    [{ collapsible: true, live: true }, true],
    [{ collapsible: true, live: false }, false],
    [{ collapsible: false, live: true, marker: true }, false],
    [{ collapsible: false, live: false, marker: true }, false],
    [{ collapsible: true, live: true, marker: true }, false],
    [{ collapsible: false, live: true, marker: false }, true],
  ];
  assert.equal(rows.length, 8);
  for (const [p, want] of rows) assert.equal(isPresent(p), want, JSON.stringify(p));
});

test("a row [marker, A, B] draws two slots at x 0 and 406, each 390 wide, in a row 796 wide", () => {
  const mounted = mount(rowOf([marker(), entry('a'), entry('b')], MARKER));
  assert.deepEqual(slotIds(mounted.container), ['a', 'b'], 'the marker has no slot');
  assert.equal(xOf(mounted.container, 'a'), 0);
  assert.equal(xOf(mounted.container, 'b'), 406);
  assert.equal(slotOf(mounted.container, 'a')!.style.width, '390px');
  assert.equal(slotOf(mounted.container, 'b')!.style.width, '390px');
  assert.equal(getComputedStyle(rowRootOf(mounted.container, 'a')).width, '796px', 'the row reserves 390 + 16 + 390');
});

test('a row of only a marker draws nothing, is hidden and reserves no width', () => {
  const mounted = mount(rowOf([marker()], MARKER));
  assert.deepEqual(slotIds(mounted.container), []);
  const box = mounted.container.firstElementChild as HTMLElement;
  assert.ok(box, 'the row element is mounted');
  assert.equal(getComputedStyle(box).display, 'none', 'hidden, so it takes no flex gap from its siblings');
  assert.equal(getComputedStyle(box).width, '0px');
  cleanup();
  const shown = mount(rowOf([marker(), entry('a')], MARKER));
  assert.equal(getComputedStyle(shown.container.firstElementChild as HTMLElement).display, 'block', 'control: one present panel shows the row');
});

test('usePanelNeighborWidths for A in [marker, A, B] sees nothing on the left and one panel on the right', () => {
  const mounted = mount(rowOf([marker(), entry('a'), entry('b')], MARKER));
  const widths = (id: string): string => (mounted.container.querySelector(`[data-slot="${id}"]`) as HTMLElement).dataset.widths!;
  assert.equal(widths('a'), '{"left":[],"right":[390]}');
  assert.equal(widths('b'), '{"left":[390],"right":[]}');
});

test('with a real History root the same row has three slots and A sees History on its left', () => {
  const mounted = mount(rowOf([history(), entry('a'), entry('b')], 'root'));
  assert.deepEqual(slotIds(mounted.container), ['root', 'a', 'b']);
  assert.equal(getComputedStyle(rowRootOf(mounted.container, 'root')).width, '1202px');
  assert.equal((mounted.container.querySelector('[data-slot="a"]') as HTMLElement).dataset.widths, '{"left":[390],"right":[390]}');
});

test('fixedViewCount is 0 with only a marker fixed, and counts History as 1 in a row with a root', () => {
  assert.equal(mountProvider([marker(), entry('a'), entry('b')], { rootId: MARKER })().fixedViewCount, 0);
  cleanup();
  assert.equal(mountProvider([history(), entry('a'), entry('b')])().fixedViewCount, 1);
  cleanup();
  assert.equal(mountProvider([marker(), entry('a'), entry('f', { collapsible: false })], { rootId: MARKER })().fixedViewCount, 1, 'a real fixed panel still counts beside the marker');
});

test('movePanel hops over a parked panel but never over the marker, and the first present panel cannot go left', () => {
  const row = [marker(), entry('a'), entry('b')];
  assert.deepEqual(ids(movePanel(row, 'b', 'left', MARKER)), [MARKER, 'b', 'a']);
  const stuck = movePanel(row, 'a', 'left', MARKER);
  assert.deepEqual(ids(stuck), [MARKER, 'a', 'b'], 'a is already first; the marker is not a neighbour');
  assert.equal(stuck, row, 'and the same array comes back');
  const parked = [marker(), entry('a'), entry('p', { live: false }), entry('b')];
  assert.deepEqual(ids(movePanel(parked, 'b', 'left', MARKER)), [MARKER, 'b', 'a', 'p'], 'b hops over the parked panel and lands in front of a, as before');
});

test('wouldEmptyRow: a marker keeps nothing present, and History does', () => {
  const emptied = (initial: PanelWindow[], rootId: string): boolean => {
    let seen: UsePanelManagerResult | undefined;
    function Probe(): React.ReactElement {
      const [panels, setPanels] = React.useState<PanelWindow[]>(initial);
      seen = usePanelManagerWith({ panels, setPanels, phoneWidth: 390, containerWidth: 1640, fixedColumnCount: 0, rootId });
      return React.createElement('output');
    }
    mount(React.createElement(Probe));
    assert.ok(seen, 'the probe never rendered');
    const answer = seen.wouldEmptyRow(['a']);
    cleanup();
    return answer;
  };
  assert.equal(emptied([marker(), entry('a')], MARKER), true, 'closing A leaves a row of only the marker');
  assert.equal(emptied([history(), entry('a')], 'root'), false, 'closing A leaves History');
  assert.equal(emptied([marker(), entry('a'), entry('b')], MARKER), false, 'B stays');
});
