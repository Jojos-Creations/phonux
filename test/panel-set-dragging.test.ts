/** usePanelSetDragging: a host marks the panel it renders in as dragging, and the mark follows the panel's and the view's life. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { useHost, usePanelDragging, usePanelResizing, usePanelSetDragging } from '../index.js';
import { PanelSlotContext } from '../panelSlotContext.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { mountRow, panelsOf } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';

afterEach(() => {
  cleanup();
  setters.clear();
  controls.clear();
  identities.clear();
});

const setters = new Map<string, (on: boolean) => void>();
const identities = new Map<string, Array<(on: boolean) => void>>();
const controls = new Map<string, { close: () => unknown; park: () => unknown; resizing: (on: boolean) => void; showSetter: (on: boolean) => void }>();

function Setter({ id }: { id: string; tick: number }): null {
  const set = usePanelSetDragging();
  setters.set(id, set);
  identities.set(id, [...(identities.get(id) ?? []), set]);
  return null;
}

function View({ id }: { id: string }): React.ReactElement {
  const { panels } = useHost();
  const handle = React.useContext(PanelSlotContext)?.handle;
  const [, setResizing] = usePanelResizing();
  const [mounted, showSetter] = React.useState(true);
  const [tick, rerender] = React.useReducer((n: number) => n + 1, 0);
  controls.set(id, { close: () => panels.close(id), park: () => (handle as unknown as { hide(source: 'code'): unknown }).hide('code'), resizing: setResizing, showSetter: (on) => { showSetter(on); rerender(); } });
  return React.createElement('div', { 'data-probe': id, 'data-flag': String(usePanelDragging()) }, mounted ? React.createElement(Setter, { id, tick }) : null);
}
registerTestView('scroll-row-view', ({ panel }) => React.createElement(View, { id: panel.id }));

const flag = (container: HTMLElement, id: string): string | null => container.querySelector(`[data-probe="${id}"]`)?.getAttribute('data-flag') ?? null;
async function row(count = 2) {
  const m = mountRow(panelsOf(count), 3000);
  await advanceFrames(2000);
  return m;
}

test('the setter raises and clears the dragging mark of its own panel only', async () => {
  const m = await row();
  act(() => setters.get('s1')!(true));
  assert.equal(flag(m.container, 's1'), 'true');
  assert.equal(flag(m.container, 's2'), 'false');
  act(() => setters.get('s1')!(false));
  assert.equal(flag(m.container, 's1'), 'false');
});

test('a mark the setter raised ends when its panel closes, and the store is free for the next panel', async () => {
  const m = await row();
  act(() => setters.get('s2')!(true));
  act(() => void controls.get('s2')!.close());
  await advanceFrames(2000);
  assert.equal(flag(m.container, 's2'), null);
  act(() => setters.get('s1')!(true));
  assert.equal(flag(m.container, 's1'), 'true');
});

test('a mark the setter raised ends when its panel parks', async () => {
  const m = await row();
  act(() => setters.get('s2')!(true));
  act(() => void controls.get('s2')!.park());
  await advanceFrames(2000);
  assert.equal(flag(m.container, 's2'), null, 'the parked panel is unmounted');
  act(() => setters.get('s1')!(true));
  assert.equal(flag(m.container, 's1'), 'true');
});

test('the view that set the mark unmounting while its panel stays ends the mark', async () => {
  const m = await row();
  act(() => setters.get('s1')!(true));
  act(() => controls.get('s1')!.showSetter(false));
  assert.equal(flag(m.container, 's1'), 'false');
});

test('a later resizing write to the same panel is a plain write to the one flag', async () => {
  const m = await row();
  act(() => setters.get('s1')!(true));
  act(() => controls.get('s1')!.resizing(false));
  assert.equal(flag(m.container, 's1'), 'false', 'resizing(false) is a later write to the same single flag');
  act(() => setters.get('s1')!(true));
  act(() => controls.get('s1')!.showSetter(false));
  assert.equal(flag(m.container, 's1'), 'false');
});

test('the mark is one flag per panel and the last write wins', async () => {
  const m = await row();
  act(() => controls.get('s1')!.resizing(true));
  act(() => setters.get('s1')!(true));
  act(() => setters.get('s1')!(false));
  assert.equal(flag(m.container, 's1'), 'false');
  act(() => setters.get('s1')!(true));
  act(() => controls.get('s1')!.resizing(false));
  assert.equal(flag(m.container, 's1'), 'false');
});

test('the setter keeps one identity across renders', async () => {
  await row();
  // The row remounts its slots once when the restore settles, so only renders after that are one mount's.
  identities.clear();
  act(() => controls.get('s1')!.showSetter(true));
  act(() => controls.get('s1')!.showSetter(true));
  const seen = identities.get('s1')!;
  assert.ok(seen.length >= 2, 'the view rendered more than once');
  assert.ok(seen.every((fn) => fn === seen[0]));
});

test('outside a row the setter does nothing', () => {
  let set: ((on: boolean) => void) | undefined;
  function Probe(): null {
    set = usePanelSetDragging();
    return null;
  }
  mount(React.createElement(Probe));
  assert.doesNotThrow(() => act(() => set!(true)));
});
