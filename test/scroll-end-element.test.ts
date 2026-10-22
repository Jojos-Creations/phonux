/**
 * The right edge of a scrolling row is one element, endPad plus the row gap wide, and the container's right padding is 0 there:
 * an engine may leave an end padding or an empty end box out of the scrollable width, so the range it gives must not depend on either.
 * A row that does not scroll keeps its padding and draws no element. Real layout is test/scroll-range-chromium.test.ts.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { Workspace } from '../index.js';
import { createFakeHost } from '../fakeHost.js';
import { maxScrollOf } from '../rowNumbers.js';
import { cleanup, mount, withHost } from './support/mount-harness.js';
import { mountRow, panelsOf } from './support/scroll-row.js';

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

const element = (container: HTMLElement): HTMLElement | null => container.querySelector<HTMLElement>('[data-row-end-pad]');
const paddingRight = (container: HTMLElement): string => getComputedStyle(container).paddingRight;

test('the end element is endPad plus the row gap and the padding right is 0', () => {
  const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'step' } });
  const n = m.latest().rowNumbers;
  assert.ok(n.rowScroll);
  assert.equal(element(m.container)!.style.flex, `0 0 ${n.endPad + 16}px`);
  assert.equal(paddingRight(m.container), '0px');
  assert.equal(maxScrollOf(n), Math.max(0, n.rowMarginLeft + n.stripWidth + n.endPad - n.windowWidth), 'the range the library counts is the same sum');
});

test('a tail of two whole panels in a 968 px window is centred by its leftover, and the element carries that pad', () => {
  const m = mountRow(panelsOf(8), 1000, { tuning: { rowGesture: 'step' } });
  assert.equal(m.latest().rowNumbers.endPad, 86, 'the tail is 390 + 16 + 390 = 796 wide, so (968 - 796) / 2 is 86 on each side');
  assert.equal(element(m.container)!.style.flex, '0 0 102px');
});

const bare = (rowScroll: boolean, ref: React.RefObject<HTMLDivElement | null>): React.ReactElement =>
  withHost(React.createElement(Workspace, { overflowContainerRef: ref, rowRef: React.createRef<HTMLDivElement>(), containerWidth: 0, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: 1, liveWidths: [], rowScroll } as never), createFakeHost());

test('a row that does not scroll keeps its padding right and draws no element', () => {
  const ref = React.createRef<HTMLDivElement>();
  const mounted = mount(bare(false, ref));
  assert.equal(element(mounted.container)?.outerHTML, undefined);
  assert.equal(paddingRight(ref.current!), '16px');
});

test('a Workspace told its row scrolls, with no numbers yet, draws the element at the row gap from the first paint', () => {
  const ref = React.createRef<HTMLDivElement>();
  const mounted = mount(bare(true, ref));
  assert.equal(element(mounted.container)!.style.flex, '0 0 16px');
  assert.equal(paddingRight(ref.current!), '0px');
});

test('the end element has no height of its own, so it is not an empty box an engine may leave out', () => {
  const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'step' } });
  assert.equal(element(m.container)!.style.height, '');
});
