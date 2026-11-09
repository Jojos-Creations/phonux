/**
 * What ends or refuses an edge-scroll hold: a glide in flight, a request made during the hold, a release, a
 * pointercancel, an unmount, the row ceasing to scroll, a native scroll, and a claim someone else already holds.
 * jsdom has no PointerEvent, so every pointer event is a MouseEvent of the pointer type name carrying the pointer
 * fields motion reads.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { setRowOffset, rowOffsetOf } from './support/strip.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose, usePanelReorderSteps } from '../index.js';
import type { DragHandleProps, PanelSettings } from '../index.js';
import { LIBRARY_TUNING_DEFAULTS, resolvePanelSettings } from '../panelSettings.js';
import { PanelSlotContext, PanelVerticalDragContext, type DragScroll, type PanelSlotValue } from '../panelSlotContext.js';
import { slotTuning } from '../panelTuning.js';
import { edgeScrollStep } from '../edgeScroll.js';
import { rowScrollerFor } from '../rowScroller.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
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
function CancelBox({ id }: { id: string }): React.ReactElement {
  const steps = usePanelReorderSteps();
  // The close tests below drag down, which a row allows only under a template's verticalDrag.
  const box = React.createElement(DragToClose, {
    onClose: () => void closes.push(id),
    reorder: { onDragEnd: (offset: number) => void ends.push({ id, offset, hops: steps(offset) }) },
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
/** The row after `n` held frames of the default speed from `from`, by the loop's own repeated additions. */
function walked(n: number, from = 0): number {
  let scrollLeft = from;
  for (let frame = 0; frame < n; frame += 1) scrollLeft += edgeScrollStep({ speed: EDGE.maxPxPerSec, dtMs: FRAME_MS, scrollLeft, maxScroll: MAX_SCROLL });
  return scrollLeft;
}
/**
 * The row's stops: the one-phone grid (390 + the 16 gap apart) from 0 to MAX_SCROLL. 86, half of (968 + 16) % 406, before and
 * after the strip centers the whole slots the window shows at every stop.
 */
const STOPS = Array.from({ length: 10 }, (_, k) => 406 * k);
/** True when a fresh claim can be taken, giving it back at once. */
function claimFree(m: MountedRow): boolean {
  const claim = m.scroller.claim();
  claim?.release();
  return claim !== null;
}

test('a glide in flight goes on to its target at the pointer-down on the grab bar: a press must not leave the row between two stops', async () => {
  const m = mountCancelRow();
  assert.equal(m.scroller.glideTo(2000, { durationSec: 1, instant: false, ease: 'cubic-out' }), true);
  await frames(10);
  const mid = rowOffsetOf(m.container);
  assert.ok(mid > 0 && mid < 2000, `mid-glide at ${mid}`);
  await press(handleOf(m), 500);
  assert.equal(m.scroller.glideTarget(), 2000);
  await frames(90);
  assert.equal(rowOffsetOf(m.container), 2000);
});

/** A DragToClose alone in a marked scroller whose slot's drag scroll the caller can change. */
function mountAlone(dragScroll: DragScroll | undefined) {
  const slot = (value: DragScroll | undefined): PanelSlotValue => ({
    ...resolvePanelSettings().value,
    collapsible: true,
    neighborWidths: { left: [], right: [] },
    tuning: slotTuning(LIBRARY_TUNING_DEFAULTS),
    dragScroll: value,
  });
  const ui = (value: DragScroll | undefined): React.ReactElement =>
    React.createElement(
      PanelSlotContext.Provider,
      { value: slot(value) },
      React.createElement(
        'div',
        { 'data-row-scroller': '' },
        React.createElement(DragToClose, {
          reorder: { onDragEnd: (offset: number) => void ends.push({ id: 'alone', offset, hops: 0 }) },
          children: (handle) => {
            lastHandle = handle;
            return React.createElement('div', { 'data-handle': 'alone', onPointerDown: handle.onPointerDown }, 'grab');
          },
        }),
      ),
    );
  const mounted = mount(ui(dragScroll));
  const scroller = mounted.container.querySelector<HTMLElement>('[data-row-scroller]')!;
  scroller.getBoundingClientRect = () => RECT;
  return { mounted, ui, scroller, handle: mounted.container.querySelector('[data-handle]')! };
}
const EDGE_ON: DragScroll = { mode: 'edge', zonePx: EDGE.zonePx, maxPxPerSec: EDGE.maxPxPerSec, reducedStepMs: EDGE.reducedStepMs, maxScroll: MAX_SCROLL, stops: [], settleStops: [], settleSec: 0.4, settleEase: 'cubic-out' };

test('the row ceasing to scroll mid-hold gives the claim back and the row stops where it is', async () => {
  ends.length = 0;
  const alone = mountAlone(EDGE_ON);
  const rowScroller = rowScrollerFor(alone.scroller);
  await press(alone.handle, 960);
  await moveTo(1000);
  await frames(30);
  const held = rowScroller.scrollLeft();
  assert.ok(held > 0);
  assert.equal(rowScroller.claimHeld(), true);
  alone.mounted.rerender(alone.ui(undefined));
  assert.equal(rowScroller.claimHeld(), false, 'rowScroll turned false');
  await frames(30);
  assert.equal(rowScroller.scrollLeft(), held);
  await liftAt(1000);
});

/** A row whose offset moves are counted: `writes` rises on every notify that finds the offset changed. */
function countWrites(m: MountedRow): { writes: () => number; value: () => number } {
  const scroller = rowScrollerFor(m.container);
  let writes = 0;
  let value = scroller.scrollLeft();
  scroller.subscribe(() => {
    if (scroller.scrollLeft() === value) return;
    writes += 1;
    value = scroller.scrollLeft();
  });
  return { writes: () => writes, value: () => value };
}

