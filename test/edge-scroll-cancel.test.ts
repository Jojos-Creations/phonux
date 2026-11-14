/**
 * What ends or refuses an edge-scroll hold: a glide in flight, a request made during the hold, a release, a
 * pointercancel, an unmount, the row ceasing to scroll, a native scroll, and a claim someone else already holds.
 * jsdom has no PointerEvent, so every pointer event is a MouseEvent of the pointer type name carrying the pointer
 * fields motion reads.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { emblaHeld, emblaOf } from '../emblaRow.js';
import { advanceUntilRowRests, emblaWindowIn, rowGlideTargetOf, rowOffsetOf, stubSlotBoxes } from './support/strip.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose, usePanelReorderSteps } from '../index.js';
import type { DragHandleProps, PanelSettings } from '../index.js';
import { LIBRARY_TUNING_DEFAULTS } from '../panelSettings.js';
import { PanelVerticalDragContext } from '../panelSlotContext.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { FRAME_MS } from './support/jsdom-globals.js';
import { made, mountRow, rootEntry, row, type MountedRow } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';

afterEach(async () => {
  // A test that left the pointer down must not leave motion's window listeners live for the next one.
  document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  await frames(5);
  cleanup();
});

const ends: Array<{ id: string; offset: number; hops: number }> = [];
const closes: string[] = [];
let lastHandle: DragHandleProps | undefined;
/** Whether the grab bars offer a reorder: a host can take it away mid-drag, which takes the row's edge numbers from the drag. */
const reorderSwitch = { on: true, listeners: new Set<() => void>() };
const setReorder = (on: boolean): void => {
  reorderSwitch.on = on;
  for (const l of reorderSwitch.listeners) l();
};
const subscribeReorder = (l: () => void): (() => void) => {
  reorderSwitch.listeners.add(l);
  return () => void reorderSwitch.listeners.delete(l);
};
function CancelBox({ id }: { id: string }): React.ReactElement {
  const steps = usePanelReorderSteps();
  const reorderOn = React.useSyncExternalStore(subscribeReorder, () => reorderSwitch.on);
  // The close tests below drag down, which a row allows only under a template's verticalDrag.
  const box = React.createElement(DragToClose, {
    onClose: () => void closes.push(id),
    ...(reorderOn ? { reorder: { onDragEnd: (offset: number) => void ends.push({ id, offset, hops: steps(offset) }) } } : {}),
    children: (handle) => {
      lastHandle = handle;
      return React.createElement('div', { 'data-handle': id, onPointerDown: handle.onPointerDown }, 'grab');
    },
  });
  return React.createElement(PanelVerticalDragContext.Provider, { value: true, children: box });
}
registerTestView('cancel-view', ({ panel }) => React.createElement(CancelBox, { id: panel.id }));

const WINDOW = 1000;
const MAX_SCROLL = 3654;
const EDGE = LIBRARY_TUNING_DEFAULTS.edgeScroll;
const RECT = { left: 0, right: WINDOW, top: 0, bottom: 700, width: WINDOW, height: 700, x: 0, y: 0, toJSON: () => ({}) };

function mountCancelRow(layer: PanelSettings = {}, over: Parameters<typeof mountRow>[2] = {}): MountedRow {
  ends.length = 0;
  closes.length = 0;
  const entries = row(rootEntry(), ...Array.from({ length: 10 }, (_, k) => made(`s${k + 1}`, layer, { view: 'cancel-view' })));
  const m = mountRow(entries, WINDOW, over);
  Object.defineProperty(m.container, 'clientWidth', { value: WINDOW, configurable: true });
  m.container.getBoundingClientRect = () => RECT;
  return m;
}

function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', x: number, y = 100): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1 });
  for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true })) Object.defineProperty(event, key, { value });
  return event;
}
const press = (target: Element, x: number): Promise<void> => act(async () => void target.dispatchEvent(pointer('pointerdown', x)));
const moveTo = (x: number, y = 100): Promise<void> => act(async () => void document.dispatchEvent(pointer('pointermove', x, y)));
const liftAt = (x: number, y = 100): Promise<void> => act(async () => void document.dispatchEvent(pointer('pointerup', x, y)));
const cancelAt = (x: number): Promise<void> => act(async () => void document.dispatchEvent(pointer('pointercancel', x)));
const frames = (n: number): Promise<void> => advanceFrames(n * FRAME_MS);
const handleOf = (m: MountedRow, id = 's1'): Element => {
  const handle = m.container.querySelector(`[data-handle="${id}"]`);
  assert.ok(handle, `${id}'s grab bar rendered`);
  return handle;
};
const drawnX = (m: MountedRow, id = 's1'): number => {
  const box = handleOf(m, id).closest<HTMLElement>('[data-drag-to-close]')!;
  const transform = /translateX\((-?[\d.e+-]+)px\)/.exec(box.style.transform);
  const translate = /^(-?[\d.e+-]+)px/.exec(box.style.translate);
  return (transform === null ? 0 : Number(transform[1])) + (translate === null ? 0 : Number(translate[1]));
};
/** A horizontal drag from 40 px left of `at` to `at`, and a frame for the axis lock to take. */
async function dragTo(m: MountedRow, at: number): Promise<void> {
  await press(handleOf(m), at - 40);
  await moveTo(at);
  await frames(1);
}
/**
 * The row's stops: the one-phone grid (390 + the 16 gap apart) from 0 to the strip's end. 86, half of (968 + 16) % 406, before and
 * after the strip centers the whole slots the window shows at every stop.
 */
const STOPS = Array.from({ length: 10 }, (_, k) => 406 * k);
test('a press on a grab bar mid-glide keeps the pressed panel: the row rests on the stop that shows it whole, never between two stops', async () => {
  const m = mountCancelRow();
  await frames(30);
  // Lays the Embla row out, so the glide is Embla's and rowOffsetOf reads where it draws the row.
  stubSlotBoxes(m.container, 0);
  await frames(30);
  assert.equal(rowOffsetOf(m.container), 0, 'control: the row starts at its first stop');
  act(() => void m.latest().scrollTo('s8'));
  const target = rowGlideTargetOf(m.container);
  assert.ok(target !== null && target > 406, `a glide is in flight toward s8 (${String(target)})`);
  await frames(6);
  const mid = rowOffsetOf(m.container);
  assert.ok(mid > 0 && mid < target, `mid-glide at ${mid}`);
  // A person presses a grab bar they can see: the first panel wholly in the window mid-glide.
  const win = emblaWindowIn(m.container)!.getBoundingClientRect();
  const slotOf = (id: string): HTMLElement => handleOf(m, id).closest<HTMLElement>('[data-row-slot]')!;
  const whole = (id: string): boolean => {
    const r = slotOf(id).getBoundingClientRect();
    return r.left >= win.left - 0.5 && r.right <= win.right + 0.5;
  };
  const seen = Array.from({ length: 10 }, (_, k) => `s${k + 1}`).find(whole);
  assert.ok(seen, 'control: a whole panel is in the window mid-glide');
  const at = slotOf(seen).getBoundingClientRect().left + 100;
  await press(handleOf(m, seen), at);
  await advanceUntilRowRests(m.container);
  const rest = rowOffsetOf(m.container);
  assert.ok(STOPS.includes(rest), `the row rests on a stop (${rest})`);
  assert.ok(rest < target, `the glide toward s8 gave way to the press (${rest} short of ${target})`);
  assert.equal(whole(seen), true, `the pressed panel ${seen} is still whole in the window`);
  await liftAt(at);
});

test('the drag losing the row mid-hold (its reorder taken away) gives the Embla row back and the row settles on the nearest stop', async () => {
  setReorder(true);
  const m = mountCancelRow();
  await frames(30);
  stubSlotBoxes(m.container, 0);
  await frames(30);
  const win = emblaWindowIn(m.container)!;
  const right = win.getBoundingClientRect().right;
  const rowHeld = (): boolean => emblaHeld(emblaOf(win)!);
  await dragTo(m, right - EDGE.zonePx / 4);
  await frames(30);
  const held = rowOffsetOf(m.container);
  assert.ok(held > 0, `control: the edge hold scrolled the row (${held})`);
  assert.equal(rowHeld(), true, 'the drag holds the row');
  act(() => setReorder(false));
  assert.equal(rowHeld(), false, 'the hold is given back with the reorder');
  const at = rowOffsetOf(m.container);
  await advanceUntilRowRests(m.container);
  const rest = rowOffsetOf(m.container);
  assert.ok(STOPS.includes(rest) && Math.abs(rest - at) <= 203, `the row settles on the stop nearest where it was (${at} -> ${rest}), never between two`);
  await frames(30);
  assert.equal(rowOffsetOf(m.container), rest, 'and no longer moves under the held pointer');
  await liftAt(right - EDGE.zonePx / 4);
  setReorder(true);
});
