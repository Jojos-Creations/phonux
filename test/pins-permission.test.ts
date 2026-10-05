/**
 * Behaviour pinned before the engine learns the permission settings. A pin states what the code does today, with
 * the bad ones named KNOWN-BAD so a later change has to rename the pin it fixes, never delete it.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { useProvidePanels, type PanelWindow, type ProvidedPanels } from '../index.js';
import { movePanel } from '../panelWindow.js';
import { cleanup, mount, panelsInput } from './support/mount-harness.js';

const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({
  id,
  url: `https://${id}.example`,
  title: id.toUpperCase(),
  live: true,
  locked: false,
  view: 'web',
  collapsible: true,
  listed: true,
  ...over,
});
const root = (): PanelWindow => entry('root', { url: '', title: 'History', locked: true, collapsible: false, listed: false });
const ids = (panels: readonly PanelWindow[]): string[] => panels.map((p) => p.id);

/** Mounts useProvidePanels over `initialEntries` and returns a reader for the latest render's value. */
function mountProvider(initialEntries: PanelWindow[]): { latest: () => ProvidedPanels } {
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(panelsInput({ initialEntries }));
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

test('PIN movePanel across a parked panel: [P, X parked, Q] moving P right gives [X, Q, P]', () => {
  const panels = [root(), entry('p'), entry('x', { live: false }), entry('q')];
  const moved = movePanel(panels, 'p', 'right', 'root');
  assert.notEqual(moved, panels, 'the move happened: the control that the pin below is not a no-op');
  assert.deepEqual(ids(moved), ['root', 'x', 'q', 'p'], 'P hops past the next present panel Q, and the parked X shifts one slot with it');
});

test('KNOWN-BAD:1 initialEntries seeded { locked: true, collapsible: true } is removed by clearAll', () => {
  const provider = mountProvider([root(), entry('locked', { locked: true }), entry('plain')]);
  assert.deepEqual(ids(provider.latest().entries), ['root', 'locked', 'plain'], 'control: both panels are seeded');
  act(() => provider.latest().clearAll());
  assert.deepEqual(ids(provider.latest().entries), ['root'], 'a locked parkable entry is wiped like any other: clearAll reads only collapsible');
});

test('KNOWN-BAD:3 two closes before a re-render undo in the wrong order', () => {
  const provider = mountProvider([root(), entry('a'), entry('b'), entry('c')]);
  act(() => {
    const stale = provider.latest();
    stale.close('a');
    stale.close('b');
  });
  assert.deepEqual(ids(provider.latest().entries), ['root', 'c'], 'control: both closes landed');
  act(() => provider.latest().undoClose());
  assert.deepEqual(ids(provider.latest().entries), ['root', 'a', 'c', 'b'], 'B was closed at an index read before A left, so undo puts it back after C');
});
