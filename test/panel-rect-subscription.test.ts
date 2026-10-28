/**
 * A slot reports its box while it moves: `moving` on each change during the slide, then one `settled` once it stops.
 * The layout is stubbed: jsdom computes no boxes, so a slot's box is its translateX.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { AnimatePresence } from 'motion/react';
import { PanelRowSlot } from '../PanelRowSlot.js';
import { PANEL_RECT_EVENT, type PanelRectDetail } from '../panelChrome.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { mountRow, panelsOf } from './support/scroll-row.js';

afterEach(() => cleanup());

const translateX = (el: Element): number => {
  const match = /translateX\((-?[\d.e+-]+)px\)/.exec((el as HTMLElement).style.transform);
  return match === null ? 0 : Number(match[1]);
};

const realRect = HTMLElement.prototype.getBoundingClientRect;
function stubBoxes(): void {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    const x = translateX(this);
    return { x, y: 0, left: x, top: 0, width: 390, height: 600, right: x + 390, bottom: 600, toJSON: () => ({}) } as DOMRect;
  };
}
function restoreBoxes(): void {
  HTMLElement.prototype.getBoundingClientRect = realRect;
}

let setOrder: (order: string[]) => void = () => undefined;
function Hosted(): React.ReactElement {
  const [order, set] = React.useState(['history', 'a']);
  setOrder = set;
  return React.createElement(
    AnimatePresence,
    { initial: false },
    order.map((id, index) =>
      React.createElement(
        PanelRowSlot,
        { key: id, panelId: id, leftOffset: index * 406, width: 390, phoneHeight: 600, enterDirection: 'right', exitDirection: 'left', children: React.createElement('i', { 'data-slot': id }, id) },
      ),
    ),
  );
}

test('a slot that a reorder slides reports its box while it moves, then one settled report at its rest', async () => {
  stubBoxes();
  const reports: PanelRectDetail[] = [];
  const onRect = (e: Event): void => void reports.push((e as CustomEvent<PanelRectDetail>).detail);
  window.addEventListener(PANEL_RECT_EVENT, onRect);
  try {
    mount(React.createElement(Hosted));
    await advanceFrames(120);
    reports.length = 0;
    await act(async () => setOrder(['a', 'history']));
    await advanceFrames(2000);
    const history = reports.filter((r) => r.id === 'history');
    const moving = history.filter((r) => r.phase === 'moving');
    const settled = history.filter((r) => r.phase === 'settled');
    assert.ok(moving.length > 1, `history reported its box while it slid (${moving.length} moving reports)`);
    assert.equal(settled.length, 1, 'exactly one settled report after the slide');
    assert.equal(history.at(-1)?.phase, 'settled', 'the settled report comes last');
    assert.ok(Math.abs(settled[0]!.rect.x - 406) < 1, `settled at its new rest, not ${settled[0]!.rect.x}`);
  } finally {
    window.removeEventListener(PANEL_RECT_EVENT, onRect);
    restoreBoxes();
  }
});

test('a provider forwards each slot report under the panel key', async () => {
  stubBoxes();
  const seen: { key: string; phase: string }[] = [];
  try {
    mountRow(panelsOf(2), 1000, { onPanelRect: (e) => void seen.push({ key: e.key, phase: e.phase }) });
    await advanceFrames(100);
    assert.ok(seen.some((e) => e.key === 's1' && e.phase === 'settled'), `s1 reported settled: ${JSON.stringify(seen)}`);
  } finally {
    restoreBoxes();
  }
});

test('an open panel is pictured once its opening has landed; a close that slides the others pictures only the closed one', async () => {
  const captured: { id: string; x: number }[] = [];
  const m = mountRow(panelsOf(3), 3000, { capture: { capture: (id) => void captured.push({ id, x: translateX(slotOf(id)) }), evict: () => undefined }, wireClosing: true });
  await advanceFrames(100);
  assert.equal(captured.length, 0, 'no picture is taken while the opening is under way');
  await advanceFrames(2000);
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.deepEqual(captured.map((c) => c.id).sort(), ['s1', 's2', 's3'], 'each open panel is pictured once');
  const restBefore = translateX(slotOf('s2'));
  captured.length = 0;
  act(() => m.latest().close('s1'));
  await advanceFrames(2000);
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.notEqual(translateX(slotOf('s2')), restBefore, 's2 slid');
  assert.deepEqual(captured.map((c) => c.id), ['s1'], 'only the closed panel is pictured');

  function slotOf(id: string): HTMLElement {
    return m.container.querySelector<HTMLElement>(`[data-row-id="${id}"]`)!;
  }
});
