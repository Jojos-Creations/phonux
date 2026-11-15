/**
 * The Embla row's wiring (`useEmblaRow`, `markAwaySlots`) in a mounted row: the inert marks on pages out of the window, the arrow keys
 * and their text-field guard, Option + wheel left to the content, and a focus that brings a cut page into view. The pure functions
 * have their own tests; these go through the mounted row, with the layout a browser gives it stubbed by `stubSlotBoxes`.
 * Row: the root and five pages, 390 px a phone and 16 px gaps, so a slot every 406 px; the 1000 px container fits a 796 px window
 * (two slots), so the root and s1 are shown at rest and s2 starts one gap past the right edge.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { advanceUntilRowRests, rowBoxOf, rowGlideTargetOf, rowOffsetOf, setRowOffset, stubSlotBoxes } from './support/strip.js';
import * as React from 'react';
import { act } from 'react';
import { useEmblaRow } from '../emblaRow.js';
import { cleanup, mount } from './support/mount-harness.js';
import { mountRow, panelsOf, type MountedRow } from './support/scroll-row.js';

afterEach(() => {
  for (const el of document.querySelectorAll('[data-wiring-probe]')) el.remove();
  cleanup();
});

const rect = (left: number, width: number): DOMRect => ({ left, right: left + width, top: 0, bottom: 700, width, height: 700, x: left, y: 0, toJSON: () => ({}) });

function laidOutRow(): MountedRow {
  const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'step' } });
  m.container.getBoundingClientRect = () => rect(0, 1000);
  stubSlotBoxes(m.container, 16);
  return m;
}

const slotOf = (m: MountedRow, id: string): HTMLElement => {
  const slot = rowBoxOf(m.container)?.querySelector<HTMLElement>(`[data-row-id="${id}"]`);
  assert.ok(slot, `the row draws a slot for ${id}`);
  return slot;
};
const inert = (m: MountedRow, id: string): boolean => slotOf(m, id).hasAttribute('inert');

test('the window\'s stops are the slot grid: the stub lays the row out, so the checks below can see it move', () => {
  const m = laidOutRow();
  assert.equal(rowOffsetOf(m.container), 0);
  setRowOffset(m.container, 1624);
  assert.equal(rowOffsetOf(m.container), 1624, 'the last stop: s4 and s5 shown');
});

test('a page wholly outside the window is inert, one the window shows is not, and the marks follow the row', () => {
  const m = laidOutRow();
  assert.deepEqual(['s1', 's2', 's5'].map((id) => inert(m, id)), [false, true, true], 'at rest: s1 shown, s2 and s5 out of the window');
  setRowOffset(m.container, 1624);
  assert.deepEqual(['s1', 's4', 's5'].map((id) => inert(m, id)), [true, false, false], 'at the last stop: s1 out, s4 and s5 shown');
});

test('ArrowRight steps the row one slot right and ArrowLeft steps it back', async () => {
  const m = laidOutRow();
  m.key('ArrowRight');
  assert.equal(rowGlideTargetOf(m.container), 406, 'ArrowRight heads for the next stop to the right');
  await advanceUntilRowRests(m.container);
  assert.equal(rowOffsetOf(m.container), 406);
  m.key('ArrowLeft');
  assert.equal(rowGlideTargetOf(m.container), 0, 'ArrowLeft heads back for the first stop');
  await advanceUntilRowRests(m.container);
  assert.equal(rowOffsetOf(m.container), 0);
});

test('an arrow key typed in a text field stays with the field: the row does not step', async () => {
  const m = laidOutRow();
  const field = document.createElement('input');
  field.setAttribute('data-wiring-probe', '');
  document.body.appendChild(field);
  field.focus();
  assert.ok(document.activeElement === field, 'the field has the focus');
  m.key('ArrowRight', {}, field);
  assert.equal(rowGlideTargetOf(m.container), null, 'no glide started');
  assert.equal(rowOffsetOf(m.container), 0);
  field.blur();
  m.key('ArrowRight');
  assert.equal(rowGlideTargetOf(m.container), 406, 'control: the same key outside the field steps the row');
});

test('a sideways wheel moves the row, and one that starts with Option held is left to the content', () => {
  const plain = laidOutRow();
  const taken = plain.wheel({ deltaX: 50 });
  assert.equal(rowGlideTargetOf(plain.container), 50, 'control: a plain sideways wheel moves the row by its delta');
  assert.ok(taken.defaultPrevented, 'and the row takes it from the page');
  cleanup();
  const option = laidOutRow();
  const left = option.wheel({ deltaX: 50, altKey: true });
  assert.equal(rowGlideTargetOf(option.container), null, 'with Option held the row does not move');
  assert.equal(rowOffsetOf(option.container), 0);
  assert.ok(!left.defaultPrevented, 'and the wheel is left to the content');
});

test('a focus inside a page past the window\'s edge brings that page whole into view', () => {
  const m = laidOutRow();
  const inside = slotOf(m, 's2').querySelector<HTMLElement>('*') ?? slotOf(m, 's2');
  act(() => void inside.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
  assert.equal(rowGlideTargetOf(m.container), 406, 's2 (812..1202) comes in at the right edge: the row heads for 406');
  const shown = slotOf(m, 's1').querySelector<HTMLElement>('*') ?? slotOf(m, 's1');
  setRowOffset(m.container, 0);
  act(() => void shown.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
  assert.equal(rowGlideTargetOf(m.container), null, 'control: a focus in a page already whole in view moves nothing');
});

/**
 * `useEmblaRow` alone, under no PanelRow: a window 796 px wide, a stop every 406 px, and three 390 px slots at 0, 406 and 812, each
 * holding a button. PanelRow also reveals a focused page (its slot's onActivate), so this is the one place the row's own focus
 * listener is seen by itself.
 */
function BareRow(): React.ReactElement {
  const win = React.useRef<HTMLDivElement>(null);
  const box = React.useRef<HTMLDivElement>(null);
  useEmblaRow(win, box, true, 150);
  const lefts = [0, 406, 812];
  return React.createElement(
    'div',
    { ref: win, 'data-row-embla-window': '', style: { position: 'relative', width: '796px' } },
    React.createElement(
      'div',
      { ref: box, style: { position: 'relative' } },
      ...lefts.map((left) => React.createElement('div', { key: `m${left}`, 'data-row-embla-slot': left, style: { position: 'absolute', left: `${left}px`, width: '390px' } })),
      ...lefts.map((left) =>
        React.createElement('div', { key: `s${left}`, 'data-row-slot': left, 'data-row-id': `p${left}`, style: { position: 'absolute', translate: `${left}px`, width: '390px' } }, React.createElement('button', null, `p${left}`)),
      ),
    ),
  );
}

test('the row\'s own focus listener: a focus in a slot past the window\'s edge brings it whole into view, one in view moves nothing', () => {
  const m = mount(React.createElement(BareRow));
  stubSlotBoxes(m.container, 0);
  const button = (left: number): HTMLElement => m.container.querySelector<HTMLElement>(`[data-row-slot="${left}"] button`)!;
  act(() => void button(406).dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
  assert.equal(rowGlideTargetOf(m.container), null, 'control: the slot at 406..796 is in view, so the row stays');
  act(() => void button(812).dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
  assert.equal(rowGlideTargetOf(m.container), 406, 'the slot at 812..1202 comes in at the right edge: the row heads for 406');
});
