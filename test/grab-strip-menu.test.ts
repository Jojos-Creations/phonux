/**
 * The grab strip's single-pointer route: a click, a tap, Enter or Space opens a menu with Move left, Move right and Close, so a
 * panel can be moved and closed without a drag or a hardware key. A drag that ends on the strip does not open it, and a close from the
 * menu or by key hands focus to the panel that takes its place.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { Panel, PanelFrame, createWorkspace, definePanel } from '../index.js';
import type { PanelTemplate, WorkspaceHandle } from '../index.js';
import { SLIDE_DURATION_SEC } from '../rowConstants.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag } from './support/drag-gesture.js';
import { stableIds } from './support/frame-fixtures.js';
import { flush, mountWorkspace, type ResizableWorkspace } from './support/workspace-row.js';

const SLIDE_DONE_MS = SLIDE_DURATION_SEC * 1000 + 100;
const open: WorkspaceHandle[] = [];
afterEach(() => {
  cleanup();
  for (const ws of open.splice(0)) act(() => ws.dispose());
});

const bare = (id: string): PanelTemplate =>
  definePanel({ id, settings: { title: id.toUpperCase(), multiple: true }, view: ({ panel }) => React.createElement('p', { 'data-body': id, 'data-slot': panel.id }, panel.id) });
const rootTemplate = (): PanelTemplate =>
  definePanel({ id: 'root', settings: { title: 'History' }, view: () => React.createElement(Panel, { title: 'History', children: React.createElement(PanelFrame, null, React.createElement('i')) }) });

async function rig(ids: string[]): Promise<ResizableWorkspace> {
  const ws = createWorkspace({ mount: false, root: rootTemplate(), templates: ids.map((id) => bare(id)), newId: stableIds() });
  open.push(ws);
  for (const id of ids) ws.addPanel(id, { id: `${id}-1` });
  const m = mountWorkspace(ws, { width: 1600, withMaxLiveWidth: true });
  await flush();
  await advanceFrames(SLIDE_DONE_MS);
  return m;
}
const slotNumber = (n: HTMLElement): number => Number(n.closest('[data-row-slot]')!.getAttribute('data-row-slot'));
const order = (m: ResizableWorkspace): string[] => [...m.container.querySelectorAll<HTMLElement>('[data-body]')].sort((a, b) => slotNumber(a) - slotNumber(b)).map((n) => n.dataset.body!);
const stripOf = (m: ResizableWorkspace, id: string): HTMLElement => m.container.querySelector<HTMLElement>(`[data-body="${id}"]`)!.closest<HTMLElement>('[data-row-slot]')!.querySelector<HTMLElement>('[data-panel-grab-bar]')!;
const announcer = (): string => document.querySelector('[data-workspace-announcer]')!.textContent ?? '';
const settle = async (): Promise<void> => {
  await act(async () => undefined);
  await advanceFrames(SLIDE_DONE_MS);
};
const menuItems = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];
const item = (name: string): HTMLElement => menuItems().find((n) => n.textContent === name)!;

/** A press and release of one pointer kind on `el`, then the click the browser follows it with. */
async function tap(el: Element, pointerType: 'mouse' | 'touch'): Promise<void> {
  const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 0, buttons: 1 });
  for (const [k, v] of Object.entries({ pointerId: 1, pointerType, isPrimary: true })) Object.defineProperty(down, k, { value: v });
  await act(async () => void el.dispatchEvent(down));
  const up = new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 0 });
  for (const [k, v] of Object.entries({ pointerId: 1, pointerType, isPrimary: true })) Object.defineProperty(up, k, { value: v });
  await act(async () => void document.dispatchEvent(up));
  await act(async () => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
}
const describe = (el: Element | null): string => (el === null ? 'nothing' : `${el.tagName} ${el.getAttribute('aria-label') ?? ''}`);
const key = async (el: Element, k: string): Promise<KeyboardEvent> => {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  await act(async () => void el.dispatchEvent(event));
  return event;
};

for (const pointerType of ['mouse', 'touch'] as const) {
  test(`a ${pointerType} press on the grab strip opens a menu of Move left, Move right and Close`, async () => {
    const m = await rig(['one', 'two']);
    const strip = stripOf(m, 'one');
    assert.equal(strip.getAttribute('aria-haspopup'), 'menu');
    assert.equal(strip.getAttribute('aria-expanded'), 'false');
    await tap(strip, pointerType);
    assert.deepEqual(menuItems().map((n) => n.textContent), ['Move left', 'Move right', 'Close']);
    assert.equal(strip.getAttribute('aria-expanded'), 'true');
  });
}

test('Enter and Space on the strip open the menu', async () => {
  const m = await rig(['one', 'two']);
  for (const k of ['Enter', ' ']) {
    const strip = stripOf(m, 'one');
    const event = await key(strip, k);
    assert.equal(event.defaultPrevented, true, `${JSON.stringify(k)} is taken`);
    assert.deepEqual(menuItems().map((n) => n.textContent), ['Move left', 'Move right', 'Close'], `${JSON.stringify(k)} opens it`);
    await key(menuItems()[0]!, 'Escape');
    await settle();
    assert.equal(menuItems().length, 0, 'Escape closes it');
  }
});

test('Move right in the menu moves the panel one slot and says so; Move left at the end says it cannot', async () => {
  const m = await rig(['one', 'two']);
  await tap(stripOf(m, 'one'), 'mouse');
  await act(async () => void item('Move right').click());
  await settle();
  assert.deepEqual(order(m), ['two', 'one']);
  assert.equal(announcer(), 'Moved ONE right');
  await tap(stripOf(m, 'one'), 'mouse');
  await act(async () => void item('Move right').click());
  await settle();
  assert.equal(announcer(), 'ONE cannot move right');
});

test('Close in the menu closes the panel, says so, and focus lands on the grab strip of the panel that took its place', async () => {
  const m = await rig(['one', 'two', 'three']);
  const strip = stripOf(m, 'two');
  strip.focus();
  await tap(strip, 'mouse');
  await act(async () => void item('Close').click());
  await settle();
  assert.deepEqual(order(m), ['one', 'three']);
  assert.equal(announcer(), 'Closed TWO');
  assert.ok(document.activeElement === stripOf(m, 'three'), `focus is on the panel that slid into its place, not ${describe(document.activeElement)}`);
});

test('Delete on the strip hands focus to the next panel\'s strip instead of the page body', async () => {
  const m = await rig(['one', 'two', 'three']);
  stripOf(m, 'one').focus();
  await key(stripOf(m, 'one'), 'Delete');
  await settle();
  assert.deepEqual(order(m), ['two', 'three']);
  assert.ok(document.activeElement === stripOf(m, 'two'), `focus is on the next panel's strip, not ${describe(document.activeElement)}`);
});

test('the click that ends a drag on the strip does not open the menu, and a plain press after it does', async () => {
  const m = await rig(['one', 'two']);
  const strip = stripOf(m, 'one');
  await drag(strip, { dx: 40, dy: 0 });
  await act(async () => void strip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
  assert.equal(menuItems().length, 0, 'the click that ends a drag is not a press');
  await new Promise((resolve) => setTimeout(resolve, 100));
  await tap(stripOf(m, 'one'), 'mouse');
  assert.equal(menuItems().length, 3, 'a plain press opens it');
});
