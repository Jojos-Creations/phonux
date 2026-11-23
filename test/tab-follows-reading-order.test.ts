/**
 * After a drag reorders the row, Tab and Shift+Tab visit the panels in the order they are drawn, although the DOM keeps
 * them in the order they opened. jsdom has no Tab focus movement and no layout, so the test gives elements a client rect
 * and plays the browser's part: a Tab nobody prevented moves focus to the next tabbable element in DOM order.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose, useHost, usePanelReorderSteps } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';
import { made, mountRow, row, panelsOf, type MountedRow } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';

afterEach(() => cleanup());

function TabbableView({ id }: { id: string }): React.ReactElement {
  const { panels } = useHost();
  const stepsFor = usePanelReorderSteps();
  return React.createElement(DragToClose, {
    reorder: {
      onDragEnd: (offset: number) => {
        const steps = stepsFor(offset);
        for (let k = 0; k < Math.abs(steps); k += 1) panels.move(id, steps > 0 ? 'right' : 'left');
      },
    },
    children: (handle) =>
      React.createElement('div', { 'data-grab': id, onPointerDown: handle.onPointerDown }, [
        React.createElement('button', { key: 'a', 'data-stop': `${id}-a` }, 'a'),
        React.createElement('button', { key: 'b', 'data-stop': `${id}-b` }, 'b'),
      ]),
  });
}
registerTestView('scroll-row-view', ({ panel }) => React.createElement(TabbableView, { id: panel.id }));

const originalRects = HTMLElement.prototype.getClientRects;
HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
process.on('exit', () => void (HTMLElement.prototype.getClientRects = originalRects));

const stops = (m: MountedRow): HTMLElement[] => [...m.container.querySelectorAll<HTMLElement>('[data-stop]')];
/** One browser Tab press from the focused element: the row's handler first, then the default step in DOM order. */
function press(m: MountedRow, shift: boolean): string {
  const from = document.activeElement as HTMLElement;
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
  act(() => void from.dispatchEvent(event));
  if (!event.defaultPrevented) {
    const all = stops(m);
    const next = all[all.indexOf(document.activeElement as HTMLElement) + (shift ? -1 : 1)];
    next?.focus();
  }
  return (document.activeElement as HTMLElement).dataset.stop!;
}

async function reorderedRow(withRoot = true, grab = 's3', dx = -420): Promise<{ m: MountedRow; reading: string[] }> {
  const m = mountRow(withRoot ? panelsOf(5) : row(...[1, 2, 3, 4, 5].map((k) => made(`s${k}`))), 3000);
  await advanceFrames(2000);
  await drag(m.container.querySelector<HTMLElement>(`[data-grab="${grab}"]`)!, { dx, dy: 0, steps: 12, hold: 8, keepDown: true });
  await advanceFrames(500);
  await release(dx, 0);
  await advanceFrames(2000);
  const reading = m.latest().entries.map((p) => p.id);
  const domIds = [...m.container.querySelectorAll('[data-grab]')].map((el) => el.getAttribute('data-grab'));
  assert.notDeepEqual(domIds, reading, 'the drop left the reading order different from the DOM order');
  return { m, reading };
}

/** Tab from outside the row: the browser's default step lands on the DOM-first (Shift+Tab: DOM-last) tabbable element. */
async function enterFrom(side: 'before' | 'after'): Promise<{ landed: string; reading: string[] }> {
  const { m, reading } = await reorderedRow(false, 's3', side === 'before' ? -900 : 900);
  const outside = document.createElement('button');
  if (side === 'before') m.container.before(outside);
  else m.container.after(outside);
  try {
    outside.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: side === 'after', bubbles: true, cancelable: true });
    act(() => void outside.dispatchEvent(event));
    const all = stops(m);
    act(() => void all[side === 'before' ? 0 : all.length - 1]!.focus());
    return { landed: (document.activeElement as HTMLElement).dataset.stop!.split('-')[0]!, reading };
  } finally {
    outside.remove();
  }
}

/** Tab from nothing (the first Tab into the page, or from browser chrome): the focus change has no relatedTarget. */
async function enterFromNothing(shift: boolean): Promise<{ landed: string; reading: string[] }> {
  const { m, reading } = await reorderedRow(false, 's3', shift ? 900 : -900);
  (document.activeElement as HTMLElement | null)?.blur();
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
  act(() => void document.body.dispatchEvent(event));
  const all = stops(m);
  act(() => void all[shift ? all.length - 1 : 0]!.focus());
  return { landed: (document.activeElement as HTMLElement).dataset.stop!.split('-')[0]!, reading };
}

/** Focus a script moves into the row from outside, with no Tab press, lands on the element it asked for. */
async function scriptedFocus(reorder: boolean): Promise<string> {
  const m = reorder ? (await reorderedRow(false, 's3', -900)).m : mountRow(row(...[1, 2, 3, 4, 5].map((k) => made(`s${k}`))), 3000);
  if (!reorder) await advanceFrames(2000);
  const outside = document.createElement('button');
  m.container.before(outside);
  try {
    outside.focus();
    act(() => void m.container.querySelector<HTMLElement>('[data-stop="s4-b"]')!.focus());
    return (document.activeElement as HTMLElement).dataset.stop!;
  } finally {
    outside.remove();
  }
}

test('focus a script moves into the row is not redirected', async () => {
  assert.equal(await scriptedFocus(false), 's4-b');
});

/**
 * A Tab pressed inside an iframe goes to the iframe's own document, so the row sees no keydown. The browser's step out of
 * it lands on the next tabbable element of this document, which the test plays by focusing it with the iframe as the
 * related target.
 */
function browserStepFromIframe(m: MountedRow, iframe: HTMLElement, shift: boolean): string {
  const all = [...m.container.querySelectorAll<HTMLElement>('button,iframe,[tabindex]')].filter((el) => el.tabIndex >= 0);
  act(() => void iframe.focus());
  assert.equal(document.activeElement, iframe, 'the iframe holds focus');
  const next = all[all.indexOf(iframe) + (shift ? -1 : 1)]!;
  act(() => void next.focus());
  return (document.activeElement as HTMLElement).dataset.stop ?? 'sentinel';
}

async function hostIframe(m: MountedRow, id: string, at: 'first' | 'last'): Promise<HTMLElement> {
  const frame = document.createElement('iframe');
  frame.dataset.stop = `${id}-f`;
  const content = m.container.querySelector<HTMLElement>(`[data-grab="${id}"]`)!;
  if (at === 'last') content.append(frame);
  else content.prepend(frame);
  await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
  return frame;
}

/** Every tabbable element of the document in DOM order, sentinels and iframes included: what the browser's own Tab steps through. */
const tabOrder = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('button,iframe,[tabindex]')].filter((el) => el.tabIndex >= 0);
const landedOn = (): string => {
  const el = document.activeElement as HTMLElement;
  return el.dataset.stop ?? (el.dataset.rowSentinel === undefined ? el.tagName : `sentinel-${el.dataset.rowSentinel}`);
};
/** The browser's default step from the focused element, unless the row's handler prevented it. */
function stepUnlessPrevented(shift: boolean, prevented: boolean): void {
  if (prevented) return;
  const all = tabOrder();
  const next = all[all.indexOf(document.activeElement as HTMLElement) + (shift ? -1 : 1)];
  act(() => void next?.focus());
}
/** One Tab press on the focused element: keydown first, then the default step. */
function tabPress(shift: boolean): void {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
  act(() => void document.activeElement!.dispatchEvent(event));
  stepUnlessPrevented(shift, event.defaultPrevented);
}

interface Around {
  m: MountedRow;
  reading: string[];
  before: HTMLButtonElement;
  after: HTMLButtonElement;
  stop: () => void;
}
/** A row reordered so the drawn-first (`drawnFirst`) or drawn-last panel is not at its DOM end, with a button on each side. */
async function around(framed: boolean, frameAt: 'first' | 'last', drawnFirst: boolean): Promise<Around> {
  const { m, reading } = await reorderedRow(false, 's3', drawnFirst ? -900 : 900);
  if (framed) for (const id of reading) await hostIframe(m, id, frameAt);
  const before = document.createElement('button');
  const after = document.createElement('button');
  before.dataset.stop = 'before';
  after.dataset.stop = 'after';
  m.container.before(before);
  m.container.after(after);
  // The window loses focus to an iframe that takes it, which ends the record of the Tab press that caused it.
  const blurOnFrame = (e: Event): void => void (e.target instanceof HTMLIFrameElement && window.dispatchEvent(new Event('blur')));
  document.addEventListener('focusin', blurOnFrame);
  return { m, reading, before, after, stop: () => document.removeEventListener('focusin', blurOnFrame) };
}
const dropAround = (a: Around): void => {
  a.stop();
  a.before.remove();
  a.after.remove();
};

for (const shift of [false, true]) {
  test(`${shift ? 'Shift+Tab' : 'Tab'} from outside into a row of framed panels lands in the panel's content of the panel drawn ${shift ? 'last' : 'first'}`, async () => {
    const a = await around(true, shift ? 'last' : 'first', !shift);
    try {
      const want = shift ? a.reading[a.reading.length - 1]! : a.reading[0]!;
      assert.notEqual(want, shift ? 's5' : 's1', 'the panel entered is not the one the browser would pick');
      (shift ? a.after : a.before).focus();
      tabPress(shift);
      assert.equal(landedOn(), `${want}-f`);
    } finally {
      dropAround(a);
    }
  });
}

for (const framed of [false, true]) {
  const kind = framed ? 'framed' : 'unframed';
  test(`Tab from the panel drawn last leaves a ${kind} row for the element after it`, async () => {
    const a = await around(framed, 'first', false);
    try {
      const last = a.reading[a.reading.length - 1]!;
      assert.notEqual(last, 's5', 'the drawn-last panel is not the DOM-last one');
      a.m.container.querySelector<HTMLElement>(`[data-stop="${last}-b"]`)!.focus();
      tabPress(false);
      assert.equal(landedOn(), 'after');
    } finally {
      dropAround(a);
    }
  });
  test(`Shift+Tab from the panel drawn first leaves a ${kind} row for the element before it`, async () => {
    const a = await around(framed, 'last', true);
    try {
      const first = a.reading[0]!;
      assert.notEqual(first, 's1', 'the drawn-first panel is not the DOM-first one');
      a.m.container.querySelector<HTMLElement>(`[data-stop="${first}-a"]`)!.focus();
      tabPress(true);
      assert.equal(landedOn(), 'before');
    } finally {
      dropAround(a);
    }
  });
}


// ---------------------------------------------------------------------------
// Inside a column that shows several spaces: the column decides what comes after the row
// ---------------------------------------------------------------------------

test('a Tab out of a row in a cell of a column that shows several spaces: from the DOM-last panel it is the browser’s, from any other focus is parked on the cell’s end, and before any other element the key is cancelled and focus goes there', async () => {
  const cell = document.createElement('div');
  cell.setAttribute('data-workspace-cell', '');
  const sentinel = document.createElement('span');
  sentinel.tabIndex = 0;
  sentinel.setAttribute('data-column-sentinel', 'cell-end');
  const plain = document.createElement('button');
  for (const dx of [900, -900]) {
    const { m, reading } = await reorderedRow(false, 's3', dx);
    const ids = [...m.container.querySelectorAll('[data-grab]')].map((el) => el.getAttribute('data-grab'));
    const domLast = reading[reading.length - 1] === ids[ids.length - 1];
    assert.equal(domLast, dx < 0, 'dragged right, the last panel on screen has later ones in the DOM; dragged left, it is the DOM-last too');
    const last = m.container.querySelector<HTMLElement>(`[data-stop="${reading[reading.length - 1]}-b"]`)!;
    const tab = (): boolean => {
      // Twice: after a Tab, the first focus from outside the row is an entry, which the row sends to its first panel on screen.
      act(() => last.focus());
      act(() => last.focus());
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      act(() => void last.dispatchEvent(event));
      return event.defaultPrevented;
    };
    try {
      m.container.after(sentinel);
      assert.equal(tab(), false, 'the step stays pending for the column');
      assert.ok(document.activeElement === sentinel, 'outside a cell the row cannot tell who catches the step, and parks');
      m.container.before(cell);
      cell.append(m.container, sentinel);
      assert.equal(tab(), false);
      assert.ok(document.activeElement === (domLast ? last : sentinel), domLast ? 'the browser’s step from here ends on the cell’s end by itself' : 'parked');
      sentinel.before(plain);
      assert.equal(tab(), !domLast, 'with an element between the row and the cell’s end, the browser reaches it from the DOM-last panel, through whatever else that panel holds');
      assert.ok(document.activeElement === (domLast ? last : plain));
      plain.focus = () => undefined;
      assert.equal(tab(), false, 'an element that refuses focus leaves the key to the browser');
    } finally {
      delete (plain as { focus?: unknown }).focus;
      cell.before(m.container);
      cell.remove();
      sentinel.remove();
      plain.remove();
      cleanup();
    }
  }
});

test('a Tab into the row lands where the browser put it when that is the first panel on screen and the row is in a cell of a column that shows several spaces; elsewhere it goes to that panel’s first control', async () => {
  const { m, reading } = await reorderedRow(false, 's3', -900);
  const outside = document.createElement('button');
  const cell = document.createElement('div');
  cell.setAttribute('data-workspace-cell', '');
  const sentinel = document.createElement('span');
  sentinel.setAttribute('data-column-sentinel', 'cell-start');
  const second = m.container.querySelector<HTMLElement>(`[data-stop="${reading[0]}-b"]`)!;
  const enterAt = (el: HTMLElement): string => {
    outside.focus();
    act(() => void outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    act(() => el.focus());
    return (document.activeElement as HTMLElement).dataset.stop!;
  };
  try {
    m.container.before(outside);
    assert.equal(enterAt(second), `${reading[0]}-a`, 'a row alone picks the panel’s first control');
    m.container.before(cell);
    cell.append(sentinel, m.container);
    assert.equal(enterAt(second), `${reading[0]}-b`, 'in the cell the browser’s own choice in the right panel stays');
    const other = m.container.querySelector<HTMLElement>(`[data-stop="${reading[1]}-b"]`)!;
    assert.equal(enterAt(other), `${reading[0]}-a`, 'and its choice of another panel is still corrected');
  } finally {
    cell.before(m.container);
    cell.remove();
    outside.remove();
  }
});
