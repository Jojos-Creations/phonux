/** Chrome inside the frame: where the pills go, and a scroll down hides them while a scroll up brings them back. */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act, createElement, useRef } from 'react';
import { cleanup, mount } from './support/mount-harness.js';
import { shownMode } from '../panelChrome.js';
import { rowBottomReservePx } from '../panelChromeSize.js';
import { useChromeScrollAway } from '../panelChromeInside.js';

afterEach(() => cleanup());

const later = (): Promise<void> => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

function Harness({ inside = true }: { inside?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const onScrollCapture = useChromeScrollAway(root, inside);
  return createElement('div', { ref: root, onScrollCapture },
    createElement('div', { 'data-panel-chrome-part': 'header' }),
    createElement('div', { 'data-scroller': '', style: { overflow: 'auto' } }),
    createElement('div', { 'data-panel-chrome-part': 'footer' }));
}

const scrollTo = async (el: HTMLElement, top: number): Promise<void> => {
  Object.defineProperty(el, 'scrollTop', { value: top, configurable: true });
  await act(async () => { el.dispatchEvent(new Event('scroll')); });
  await later();
};
const away = (c: HTMLElement, part: string): boolean => c.querySelector<HTMLElement>(`[data-panel-chrome-part="${part}"]`)!.style.pointerEvents === 'none';

test('a scroll down hides the header and footer and a scroll up brings them back', async () => {
  const { container } = mount(createElement(Harness));
  const scroller = container.querySelector<HTMLElement>('[data-scroller]')!;
  await scrollTo(scroller, 100);
  assert.equal(away(container, 'header'), true);
  assert.equal(away(container, 'footer'), true);
  await scrollTo(scroller, 80);
  assert.equal(away(container, 'header'), false);
  assert.equal(away(container, 'footer'), false);
});

test('a tremble under the noise floor changes nothing', async () => {
  const { container } = mount(createElement(Harness));
  const scroller = container.querySelector<HTMLElement>('[data-scroller]')!;
  await scrollTo(scroller, 100);
  await scrollTo(scroller, 98);
  assert.equal(away(container, 'header'), true);
});

test('back at the top they always show', async () => {
  const { container } = mount(createElement(Harness));
  const scroller = container.querySelector<HTMLElement>('[data-scroller]')!;
  await scrollTo(scroller, 3);
  await scrollTo(scroller, 50);
  await scrollTo(scroller, 0);
  assert.equal(away(container, 'header'), false);
});

test('outside the frame a scroll changes nothing', async () => {
  const { container } = mount(createElement(Harness, { inside: false }));
  await scrollTo(container.querySelector<HTMLElement>('[data-scroller]')!, 100);
  assert.equal(away(container, 'header'), false);
});

test('inside, the row keeps no footer room under the frames', () => {
  assert.equal(rowBottomReservePx(8), 40);
  assert.equal(rowBottomReservePx(8, undefined, 'inside'), 8);
});

test('inside the frame the hover fade does not apply, so a panel that cannot scroll keeps its pills', () => {
  const chrome = { mode: 'hover-or-active', fadeMs: 120, fadeEase: 'easeOut' } as const;
  assert.equal(shownMode({ ...chrome, where: 'inside' }), 'always');
  assert.equal(shownMode({ ...chrome, where: 'outside' }), 'hover-or-active');
});
