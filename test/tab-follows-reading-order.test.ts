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

test('Tab visits the panels in the order they are drawn after a reorder', async () => {
  const { m, reading } = await reorderedRow();
  const first = m.container.querySelector<HTMLElement>(`[data-stop="${reading[0]}-a"]`)!;
  first.focus();
  const visited = [reading[0]!];
  for (let k = 0; k < reading.length * 2 - 1; k += 1) visited.push(press(m, false).split('-')[0]!);
  assert.deepEqual([...new Set(visited)], reading);
});

test('Shift+Tab visits the panels in reverse drawn order after a reorder', async () => {
  const { m, reading } = await reorderedRow();
  const last = reading[reading.length - 1]!;
  m.container.querySelector<HTMLElement>(`[data-stop="${last}-b"]`)!.focus();
  const visited = [last];
  for (let k = 0; k < reading.length * 2 - 1; k += 1) visited.push(press(m, true).split('-')[0]!);
  assert.deepEqual([...new Set(visited)], [...reading].reverse());
});

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

test('Tab entering the row from before it lands in the panel drawn first', async () => {
  const { landed, reading } = await enterFrom('before');
  assert.equal(landed, reading[0]);
  assert.notEqual(reading[0], 's1', 'the drawn-first panel is not the DOM-first one');
});

test('Shift+Tab entering the row from after it lands in the panel drawn last', async () => {
  const { landed, reading } = await enterFrom('after');
  assert.equal(landed, reading[reading.length - 1]);
  assert.notEqual(reading[reading.length - 1], 's5', 'the drawn-last panel is not the DOM-last one');
});

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

test('Tab from nothing lands in the panel drawn first', async () => {
  const { landed, reading } = await enterFromNothing(false);
  assert.equal(landed, reading[0]);
  assert.notEqual(reading[0], 's1', 'the drawn-first panel is not the DOM-first one');
});

test('Shift+Tab from nothing lands in the panel drawn last', async () => {
  const { landed, reading } = await enterFromNothing(true);
  assert.equal(landed, reading[reading.length - 1]);
  assert.notEqual(reading[reading.length - 1], 's5', 'the drawn-last panel is not the DOM-last one');
});

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

test('focus a script moves into a reordered row is not redirected', async () => {
  assert.equal(await scriptedFocus(true), 's4-b');
});

test('a Tab the app handled itself does not steer a later script focus into the row', async () => {
  const { m } = await reorderedRow(false, 's3', -900);
  const outside = document.createElement('button');
  m.container.before(outside);
  try {
    outside.focus();
    const trap = (e: Event) => e.preventDefault();
    outside.addEventListener('keydown', trap);
    act(() => void outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    await new Promise((r) => setTimeout(r, 5));
    act(() => void m.container.querySelector<HTMLElement>('[data-stop="s4-b"]')!.focus());
    assert.equal((document.activeElement as HTMLElement).dataset.stop, 's4-b');
  } finally {
    outside.remove();
  }
});

test('Tab skips an inert panel and lands in the next panel drawn', async () => {
  const { m, reading } = await reorderedRow(false, 's3', -900);
  m.container.querySelector(`[data-row-slot][data-row-id="${reading[1]}"]`)!.setAttribute('inert', '');
  m.container.querySelector<HTMLElement>(`[data-stop="${reading[0]}-b"]`)!.focus();
  assert.equal(press(m, false), `${reading[2]}-a`);
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

test('Tab out of an iframe that ends a panel lands in the panel drawn next', async () => {
  const { m, reading } = await reorderedRow(false, 's3', -900);
  const frame = await hostIframe(m, reading[0]!, 'last');
  assert.notEqual(reading[1], 's4', 'the drawn-next panel is not the DOM-next one');
  assert.equal(browserStepFromIframe(m, frame, false), `${reading[1]}-a`);
});

test('Shift+Tab out of an iframe that starts a panel lands in the panel drawn before', async () => {
  const { m, reading } = await reorderedRow(false, 's3', 900);
  const last = reading[reading.length - 1]!;
  const frame = await hostIframe(m, last, 'first');
  assert.notEqual(reading[reading.length - 2], 's2', 'the drawn-previous panel is not the DOM-previous one');
  assert.equal(browserStepFromIframe(m, frame, true), `${reading[reading.length - 2]}-b`);
});

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

test('Tab parks focus on the DOM-last end sentinel while it leaves a framed row, so the content of that panel is not entered', async () => {
  const a = await around(true, 'first', false);
  try {
    const last = a.reading[a.reading.length - 1]!;
    a.m.container.querySelector<HTMLElement>(`[data-stop="${last}-b"]`)!.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => void document.activeElement!.dispatchEvent(event));
    assert.equal(landedOn(), 'sentinel-end');
  } finally {
    dropAround(a);
  }
});

test('Tab out of an iframe that ends the panel drawn last leaves the row for the element after it', async () => {
  const a = await around(true, 'last', false);
  try {
    const last = a.reading[a.reading.length - 1]!;
    a.m.container.querySelector<HTMLElement>(`[data-stop="${last}-f"]`)!.focus();
    stepUnlessPrevented(false, false);
    assert.equal(landedOn(), 'after');
  } finally {
    dropAround(a);
  }
});

test('Shift+Tab out of an iframe that starts the panel drawn first leaves the row for the element before it', async () => {
  const a = await around(true, 'first', true);
  try {
    const first = a.reading[0]!;
    a.m.container.querySelector<HTMLElement>(`[data-stop="${first}-f"]`)!.focus();
    stepUnlessPrevented(true, false);
    assert.equal(landedOn(), 'before');
  } finally {
    dropAround(a);
  }
});
