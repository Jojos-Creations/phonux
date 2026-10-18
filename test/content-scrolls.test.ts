/**
 * Input meant for a panel's own scroller stays with it: `contentScrolls` says whether an element, or an ancestor below the
 * row's own scroller, can still move along an axis in a direction, and `arrowKeyBelongsElsewhere` leaves such an arrow key alone.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { arrowKeyBelongsElsewhere, contentScrolls } from '../arrowKeys.js';

afterEach(() => {
  document.body.replaceChildren();
});

interface Scroll {
  scrollLeft?: number;
  scrollWidth?: number;
  clientWidth?: number;
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
}

/** A div whose layout numbers are stubbed, because jsdom does no layout. */
function box(style: string, scroll: Scroll = {}, parent: Element = document.body): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('style', style);
  const numbers: Required<Scroll> = { scrollLeft: 0, scrollWidth: 0, clientWidth: 0, scrollTop: 0, scrollHeight: 0, clientHeight: 0, ...scroll };
  for (const [name, value] of Object.entries(numbers)) Object.defineProperty(el, name, { configurable: true, get: () => value });
  parent.appendChild(el);
  return el;
}

/** A row scroller holding a panel scroller holding a leaf: the shape a carousel in a panel has. */
function carousel(scroll: Scroll, style = 'overflow-x: auto'): { rowScroller: HTMLElement; scroller: HTMLElement; leaf: HTMLElement } {
  const rowScroller = box('overflow-x: hidden');
  rowScroller.setAttribute('data-row-scroller', '');
  const scroller = box(style, scroll, rowScroller);
  const leaf = box('', {}, scroller);
  return { rowScroller, scroller, leaf };
}

const MIDDLE = { scrollWidth: 1000, clientWidth: 400, scrollLeft: 200 };
const START = { scrollWidth: 1000, clientWidth: 400, scrollLeft: 0 };
const END = { scrollWidth: 1000, clientWidth: 400, scrollLeft: 600 };

test('a horizontal scroller with room to the right claims a rightward input, and one with room to the left a leftward one', () => {
  const { leaf } = carousel(MIDDLE);
  assert.equal(contentScrolls(leaf, 'x', 1), true, 'room to the right');
  assert.equal(contentScrolls(leaf, 'x', -1), true, 'room to the left');
});

test('a scroller at its end does not claim the input that would push it past', () => {
  const atEnd = carousel(END);
  assert.equal(contentScrolls(atEnd.leaf, 'x', 1), false, 'at the right end, rightward is the row');
  assert.equal(contentScrolls(atEnd.leaf, 'x', -1), true, 'the same scroller still moves left');
  const atStart = carousel(START);
  assert.equal(contentScrolls(atStart.leaf, 'x', -1), false, 'at the left end, leftward is the row');
  assert.equal(contentScrolls(atStart.leaf, 'x', 1), true, 'the same scroller still moves right');
});

test('an element that does not overflow, or whose overflow is not auto or scroll, claims nothing', () => {
  assert.equal(contentScrolls(carousel({ scrollWidth: 400, clientWidth: 400, scrollLeft: 0 }).leaf, 'x', 1), false, 'nothing to scroll');
  assert.equal(contentScrolls(carousel(MIDDLE, 'overflow-x: hidden').leaf, 'x', 1), false, 'hidden overflow has no user scrolling');
  assert.equal(contentScrolls(carousel(MIDDLE, 'overflow-x: visible').leaf, 'x', 1), false, 'visible overflow does not scroll');
  assert.equal(contentScrolls(carousel(MIDDLE, 'overflow-x: scroll').leaf, 'x', 1), true, 'control: scroll does');
});

test('a scroller on the other axis does not claim a horizontal input', () => {
  const { leaf } = carousel(MIDDLE, 'overflow-y: auto');
  assert.equal(contentScrolls(leaf, 'x', 1), false);
});

test('the walk stops at the row scroller: it and everything above it is never consulted', () => {
  const { rowScroller, leaf } = carousel(MIDDLE);
  // The row scroller itself has room and a scrollable overflow, which would claim the input if the walk reached it.
  rowScroller.setAttribute('style', 'overflow-x: auto');
  Object.defineProperty(rowScroller, 'scrollWidth', { configurable: true, get: () => 5000 });
  Object.defineProperty(rowScroller, 'clientWidth', { configurable: true, get: () => 1000 });
  const outer = box('overflow-x: auto', { scrollWidth: 9000, clientWidth: 1000, scrollLeft: 100 });
  outer.appendChild(rowScroller);
  const inner = box('', {}, rowScroller);
  assert.equal(contentScrolls(inner, 'x', 1), false, 'a plain child of the row scroller');
  assert.equal(contentScrolls(rowScroller, 'x', 1), false, 'the row scroller itself');
  assert.equal(contentScrolls(leaf, 'x', 1), true, 'control: the panel scroller below it is still consulted');
});

test('a right-to-left scroller counts its rightward room as what has been scrolled', () => {
  // Chromium reports scrollLeft as 0 at the start and negative as it scrolls toward the left edge.
  const rtlStart = carousel({ scrollWidth: 1000, clientWidth: 400, scrollLeft: 0 }, 'overflow-x: auto; direction: rtl');
  assert.equal(getComputedStyle(rtlStart.scroller).direction, 'rtl', 'the style reached the computed value');
  assert.equal(contentScrolls(rtlStart.leaf, 'x', 1), false, 'rtl at rest: nothing scrolled, so no rightward room');
  assert.equal(contentScrolls(rtlStart.leaf, 'x', -1), true, 'rtl at rest: all the room is to the left');
  const rtlEnd = carousel({ scrollWidth: 1000, clientWidth: 400, scrollLeft: -600 }, 'overflow-x: auto; direction: rtl');
  assert.equal(contentScrolls(rtlEnd.leaf, 'x', -1), false, 'rtl at its far end: none to the left');
  assert.equal(contentScrolls(rtlEnd.leaf, 'x', 1), true, 'rtl at its far end: all of it is to the right');
  // The same numbers in a left-to-right scroller read the other way round.
  const ltr = carousel({ scrollWidth: 1000, clientWidth: 400, scrollLeft: 0 });
  assert.equal(contentScrolls(ltr.leaf, 'x', 1), true, 'control: ltr at rest has room to the right');
});

test('a vertical scroller with room claims a vertical input, and not at its end', () => {
  const rowScroller = box('overflow-x: hidden');
  rowScroller.setAttribute('data-row-scroller', '');
  const scroller = box('overflow-y: auto', { scrollHeight: 900, clientHeight: 300, scrollTop: 100 }, rowScroller);
  const leaf = box('', {}, scroller);
  assert.equal(contentScrolls(leaf, 'y', 1), true, 'down, with room');
  assert.equal(contentScrolls(leaf, 'y', -1), true, 'up, with room');
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => 600 });
  assert.equal(contentScrolls(leaf, 'y', 1), false, 'down, at the bottom');
  assert.equal(contentScrolls(leaf, 'x', 1), false, 'and it says nothing about the horizontal axis');
});

function arrow(key: string, target: Element): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { configurable: true, get: () => target });
  return event;
}

test('an arrow key belongs elsewhere while the focused panel scroller can still move that way', () => {
  const { leaf } = carousel(MIDDLE);
  assert.equal(arrowKeyBelongsElsewhere(arrow('ArrowRight', leaf), document), true, 'ArrowRight with room to the right');
  assert.equal(arrowKeyBelongsElsewhere(arrow('ArrowLeft', leaf), document), true, 'ArrowLeft with room to the left');
  const atEnd = carousel(END);
  assert.equal(arrowKeyBelongsElsewhere(arrow('ArrowRight', atEnd.leaf), document), false, 'at its end the row may step');
});

test('the scroller is found from the focused element as well as from the event target', () => {
  const { leaf } = carousel(MIDDLE);
  leaf.tabIndex = 0;
  leaf.focus();
  assert.equal(document.activeElement, leaf);
  const elsewhere = box('');
  assert.equal(arrowKeyBelongsElsewhere(arrow('ArrowRight', elsewhere), document), true);
});

test('ArrowDown in a vertical scroller with room belongs elsewhere, and ArrowUp at its top does not', () => {
  const rowScroller = box('overflow-x: hidden');
  rowScroller.setAttribute('data-row-scroller', '');
  const scroller = box('overflow-y: auto', { scrollHeight: 900, clientHeight: 300, scrollTop: 0 }, rowScroller);
  const leaf = box('', {}, scroller);
  assert.equal(arrowKeyBelongsElsewhere(arrow('ArrowDown', leaf), document), true, 'down with room');
  assert.equal(arrowKeyBelongsElsewhere(arrow('ArrowUp', leaf), document), false, 'up at the top');
});

test('an arrow key over plain content, or at the row scroller, is the row\'s', () => {
  const plain = box('');
  assert.equal(arrowKeyBelongsElsewhere(arrow('ArrowRight', plain), document), false);
  const { rowScroller } = carousel(MIDDLE);
  rowScroller.setAttribute('style', 'overflow-x: auto');
  Object.defineProperty(rowScroller, 'scrollWidth', { configurable: true, get: () => 5000 });
  Object.defineProperty(rowScroller, 'clientWidth', { configurable: true, get: () => 1000 });
  assert.equal(arrowKeyBelongsElsewhere(arrow('ArrowRight', rowScroller), document), false, 'the row\'s own scroller is not content');
});
