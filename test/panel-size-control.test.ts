/**
 * PanelSizeControl, which Panel draws in the header of every resizable panel: the widths that fit, the pressed width, a pick
 * going through setSlots, and a refusal announced or handed to the host.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act, createElement, type ReactElement } from 'react';
import { AnnounceContext } from '../announce.js';
import { LIBRARY_TUNING_DEFAULTS, PanelSizeControl, type PanelSizeControlProps } from '../index.js';
import { PanelSlotContext, type PanelSlotValue } from '../panelSlotContext.js';
import { slotTuning } from '../panelTuning.js';
import { cleanup, mount } from './support/mount-harness.js';
import { headerRig, type HeaderRig } from './support/header-rig.js';

afterEach(() => {
  mock.restoreAll();
  cleanup();
});

const wait = (): Promise<void> => act(async () => void (await new Promise((done) => setTimeout(done, 80))));
const sizeButton = (rig: HeaderRig): HTMLButtonElement | null => rig.m.container.querySelector<HTMLButtonElement>('[data-panel-size-button]');
const widths = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('[data-view-size]')];

async function openSizes(rig: HeaderRig): Promise<void> {
  act(() => void sizeButton(rig)!.click());
  await wait();
}

test('a resizable panel shows the control, and one that is not resizable or is held to one slot shows none', async () => {
  assert.ok(sizeButton(await headerRig({ ids: ['a'], sizeControl: true })), 'resizable by default');
  cleanup();
  assert.equal(sizeButton(await headerRig({ ids: ['a'], sizeControl: true, settings: { a: { resizable: false } } })), null);
  cleanup();
  assert.equal(sizeButton(await headerRig({ ids: ['a'], sizeControl: true, settings: { a: { maxSlots: 1 } } })), null);
  cleanup();
  assert.equal(sizeButton(await headerRig({ ids: ['a'], sizeControl: false })), null, 'sizeControl={false} leaves it to the view');
});

test('the menu offers the widths maxSlots allows, named by the labels, with the own width pressed, then Fullscreen', async () => {
  const rig = await headerRig({ ids: ['a'], sizeControl: true, settings: { a: { maxSlots: 3 } } });
  await openSizes(rig);
  assert.deepEqual(widths().map((b) => b.getAttribute('aria-label')), ['Phone', 'Fold', 'Tablet']);
  assert.deepEqual(widths().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.viewSize), ['phone']);
  assert.deepEqual(widths().filter((b) => b.getAttribute('aria-disabled') === 'true').map((b) => b.dataset.viewSize), ['phone'], 'the current size is marked unavailable, the others are not');
  assert.ok(document.querySelector('[role="group"][aria-label="View Size"] [data-view-fullscreen]'), 'Fullscreen is in the group');
});

test('picking a width sets the panel\'s slots as the person, and the pressed width follows', async () => {
  const rig = await headerRig({ ids: ['a'], sizeControl: true, settings: { a: { maxSlots: 3 } } });
  await openSizes(rig);
  act(() => void widths().find((b) => b.dataset.viewSize === 'tablet')!.click());
  await wait();
  assert.equal(rig.entry('a').slots, 3);
  await openSizes(rig);
  assert.deepEqual(widths().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.viewSize), ['tablet']);
});

/** The control alone in a hand-built slot whose handle refuses every width. */
function refusingSlot(onRefused?: (what: 'resize' | 'fullscreen') => void): { said: string[]; calls: unknown[][]; container: HTMLElement } {
  const said: string[] = [];
  const calls: unknown[][] = [];
  const handle = {
    setSlots: (...args: unknown[]) => {
      calls.push(args);
      return { ok: false };
    },
  } as unknown as NonNullable<PanelSlotValue['handle']>;
  const value: PanelSlotValue = { collapsible: true, closable: true, movable: true, resizable: true, maxSlots: 4, neighborWidths: { left: [], right: [] }, tuning: slotTuning(LIBRARY_TUNING_DEFAULTS), handle, summary: { id: 'p', live: true, slots: 1, fitSlots: 4 } };
  const props: PanelSizeControlProps = onRefused === undefined ? {} : { onRefused };
  const control = createElement(PanelSizeControl as (p: PanelSizeControlProps) => ReactElement | null, props);
  const tree = createElement(AnnounceContext.Provider, { value: (text: string) => void said.push(text) }, createElement(PanelSlotContext.Provider, { value }, control));
  return { said, calls, container: mount(tree).container };
}

async function pickIn(container: HTMLElement, size: string): Promise<void> {
  act(() => void container.querySelector<HTMLButtonElement>('[data-panel-size-button]')!.click());
  await wait();
  act(() => void widths().find((b) => b.dataset.viewSize === size)!.click());
  await wait();
}

test('a refused width is announced through the workspace\'s live region, as the person asked for it', async () => {
  const { said, calls, container } = refusingSlot();
  await pickIn(container, 'tablet');
  assert.deepEqual(calls, [[3, 'person']]);
  assert.deepEqual(said, ['Could not resize this panel']);
});

test('with onRefused the host hears the refusal instead, and nothing is announced', async () => {
  const heard: string[] = [];
  const { said, container } = refusingSlot((what) => heard.push(what));
  await pickIn(container, 'fold');
  assert.deepEqual(heard, ['resize']);
  assert.deepEqual(said, []);
});

const key = (target: Element, name: string): void => void act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })));

const stopName = (b: HTMLButtonElement): string => b.dataset.viewSize ?? (b.dataset.viewFullscreen === undefined ? '?' : 'fullscreen');

test('opening the menu puts focus on the first width, and the arrow keys, Home and End move it among the widths and Fullscreen', async () => {
  const rig = await headerRig({ ids: ['a'], sizeControl: true, settings: { a: { maxSlots: 3 } } });
  await openSizes(rig);
  const stops = [...document.querySelectorAll<HTMLButtonElement>('[data-panel-size-group] button')];
  assert.deepEqual(stops.map(stopName), ['phone', 'fold', 'tablet', 'fullscreen'], 'three widths and Fullscreen, the current size, Phone, among them');
  assert.ok(document.activeElement === stops[1], 'focus starts on the first width that is not the current size');
  key(document.activeElement!, 'ArrowLeft');
  assert.ok(document.activeElement === stops[0], 'ArrowLeft reaches the current size, Phone');
  key(document.activeElement!, 'ArrowLeft');
  assert.ok(document.activeElement === stops[0], 'the start does not wrap');
  key(document.activeElement!, 'ArrowRight');
  assert.ok(document.activeElement === stops[1], "focus is on the expected stop");
  key(document.activeElement!, 'End');
  assert.ok(document.activeElement === stops[3], "focus is on the expected stop");
  key(document.activeElement!, 'ArrowRight');
  assert.ok(document.activeElement === stops[3], 'the ends do not wrap');
  key(document.activeElement!, 'ArrowLeft');
  assert.ok(document.activeElement === stops[2], "focus is on the expected stop");
  key(document.activeElement!, 'Home');
  assert.ok(document.activeElement === stops[0], 'Home reaches the current size, Phone');
});

test('with a middle width current, focus opens on Phone and the arrow keys land on the current size', async () => {
  const rig = await headerRig({ ids: ['a'], sizeControl: true, settings: { a: { maxSlots: 3 } } });
  await openSizes(rig);
  act(() => void widths().find((b) => b.dataset.viewSize === 'fold')!.click());
  await wait();
  assert.equal(rig.entry('a').slots, 2);
  await openSizes(rig);
  const at = (): string => (document.activeElement instanceof HTMLButtonElement ? stopName(document.activeElement) : 'none');
  assert.equal(at(), 'phone', 'focus starts on Phone, the first width that is not the current size');
  key(document.activeElement!, 'ArrowRight');
  assert.equal(at(), 'fold', 'ArrowRight lands on Fold, the current size');
  key(document.activeElement!, 'ArrowRight');
  assert.equal(at(), 'tablet', 'and goes on past it');
  key(document.activeElement!, 'ArrowLeft');
  assert.equal(at(), 'fold', 'ArrowLeft lands on it again');
});

test('Escape closes the menu and focus returns to the View Size button', async () => {
  const rig = await headerRig({ ids: ['a'], sizeControl: true });
  await openSizes(rig);
  key(document.activeElement!, 'Escape');
  await wait();
  assert.equal(document.querySelectorAll('[data-view-size]').length, 0, 'the menu is gone');
  assert.ok(document.activeElement === sizeButton(rig), "focus is on the expected stop");
});

test('the menu is not a role=menu holding buttons, which a screen reader cannot read as a menu', async () => {
  const rig = await headerRig({ ids: ['a'], sizeControl: true });
  await openSizes(rig);
  assert.ok(document.querySelector('[role="menu"]') === null, 'no role=menu');
  assert.equal(sizeButton(rig)!.getAttribute('aria-haspopup'), 'dialog');
});

const current = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('[data-panel-size-group] button')].filter((b) => b.getAttribute('aria-current') === 'true');

test('the current size is announced as current: pressed, aria-current and aria-disabled, and never the disabled attribute that hides it from the keys', async () => {
  const rig = await headerRig({ ids: ['a'], sizeControl: true, settings: { a: { maxSlots: 3 } } });
  await openSizes(rig);
  const all = [...document.querySelectorAll<HTMLButtonElement>('[data-panel-size-group] button')];
  assert.deepEqual(current().map(stopName), ['phone']);
  const phone = current()[0]!;
  assert.equal(phone.getAttribute('aria-pressed'), 'true');
  assert.equal(phone.getAttribute('aria-disabled'), 'true');
  assert.equal(phone.getAttribute('aria-label'), 'Phone');
  assert.deepEqual(all.filter((b) => b.disabled || b.hasAttribute('disabled')).map(stopName), [], 'no entry is disabled');
  assert.deepEqual(all.filter((b) => b.tabIndex < 0).map(stopName), [], 'every entry takes focus');
  assert.deepEqual(all.filter((b) => b !== phone && (b.hasAttribute('aria-current') || b.getAttribute('aria-disabled') === 'true' || b.getAttribute('aria-pressed') !== 'false')).map(stopName), [], 'the other entries are plain, unpressed and available');
});

/** Every way a person picks an entry: Enter and Space as the key events, then the click the browser fires for them, or a press. */
function activate(target: HTMLButtonElement): void {
  for (const name of ['Enter', ' ']) {
    act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })));
    act(() => void target.dispatchEvent(new KeyboardEvent('keyup', { key: name, bubbles: true, cancelable: true })));
    act(() => void target.click());
  }
}

test('picking the current size by press, Enter or Space changes nothing: same slots, same snapshot, no move, and the menu stays open on it', async () => {
  const rig = await headerRig({ ids: ['a'], sizeControl: true, settings: { a: { maxSlots: 3 } } });
  await openSizes(rig);
  const before = rig.ws.panels.getSnapshot();
  let told = 0;
  let moves = 0;
  const stopTold = rig.ws.panels.subscribe(() => void (told += 1));
  const stopMoves = rig.ws.panels.subscribeMoves(() => void (moves += 1));
  const phone = widths().find((b) => b.dataset.viewSize === 'phone')!;
  act(() => phone.focus());
  activate(phone);
  await wait();
  stopTold();
  stopMoves();
  assert.equal(rig.entry('a').slots, 1, 'the panel keeps its one slot');
  assert.ok(rig.ws.panels.getSnapshot() === before, 'the snapshot is the same object');
  assert.equal(rig.ws.panels.getSnapshot().version, before.version, 'the snapshot version did not move');
  assert.equal(told, 0, 'no change was published');
  assert.equal(moves, 0, 'no move was reported');
  assert.equal(widths().length, 3, 'the menu is still open');
  assert.ok(document.activeElement === widths().find((b) => b.dataset.viewSize === 'phone'), 'focus stays on the current size');
  act(() => void widths().find((b) => b.dataset.viewSize === 'tablet')!.click());
  await wait();
  assert.equal(rig.entry('a').slots, 3, 'another width still resizes afterwards');
});

test('picking the current size calls nothing on the panel handle, while another width still calls setSlots', async () => {
  const calls: string[] = [];
  const handle = new Proxy({}, { get: (_t, name) => (...args: unknown[]) => {
    calls.push(`${String(name)}(${args.join(',')})`);
    return { ok: true };
  } }) as unknown as NonNullable<PanelSlotValue['handle']>;
  const value: PanelSlotValue = { collapsible: true, closable: true, movable: true, resizable: true, maxSlots: 4, neighborWidths: { left: [], right: [] }, tuning: slotTuning(LIBRARY_TUNING_DEFAULTS), handle, summary: { id: 'p', live: true, slots: 2, fitSlots: 4 } };
  const control = createElement(PanelSizeControl as (p: PanelSizeControlProps) => ReactElement | null, {});
  const { container } = mount(createElement(PanelSlotContext.Provider, { value }, control));
  act(() => void container.querySelector<HTMLButtonElement>('[data-panel-size-button]')!.click());
  await wait();
  activate(widths().find((b) => b.dataset.viewSize === 'fold')!);
  await wait();
  assert.deepEqual(calls, [], 'the current size, Fold, made no call: no setSlots, no configure, no move');
  act(() => void widths().find((b) => b.dataset.viewSize === 'tablet')!.click());
  await wait();
  assert.deepEqual(calls, ['setSlots(3,person)']);
});

test('while the panel is fullscreen, Fullscreen is the current size: reachable, announced as current, and picking it keeps the panel fullscreen', async () => {
  // jsdom has no popover, which the panel's lift to the window uses.
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const saved = { show: proto.showPopover, hide: proto.hidePopover };
  proto.showPopover = () => {};
  proto.hidePopover = () => {};
  try {
    const rig = await headerRig({ ids: ['a'], sizeControl: true, settings: { a: { maxSlots: 3 } } });
    await openSizes(rig);
    assert.deepEqual(current().map(stopName), ['phone'], 'not fullscreen to begin with');
    act(() => void document.querySelector<HTMLButtonElement>('[data-view-fullscreen]')!.click());
    await wait();
    await openSizes(rig);
    assert.deepEqual(current().map(stopName), ['fullscreen'], 'Fullscreen, picked when not current, made the panel fullscreen: it is the current entry, and no width is');
    const full = document.querySelector<HTMLButtonElement>('[data-view-fullscreen]')!;
    assert.equal(full.getAttribute('aria-disabled'), 'true');
    assert.equal(full.disabled, false);
    key(document.activeElement!, 'End');
    assert.ok(document.activeElement === full, 'End reaches Fullscreen');
    activate(full);
    await wait();
    assert.ok(document.querySelector('[data-view-fullscreen]') !== null, 'the menu is still open');
    assert.deepEqual(current().map(stopName), ['fullscreen'], 'the panel is still fullscreen');
  } finally {
    proto.showPopover = saved.show;
    proto.hidePopover = saved.hide;
  }
});
