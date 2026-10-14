/**
 * What the row renders for a parked entry today: its view unmounts once the park exit finishes and mounts afresh at
 * every show. A change to that must rename the pin it changes and cannot delete it.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import type { PanelWindow } from '../index.js';
import { advanceFrames, cleanup, mount, withHost, StaticRow } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';

const counts = { mounts: 0, unmounts: 0 };
registerTestView('pin-render-counter', () => {
  React.useEffect(() => {
    counts.mounts += 1;
    return () => {
      counts.unmounts += 1;
    };
  }, []);
  return React.createElement('i', { 'data-view': 'counter' });
});

const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({
  id,
  url: `https://${id}.example`,
  title: id,
  live: true,
  locked: false,
  view: 'pin-render-counter',
  collapsible: true,
  listed: true,
  ...over,
});
const root = (): PanelWindow => entry('root', { url: '', title: 'History', locked: true, collapsible: false, listed: false, view: 'pin-render-root' });
registerTestView('pin-render-root', () => React.createElement('b'));

const NONE: ReadonlySet<string> = new Set();
const rowOf = (entries: PanelWindow[]): React.ReactElement => withHost(React.createElement(StaticRow, { entries, rootId: 'root', closingIds: NONE, enteringViaAnchorIds: NONE }));

afterEach(() => cleanup());

test('a view that starts parked, shown then parked three times, mounts 3 times and unmounts 3 times once the park exits complete', async () => {
  counts.mounts = 0;
  counts.unmounts = 0;
  const at = (live: boolean): React.ReactElement => rowOf([root(), entry('a', { live })]);
  const mounted = mount(at(false));
  assert.equal(counts.mounts, 0, 'a parked start renders no view');
  for (let cycle = 0; cycle < 3; cycle += 1) {
    mounted.rerender(at(true));
    await advanceFrames(1000);
    mounted.rerender(at(false));
    await advanceFrames(1000);
  }
  assert.equal(counts.mounts, 3);
  assert.equal(counts.unmounts, 3);
  assert.equal(mounted.container.querySelector('[data-view="counter"]'), null, 'nothing of the parked view remains in the document');
});
