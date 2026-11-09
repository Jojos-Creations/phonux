/**
 * The row mechanics a host used to rebuild on the library's DOM: the edge-focus picks, the waits that replace turn timers,
 * the published attribute helpers and the maximized-panel store.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { edgeSlotInView, isShown } from '../rowStep.js';
import { whenAccepted, whenPanel } from '../panelWaits.js';
import { PANEL_ROOT_ATTRIBUTE, ROW_ID_ATTRIBUTE, panelRootOf, rowPanelIdOf } from '../rowDom.js';
import { maximizablePanels, maximizedPanel, reportMaximized } from '../maximizedStore.js';
import type { PanelResult } from '../panelManager.js';
import type { PanelState } from '../panelTemplate.js';

test('isShown and edgeSlotInView: Left picks the rightmost panel in view and Right the leftmost; a sliver is out of view', () => {
  const view = { left: 0, right: 1000 };
  const slots = [
    { id: 'gone-left', left: -500, right: -100 },
    { id: 'sliver-left', left: -390, right: 10 },
    { id: 'first', left: 100, right: 400 },
    { id: 'second', left: 500, right: 800 },
    { id: 'cut-right', left: 900, right: 1300 },
    { id: 'gone-right', left: 1100, right: 1400 },
  ];
  assert.equal(isShown(slots[0]!, view), false);
  assert.equal(isShown(slots[1]!, view), false, 'ten pixels is a sliver');
  assert.equal(isShown(slots[4]!, view), true, 'a hundred pixels is a panel in view');
  assert.equal(edgeSlotInView(slots, view, 'left')?.id, 'cut-right');
  assert.equal(edgeSlotInView(slots, view, 'right')?.id, 'first');
  assert.equal(edgeSlotInView([slots[0]!, slots[5]!], view, 'left'), undefined, 'nothing in view');
  assert.equal(isShown({ left: 10, right: 30 }, view), true, 'a panel narrower than the sliver is judged by its own width');
  assert.equal(isShown({ left: 50, right: 50 }, view), false, 'a slot with no width is a hidden panel');
});

/** A manager whose changes the test fires by hand. */
function fakePanels() {
  const listeners = new Set<() => void>();
  return {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    change: () => {
      for (const l of [...listeners]) l();
    },
    count: () => listeners.size,
  };
}

const busy: PanelResult = { ok: false, code: 'busy', message: 'busy' };
const notLive: PanelResult = { ok: false, code: 'not-live', message: 'not live' };
const accepted: PanelResult = { ok: true, changed: true };

test('whenAccepted retries a busy call at the end of the turn, with no change heard', async () => {
  const panels = fakePanels();
  let calls = 0;
  const result = await whenAccepted(panels, () => (++calls === 1 ? busy : accepted));
  assert.deepEqual(result, accepted);
  assert.equal(calls, 2);
  assert.equal(panels.count(), 0, 'it stops listening once answered');
});

test('whenAccepted waits on changes for a panel that is not live yet, and answers a lasting refusal at once', async () => {
  const panels = fakePanels();
  let live = false;
  const waiting = whenAccepted(panels, () => (live ? accepted : notLive));
  await new Promise((done) => setTimeout(done, 5));
  assert.equal(panels.count(), 1, 'still waiting');
  live = true;
  panels.change();
  assert.deepEqual(await waiting, accepted);
  const refusedForGood: PanelResult = { ok: false, code: 'not-closable', message: 'no' };
  let calls = 0;
  assert.deepEqual(await whenAccepted(panels, () => {
    calls += 1;
    return refusedForGood;
  }), refusedForGood);
  assert.equal(calls, 1, 'a refusal no turn can clear is not retried');
});

test('whenAccepted gives up with the last answer when the wait runs out', async () => {
  const panels = fakePanels();
  assert.deepEqual(await whenAccepted(panels, () => notLive, { timeoutMs: 10 }), notLive);
  assert.equal(panels.count(), 0);
});

test('whenPanel resolves once the test passes on a change, and undefined on a timeout', async () => {
  const panels = fakePanels();
  let status: PanelState['status'] = 'pending';
  const manager = { ...panels, get: (id: string) => (id === 'a' ? ({ getState: () => ({ id, status }) }) as never : undefined) };
  const waiting = whenPanel(manager, 'a');
  status = 'live';
  panels.change();
  assert.equal((await waiting)?.status, 'live');
  assert.equal(await whenPanel(manager, 'nobody', undefined, { timeoutMs: 10 }), undefined);
});

test('panelRootOf and rowPanelIdOf find the panel and its slot from any element inside', () => {
  const slot = document.createElement('div');
  slot.setAttribute(ROW_ID_ATTRIBUTE, 'p7');
  const root = document.createElement('div');
  root.setAttribute(PANEL_ROOT_ATTRIBUTE, '');
  const inner = document.createElement('button');
  root.append(inner);
  slot.append(root);
  assert.equal(rowPanelIdOf(inner), 'p7');
  assert.equal(panelRootOf(inner), root);
  assert.equal(rowPanelIdOf(document.body), null, 'control: outside every slot');
  assert.equal(panelRootOf(null), null);
});

test('reportMaximized stands in for a grown panel and its return takes it home', () => {
  const panel = { root: () => null, toggle: () => true };
  assert.equal(maximizedPanel(), null);
  const done = reportMaximized(panel, 'growing', true);
  assert.equal(maximizedPanel(), panel);
  assert.ok(maximizablePanels().includes(panel));
  done();
  assert.equal(maximizedPanel(), null);
  assert.ok(!maximizablePanels().includes(panel));
});
