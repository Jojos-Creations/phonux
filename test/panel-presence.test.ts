/**
 * usePanelPresence: each of the four reasons a view is or is not drawn (exiting, closing, parked, scrolled away), and the
 * store that carries the scrolled-away flag from the Workspace's scroll loop to the views, which must wake only on a flip.
 * jsdom has no layout, so each slot's rectangle is set from the row's own numbers, as show-partial-at-edge.test.ts does.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { setRowOffset, stubSlotBoxes } from './support/strip.js';
import * as React from 'react';
import { act } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { usePanelPresence, type PanelPresence, type PanelSummary } from '../index.js';
import { createAwayStore } from '../panelAway.js';
import { PanelSlotContext } from '../panelSlotContext.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { mountRow, panelsOf, type MountedRow } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';

afterEach(() => cleanup());

const presences = new Map<string, PanelPresence>();
const renders = new Map<string, number>();
const parkers = new Map<string, () => void>();

function PresenceView({ panel }: { panel: PanelSummary }): React.ReactElement {
  const presence = usePanelPresence();
  presences.set(panel.id, presence);
  renders.set(panel.id, (renders.get(panel.id) ?? 0) + 1);
  const handle = React.useContext(PanelSlotContext)?.handle;
  parkers.set(panel.id, () => (handle as unknown as { hide(source: 'code'): unknown }).hide('code'));
  return React.createElement('i');
}
registerTestView('scroll-row-view', PresenceView);

const reasonOf = (id: string): string | undefined => presences.get(id)?.reason;

const rect = (left: number, width: number): DOMRect => ({ left, right: left + width, top: 0, bottom: 700, width, height: 700, x: left, y: 0, toJSON: () => ({}) });

/** A 1000 px row of root and five panels, with each slot placed where the row's numbers put it at the current scroll. */
function scrollableRow(over: { wireClosing?: boolean } = {}): MountedRow {
  const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'step' }, ...over });
  m.container.getBoundingClientRect = () => rect(0, 1000);
  return m;
}

/** Gives each slot the box a browser draws; the row measures once per render and follows its own moves from there. */
function layout(m: MountedRow): void {
  stubSlotBoxes(m.container, 16);
  m.rerender(1000);
}

test('a panel the window draws reads shown, and shown is true', () => {
  const m = scrollableRow();
  layout(m);
  assert.equal(reasonOf('s1'), 'shown');
  assert.equal(presences.get('s1')?.shown, true);
});

test('a panel scrolled outside the window reads scrolledAway, and shown is false', () => {
  const m = scrollableRow();
  layout(m);
  assert.equal(reasonOf('s5'), 'scrolledAway');
  assert.equal(presences.get('s5')?.shown, false);
});

test('a panel the row scrolls back into the window reads shown again', () => {
  const m = scrollableRow();
  layout(m);
  // The last stop: s5 is whole in the second slot there, and s1 is wholly past the grid's left edge.
  setRowOffset(m.container, 1624);
  layout(m);
  assert.equal(reasonOf('s1'), 'scrolledAway');
  assert.equal(reasonOf('s5'), 'shown');
});

test('a scroll that moves no panel across the window renders no view', () => {
  const m = scrollableRow();
  layout(m);
  const before = renders.get('s1');
  setRowOffset(m.container, 10);
  assert.equal(renders.get('s1'), before, 'the view re-rendered for a scroll that changed nothing it reads');
});

test('a panel parked by code reads parked, and shown is false', () => {
  const m = scrollableRow();
  layout(m);
  act(() => parkers.get('s2')!());
  assert.equal(reasonOf('s2'), 'parked');
  assert.equal(presences.get('s2')?.shown, false);
});

test('a panel being closed reads closing, from the moment its close starts through its exit', () => {
  const m = scrollableRow({ wireClosing: true });
  layout(m);
  act(() => void m.latest().close('s3'));
  assert.equal(reasonOf('s3'), 'closing');
  assert.equal(presences.get('s3')?.shown, false);
});

test('a panel leaving outside any close, park or scroll reads exiting and stays shown', async () => {
  const seen: { presence?: PanelPresence } = {};
  function Probe(): React.ReactElement {
    seen.presence = usePanelPresence();
    return React.createElement('i');
  }
  const Host = ({ on }: { on: boolean }): React.ReactElement =>
    React.createElement(AnimatePresence, null, on ? React.createElement(motion.div, { key: 'p', exit: { opacity: 0, transition: { duration: 1 } } }, React.createElement(Probe)) : null);
  const mounted = mount(React.createElement(Host, { on: true }));
  assert.equal(seen.presence?.reason, 'shown');
  act(() => mounted.rerender(React.createElement(Host, { on: false })));
  assert.deepEqual(seen.presence, { shown: true, reason: 'exiting' });
  await advanceFrames(1500);
});

test('a view outside any row reads shown, since no row can close, park or scroll it', () => {
  const seen: { presence?: PanelPresence } = {};
  function Probe(): React.ReactElement {
    seen.presence = usePanelPresence();
    return React.createElement('i');
  }
  mount(React.createElement(Probe));
  assert.deepEqual(seen.presence, { shown: true, reason: 'shown' });
});

test('the away store publishes a flag only on a flip, and clears a slot that did not report', () => {
  const store = createAwayStore();
  const woke: string[] = [];
  const stop = store.subscribe('a', () => woke.push('a'));
  store.set('a', false);
  assert.deepEqual(woke, [], 'a flag that stays false wakes nothing');
  store.set('a', true);
  store.set('a', true);
  assert.deepEqual(woke, ['a'], 'a repeated write of the same flag wakes nothing');
  store.retain(new Set(['b']));
  assert.equal(store.has('a'), false);
  assert.deepEqual(woke, ['a', 'a'], 'a slot dropped by retain wakes its listeners');
  stop();
  store.set('a', true);
  assert.deepEqual(woke, ['a', 'a'], 'a stopped listener is not called');
});
