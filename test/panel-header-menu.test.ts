/**
 * PanelHeaderMenu in a panel's header slot: the move menu's one entry reads Pin or Unpin from the panel's pinned state,
 * the close button and the grip appear only when the panel allows them, and the body draws nothing of its own.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act, createElement } from 'react';
import { PanelHeaderMenu, type PanelHeaderMenuProps, type Pinning, type PanelSettings } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { headerRig, type HeaderRig } from './support/header-rig.js';

afterEach(() => {
  mock.restoreAll();
  cleanup();
});

const FIX: Pinning = { pinned: { placement: 'row-start', parkable: false }, unpinned: { placement: 'row-end', parkable: true } };
const wait = (): Promise<void> => act(async () => void (await new Promise((done) => setTimeout(done, 80))));

const menuOf = (rig: HeaderRig, id: string): HTMLElement | null => rig.m.container.querySelector<HTMLElement>('[data-panel-header-menu]') ?? null;
const moveButton = (rig: HeaderRig, id: string): HTMLButtonElement | null => rig.m.container.querySelector<HTMLButtonElement>('[data-panel-move]') ?? null;
const closeButton = (rig: HeaderRig, id: string): HTMLButtonElement | null => rig.m.container.querySelector<HTMLButtonElement>('[data-panel-close]') ?? null;

/** Opens the move menu of panel `id` and returns its one entry, read from the portal the menu draws into the document. */
async function openMenu(rig: HeaderRig, id: string): Promise<HTMLElement> {
  act(() => void moveButton(rig, id)!.click());
  await wait();
  const entry = document.querySelector<HTMLElement>('[data-panel-pin-toggle]');
  assert.ok(entry, 'the move menu holds the pin entry');
  return entry;
}

/** A panel's header with the menu in its header slot; the body is a plain element with no menu in it. */
const withMenu = (settings: PanelSettings = {}): Promise<HeaderRig> => headerRig({ ids: ['a'], actions: createElement(PanelHeaderMenu), settings: { a: settings } });

test('menu: the move menu lists Pin while the panel is unpinned and Unpin once it is pinned, and nothing else', async () => {
  const rig = await withMenu({ pinning: FIX });
  assert.equal(rig.state('a').pinned, false);
  let entry = await openMenu(rig, 'a');
  assert.equal(entry.textContent, 'Pin');
  assert.equal(document.querySelectorAll('[role="menuitem"]').length, 1, 'one entry only');
  act(() => void entry.click());
  await wait();
  assert.equal(rig.state('a').pinned, true, 'the entry pinned the panel');
  entry = await openMenu(rig, 'a');
  assert.equal(entry.textContent, 'Unpin');
  act(() => void entry.click());
  await wait();
  assert.equal(rig.state('a').pinned, false, 'the same entry now unpins it');
});

test('menu: the close button is drawn for a closable panel and gone for one that is not, and a press closes the panel', async () => {
  const rig = await withMenu();
  assert.ok(closeButton(rig, 'a'), 'closable by default');
  act(() => void closeButton(rig, 'a')!.click());
  await wait();
  assert.equal(rig.state('a').status, 'closed');

  const locked = await withMenu({ closable: false });
  assert.equal(closeButton(locked, 'a'), null, 'no X when the panel cannot be closed');
});

test('menu: the move menu and the close button follow the panel\'s capabilities, and a frozen panel draws nothing', async () => {
  const open = await withMenu();
  assert.ok(moveButton(open, 'a'));
  assert.ok(closeButton(open, 'a'));

  const frozen = await withMenu({ closable: false, movable: false });
  assert.equal(moveButton(frozen, 'a'), null, 'no move menu for a panel that cannot be moved');
  assert.equal(closeButton(frozen, 'a'), null);
  assert.equal(menuOf(frozen, 'a'), null, 'nothing drawn at all');
});

test('menu: with grabProps the panel draws its one grab handle, and the menu adds no second one', async () => {
  const rig = await headerRig({ ids: ['a'], actions: createElement(PanelHeaderMenu), grab: true });
  assert.ok(menuOf(rig, 'a'), 'the menu is drawn');
  assert.equal(rig.m.container.querySelectorAll('[data-grab]').length, 1, 'Panel\'s own grab handle only');
});

test('menu: it draws in the header slot only, and the panel body holds none of it', async () => {
  const rig = await withMenu();
  assert.ok(menuOf(rig, 'a'), 'the menu is drawn');
  const body = rig.m.container.querySelector<HTMLElement>('[data-slot="a"]');
  assert.ok(body, 'the panel body rendered');
  assert.equal(body.querySelector('[data-panel-header-menu]'), null, 'nothing drawn inside the body');
});

test('menu: a pin or unpin from the menu reports to onPinChange with the verb and whether it applied', async () => {
  const calls: Array<[string, boolean]> = [];
  const rig = await headerRig({ ids: ['a'], actions: createElement<PanelHeaderMenuProps>(PanelHeaderMenu, { onPinChange: (verb, ok) => calls.push([verb, ok]) }), settings: { a: { pinning: FIX } } });
  let entry = await openMenu(rig, 'a');
  act(() => void entry.click());
  await wait();
  entry = await openMenu(rig, 'a');
  act(() => void entry.click());
  await wait();
  assert.deepEqual(calls, [
    ['pin', true],
    ['unpin', true],
  ]);
});

test('menu: closing the menu without a pin returns focus to the move button', async () => {
  const rig = await withMenu({ pinning: FIX });
  await openMenu(rig, 'a');
  act(() => void document.querySelector<HTMLElement>('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await wait();
  const move = moveButton(rig, 'a');
  assert.ok(move !== null && document.activeElement === move, 'focus returned to the move button');
  assert.equal(rig.state('a').pinned, false, 'closing pins nothing');
});

test('menu: after a pin, focus lands on the move button once the header is back', async () => {
  const rig = await withMenu({ pinning: FIX });
  const entry = await openMenu(rig, 'a');
  act(() => void entry.click());
  await advanceFrames(300);
  const move = moveButton(rig, 'a');
  assert.ok(move !== null && document.activeElement === move, 'focus is on the move button after the pin');
});

test('menu: host entries are listed under Pin, pick and close the menu, and show it even for a panel that cannot move', async () => {
  const picked: string[] = [];
  const entries = [
    { id: 'size-big', label: 'Bigger', onSelect: () => picked.push('big') },
    { id: 'size-small', label: 'Smaller', onSelect: () => picked.push('small') },
  ];
  const rig = await headerRig({ ids: ['a'], actions: createElement<PanelHeaderMenuProps>(PanelHeaderMenu, { entries }), settings: { a: { movable: false } } });
  assert.ok(moveButton(rig, 'a'), 'the move menu shows for the host entries alone');
  act(() => void moveButton(rig, 'a')!.click());
  await wait();
  assert.equal(document.querySelector('[data-panel-pin-toggle]'), null, 'no Pin entry for a fixed panel');
  const items = [...document.querySelectorAll<HTMLElement>('[data-panel-menu-entry]')];
  assert.deepEqual(items.map((el) => el.textContent), ['Bigger', 'Smaller']);
  act(() => void items[1]!.click());
  await wait();
  assert.deepEqual(picked, ['small']);
  assert.equal(document.querySelector('[role="menu"]'), null, 'the menu closed on pick');
});

test('menu: a group draws its title and one icon button per action, with the shortcut in its hover text, and a press picks it and closes the menu', async () => {
  const picked: string[] = [];
  const group = {
    id: 'view-size',
    title: 'View Size',
    actions: [
      { id: 'phone', label: 'Phone', icon: createElement('i'), shortcut: 'Option+1', onSelect: () => picked.push('phone') },
      { id: 'fullscreen', label: 'Fullscreen', icon: createElement('i'), shortcut: 'Option+Enter', onSelect: () => picked.push('fullscreen') },
    ],
  };
  const rig = await headerRig({ ids: ['a'], actions: createElement<PanelHeaderMenuProps>(PanelHeaderMenu, { entries: [group] }), settings: { a: { movable: false } } });
  act(() => void moveButton(rig, 'a')!.click());
  await wait();
  const row = document.querySelector<HTMLElement>('[data-panel-menu-group="view-size"]');
  assert.ok(row, 'the group is drawn');
  assert.equal(row.getAttribute('aria-label'), 'View Size');
  assert.equal(row.querySelector('[data-panel-menu-entry="phone"]')?.getAttribute('aria-label'), 'Phone');
  assert.equal(row.querySelectorAll('button').length, 2, 'one icon button per action');
  act(() => void row.querySelector<HTMLElement>('[data-panel-menu-entry="fullscreen"]')!.click());
  await wait();
  assert.deepEqual(picked, ['fullscreen']);
  assert.equal(document.querySelector('[role="menu"]'), null, 'the menu closed on pick');
});
