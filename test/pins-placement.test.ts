/**
 * What the row does where placement, a missing root and a repeated undo are concerned. A pin states what the code
 * does, with the bad ones named KNOWN-BAD so a change has to rename the pin it fixes, never delete it.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { PanelRow, registerView, useProvidePanels, type PanelWindow, type ProvidedPanels } from '../index.js';
import { computeRowLayout } from '../panelRowLayout.js';
import { computeRowOrder, deriveAnchorsFromOrder } from '../panelRowOrder.js';
import { movePanel, reanchorPanel } from '../panelWindow.js';
import type { UsePanelManagerResult } from '../panels/usePanelManager.js';
import { hydrateWorkspaceState, type WorkspaceState } from '../workspaceState.js';
import { advanceFrames, cleanup, mount, panelsInput, usePanelManagerWith, withHost } from './support/mount-harness.js';

const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({
  id,
  url: `https://${id}.example`,
  title: id.toUpperCase(),
  live: true,
  locked: false,
  view: 'pin-placement',
  collapsible: true,
  listed: true,
  ...over,
});
const root = (id = 'root'): PanelWindow => entry(id, { url: '', title: 'History', locked: true, collapsible: false, listed: false });
const ids = (panels: readonly PanelWindow[]): string[] => panels.map((p) => p.id);
const anchorsOf = (panels: readonly PanelWindow[]): Record<string, string> =>
  Object.fromEntries(panels.filter((p) => p.anchor !== undefined).map((p) => [p.id, `${p.anchor!.panel} ${p.anchor!.position} ${p.anchor!.priority}`]));

registerView('pin-placement', ({ panel }) => React.createElement('i', { 'data-slot': panel.id }, panel.title));

const NONE: ReadonlySet<string> = new Set();
const rowOf = (entries: PanelWindow[], rootId: string, entering: ReadonlySet<string> = NONE): React.ReactElement =>
  withHost(React.createElement(PanelRow, { entries, rootId, closingIds: NONE, enteringViaAnchorIds: entering }));
/** The slot's translateX in px right after a render, before any frame has run; a slot at x 0 carries no transform. */
const slotX = (container: HTMLElement, id: string): number => {
  const slot = container.querySelector(`[data-slot="${id}"]`)?.parentElement;
  assert.ok(slot, `slot ${id} is mounted`);
  const match = /translateX\((-?[\d.]+)px\)/.exec(slot.style.transform);
  return match === null ? 0 : Number(match[1]);
};
const slotCount = (container: HTMLElement): number => container.querySelectorAll('[data-slot]').length;

/** `p` as the marker a root-less row keeps. */
const withMarker = (p: PanelWindow): PanelWindow => {
  const marked = { ...p, marker: true as const };
  return marked;
};

/** usePanelManagerWith over `initial` at `width`; `setWidth` re-renders the same probe at another measured width. */
function mountManager(initial: PanelWindow[], rootId: string, width = 0, fixedColumnCount = 0): { latest: () => { panels: PanelWindow[]; manager: UsePanelManagerResult }; setWidth: (next: number) => void } {
  let seen: { panels: PanelWindow[]; manager: UsePanelManagerResult } | undefined;
  function Probe({ containerWidth }: { containerWidth: number }): React.ReactElement {
    const [panels, setPanels] = React.useState<PanelWindow[]>(initial);
    const manager = usePanelManagerWith({ panels, setPanels, phoneWidth: 390, containerWidth, fixedColumnCount, rootId });
    seen = { panels, manager };
    return React.createElement('output');
  }
  const mounted = mount(React.createElement(Probe, { containerWidth: width }));
  return {
    latest: () => {
      assert.ok(seen, 'the probe never rendered, so there is no manager to read');
      return seen;
    },
    setWidth: (next) => mounted.rerender(React.createElement(Probe, { containerWidth: next })),
  };
}

function mountProvider(initialEntries: PanelWindow[], over: Parameters<typeof panelsInput>[0] = {}): { latest: () => ProvidedPanels } {
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(panelsInput({ initialEntries, ...over }));
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  return {
    latest: () => {
      assert.ok(latest, 'the probe never rendered, so there is no provider value to read');
      return latest;
    },
  };
}

afterEach(() => cleanup());

test('PIN computeRowLayout at fixedItemCount 0: the fixed block is one gap short, which the live panels own gaps make up', () => {
  const layout = computeRowLayout({ containerWidth: 1300, phoneWidth: 390, gap: 16, fixedItemCount: 0, liveWidths: [390, 390] });
  assert.deepEqual(layout, { maxLiveThatFit: 3, effectiveLiveCount: 2, rowTotalWidth: 796, computedRowMarginLeft: 236 });
  assert.deepEqual(computeRowLayout({ containerWidth: 1300, phoneWidth: 390, gap: 16, fixedItemCount: 0, liveWidths: [] }), {
    maxLiveThatFit: 3,
    effectiveLiveCount: 0,
    rowTotalWidth: -16,
    computedRowMarginLeft: 642,
  });
});

test('PIN computeRowOrder with the root absent: every entry hangs off the missing root, a left anchor leads and the rest follow by priority', () => {
  const row = [
    entry('a', { anchor: { panel: 'root', position: 'right', priority: 1 } }),
    entry('b', { anchor: { panel: 'root', position: 'right', priority: 0 } }),
    entry('c', { anchor: { panel: 'root', position: 'left', priority: 0 } }),
  ];
  const ordered = computeRowOrder(row, 'root');
  assert.deepEqual(ids(ordered), ['c', 'b', 'a']);
  assert.deepEqual(anchorsOf(ordered), { c: 'root left 0', b: 'root right 0', a: 'root right 1' });
});

test('PIN movePanel with the root absent: the hop is over the next present neighbour and every anchor is re-read as root-right', () => {
  const moved = movePanel([entry('a'), entry('b'), entry('c')], 'b', 'left', 'root');
  assert.deepEqual(ids(moved), ['b', 'a', 'c']);
  assert.deepEqual(anchorsOf(moved), { b: 'root right 0', a: 'root right 1', c: 'root right 2' });
});

test('PIN reanchorPanel with the root absent: a left request puts the panel first, a right one last', () => {
  const row = [entry('a'), entry('b'), entry('c')];
  const left = reanchorPanel(row, 'c', { position: 'left' }, 'root');
  assert.deepEqual(ids(left), ['c', 'a', 'b']);
  assert.equal(anchorsOf(left).c, 'root left 0');
  const right = reanchorPanel(row, 'a', { position: 'right' }, 'root');
  assert.deepEqual(ids(right), ['b', 'c', 'a']);
});

test('PIN scrollRow with the root absent: a rightward step brings the first parked panel after the live range and parks the leftmost live one', () => {
  const view = mountManager([entry('a'), entry('b'), entry('c'), entry('d', { live: false })], 'root');
  act(() => view.latest().manager.scrollRow('right'));
  const { panels } = view.latest();
  assert.deepEqual(ids(panels), ['a', 'b', 'c', 'd'], 'the array order is untouched');
  assert.deepEqual(panels.filter((p) => p.live).map((p) => p.id), ['b', 'c', 'd']);
});

test('PIN PanelRow with the root absent enters a reappearing entry from the right: the anchor formula finds no anchor entry', async () => {
  const mounted = mount(rowOf([entry('a')], 'root'));
  mounted.rerender(rowOf([entry('a'), entry('b', { anchor: { panel: 'root', position: 'left', priority: 0 } })], 'root', new Set(['b'])));
  assert.equal(slotX(mounted.container, 'b'), 812, 'rest 406 plus one span of 406: the right-hand start, although the anchor says left');
  await advanceFrames(600);
  assert.equal(slotX(mounted.container, 'b'), 406, 'control: it settles at its rest position');
});

test('PIN right-side tie: [H, A(H right 0), B(H right 1)] plus N(H right 0) is H A N B, and N at priority -1 is H N A B', () => {
  const h = root('h');
  const a = entry('a', { anchor: { panel: 'h', position: 'right', priority: 0 } });
  const b = entry('b', { anchor: { panel: 'h', position: 'right', priority: 1 } });
  const tied = computeRowOrder([h, a, b, entry('n', { anchor: { panel: 'h', position: 'right', priority: 0 } })], 'h');
  assert.deepEqual(ids(tied), ['h', 'a', 'n', 'b']);
  const nearest = computeRowOrder([h, a, b, entry('n', { anchor: { panel: 'h', position: 'right', priority: -1 } })], 'h');
  assert.deepEqual(ids(nearest), ['h', 'n', 'a', 'b']);
});

test('PIN missing anchor: hydrating a saved row whose anchor target S is not in the file swaps C and D', () => {
  const state: WorkspaceState = {
    version: 1,
    panels: [
      { id: 'a', view: 'web', url: 'https://a.example', live: true, anchor: { panel: 's', position: 'right', priority: 0 } },
      { id: 'b', view: 'web', url: 'https://b.example', live: true, anchor: { panel: 's', position: 'right', priority: 1 } },
      { id: 'c', view: 'web', url: 'https://c.example', live: true, anchor: { panel: 'h', position: 'right', priority: 3 } },
      { id: 'd', view: 'web', url: 'https://d.example', live: true, anchor: { panel: 's', position: 'right', priority: 2 } },
      { id: 'e', view: 'web', url: 'https://e.example', live: true, anchor: { panel: 'h', position: 'right', priority: 4 } },
    ],
  };
  let next = 100;
  const hydrated = hydrateWorkspaceState(state, () => String(next++), 'h');
  const savedIdOf = new Map(state.panels.map((s, i) => [String(100 + i), s.id]));
  assert.deepEqual(hydrated.map((p) => savedIdOf.get(p.id)), ['a', 'b', 'd', 'c', 'e'], 'D (priority 2 on the missing S) now sits before C (priority 3 on H)');
});

test('PIN positional anchors: with the root absent every entry reads root-right from 0, and around a present root the sides split', () => {
  assert.deepEqual(anchorsOf(deriveAnchorsFromOrder([entry('a'), entry('b')], 'root')), { a: 'root right 0', b: 'root right 1' });
  assert.deepEqual(anchorsOf(deriveAnchorsFromOrder([entry('a'), root('r'), entry('b')], 'r')), { a: 'r left 0', b: 'r right 0' });
});

test("root marker: an entry '__root__' passed as rootId stays put when an unrelated pair swaps, reads what follows it as right, and is neither drawn as a slot nor counted as a fixed column", () => {
  const marker = withMarker(root('__root__'));
  const moved = movePanel([marker, entry('a'), entry('b')], 'b', 'left', '__root__');
  assert.deepEqual(ids(moved), ['__root__', 'b', 'a'], 'the marker keeps index 0');
  assert.deepEqual(anchorsOf(moved), { b: '__root__ right 0', a: '__root__ right 1' });

  const mounted = mount(rowOf([marker, entry('a'), entry('b')], '__root__'));
  assert.equal(slotCount(mounted.container), 2, 'the marker holds the anchor point and has no slot of its own');
  assert.equal(slotX(mounted.container, 'a'), 0, 'the first panel starts where the marker would have');
  assert.equal(slotX(mounted.container, 'b'), 406);

  const provider = mountProvider([marker, entry('a'), entry('b')], { rootId: '__root__' });
  assert.equal(provider.latest().fixedViewCount, 0, 'the marker is not a fixed column');
});

test('PIN a capacity rise returns a parked panel to the slot it was parked in', () => {
  const view = mountManager([root(), entry('a'), entry('b'), entry('c')], 'root', 1640, 1);
  act(() => view.setWidth(1234));
  assert.deepEqual(view.latest().panels.map((p) => `${p.id}:${p.live}`), ['root:true', 'a:false', 'b:true', 'c:true'], 'control: narrowing the row parked the leftmost live panel');
  act(() => view.setWidth(1640));
  assert.deepEqual(view.latest().panels.map((p) => `${p.id}:${p.live}`), ['root:true', 'a:true', 'b:true', 'c:true'], 'the rise returned it in the slot it was parked in');
});

test('after one close, two undoClose calls in one handler report the log id once', () => {
  const restored: string[][] = [];
  const closedLog: string[] = [];
  const provider = mountProvider([root(), entry('a'), entry('b')], {
    onPanelsClosed: (e) => closedLog.push(e.id),
    onPanelsRestored: (logIds) => restored.push(logIds),
  });
  act(() => provider.latest().close('a'));
  assert.notEqual(provider.latest().recentlyClosed, null, 'precondition: the undo window is open before both calls');
  assert.equal(closedLog.length, 1, 'precondition: one close was logged');
  act(() => {
    const stale = provider.latest();
    stale.undoClose();
    stale.undoClose();
  });
  assert.deepEqual(restored, [[closedLog[0]!]], 'the second call found the key already present and reported nothing');
  assert.deepEqual(ids(provider.latest().entries), ['root', 'a', 'b'], 'the panel itself came back once');
});
