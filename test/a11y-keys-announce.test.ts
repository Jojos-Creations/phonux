/**
 * Names and keys for assistive technology: the row is a region and each panel a group with its place, a drag says the panel's
 * title, the grab strip is a button that moves and closes by key, and one polite live region says what a key did.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { LIBRARY_TUNING_DEFAULTS, Panel, PanelFrame, createWorkspace, definePanel } from '../index.js';
import type { PanelTemplate, WorkspaceHandle } from '../index.js';
import { arrowKeyBelongsElsewhere } from '../arrowKeys.js';
import { DragToClose } from '../dragToClose.js';
import { PanelSlotContext, type PanelSlotValue } from '../panelSlotContext.js';
import { slotTuning } from '../panelTuning.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { SLIDE_DURATION_SEC } from '../rowConstants.js';
import { drag, release } from './support/drag-gesture.js';
import { stableIds } from './support/frame-fixtures.js';
import { flush, mountWorkspace, type ResizableWorkspace } from './support/workspace-row.js';

/** Long enough for a default-slide enter or exit to finish, with a few frames to spare. */
const SLIDE_DONE_MS = SLIDE_DURATION_SEC * 1000 + 100;
const open: WorkspaceHandle[] = [];
afterEach(() => {
  cleanup();
  for (const ws of open.splice(0)) act(() => ws.dispose());
});

const bare = (id: string, settings: Record<string, unknown> = {}): PanelTemplate =>
  definePanel({ id, settings: { title: id.toUpperCase(), multiple: true, ...settings }, view: ({ panel }) => React.createElement('p', { 'data-body': id, 'data-slot': panel.id }, panel.id) });
const rootTemplate = (): PanelTemplate =>
  definePanel({ id: 'root', settings: { title: 'History' }, view: () => React.createElement(Panel, { title: 'History', children: React.createElement(PanelFrame, null, React.createElement('i')) }) });

async function rig(ids: string[], over: Record<string, Record<string, unknown>> = {}): Promise<ResizableWorkspace> {
  const ws = createWorkspace({ mount: false, root: rootTemplate(), templates: ids.map((id) => bare(id, over[id])), newId: stableIds() });
  open.push(ws);
  for (const id of ids) ws.addPanel(id, { id: `${id}-1` });
  const m = mountWorkspace(ws, { width: 1600, withMaxLiveWidth: true });
  await flush();
  await advanceFrames(SLIDE_DONE_MS);
  return m;
}
/** Panels in the order they are drawn: the DOM keeps the order they opened, so position comes from the slot's offset. */
const leftOf = (n: HTMLElement): number => Number(n.closest('[data-row-slot]')!.getAttribute('data-row-slot'));
const order = (m: ResizableWorkspace): string[] => [...m.container.querySelectorAll<HTMLElement>('[data-body]')].sort((a, b) => leftOf(a) - leftOf(b)).map((n) => n.dataset.body!);
const slotOf = (m: ResizableWorkspace, id: string): HTMLElement => m.container.querySelector<HTMLElement>(`[data-body="${id}"]`)!.closest<HTMLElement>('[data-row-slot]')!;
const stripOf = (m: ResizableWorkspace, id: string): HTMLElement => slotOf(m, id).querySelector<HTMLElement>('[data-panel-grab-bar]')!;
const announcer = (): string => document.querySelector('[data-workspace-announcer]')!.textContent ?? '';
const settle = async (): Promise<void> => {
  await act(async () => undefined);
  await advanceFrames(SLIDE_DONE_MS);
};
const press = async (el: Element, key: string): Promise<KeyboardEvent> => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => void el.dispatchEvent(event));
  await settle();
  return event;
};

test('arrowKeyBelongsElsewhere judges every clause but a repeat', () => {
  const key = (init: KeyboardEventInit = {}): KeyboardEvent => new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true, bubbles: true, ...init });
  assert.equal(arrowKeyBelongsElsewhere(key(), document), false, 'a bare key');
  assert.equal(arrowKeyBelongsElsewhere(key({ repeat: true }), document), false, 'a repeat is the caller\'s to judge');
  assert.equal(arrowKeyBelongsElsewhere(key({ shiftKey: true }), document), true, 'a modifier');
  assert.equal(arrowKeyBelongsElsewhere(key({ isComposing: true }), document), true, 'an IME');
  const handled = key();
  handled.preventDefault();
  assert.equal(arrowKeyBelongsElsewhere(handled, document), true, 'a key a handler took');
});

test('the row is a named region and each panel a group named with its place among the panels drawn', async () => {
  const m = await rig(['one', 'two']);
  const region = m.container;
  assert.equal(region.getAttribute('role'), 'region');
  assert.equal(region.getAttribute('aria-label'), 'Panels');
  const groups = [...m.container.querySelectorAll<HTMLElement>('[data-row-slot]')].map((n) => [n.getAttribute('role'), n.getAttribute('aria-label')]);
  assert.deepEqual(groups, [['group', 'History, 1 of 3'], ['group', 'ONE, 2 of 3'], ['group', 'TWO, 3 of 3']]);
});

test('a drag says the panel\'s title, not draggable item and an id', async () => {
  const m = await rig(['one', 'two']);
  const region = (): string => document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '';
  await drag(stripOf(m, 'one'), { dx: 100, dy: 0, keepDown: true });
  assert.equal(region(), 'Picked up ONE');
  await release(100, 0);
  await settle();
  assert.equal(region(), 'Dropped ONE');
});

test('the grab strip is a button named for its panel; ArrowRight moves it one slot and the live region says so', async () => {
  const m = await rig(['one', 'two']);
  const strip = stripOf(m, 'one');
  assert.equal(strip.getAttribute('role'), 'button');
  assert.equal(strip.tabIndex, 0);
  assert.equal(strip.getAttribute('aria-label'), 'Move or close ONE');
  const live = document.querySelector('[data-workspace-announcer]')!;
  assert.deepEqual([live.getAttribute('role'), live.getAttribute('aria-live')], ['status', 'polite']);
  const event = await press(strip, 'ArrowRight');
  assert.equal(event.defaultPrevented, true, 'the key is taken, so the row does not also step');
  assert.deepEqual(order(m), ['two', 'one']);
  assert.equal(announcer(), 'Moved ONE right');
  await press(stripOf(m, 'one'), 'ArrowRight');
  assert.deepEqual(order(m), ['two', 'one']);
  assert.equal(announcer(), 'ONE cannot move right');
  await press(stripOf(m, 'one'), 'ArrowLeft');
  assert.deepEqual(order(m), ['one', 'two']);
  assert.equal(announcer(), 'Moved ONE left');
});

test('Delete on the strip closes the panel and says so; a panel that cannot close has no strip', async () => {
  const m = await rig(['one', 'two', 'three']);
  await press(stripOf(m, 'two'), 'Delete');
  assert.deepEqual(order(m), ['one', 'three']);
  assert.equal(announcer(), 'Closed TWO');
  const fixed = await rig(['solo'], { solo: { closable: false } });
  assert.equal(stripOf(fixed, 'solo') === null, true, 'a panel that cannot close has no strip at all');
});

test('a press on the strip still starts a drag although the strip is itself a button', async () => {
  const m = await rig(['one', 'two']);
  await drag(stripOf(m, 'one'), { dx: 450, dy: 0 });
  await settle();
  assert.deepEqual(order(m), ['two', 'one']);
});

test('an arrow with a modifier on the strip does nothing and is not taken', async () => {
  const m = await rig(['one', 'two']);
  const strip = stripOf(m, 'one');
  const shifted = new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true });
  await act(async () => void strip.dispatchEvent(shifted));
  await settle();
  assert.deepEqual(order(m), ['one', 'two']);
  assert.equal(shifted.defaultPrevented, false);
});

test('the grab strip\'s name follows its handle\'s title when nothing renders the strip again', async () => {
  // The handle announces a title change; no parent re-renders, so only a subscription can move the name.
  let title: string | undefined;
  const listeners = new Set<() => void>();
  const handle = { getState: () => ({ title }), subscribe: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    } } as unknown as NonNullable<PanelSlotValue['handle']>;
  const host = document.createElement('div');
  document.body.append(host);
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(PanelSlotContext.Provider, { value: { collapsible: true, closable: true, movable: true, resizable: true, maxSlots: 4, neighborWidths: { left: [], right: [] }, pinned: false, tuning: slotTuning(LIBRARY_TUNING_DEFAULTS, undefined), handle } }, React.createElement(DragToClose, { onClose: () => undefined, children: ({ sx: _sx, ...h }) => React.createElement('div', { ...h, 'data-own-strip': '' }, 'strip') }))));
  const label = (): string => host.querySelector('[data-own-strip]')!.getAttribute('aria-label')!;
  assert.equal(label(), 'Move or close Untitled panel');
  title = 'After';
  await act(async () => void listeners.forEach((l) => l()));
  assert.equal(label(), 'Move or close After');
  title = undefined;
  await act(async () => void listeners.forEach((l) => l()));
  assert.equal(label(), 'Move or close Untitled panel', 'a title taken away is heard too');
  await act(async () => root.unmount());
  assert.equal(listeners.size, 0, 'and the strip lets go of the handle');
  host.remove();
});
