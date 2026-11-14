/**
 * The dot bar's oval is a slider a keyboard can use: ArrowRight and ArrowUp step the row one stop on, ArrowLeft and ArrowDown one
 * back, Home and End glide it to its ends, and its spoken value names the panels in view. Through the mounted row and the public
 * `usePanelDots`, with the layout a browser gives the row stubbed by `stubSlotBoxes`. Row: the root and five pages, a slot every
 * 406 px, a window of two slots, so the stops are 0, 406, ... 1624.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { usePanelDots, type PanelDots } from '../index.js';
import { advanceUntilRowRests, rowGlideTargetOf, rowOffsetOf, stubSlotBoxes } from './support/strip.js';
import { cleanup, mount } from './support/mount-harness.js';
import { mountRow, panelsOf, type MountedRow } from './support/scroll-row.js';

afterEach(() => cleanup());

const rect = (left: number, width: number): DOMRect => ({ left, right: left + width, top: 0, bottom: 700, width, height: 700, x: left, y: 0, toJSON: () => ({}) });

function rowWithBar(labels?: Parameters<typeof usePanelDots>[0]['labels']): { m: MountedRow; bar: () => PanelDots; oval: () => HTMLElement } {
  const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'step' } });
  m.container.getBoundingClientRect = () => rect(0, 1000);
  stubSlotBoxes(m.container, 16);
  let latest: PanelDots | undefined;
  const scroller = { current: m.container as HTMLElement };
  function Bar(): React.ReactElement {
    latest = usePanelDots({ entries: m.latest().entries, scroller, ...(labels === undefined ? {} : { labels }) });
    return React.createElement('div', { 'data-bar-probe': '' }, React.createElement('div', { ...latest.ovalProps, 'aria-label': 'Row', 'data-oval-probe': '' }));
  }
  mount(React.createElement(Bar));
  const oval = (): HTMLElement => {
    const el = document.querySelector<HTMLElement>('[data-oval-probe]');
    assert.ok(el !== null, 'the bar draws the oval');
    return el;
  };
  return { m, bar: () => latest!, oval };
}

const press = (el: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => void el.dispatchEvent(e));
  return e;
};

test('the stub lays the row out and the bar sees it: dots for every panel, the oval a slider', () => {
  const { m, bar, oval } = rowWithBar();
  assert.equal(bar().dots.length, 6, 'one dot per panel: the bar is not the empty one a missing row gives');
  assert.equal(oval().getAttribute('role'), 'slider');
  assert.equal(rowOffsetOf(m.container), 0);
});

test('ArrowRight on the oval steps the row one stop on, ArrowLeft one back, and the row does not take the key a second time', async () => {
  const { m, oval } = rowWithBar();
  const e = press(oval(), 'ArrowRight');
  assert.ok(e.defaultPrevented, 'the slider takes the key');
  assert.equal(rowGlideTargetOf(m.container), 406, 'one stop, not two: the row\'s own arrow keys stand aside for a slider');
  await advanceUntilRowRests(m.container);
  assert.equal(rowOffsetOf(m.container), 406);
  press(oval(), 'ArrowLeft');
  assert.equal(rowGlideTargetOf(m.container), 0);
  await advanceUntilRowRests(m.container);
  assert.equal(rowOffsetOf(m.container), 0);
});

test('ArrowUp steps on and ArrowDown steps back, as a slider\'s keys do', async () => {
  const { m, oval } = rowWithBar();
  press(oval(), 'ArrowUp');
  assert.equal(rowGlideTargetOf(m.container), 406);
  await advanceUntilRowRests(m.container);
  press(oval(), 'ArrowDown');
  assert.equal(rowGlideTargetOf(m.container), 0);
  await advanceUntilRowRests(m.container);
  assert.equal(rowOffsetOf(m.container), 0);
});

test('End glides the row to its last stop and Home back to the first', async () => {
  const { m, oval } = rowWithBar();
  press(oval(), 'End');
  assert.equal(rowGlideTargetOf(m.container), 1624, 'the last stop: s4 and s5 shown');
  await advanceUntilRowRests(m.container);
  assert.equal(rowOffsetOf(m.container), 1624);
  press(oval(), 'Home');
  assert.equal(rowGlideTargetOf(m.container), 0);
  await advanceUntilRowRests(m.container);
  assert.equal(rowOffsetOf(m.container), 0);
});

test('a key with a modifier, or one the slider has no use for, is left alone', () => {
  const { m, oval } = rowWithBar();
  for (const [key, init] of [['ArrowRight', { shiftKey: true }], ['End', { metaKey: true }], ['a', {}], ['PageDown', {}]] as const) {
    const e = press(oval(), key, init);
    assert.equal(e.defaultPrevented, false, `${key} ${JSON.stringify(init)} is not taken`);
    assert.equal(rowGlideTargetOf(m.container), null, `${key} ${JSON.stringify(init)} moves nothing`);
  }
});

test('the oval\'s spoken value names the panels in view by their places, and follows the row', async () => {
  const { m, oval } = rowWithBar();
  assert.equal(oval().getAttribute('aria-valuetext'), 'Panels 1 to 2 of 6');
  press(oval(), 'End');
  await advanceUntilRowRests(m.container);
  assert.equal(oval().getAttribute('aria-valuetext'), 'Panels 5 to 6 of 6');
  assert.equal(oval().getAttribute('aria-valuenow'), '100');
});

test('the spoken value is a label a host can replace', () => {
  const { oval } = rowWithBar({ dotBarView: (first, last, total) => `${first}-${last}/${total}` });
  assert.equal(oval().getAttribute('aria-valuetext'), '1-2/6');
});
