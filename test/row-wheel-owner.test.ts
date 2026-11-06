/**
 * A stepping row owns sideways wheels over its panels' content: it takes them in the capture phase, cancels them and stops them
 * before the content sees them. Option (Alt) held at a gesture's start leaves the whole gesture to the content, and a vertical
 * wheel is never cancelled.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { workspaceShellStyle } from '../Workspace.js';
import { feedRowWheel, useRowScrollGesture } from '../panels/useRowScrollGesture.js';
import { cleanup, mount } from './support/mount-harness.js';

afterEach(() => {
  mock.restoreAll();
  cleanup();
});

interface Mounted {
  container: HTMLDivElement;
  inner: HTMLElement;
  steps: Array<'left' | 'right'>;
}

/** The hook on a container holding one child, with the options each test is about; `steps` records what the row was asked to do. */
function mountGesture(mode: 'step' | 'off' = 'step'): Mounted {
  const steps: Array<'left' | 'right'> = [];
  const ref = React.createRef<HTMLDivElement>();
  function Row(): React.ReactElement {
    useRowScrollGesture(ref, (direction) => void steps.push(direction), 30, mode);
    return React.createElement('div', { ref, 'data-row-scroller': '' }, React.createElement('section', { 'data-inner': '' }));
  }
  const m = mount(React.createElement(Row));
  const container = ref.current!;
  return { container, inner: m.container.querySelector<HTMLElement>('[data-inner]')!, steps };
}

function wheel(target: Element, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(event));
  return event;
}

/** Makes `el` a horizontal scroller as a browser would lay it out: overflow-x auto with `scrollLeft` of `max` possible. */
function scrollerOf(el: HTMLElement, scrollLeft: number): void {
  el.setAttribute('style', 'overflow-x: auto');
  Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => 1000 });
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => 400 });
  Object.defineProperty(el, 'scrollLeft', { configurable: true, get: () => scrollLeft });
}

test('the wheel listener is installed in the capture phase and may cancel', () => {
  const added: Array<{ on: EventTarget; type: string; options: unknown }> = [];
  // The DOM's own EventTarget, not Node's global one: the container's addEventListener is inherited from the jsdom window's.
  const target = window.EventTarget.prototype;
  const original = target.addEventListener;
  mock.method(target, 'addEventListener', function (this: EventTarget, type: string, listener: unknown, options?: unknown) {
    added.push({ on: this, type, options });
    return (original as (...a: unknown[]) => void).call(this, type, listener, options);
  });
  const m = mountGesture();
  // React puts wheel listeners of its own on its root; only the row container's is the hook's.
  const wheels = added.filter((a) => a.type === 'wheel' && a.on === m.container);
  assert.equal(wheels.length, 1, 'one wheel listener on the row container');
  assert.deepEqual(wheels[0]!.options, { capture: true, passive: false });
});

/** Mounts the row and listens on its inner content, as a panel's own script would. */
function withContentListener(): Mounted & { seen: WheelEvent[] } {
  const m = mountGesture();
  const seen: WheelEvent[] = [];
  m.inner.addEventListener('wheel', (e) => void seen.push(e));
  return { ...m, seen };
}

test('a horizontal wheel steps the row, is cancelled and never reaches the content', () => {
  const m = withContentListener();
  const event = wheel(m.inner, { deltaX: 120 });
  assert.deepEqual(m.steps, ['right']);
  assert.equal(event.defaultPrevented, true);
  assert.equal(m.seen.length, 0);
  const back = wheel(m.inner, { deltaX: -120 });
  assert.deepEqual(m.steps, ['right', 'left']);
  assert.equal(back.defaultPrevented, true, 'a reversal too');
});

test('Shift+vertical wheel is a sideways ask the row takes', () => {
  const m = withContentListener();
  const event = wheel(m.inner, { deltaY: 120, shiftKey: true });
  assert.deepEqual(m.steps, ['right']);
  assert.equal(event.defaultPrevented, true);
  assert.equal(m.seen.length, 0);
});

test('a vertical wheel neither steps nor is cancelled, and reaches the content', () => {
  const m = withContentListener();
  const event = wheel(m.inner, { deltaY: 300 });
  assert.deepEqual(m.steps, []);
  assert.equal(event.defaultPrevented, false);
  assert.equal(m.seen.length, 1);
});

test('a vertical wobble inside a sideways gesture stays the row\'s', () => {
  const m = withContentListener();
  wheel(m.inner, { deltaX: 120 });
  const wobble = wheel(m.inner, { deltaX: 1, deltaY: 4 });
  assert.equal(wobble.defaultPrevented, true);
  assert.equal(m.seen.length, 0);
});

test('a horizontal wheel over a horizontal scroller with room still steps the row', () => {
  const m = withContentListener();
  scrollerOf(m.inner, 200);
  const right = wheel(m.inner, { deltaX: 120 });
  assert.deepEqual(m.steps, ['right'], 'the row owns sideways scrolling, room or not');
  assert.equal(right.defaultPrevented, true);
});

test('Option held at a gesture\'s start leaves the whole gesture to the content', () => {
  const m = withContentListener();
  scrollerOf(m.inner, 200);
  const first = wheel(m.inner, { deltaX: 120, altKey: true });
  assert.deepEqual(m.steps, []);
  assert.equal(first.defaultPrevented, false);
  // Option let go mid-gesture: the gesture is still the content's.
  const later = wheel(m.inner, { deltaX: 120 });
  assert.deepEqual(m.steps, []);
  assert.equal(later.defaultPrevented, false);
  assert.equal(m.seen.length, 2);
});

test('a quiet gap ends the Option gesture, and the next sideways wheel is the row\'s again', async () => {
  const m = withContentListener();
  wheel(m.inner, { deltaX: 120, altKey: true });
  // The quiet gap is the default gestureQuietMs, 150 ms.
  await new Promise((r) => setTimeout(r, 200));
  const next = wheel(m.inner, { deltaX: 120 });
  assert.deepEqual(m.steps, ['right']);
  assert.equal(next.defaultPrevented, true);
});

test('Option held mid-gesture does not take a sideways gesture back from the row', () => {
  const m = mountGesture();
  wheel(m.inner, { deltaX: 120 });
  const held = wheel(m.inner, { deltaX: 1, altKey: true });
  assert.equal(held.defaultPrevented, true);
});

test('feedRowWheel hands the row a sideways wheel from isolated content, and says it took it', () => {
  const m = mountGesture();
  let took = false;
  act(() => void (took = feedRowWheel(m.inner, { deltaX: 120 })));
  assert.equal(took, true);
  assert.deepEqual(m.steps, ['right']);
});

test('feedRowWheel leaves a vertical wheel, and an Option gesture, to the content', () => {
  const m = mountGesture();
  assert.equal(feedRowWheel(m.inner, { deltaX: 0, deltaY: 120 }), false);
  assert.equal(feedRowWheel(m.inner, { deltaX: 120, altKey: true }), false);
  assert.deepEqual(m.steps, []);
});

test('feedRowWheel from outside any row takes nothing', () => {
  const lone = document.createElement('div');
  document.body.appendChild(lone);
  assert.equal(feedRowWheel(lone, { deltaX: 120 }), false);
  lone.remove();
});

test('under off no wheel listener is installed, so nothing scrolls the row', () => {
  const m = mountGesture('off');
  const event = wheel(m.inner, { deltaX: 120 });
  assert.deepEqual(m.steps, []);
  assert.equal(event.defaultPrevented, false);
});

const SHELL = { rowResizeSettled: true, containerWidth: 800, phoneWidth: 390, fixedColumnCount: 1, liveWidths: [] as number[] };

test('the shell hides the horizontal overflow of a scrolling row, whether it steps or not', () => {
  assert.equal(workspaceShellStyle({ ...SHELL, rowScroll: true, rowGesture: 'step' }).overflowX, 'hidden');
  assert.equal(workspaceShellStyle({ ...SHELL, rowScroll: true, rowGesture: 'off' }).overflowX, 'hidden');
});

test('a scrolling row hides its scrollbar whether it steps or not, and a row that does not scroll keeps none to hide', () => {
  assert.equal(workspaceShellStyle({ ...SHELL, rowScroll: true, rowGesture: 'step' }).hideScrollbar, true);
  assert.equal(workspaceShellStyle({ ...SHELL, rowScroll: true, rowGesture: 'off' }).hideScrollbar, true);
  assert.equal(workspaceShellStyle({ ...SHELL, rowScroll: false, rowGesture: 'step' }).hideScrollbar, false);
});
