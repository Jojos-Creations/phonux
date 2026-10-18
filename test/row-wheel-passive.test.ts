/**
 * A stepping row never cancels a wheel event: its listener is passive, so the browser does not wait on it for every wheel over a
 * panel, and its overflow is hidden, so there is nothing of the row's own for the browser to scroll. A panel's own horizontal
 * scroller keeps a swipe that it can still take.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { workspaceShellStyle } from '../Workspace.js';
import { useRowScrollGesture } from '../panels/useRowScrollGesture.js';
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

test('the wheel listener is installed passive', () => {
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
  assert.deepEqual(wheels[0]!.options, { passive: true });
});

test('a horizontal wheel steps the row and is never default-prevented', () => {
  const m = mountGesture();
  const event = wheel(m.inner, { deltaX: 120 });
  assert.deepEqual(m.steps, ['right'], 'it did step, so the next line is about a wheel that was handled');
  assert.equal(event.defaultPrevented, false);
  const back = wheel(m.inner, { deltaX: -120 });
  assert.deepEqual(m.steps, ['right', 'left']);
  assert.equal(back.defaultPrevented, false, 'a reversal too');
});

test('a vertical wheel neither steps nor is cancelled', () => {
  const m = mountGesture();
  const event = wheel(m.inner, { deltaY: 300 });
  assert.deepEqual(m.steps, []);
  assert.equal(event.defaultPrevented, false);
});

test('a horizontal wheel over a horizontal scroller with room in that direction does not step', () => {
  const m = mountGesture();
  scrollerOf(m.inner, 200);
  const right = wheel(m.inner, { deltaX: 120 });
  assert.deepEqual(m.steps, [], 'room to the right');
  assert.equal(right.defaultPrevented, false);
  wheel(m.inner, { deltaX: -120 });
  assert.deepEqual(m.steps, [], 'room to the left');
});

test('the same wheel steps once the scroller is at its end in that direction', () => {
  const m = mountGesture();
  scrollerOf(m.inner, 600);
  wheel(m.inner, { deltaX: 120 });
  assert.deepEqual(m.steps, ['right'], 'at the right end, rightward is the row\'s');
});

test('over plain content the same wheel steps', () => {
  const m = mountGesture();
  wheel(m.inner, { deltaX: 120 });
  assert.deepEqual(m.steps, ['right']);
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

test('a stepping row hides its scrollbar, and an off row has none to hide', () => {
  assert.equal(workspaceShellStyle({ ...SHELL, rowScroll: true, rowGesture: 'step' }).hideScrollbar, true);
  assert.equal(workspaceShellStyle({ ...SHELL, rowScroll: true, rowGesture: 'off' }).hideScrollbar, false);
});
