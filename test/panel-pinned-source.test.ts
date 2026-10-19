/**
 * `pinned` has one source: the entry's `pinning` definition read by `isPinned`. The slot's own flag, which
 * `usePanelPinned` falls back on without a handle, follows it too, so a definition that is not the default placement one
 * cannot disagree with `PanelState.pinned`.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';

import type { PanelWindow } from '../index.js';
import { PanelSlotContext } from '../panelSlotContext.js';
import { resolvePanelSettings } from '../panelSettings.js';
import { cleanup, mount, withHost, StaticRow } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';

registerTestView('pinned-source', ({ panel }) => {
  const pinned = React.useContext(PanelSlotContext)?.pinned;
  return React.createElement('i', { 'data-slot': panel.id, 'data-pinned': String(pinned) });
});

const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({
  id, url: `https://${id}.example`, title: id, live: true, view: 'pinned-source', collapsible: true, listed: true, ...over,
});
const root = (): PanelWindow => entry('root', { url: '', title: 'History', collapsible: false, listed: false });
const leftOfRoot = { panel: 'root', position: 'left', priority: 0 } as const;
const NONE: ReadonlySet<string> = new Set();

afterEach(() => cleanup());

function pinnedOf(entries: PanelWindow[]): Record<string, string> {
  const mounted = mount(withHost(React.createElement(StaticRow, { entries, rootId: 'root', closingIds: NONE, enteringViaAnchorIds: NONE })));
  const out: Record<string, string> = {};
  for (const id of entries.map((e) => e.id)) out[id] = mounted.container.querySelector(`[data-slot="${id}"]`)?.getAttribute('data-pinned') ?? 'absent';
  mounted.unmount();
  return out;
}

const byParkable = resolvePanelSettings({ template: { pinning: { pinned: { parkable: false }, unpinned: { parkable: true } } } }).value;

test('a pinning read by parkable decides a slot\'s pinned flag, not its place left of the root', () => {
  const row = [
    root(),
    entry('left-parkable', { anchor: leftOfRoot, settings: byParkable }),
    entry('left-fixed', { anchor: leftOfRoot, collapsible: false, settings: { ...byParkable, parkable: false } }),
  ];
  assert.deepEqual(pinnedOf(row), { root: 'false', 'left-parkable': 'false', 'left-fixed': 'true' });
});

test('the default pinning still reads a panel left of the root as pinned', () => {
  const row = [root(), entry('left', { anchor: leftOfRoot }), entry('right', { anchor: { panel: 'root', position: 'right', priority: 0 } })];
  assert.deepEqual(pinnedOf(row), { root: 'false', left: 'true', right: 'false' });
});
