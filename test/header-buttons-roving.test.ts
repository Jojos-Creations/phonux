/**
 * The header buttons as one toolbar: a single tab stop, Arrow, Home and End moving along the buttons, disabled buttons
 * skipped, the stop following a removed or disabled button, and the row announcing itself as a horizontal toolbar.
 * These replace the earlier behavior, where every button was its own tab stop.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act, createElement, type ReactElement } from 'react';
import type { HeaderButton } from '../index.js';
import { cleanup } from './support/mount-harness.js';
import { headerRig, type HeaderRig } from './support/header-rig.js';

afterEach(() => cleanup());

const icon = (name: string): ReactElement => createElement('i', { 'data-icon': name });
const slot = (label: string, extra: Partial<HeaderButton> = {}): HeaderButton => ({ icon: icon(label), label, onClick: () => undefined, ...extra });
const stops = (rig: HeaderRig, panel = 'a'): string[] => rig.buttons(panel).filter((b) => b.tabIndex === 0).map((b) => b.getAttribute('aria-label')!);
const focusedLabel = (): string | null => document.activeElement?.getAttribute('aria-label') ?? null;
const keyDown = (el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => void el.dispatchEvent(event));
  return event;
};
const three = { menu: slot('Menu', { side: 'start' }), size: slot('Size', { order: 0 }), pin: slot('Pin', { order: 1 }) };

test('the row is a horizontal toolbar named by its title, and exactly one button is in the tab order', async () => {
  const rig = await headerRig({ ids: ['a'], title: 'Sessions', slots: three });
  const row = rig.row('a')!;
  assert.equal(row.getAttribute('role'), 'toolbar');
  assert.equal(row.getAttribute('aria-orientation'), 'horizontal');
  assert.equal(row.getAttribute('aria-label'), 'Sessions');
  assert.deepEqual(stops(rig), ['Menu'], 'the first button in document order holds the stop');
  assert.deepEqual(rig.buttons('a').map((b) => b.tabIndex), [0, -1, -1]);
});

test('Arrow keys, Home and End move focus across the start and end clusters, and the stop follows focus', async () => {
  const rig = await headerRig({ ids: ['a'], slots: three });
  const [menu, size, pin] = rig.buttons('a') as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];
  act(() => menu.focus());
  assert.equal(keyDown(menu, 'ArrowRight').defaultPrevented, true);
  assert.equal(focusedLabel(), 'Size');
  assert.deepEqual(stops(rig), ['Size']);
  keyDown(size, 'ArrowRight');
  assert.equal(focusedLabel(), 'Pin');
  keyDown(pin, 'ArrowRight');
  assert.equal(focusedLabel(), 'Pin', 'no wrap past the last button');
  keyDown(pin, 'Home');
  assert.equal(focusedLabel(), 'Menu');
  keyDown(menu, 'End');
  assert.equal(focusedLabel(), 'Pin');
  keyDown(pin, 'ArrowLeft');
  assert.equal(focusedLabel(), 'Size');
  assert.deepEqual(stops(rig), ['Size']);
});

test('a key with a modifier, or any other key, is left to the browser', async () => {
  const rig = await headerRig({ ids: ['a'], slots: three });
  const menu = rig.buttons('a')[0]!;
  act(() => menu.focus());
  assert.equal(keyDown(menu, 'ArrowRight', { shiftKey: true }).defaultPrevented, false);
  assert.equal(keyDown(menu, 'a').defaultPrevented, false);
  assert.equal(focusedLabel(), 'Menu');
});

test('disabled buttons are skipped by Arrow, Home and End and never hold the stop', async () => {
  const rig = await headerRig({ ids: ['a'], slots: { menu: slot('Menu', { side: 'start', disabled: true }), size: slot('Size', { order: 0 }), pin: slot('Pin', { order: 1, disabled: true }), end: slot('End', { order: 2 }) } });
  assert.deepEqual(stops(rig), ['Size']);
  const size = rig.buttons('a').find((b) => b.getAttribute('aria-label') === 'Size')!;
  act(() => size.focus());
  keyDown(size, 'ArrowRight');
  assert.equal(focusedLabel(), 'End', 'Pin is disabled and skipped');
  keyDown(document.activeElement!, 'Home');
  assert.equal(focusedLabel(), 'Size', 'Menu is disabled and skipped');
});

test('when every button is disabled the first still holds the stop', async () => {
  const rig = await headerRig({ ids: ['a'], slots: { one: slot('One', { disabled: true }), two: slot('Two', { disabled: true, order: 1 }) } });
  assert.deepEqual(stops(rig), ['One']);
});

test('removing the button that held the stop gives it to the first remaining one', async () => {
  const rig = await headerRig({ ids: ['a'], slots: three });
  assert.deepEqual(stops(rig), ['Menu']);
  rig.turn(() => rig.h.a!.configure({ headerButtons: { menu: false } }));
  assert.deepEqual(stops(rig), ['Size']);
});

test('disabling the button that held the stop moves it to the first enabled one', async () => {
  const rig = await headerRig({ ids: ['a'], slots: { menu: slot('Menu', { side: 'start', disabled: (c) => c.state.pinned }), size: slot('Size') } });
  assert.deepEqual(stops(rig), ['Menu']);
  rig.turn(() => void rig.h.a!.pin());
  assert.deepEqual(stops(rig), ['Size']);
});

test('two panels each have their own single stop', async () => {
  const rig = await headerRig({ ids: ['a', 'b'], slots: three });
  assert.deepEqual([stops(rig, 'a'), stops(rig, 'b')], [['Menu'], ['Menu']]);
});
