/**
 * A PanelRowSlot that a reorder moves must still slide to its new rest. React 19.2 cleans up and sets up again the
 * effects of a keyed child that a reorder moves under StrictMode, which stops the slide Motion was running for it.
 * This file's React (19.3) does not do that, so the test is the behavior a consumer on 19.2 relies on.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { AnimatePresence } from 'motion/react';
import { PanelRowSlot } from '../PanelRowSlot.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';

afterEach(() => cleanup());

let setOrder: (order: string[]) => void = () => undefined;
function Hosted(): React.ReactElement {
  const [order, set] = React.useState(['history', 'a']);
  setOrder = set;
  return React.createElement(
    React.StrictMode,
    null,
    React.createElement(AnimatePresence, { initial: false }, order.map((id, index) =>
      React.createElement(PanelRowSlot, { key: id, leftOffset: index * 406, width: 390, phoneHeight: 600, enterDirection: 'right', exitDirection: 'left', children: React.createElement('i', { 'data-slot': id }) }),
    )),
  );
}

const translateX = (el: HTMLElement): number => {
  const match = /translateX\((-?[\d.e+-]+)px\)/.exec(el.style.transform);
  return match === null ? 0 : Number(match[1]);
};

test('a slot that a reorder moves in the DOM slides to its new rest', async () => {
  const mounted = mount(React.createElement(Hosted));
  const slotOf = (id: string): HTMLElement => {
    const slot = mounted.container.querySelector<HTMLElement>(`[data-slot="${id}"]`)?.parentElement;
    assert.ok(slot, `${id} rendered`);
    return slot;
  };
  await advanceFrames(120);
  await act(async () => setOrder(['a', 'history']));
  await advanceFrames(2000);
  assert.ok(Math.abs(translateX(slotOf('history')) - 406) < 1, `history is at its rest, not stuck at ${Math.round(translateX(slotOf('history')))} px`);
  assert.ok(Math.abs(translateX(slotOf('a'))) < 1, `a is at its rest, not stuck at ${Math.round(translateX(slotOf('a')))} px`);
});
