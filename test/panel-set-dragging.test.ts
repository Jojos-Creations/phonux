/** usePanelSetDragging: a host marks the panel it renders in as dragging, and the mark follows the panel's life. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { useHost, usePanelDragging, usePanelSetDragging } from '../index.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { mountRow, panelsOf } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';

afterEach(() => cleanup());

const setters = new Map<string, (on: boolean) => void>();
const closers = new Map<string, () => unknown>();
function View({ id }: { id: string }): React.ReactElement {
  const { panels } = useHost();
  const set = usePanelSetDragging();
  setters.set(id, set);
  closers.set(id, () => panels.close(id));
  return React.createElement('div', { 'data-probe': id, 'data-flag': String(usePanelDragging()) });
}
registerTestView('scroll-row-view', ({ panel }) => React.createElement(View, { id: panel.id }));

const flag = (container: HTMLElement, id: string): string | null => container.querySelector(`[data-probe="${id}"]`)?.getAttribute('data-flag') ?? null;

test('the setter raises and clears the dragging mark of its own panel only', async () => {
  const m = mountRow(panelsOf(2), 3000);
  await advanceFrames(2000);
  act(() => setters.get('s1')!(true));
  assert.equal(flag(m.container, 's1'), 'true');
  assert.equal(flag(m.container, 's2'), 'false');
  act(() => setters.get('s1')!(false));
  assert.equal(flag(m.container, 's1'), 'false');
});

test('a mark the setter raised ends when its panel closes', async () => {
  const m = mountRow(panelsOf(2), 3000);
  await advanceFrames(2000);
  act(() => setters.get('s2')!(true));
  assert.equal(flag(m.container, 's2'), 'true');
  act(() => void closers.get('s2')!());
  await advanceFrames(2000);
  assert.equal(flag(m.container, 's2'), null);
  act(() => setters.get('s1')!(true));
  assert.equal(flag(m.container, 's1'), 'true', 'the store is not stuck on the closed panel');
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
