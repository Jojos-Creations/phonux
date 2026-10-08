/**
 * The header buttons as the keyboard and a screen reader meet them (jsdom and style assertions; real pixels and focus
 * retention across a real DOM move belong to the real-layout gate): native buttons, tab order, Enter and Space, and
 * where focus goes when the button that had it moves, leaves or takes its panel with it.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act, createElement, type ReactElement } from 'react';
import type { HeaderButton } from '../index.js';
import { cleanup } from './support/mount-harness.js';
import { headerRig, type HeaderRig } from './support/header-rig.js';

afterEach(() => {
  mock.restoreAll();
  cleanup();
});

const icon = (name: string): ReactElement => createElement('i', { 'data-icon': name });
const slot = (label: string, extra: Partial<HeaderButton> = {}): HeaderButton => ({ icon: icon(label), label, onClick: () => undefined, ...extra });
const byLabel = (rig: HeaderRig, panel: string, label: string): HTMLButtonElement => rig.buttons(panel).find((b) => b.getAttribute('aria-label') === label)!;
const rowOf = (rig: HeaderRig, panel: string): HTMLElement => rig.row(panel)!;

/** What a browser does for a native button: Enter clicks on keydown, Space on keyup, unless the page prevented it. */
function key(el: HTMLElement, name: 'Enter' | ' '): void {
  act(() => {
    const down = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    el.dispatchEvent(down);
    if (name === 'Enter' && !down.defaultPrevented) el.click();
    const up = new KeyboardEvent('keyup', { key: name, bubbles: true, cancelable: true });
    el.dispatchEvent(up);
    if (name === ' ' && !up.defaultPrevented) el.click();
  });
}

test('every slot is a native button, the grab bar has no tabindex, and the tab order is start slots, the title, the view action, end slots', async () => {
  const rig = await headerRig({
    ids: ['a'],
    grab: true,
    actions: createElement('button', { type: 'button', 'data-view-action': '' }, 'Edit'),
    slots: { menu: slot('Menu', { side: 'start' }), size: slot('Size', { order: 0 }), pin: slot('Pin', { order: 1 }) },
  });
  const row = rowOf(rig, 'a');
  assert.ok(rig.buttons('a').every((b) => b.tagName === 'BUTTON'));
  assert.equal(row.getAttribute('tabindex'), '-1');
  const grab = rig.m.container.querySelector('[data-panel-grab-bar]')!;
  assert.equal(grab.hasAttribute('tabindex'), false);
  const order = [...row.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? 'Edit');
  assert.deepEqual(order, ['Menu', 'Edit', 'Size', 'Pin']);
  const title = row.children[1]!;
  const menu = byLabel(rig, 'a', 'Menu');
  const edit = row.querySelector('[data-view-action]')!;
  assert.ok(menu.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING, 'the start slot is before the title');
  assert.ok(title.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING, 'the title is before the view action');
});

for (const [name, label] of [['Enter', 'Enter'], [' ', 'Space']] as const) {
  test(`${label} fires the function once`, async () => {
    let calls = 0;
    const rig = await headerRig({ ids: ['a'], slots: { go: slot('Go', { onClick: () => void (calls += 1) }) } });
    key(byLabel(rig, 'a', 'Go'), name);
    assert.equal(calls, 1);
  });
}

test('after a pin press that reorders the slot, focus returns to that panel\'s pin button exactly once, with preventScroll', async () => {
  const rig = await headerRig({ slots: { pin: slot('Pin', { onClick: (h) => void (h.getState().pinned ? h.unpin() : h.pin()) }) } });
  const button = byLabel(rig, 'c', 'Pin');
  act(() => button.focus());
  const focus = mock.method(HTMLElement.prototype, 'focus');
  act(() => button.click());
  assert.equal(rig.order().join(' '), 'c root a b');
  const onPin = focus.mock.calls.filter((c) => c.this === byLabel(rig, 'c', 'Pin'));
  assert.equal(onPin.length, 1, 'one focus call on that panel\'s pin button');
  assert.deepEqual(onPin[0]!.arguments[0], { preventScroll: true });
  assert.ok(document.activeElement === byLabel(rig, 'c', 'Pin'));
});

test('a press with no focus on the button moves no focus', async () => {
  const rig = await headerRig({ slots: { pin: slot('Pin', { onClick: (h) => void h.pin() }) } });
  const focus = mock.method(HTMLElement.prototype, 'focus');
  act(() => byLabel(rig, 'c', 'Pin').click());
  assert.equal(focus.mock.calls.length, 0);
});

test('a re-render without the focused slot moves focus to the same panel\'s header row, never body', async () => {
  const hideWhenTablet = (c: { state: { formFactor: string } }): boolean => c.state.formFactor === 'tablet';
  const rig = await headerRig({ ids: ['a'], slots: { tmp: slot('Tmp', { hidden: hideWhenTablet }), keep: slot('Keep') } });
  act(() => byLabel(rig, 'a', 'Tmp').focus());
  assert.ok(document.activeElement === byLabel(rig, 'a', 'Tmp'));
  act(() => void rig.h.a!.setFormFactor('tablet'));
  assert.equal(rig.buttons('a').length, 1);
  assert.ok(document.activeElement === rowOf(rig, 'a'));
  assert.equal(rowOf(rig, 'a').getAttribute('tabindex'), '-1');
});

test('when the only slot leaves, focus still lands on the header row, which takes tabindex -1', async () => {
  const rig = await headerRig({ ids: ['a'], slots: { tmp: slot('Tmp', { hidden: (c) => c.state.formFactor === 'tablet' }) } });
  const row = rowOf(rig, 'a');
  act(() => byLabel(rig, 'a', 'Tmp').focus());
  act(() => void rig.h.a!.setFormFactor('tablet'));
  assert.equal(rig.buttons('a').length, 0);
  assert.ok(document.activeElement === row);
  assert.equal(row.getAttribute('tabindex'), '-1');
});

test('a slot that closes its own panel moves focus to the header row of the panel now at that index, else the previous one\'s, never body', async () => {
  const rig = await headerRig({ slots: { close: slot('Close', { onClick: (h) => void h.close() }) } });
  act(() => byLabel(rig, 'b', 'Close').focus());
  act(() => byLabel(rig, 'b', 'Close').click());
  assert.ok(document.activeElement === rowOf(rig, 'c'), 'the panel now at that index');
  act(() => byLabel(rig, 'c', 'Close').focus());
  act(() => byLabel(rig, 'c', 'Close').click());
  assert.ok(document.activeElement === rowOf(rig, 'a'), 'the previous panel when none follows');
  assert.ok(document.activeElement !== document.body);
});
