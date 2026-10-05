/**
 * Behaviour pinned before the engine learns the visibility settings. A pin states what the code does today, with
 * the bad ones named KNOWN-BAD so a later change has to rename the pin it fixes, never delete it.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { PanelRow, registerView, useViewState, type PanelWindow } from '../index.js';
import type { UsePanelManagerResult } from '../panels/usePanelManager.js';
import { advanceFrames, cleanup, mount, usePanelManagerWith, withHost } from './support/mount-harness.js';

const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({
  id,
  url: `https://${id}.example`,
  title: id.toUpperCase(),
  live: true,
  locked: false,
  view: 'pin-vs',
  collapsible: true,
  listed: true,
  ...over,
});
const root = (): PanelWindow => entry('root', { url: '', title: 'History', locked: true, collapsible: false, listed: false });
const liveIds = (panels: readonly PanelWindow[]): string[] => panels.filter((p) => p.live).map((p) => p.id);

/** Wide enough for three live panels beside History: 390 + 3 * (390 + 16) + 32. */
const ROOMY = 1640;

/** Mounts usePanelManagerWith over `initial`; `latest()` is the newest render's panels, setter and manager. */
function mountManager(initial: PanelWindow[], containerWidth: number): { latest: () => { panels: PanelWindow[]; setPanels: React.Dispatch<React.SetStateAction<PanelWindow[]>>; manager: UsePanelManagerResult } } {
  let seen: { panels: PanelWindow[]; setPanels: React.Dispatch<React.SetStateAction<PanelWindow[]>>; manager: UsePanelManagerResult } | undefined;
  function Probe(): React.ReactElement {
    const [panels, setPanels] = React.useState<PanelWindow[]>(initial);
    const manager = usePanelManagerWith({ panels, setPanels, phoneWidth: 390, containerWidth, fixedColumnCount: 1, rootId: 'root' });
    seen = { panels, setPanels, manager };
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  return {
    latest: () => {
      assert.ok(seen, 'the probe never rendered, so there is no manager to read');
      return seen;
    },
  };
}

const setters = new Map<string, (next: number) => void>();
registerView('pin-vs', ({ panel }) => {
  const [value, setValue] = useViewState('pin-count', 0);
  setters.set(panel.id, setValue);
  return React.createElement('i', { 'data-slot': panel.id }, String(value));
});

const NONE: ReadonlySet<string> = new Set();
const row = (entries: PanelWindow[]): React.ReactElement => withHost(React.createElement(PanelRow, { entries, rootId: 'root', closingIds: NONE, enteringViaAnchorIds: NONE }));
const slotText = (container: HTMLElement, id: string): string | null => container.querySelector(`[data-slot="${id}"]`)?.textContent ?? null;

afterEach(() => {
  setters.clear();
  cleanup();
});

test('KNOWN-BAD:4 a plain park in a roomy measured row bounces back, and the same park in an unmeasured row stays parked', () => {
  const unmeasured = mountManager([root(), entry('a'), entry('b')], 0);
  act(() => unmeasured.latest().setPanels((prev) => prev.map((p) => (p.id === 'b' ? { ...p, live: false } : p))));
  assert.deepEqual(liveIds(unmeasured.latest().panels), ['root', 'a'], 'control: with no measurement there is no capacity to return to, so the park stands');

  const roomy = mountManager([root(), entry('a'), entry('b')], ROOMY);
  act(() => roomy.latest().setPanels((prev) => prev.map((p) => (p.id === 'b' ? { ...p, live: false } : p))));
  assert.deepEqual(liveIds(roomy.latest().panels), ['root', 'a', 'b'], 'the commit stacked the park and the capacity rise returned it in the same settle');
});

test('useViewState: a value set before a park is readable after the revive', async () => {
  const mounted = mount(row([root(), entry('a')]));
  assert.equal(slotText(mounted.container, 'a'), '0', 'control: the cell starts at its initial value');
  act(() => setters.get('a')!(5));
  assert.equal(slotText(mounted.container, 'a'), '5', 'control: the set reached the view');
  mounted.rerender(row([root(), entry('a', { live: false })]));
  await advanceFrames(600);
  assert.equal(slotText(mounted.container, 'a'), null, 'control: the park unmounted the view');
  mounted.rerender(row([root(), entry('a')]));
  await advanceFrames(100);
  assert.equal(slotText(mounted.container, 'a'), '5', 'the revived view reads the value it had before the park');
});

test('useViewState: a cell with a mounted listener is not dropped by the retain effect, and goes when the view unmounts', async () => {
  const mounted = mount(row([root(), entry('a')]));
  act(() => setters.get('a')!(5));
  mounted.rerender(row([root()]));
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(slotText(mounted.container, 'a'), '5', 'the retain effect has run and the exiting view, still mounted, keeps its value');
  await advanceFrames(600);
  assert.equal(slotText(mounted.container, 'a'), null, 'control: the exit finished and the view unmounted');
  mounted.rerender(row([root(), entry('a')]));
  await advanceFrames(100);
  assert.equal(slotText(mounted.container, 'a'), '0', 'the value was released once the last listener left');
});
