/**
 * A scrolling row's range is its numbers alone: no end element holds the strip's right edge, and the container pads nothing on the
 * right. A row that does not scroll keeps its padding. Real layout is test/row-transform-chromium.test.ts.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { Workspace } from '../index.js';
import { createFakeHost } from '../fakeHost.js';
import { cleanup, mount, withHost } from './support/mount-harness.js';
import { mountRow, panelsOf } from './support/scroll-row.js';

afterEach(() => cleanup());

const element = (container: HTMLElement): HTMLElement | null => container.querySelector<HTMLElement>('[data-row-end-pad]');
const paddingRight = (container: HTMLElement): string => getComputedStyle(container).paddingRight;

test('a scrolling row draws no end element and pads nothing on the right', () => {
  const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'step' } });
  assert.ok(m.latest().rowNumbers.rowScroll, 'control: the row scrolls');
  assert.equal(element(m.container), null);
  assert.equal(paddingRight(m.container), '0px');
});

const bare = (rowScroll: boolean, ref: React.RefObject<HTMLDivElement | null>): React.ReactElement =>
  withHost(React.createElement(Workspace, { overflowContainerRef: ref, rowRef: React.createRef<HTMLDivElement>(), containerWidth: 0, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: 1, liveWidths: [], rowScroll } as never), createFakeHost());

test('a row that does not scroll keeps its padding right', () => {
  const ref = React.createRef<HTMLDivElement>();
  mount(bare(false, ref));
  assert.equal(paddingRight(ref.current!), '16px');
});
