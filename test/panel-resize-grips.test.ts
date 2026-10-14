/**
 * PanelResizeGrips: the default frame draws a grip on each side of a resizable panel; a drag draws the panel as wide as the
 * pointer pulls it, the release settles it on the nearest slot, Arrow keys step one slot, and none is drawn where the panel
 * cannot be resized or fewer than two slots fit.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { PANEL_SETTINGS_CATALOG, PanelResizeGrips, createWorkspace, definePanel, Panel, PanelFrame } from '../index.js';
import type { PanelHandle, PanelSettings } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { FRAME_MS } from './support/jsdom-globals.js';
import { flush, mountWorkspace, type ResizableWorkspace } from './support/workspace-row.js';

afterEach(() => {
  cleanup();
  reduceMotion(false);
});

const reduced = { matches: false, listeners: new Set<() => void>() };
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    media: query,
    get matches() {
      return reduced.matches;
    },
    addEventListener: (_type: string, listener: () => void) => void reduced.listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void reduced.listeners.delete(listener),
  }),
});
function reduceMotion(on: boolean): void {
  reduced.matches = on;
  for (const listener of [...reduced.listeners]) listener();
}

// jsdom has no pointer capture; the grip only asks for it.
for (const name of ['setPointerCapture', 'releasePointerCapture'] as const) Object.defineProperty(Element.prototype, name, { configurable: true, value: () => undefined });
Object.defineProperty(Element.prototype, 'hasPointerCapture', { configurable: true, value: () => true });

const PHONE = 390;
const GAP = 24;

const bare = (settings: PanelSettings = {}) =>
  definePanel({ id: 'bare', settings: { title: 'Bare', maxSlots: 4, ...settings }, view: () => React.createElement('p', { 'data-body': 'bare' }, 'bare') });

interface Rig {
  m: ResizableWorkspace;
  handle: PanelHandle;
}

async function rig(settings: PanelSettings = {}, width = 4000): Promise<Rig> {
  const root = definePanel({ id: 'root', view: () => React.createElement(Panel, { title: 'History', children: React.createElement(PanelFrame, null, 'h') }) });
  const ws = createWorkspace({ mount: false, root, templates: [bare(settings)], tuning: { rowGap: GAP } });
  const handle = ws.addPanel('bare');
  const m = mountWorkspace(ws, { width, withMaxLiveWidth: true });
  await flush();
  await advanceFrames(400);
  return { m, handle };
}

const gripOf = (r: Rig, side: 'left' | 'right'): HTMLElement | null => r.m.container.querySelector<HTMLElement>(`[data-panel-resize-grip="${side}"]`);
const boxOf = (r: Rig): HTMLElement => r.m.container.querySelector<HTMLElement>('[data-body="bare"]')!.closest<HTMLElement>('[data-row-slot]')!.querySelector<HTMLElement>('[data-panel-size-box]')!;
const slotOf = (r: Rig): HTMLElement => r.m.container.querySelector<HTMLElement>('[data-body="bare"]')!.closest<HTMLElement>('[data-row-slot]')!;
const slotsOf = (r: Rig): number => r.m.latest().entries.find((p) => p.title === 'Bare')!.slots ?? 1;
const widthOf = (slots: number): number => slots * PHONE + (slots - 1) * GAP;

function pointer(type: string, x: number, pointerId = 1): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 300, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
  for (const [key, value] of Object.entries({ pointerId, pointerType: 'mouse', isPrimary: true })) Object.defineProperty(event, key, { value });
  return event;
}
const fire = async (el: Element, type: string, x: number): Promise<void> => {
  await act(async () => void el.dispatchEvent(pointer(type, x)));
  await advanceFrames(FRAME_MS * 2);
};
const key = async (el: Element, k: string): Promise<boolean> => {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  await act(async () => void el.dispatchEvent(event));
  await advanceFrames(400);
  return event.defaultPrevented;
};

test('a default-frame panel with resizable true shows a grip on each side, named and valued for a screen reader', async () => {
  const r = await rig();
  for (const side of ['left', 'right'] as const) {
    const grip = gripOf(r, side)!;
    assert.ok(grip, `${side} grip drawn`);
    assert.equal(grip.getAttribute('role'), 'separator');
    assert.equal(grip.getAttribute('aria-orientation'), 'vertical');
    assert.equal(grip.getAttribute('aria-label'), `Resize from the ${side} edge`);
    assert.equal(grip.getAttribute('aria-valuenow'), '1');
    assert.equal(grip.getAttribute('aria-valuemin'), '1');
    assert.equal(grip.getAttribute('aria-valuetext'), `1 of ${grip.getAttribute('aria-valuemax')} slots wide`);
    assert.equal(grip.getAttribute('data-panel-chrome-part'), 'resize');
    assert.equal(grip.tabIndex, 0);
  }
  assert.equal(gripOf(r, 'left')!.style.width === '' ? 'css' : 'inline', 'css', 'the 24 px target is drawn by the stylesheet');
  assert.equal(Number(gripOf(r, 'right')!.getAttribute('aria-valuemax')) >= 3, true, 'a wide window offers at least three slots');
});

test('resizable false, one slot of room, or maxSlots 1 draws no grip', async () => {
  assert.equal(gripOf(await rig({ resizable: false }), 'left') === null, true, 'resizable false');
  cleanup();
  const narrow = await rig({}, PHONE + 2 * GAP);
  assert.equal(gripOf(narrow, 'right')?.getAttribute('aria-valuemax') ?? null, null, 'a window that fits one phone');
  cleanup();
  assert.equal(gripOf(await rig({ maxSlots: 1 }), 'right') === null, true, 'maxSlots 1');
});

test('a drag on the right grip draws the panel as wide as the pointer pulls it, then settles on the nearest slot', async () => {
  const r = await rig();
  const grip = gripOf(r, 'right')!;
  await fire(grip, 'pointerdown', 1000);
  await fire(grip, 'pointermove', 1100);
  assert.equal(r.m.container.querySelector('[data-panel-dragging]') !== null, true, 'the panel is marked while held');
  await advanceFrames(FRAME_MS * 30);
  assert.equal(Math.round(Number.parseFloat(boxOf(r).style.width)), PHONE + 100, 'the width follows the pointer between two slots');
  assert.equal(slotsOf(r), 1, 'and nothing is stored yet');
  await fire(grip, 'pointermove', 1000 + widthOf(2) - PHONE + 10);
  await fire(grip, 'pointerup', 1000 + widthOf(2) - PHONE + 10);
  await advanceFrames(2000);
  assert.equal(slotsOf(r), 2, 'the release stored the nearest slot count');
  assert.equal(boxOf(r).style.width, `${widthOf(2)}px`, 'and the panel rests at a whole-slot width');
  assert.equal(r.m.container.querySelector('[data-panel-dragging]'), null, 'the mark is cleared');
});

test('a drag short of half a slot settles back on one slot, and a drag far past the room stops at the most that fit (the row holds the width there)', async () => {
  const r = await rig({}, 2000);
  const grip = gripOf(r, 'right')!;
  await fire(grip, 'pointerdown', 500);
  await fire(grip, 'pointermove', 560);
  await fire(grip, 'pointerup', 560);
  await advanceFrames(2000);
  assert.equal(slotsOf(r), 1);
  const most = Number(grip.getAttribute('aria-valuemax'));
  await fire(grip, 'pointerdown', 500);
  await fire(grip, 'pointermove', 100);
  await advanceFrames(FRAME_MS * 30);
  assert.equal(Math.round(Number.parseFloat(boxOf(r).style.width)), PHONE, 'a pull inward never draws the panel under one phone');
  await fire(grip, 'pointermove', 5000);
  await advanceFrames(FRAME_MS * 30);
  assert.equal(Math.round(Number.parseFloat(boxOf(r).style.width)), widthOf(most), 'and a pull far out stops at the most that fit (the row holds the width there)');
  await fire(grip, 'pointerup', 5000);
  await advanceFrames(2000);
  assert.equal(slotsOf(r), most);
});

test('the left grip keeps the right edge where it is while the left edge follows the pointer', async () => {
  const r = await rig();
  await act(async () => void r.handle.setSlots(2));
  await advanceFrames(2000);
  const edge = (): number => Number.parseFloat(/translateX\((-?[\d.e+-]+)px\)/.exec(slotOf(r).style.transform)?.[1] ?? '0') + Number.parseFloat(boxOf(r).style.width);
  const left = gripOf(r, 'left')!;
  const before = edge();
  await fire(left, 'pointerdown', 1000);
  await fire(left, 'pointermove', 900);
  await advanceFrames(FRAME_MS * 30);
  assert.equal(Math.round(Number.parseFloat(boxOf(r).style.width)), widthOf(2) + 100, 'wider by what the pointer moved');
  assert.ok(Math.abs(edge() - before) < 2, `the right edge stayed (${before} -> ${edge()})`);
  await fire(left, 'pointerup', 900);
  await advanceFrames(2000);
  assert.equal(slotsOf(r), 2, 'a release 100 px out settles back on two slots');
});

test('a move at clientX 0 after the pointer was well inside the window is ignored, as Firefox reports it past the edge', async () => {
  const r = await rig();
  const grip = gripOf(r, 'right')!;
  await fire(grip, 'pointerdown', 1000);
  await fire(grip, 'pointermove', 1260);
  await advanceFrames(FRAME_MS * 30);
  const seen = boxOf(r).style.width;
  await fire(grip, 'pointermove', 0);
  await advanceFrames(FRAME_MS * 30);
  assert.equal(boxOf(r).style.width, seen, 'the width kept the last real pointer position');
  await fire(grip, 'pointerup', 0);
  await advanceFrames(2000);
  assert.equal(slotsOf(r), 2, 'and the release counted that position');
});

test('a cancelled drag lets the panel glide back and stores nothing', async () => {
  const r = await rig();
  const grip = gripOf(r, 'right')!;
  await fire(grip, 'pointerdown', 1000);
  await fire(grip, 'pointermove', 1500);
  await fire(grip, 'pointercancel', 1500);
  await advanceFrames(2000);
  assert.equal(slotsOf(r), 1);
  assert.equal(r.m.container.querySelector('[data-panel-dragging]'), null);
});

test('Arrow keys step one slot: the right grip grows on ArrowRight and the left grip on ArrowLeft, each shrinks the other way', async () => {
  const r = await rig();
  assert.equal(await key(gripOf(r, 'right')!, 'ArrowRight'), true, 'the key is handled, so the row does not also scroll');
  assert.equal(slotsOf(r), 2);
  await key(gripOf(r, 'left')!, 'ArrowLeft');
  assert.equal(slotsOf(r), 3);
  await key(gripOf(r, 'right')!, 'ArrowLeft');
  assert.equal(slotsOf(r), 2);
  await key(gripOf(r, 'left')!, 'ArrowRight');
  await key(gripOf(r, 'left')!, 'ArrowRight');
  assert.equal(slotsOf(r), 1, 'and it stops at one slot');
  assert.equal(gripOf(r, 'right')!.getAttribute('aria-valuenow'), '1');
});

test('under Reduce Motion the release snaps to the settled width at once', async () => {
  const r = await rig();
  reduceMotion(true);
  const grip = gripOf(r, 'right')!;
  await fire(grip, 'pointerdown', 1000);
  await fire(grip, 'pointermove', 1000 + widthOf(2) - PHONE);
  await fire(grip, 'pointerup', 1000 + widthOf(2) - PHONE);
  await advanceFrames(FRAME_MS * 3);
  assert.equal(boxOf(r).style.width, `${widthOf(2)}px`);
  assert.equal(boxOf(r).style.transform, '', 'with no scale easing it');
});

test('a press that travels under 4 px is a click: no resize starts and nothing is stored, and 4 px starts one', async () => {
  const r = await rig();
  const grip = gripOf(r, 'right')!;
  await fire(grip, 'pointerdown', 1000);
  await fire(grip, 'pointermove', 1003);
  assert.equal(r.m.container.querySelector('[data-panel-dragging]') === null, true, '3 px does not mark the panel');
  await fire(grip, 'pointermove', 1000 - 3);
  await fire(grip, 'pointerup', 1003);
  await advanceFrames(2000);
  assert.equal(slotsOf(r), 1, 'the release stored nothing');
  assert.equal(boxOf(r).style.width, `${widthOf(1)}px`, 'and the width never moved');
  await fire(grip, 'pointerdown', 1000);
  await fire(grip, 'pointermove', 1004);
  assert.equal(r.m.container.querySelector('[data-panel-dragging]') !== null, true, '4 px starts the resize');
  await fire(grip, 'pointercancel', 1004);
});

test('the click a browser fires after a drag is swallowed, and a plain click or a later click is not', async () => {
  const r = await rig();
  const grip = gripOf(r, 'right')!;
  let reached = 0;
  const count = (): void => void (reached += 1);
  document.addEventListener('click', count);
  try {
    const clickEvent = (): MouseEvent => new MouseEvent('click', { bubbles: true, cancelable: true });
    const click = async (): Promise<void> => void (await act(async () => void grip.dispatchEvent(clickEvent())));
    await fire(grip, 'pointerdown', 1000);
    await fire(grip, 'pointermove', 1200);
    // A browser fires the click in the same task as the pointerup.
    await act(async () => {
      grip.dispatchEvent(pointer('pointerup', 1200));
      grip.dispatchEvent(clickEvent());
    });
    assert.equal(reached, 0, 'the click after a drag stops at the grip');
    await act(async () => void (await new Promise((done) => setTimeout(done, 5))));
    await click();
    assert.equal(reached, 1, 'a click on its own reaches the panel');
    // A drag that fires no click (a touch drag does not) must not leave the swallow waiting for the next real click.
    await fire(grip, 'pointerdown', 1000);
    await fire(grip, 'pointermove', 1200);
    await fire(grip, 'pointerup', 1200);
    await act(async () => void (await new Promise((done) => setTimeout(done, 5))));
    await click();
    assert.equal(reached, 2, 'a swallow nobody used expires');
    await fire(grip, 'pointerdown', 1000);
    await fire(grip, 'pointerup', 1002);
    await click();
    assert.equal(reached, 3, 'a press that never became a drag leaves its click alone');
  } finally {
    document.removeEventListener('click', count);
  }
});

test('each side has one 24 px wide tab stop, and a panel that cannot resize has none', async () => {
  const r = await rig();
  const stops = [...r.m.container.querySelectorAll<HTMLElement>('[data-panel-resize-grip]')].filter((g) => g.tabIndex === 0);
  assert.deepEqual(stops.map((g) => g.dataset.panelResizeGrip), ['left', 'right']);
  for (const g of stops) assert.equal(getComputedStyle(g).width, '24px', 'a pointer target of the WCAG 2.5.8 minimum, whatever the pointer');
  cleanup();
  assert.equal((await rig({ resizable: false })).m.container.querySelectorAll('[data-panel-resize-grip]').length, 0);
});

test('a hand-built Panel puts the grips in its overlay, and the grips add no settings key', async () => {
  const view = definePanel({
    id: 'own',
    settings: { frame: 'none', maxSlots: 3 },
    view: () => React.createElement(Panel, { title: 'Own', overlay: React.createElement(PanelResizeGrips), children: React.createElement(PanelFrame, null, React.createElement('i', { 'data-body': 'own' })) }),
  });
  const root = definePanel({ id: 'root', view: () => React.createElement(Panel, { title: 'History', children: null }) });
  const ws = createWorkspace({ mount: false, root, templates: [view] });
  ws.addPanel('own');
  const m = mountWorkspace(ws, { width: 4000 });
  await flush();
  assert.equal(m.container.querySelectorAll('[data-panel-resize-grip]').length, 2);
  assert.equal(Object.keys(PANEL_SETTINGS_CATALOG).some((name) => /grip/i.test(name)), false, 'no catalog key names a grip');
});
