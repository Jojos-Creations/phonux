/**
 * While a DragToClose gesture is live the page shows no text selection and starts no native image drag; the document
 * element's own inline values come back exactly after a release, a pointercancel, an unmount and any overlap of drags.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose } from '../index.js';
import { holdDragSelection } from '../dragToClose.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';

const root = (): CSSStyleDeclaration => document.documentElement.style;

afterEach(() => {
  cleanup();
  root().cssText = '';
  document.getSelection()?.removeAllRanges();
});

function box(reorder: boolean): React.ReactElement {
  return React.createElement(
    'div',
    null,
    React.createElement('p', { 'data-text': '' }, 'some words to select'),
    React.createElement('img', { 'data-photo': '', alt: '' }),
    React.createElement(DragToClose, {
      onClose: () => undefined,
      reorder: reorder ? { onDragEnd: () => undefined } : undefined,
      children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
    }),
  );
}

function handleOf(container: HTMLElement): HTMLElement {
  const handle = container.querySelector<HTMLElement>('[data-handle]');
  assert.ok(handle, 'the handle rendered');
  return handle;
}

function press(handle: Element): Promise<void> {
  return act(async () => {
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 0, buttons: 1 });
    for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true })) Object.defineProperty(down, key, { value });
    handle.dispatchEvent(down);
  });
}

function cancel(): Promise<void> {
  return act(async () => {
    const event = new MouseEvent('pointercancel', { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true })) Object.defineProperty(event, key, { value });
    document.dispatchEvent(event);
  });
}

/** The values a drag sets, as the document element holds them. -webkit-user-select is recorded by a spy because jsdom's CSS model drops it. */
function spyOnWebkitSelect(): { calls: Array<[string, string]>; restore: () => void } {
  const style = root();
  const original = style.setProperty.bind(style);
  const calls: Array<[string, string]> = [];
  style.setProperty = (name: string, value: string | null, priority?: string) => {
    if (name === '-webkit-user-select') calls.push([name, String(value)]);
    original(name, value, priority);
  };
  return { calls, restore: () => void delete (style as { setProperty?: unknown }).setProperty };
}

function assertOff(note: string): void {
  assert.equal(root().getPropertyValue('user-select'), 'none', `${note}: user-select`);
  assert.equal(root().getPropertyValue('-webkit-user-drag'), 'none', `${note}: -webkit-user-drag`);
}

function assertClear(note: string): void {
  assert.equal(root().getPropertyValue('user-select'), '', `${note}: user-select`);
  assert.equal(root().getPropertyValue('-webkit-user-drag'), '', `${note}: -webkit-user-drag`);
}

function select(text: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(text);
  const selection = document.getSelection();
  assert.ok(selection, 'jsdom has a selection');
  selection.removeAllRanges();
  selection.addRange(range);
}

test('the document is switched off from the press until the release, then left as it was', async () => {
  const spy = spyOnWebkitSelect();
  const mounted = mount(box(false));
  const handle = handleOf(mounted.container);
  assertClear('control: before the press');
  await press(handle);
  assertOff('at the press');
  assert.deepEqual(spy.calls, [['-webkit-user-select', 'none']], 'Safari\'s prefixed property is set too');
  await drag(handle, { dx: 0, dy: 30, keepDown: true });
  assertOff('mid-drag');
  await release(0, 30);
  assertClear('after the release');
  spy.restore();
});

test('a value the host set is back, with its priority, after a release', async () => {
  root().setProperty('user-select', 'text', 'important');
  root().setProperty('-webkit-user-drag', 'element');
  const mounted = mount(box(false));
  await drag(handleOf(mounted.container), { dx: 0, dy: 30, keepDown: true });
  assertOff('control: the drag overrides the host');
  await release(0, 30);
  assert.equal(root().getPropertyValue('user-select'), 'text');
  assert.equal(root().getPropertyPriority('user-select'), 'important');
  assert.equal(root().getPropertyValue('-webkit-user-drag'), 'element');
});

test('a pointercancel gives the document back', async () => {
  root().setProperty('user-select', 'text');
  const mounted = mount(box(true));
  await drag(handleOf(mounted.container), { dx: 40, dy: 0, keepDown: true });
  assertOff('control: mid-drag');
  await cancel();
  assert.equal(root().getPropertyValue('user-select'), 'text');
  assert.equal(root().getPropertyValue('-webkit-user-drag'), '');
});

test('an unmount in the middle of a drag gives the document back', async () => {
  root().setProperty('-webkit-user-drag', 'element');
  const mounted = mount(box(false));
  await drag(handleOf(mounted.container), { dx: 0, dy: 30, keepDown: true });
  assertOff('control: mid-drag');
  mounted.unmount();
  assert.equal(root().getPropertyValue('user-select'), '');
  assert.equal(root().getPropertyValue('-webkit-user-drag'), 'element');
  await release(0, 30);
  assert.equal(root().getPropertyValue('-webkit-user-drag'), 'element', 'a late pointerup after the unmount changes nothing');
});

test('a horizontal release gives the document back as well', async () => {
  const mounted = mount(box(true));
  await drag(handleOf(mounted.container), { dx: 200, dy: 0 });
  await advanceFrames(2000);
  assertClear('after a horizontal release and its spring');
});

test('a dragstart on a photo is cancelled while a drag is live and not after', async () => {
  const mounted = mount(box(false));
  const photo = mounted.container.querySelector<HTMLElement>('[data-photo]');
  assert.ok(photo, 'the photo rendered');
  // Stopped before it bubbles: dnd-kit's own window listener never sees it, so only this drag's capture listener can cancel it.
  photo.addEventListener('dragstart', (event) => event.stopPropagation());
  const start = () => {
    const event = new Event('dragstart', { bubbles: true, cancelable: true });
    photo.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(start(), false, 'control: nothing cancels a native drag outside a gesture');
  await drag(handleOf(mounted.container), { dx: 0, dy: 30, keepDown: true });
  assert.equal(start(), true, 'cancelled during the drag');
  await release(0, 30);
  assert.equal(start(), false, 'the listener is gone after the release');
});

test('a selection made before the drag is cleared when the drag engages, and a press that never moves leaves it', async () => {
  const mounted = mount(box(false));
  const text = mounted.container.querySelector<HTMLElement>('[data-text]');
  assert.ok(text, 'text rendered');
  const handle = handleOf(mounted.container);
  // dnd-kit keeps a selectionchange listener on the document for 50 ms after a drag ends, which a drag in an earlier test left behind.
  await new Promise((resolve) => setTimeout(resolve, 80));
  select(text);
  assert.equal(document.getSelection()?.toString(), 'some words to select', 'control: something is selected');
  await press(handle);
  assertOff('pressed');
  assert.equal(document.getSelection()?.toString(), 'some words to select', 'a press alone keeps the selection');
  await release(0, 0);
  assertClear('a press with no movement restores the document');
  assert.equal(document.getSelection()?.toString(), 'some words to select', 'and still keeps it');
  await drag(handle, { dx: 0, dy: 30, keepDown: true });
  assert.equal(document.getSelection()?.rangeCount, 0, 'the engaged drag cleared it');
  await release(0, 30);
});

test('overlapping holds: the last one out restores, in either order, and a host value survives', () => {
  for (const order of [[0, 1], [1, 0]]) {
    root().setProperty('user-select', 'text', 'important');
    const releases = [holdDragSelection(document), holdDragSelection(document)];
    assertOff('both held');
    releases[order[0]!]!();
    assertOff('one still held');
    releases[order[1]!]!();
    assert.equal(root().getPropertyValue('user-select'), 'text', `order ${order.join(',')}`);
    assert.equal(root().getPropertyPriority('user-select'), 'important');
    root().cssText = '';
  }
});

test('a release is idempotent: giving back twice does not release another hold', () => {
  const first = holdDragSelection(document);
  const second = holdDragSelection(document);
  first();
  first();
  assertOff('the second hold still stands');
  second();
  assertClear('and ends it');
});

test('two boxes pressed at once: unmounting either one leaves the other\'s drag suppressed', async () => {
  const both = (): React.ReactElement => React.createElement('div', null, React.createElement('section', { 'data-a': '' }, box(false)), React.createElement('section', { 'data-b': '' }, box(false)));
  const mounted = mount(both());
  const [a, b] = Array.from(mounted.container.querySelectorAll<HTMLElement>('[data-handle]'));
  await press(a!);
  await press(b!);
  assertOff('both pressed');
  mounted.rerender(React.createElement('div', null, React.createElement('section', { 'data-b': '' }, box(false))));
  assertOff('one box gone');
  await release(0, 0);
  assertClear('released');
});

test('a hold is per document: another document is untouched', () => {
  const other = document.implementation.createHTMLDocument('other');
  const give = holdDragSelection(other);
  assert.equal(other.documentElement.style.getPropertyValue('user-select'), 'none');
  assertClear('this document');
  give();
  assert.equal(other.documentElement.style.getPropertyValue('user-select'), '');
});

test('a hide and show in the middle of a drag takes the hold again, and the release still gives the document back', async () => {
  let setVisible: (visible: boolean) => void = () => undefined;
  function Hosted(): React.ReactElement {
    const [visible, set] = React.useState(true);
    setVisible = set;
    return React.createElement(React.Activity, { mode: visible ? 'visible' : 'hidden', children: box(true) });
  }
  root().setProperty('user-select', 'text');
  const mounted = mount(React.createElement(Hosted));
  await drag(handleOf(mounted.container), { dx: 40, dy: 0, keepDown: true });
  assertOff('control: mid-drag');
  await act(async () => setVisible(false));
  await act(async () => setVisible(true));
  assertOff('after the effects ran again');
  await release(40, 0);
  assert.equal(root().getPropertyValue('user-select'), 'text');
});
