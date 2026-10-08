/**
 * The owner's literal transition cases for configure, each a before value and an after value written out by hand: the
 * closable and parkable cases first, then the placement, hold, overflow, scroll, keepMounted and viewState cases. Each is
 * one test so a red one names the transition it pins.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import type { ConfigureResult } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag } from './support/drag-gesture.js';
import {
  dragRig,
  done,
  letter,
  matrixRig,
  matrixTemplate,
  mockWindow,
  refusedWith,
  viewLog,
  type MatrixRig,
} from './support/configure-matrix.js';

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  cleanup();
  viewLog.reset();
});

const shape = (res: ConfigureResult): { now: string[]; later: string[]; shadowed: string[] } => {
  const d = done(res);
  return { now: [...d.now], later: [...d.later], shadowed: [...d.shadowed] };
};
const frames = (n: number): Promise<void> => advanceFrames(n * 16);
const summaryOf = (r: MatrixRig, name: string) => r.provided().panelList.find((s) => s.id === r.entry(name).id);
const thrownCode = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};
const slotAt = (r: MatrixRig, engineId: string): HTMLElement | null => r.m.container.querySelector<HTMLElement>(`[data-slot="${engineId}"]`)?.parentElement ?? null;

/** The live park panels fit the window beside the others, except the floor of one (the settled-row guarantee). */
function parkPanelsFit(r: MatrixRig): boolean {
  const n = r.m.latest().rowNumbers;
  if (!Number.isFinite(n.windowWidth) || n.parkLiveWidths.length <= 1) return true;
  const gap = r.ws.tuning.rowGap;
  const used = [...n.reservedWidths, ...n.parkLiveWidths].reduce((sum, w) => sum + w, 0) + (n.reservedWidths.length + n.parkLiveWidths.length - 1) * gap;
  return used <= n.windowWidth;
}

// ---------------------------------------------------------------------------
// A. closable and parkable
// ---------------------------------------------------------------------------

test('case A1: closable true to false on a live panel: the control is gone, close is refused not-closable, the History trash is gone and clearable re-derives false', async () => {
  const r = await matrixRig();
  assert.deepEqual([r.seen('b')?.['data-close'], summaryOf(r, 'b')?.locked, r.state('b').settings.clearable], ['true', false, true]);
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ closable: false }))), { now: ['closable'], later: [], shadowed: [] });
  assert.equal(r.seen('b')?.['data-close'], 'false', 'the view is no longer offered the close control');
  assert.equal(letter(r.turn(() => r.h.b!.close())), 'not-closable');
  assert.equal(summaryOf(r, 'b')?.locked, true, 'History offers no trash for it');
  assert.equal(r.state('b').settings.clearable, false, 'clearable re-derived false');
  r.turn(() => r.provided().clearAll());
  assert.equal(r.order().join(' '), 'root b', 'and clearAll keeps it');
});

test('case A2: closable false inside a declared panel\'s window is stored, and undo restores the panel unclosable', async () => {
  const r = await matrixRig();
  r.turn(() => r.h.b!.close());
  assert.equal((r.provided().recentlyClosed ?? []).length, 1, 'the window is open');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ closable: false }))), { now: [], later: ['closable'], shadowed: [] });
  assert.equal(r.state('b').status, 'closed', 'a closed panel stays closed');
  r.turn(() => r.provided().undoClose());
  await r.settle();
  assert.deepEqual([r.state('b').status, r.entry('b').locked, r.order().join(' ')], ['live', true, 'root a b c']);
  assert.equal(letter(r.turn(() => r.h.b!.close())), 'not-closable', 'undo restored it unclosable');
});

test('case A3: closable false during a DragToClose exit: released at +epsilon and at the end of the exit, the box snaps back, nothing closes and a new press drags again', async () => {
  /** Frames from the release until a drag of s2 closes the panel, with closable left alone. */
  const exitLength = async (): Promise<number> => {
    const control = await dragRig();
    await drag(control.m.container.querySelector(`[data-handle="${control.entry('s2').id}"]`)!, { dx: 0, dy: 300 });
    let frame = 0;
    for (; control.state('s2').status !== 'closed' && frame < 80; frame += 1) await frames(1);
    assert.equal(control.state('s2').status, 'closed', 'control: with closable true the box closes');
    control.m.unmount();
    return frame;
  };
  const length = await exitLength();
  assert.equal(length > 3, true, `and not at once (${length} frames)`);
  const releasedThenLocked = async (lockAtFrame: number): Promise<{ closed: boolean; rest: number; again: number }> => {
    const r = await dragRig();
    const handle = (): Element => r.m.container.querySelector(`[data-handle="${engine}"]`)!;
    const engine = r.entry('s2').id;
    const y = (): number => {
      const match = /translateY\((-?[\d.]+)px\)/.exec(handle().closest<HTMLElement>('[data-drag-to-close]')!.style.transform);
      return match === null ? 0 : Number(match[1]);
    };
    await drag(handle(), { dx: 0, dy: 300 });
    for (let i = 0; i < 70; i += 1) {
      if (i === lockAtFrame) done(r.turn(() => r.h.s2!.configure({ closable: false })));
      await frames(1);
    }
    const closed = r.state('s2').status === 'closed';
    const rest = closed ? Number.NaN : y();
    await drag(handle(), { dx: 0, dy: 30, keepDown: true });
    const again = y();
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await frames(5);
    r.m.unmount();
    return { closed, rest, again };
  };
  for (const at of [1, length - 2]) {
    const out = await releasedThenLocked(at);
    assert.equal(out.closed, false, `locked at frame ${at}: the close never ran`);
    assert.equal(Math.abs(out.rest) < 1, true, `locked at frame ${at}: the box came back to rest (${out.rest})`);
    assert.equal(out.again > 20, true, `locked at frame ${at}: a following press drags the box again, so the exit did not strand it (${out.again})`);
  }
});

test('case A4: closable true on the root is a settings-conflict naming closable and rule C5', async () => {
  const r = await matrixRig();
  const entries = r.m.latest().entries;
  const refusal = refusedWith(r.turn(() => r.ws.panels.configure(r.ws.rootId, { closable: true })), 'settings-conflict');
  assert.equal(refusal.setting, 'closable');
  assert.match(refusal.message, /C5/);
  assert.equal(r.m.latest().entries === entries, true, 'the engine was not touched');
});

test('case A5: parkable true to false on a live phone panel: listed, draggable, placeable and clearable re-derive false at the commit unless named, the settled row fits, a resizable true is a conflict and a measured park row accepts it', async () => {
  const r = await matrixRig({ ids: ['a', 'b', 'c'], settings: { a: { overflow: 'park' }, c: { overflow: 'park' } }, width: 1700 });
  await r.settle();
  assert.equal(r.live().join(' '), 'root a b c');
  const facts = (name: string): unknown[] => {
    const s = r.state(name);
    return [s.settings.parkable, s.listed, s.settings.draggable, s.settings.placeable, s.settings.clearable];
  };
  assert.deepEqual(facts('b'), [true, true, true, true, true]);
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ parkable: false }))), { now: ['parkable'], later: [], shadowed: [] }, 'a measured row holding park panels accepts it: no refusal for room');
  assert.deepEqual(facts('b'), [false, false, false, false, false], 'all four re-derived at the commit');
  await r.settle();
  assert.equal(parkPanelsFit(r), true, 'the settled row fits the window beside the new fixed column');
  assert.equal(r.state('b').status, 'live', 'the fixed column is live');
  const named = await matrixRig();
  assert.deepEqual(shape(named.turn(() => named.h.b!.configure({ parkable: false, listed: true }))), { now: ['parkable', 'listed'], later: [], shadowed: [] });
  assert.deepEqual([named.state('b').settings.parkable, named.state('b').listed, named.state('b').settings.draggable], [false, true, false], 'a named key keeps its value');
  const clash = refusedWith(named.turn(() => named.h.a!.configure({ parkable: false, resizable: true })), 'settings-conflict');
  assert.equal(clash.setting, 'resizable');
  assert.equal(named.state('a').settings.parkable, true, 'and the refused call changed nothing');
});

test('case A6: parkable true to false on a tablet panel is tier-not-allowed and changes nothing', async () => {
  const r = await matrixRig();
  r.turn(() => r.h.b!.setFormFactor('tablet', 'person'));
  const entries = r.m.latest().entries;
  const renders = r.m.renders();
  refusedWith(r.turn(() => r.h.b!.configure({ parkable: false })), 'tier-not-allowed');
  assert.deepEqual([r.m.latest().entries === entries, r.m.renders(), r.entry('b').collapsible, r.entry('b').formFactor], [true, renders, true, 'tablet']);
});

test('case A7: parkable false to true on a live fixed column makes it an ordinary panel again', async () => {
  const r = await matrixRig({ settings: { b: { parkable: false } } });
  const facts = (): unknown[] => {
    const s = r.state('b');
    return [s.settings.parkable, s.listed, s.settings.draggable, s.settings.placeable, s.settings.clearable];
  };
  assert.deepEqual([facts(), r.entry('b').collapsible, r.provided().fixedViewCount], [[false, false, false, false, false], false, 2], 'before: a fixed column');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ parkable: true }))), { now: ['parkable'], later: [], shadowed: [] });
  assert.deepEqual([facts(), r.entry('b').collapsible, r.provided().fixedViewCount], [[true, true, true, true, true], true, 1], 'after: C1 is lifted and the derived keys follow parkable');
  assert.equal(letter(r.turn(() => r.h.b!.hide())), 'T', 'it can be hidden');
});

// ---------------------------------------------------------------------------
// B. placement, holds, overflow, scrolling, keepMounted and viewState
// ---------------------------------------------------------------------------

test('case B1: placeOnShow changed on a hidden panel moves and reveals nothing, and the next show uses it', async () => {
  const r = await matrixRig();
  r.turn(() => r.h.b!.hide());
  await r.settle();
  const order = r.order().join(' ');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ placeOnShow: 'row-start' }))), { now: [], later: ['placeOnShow'], shadowed: [] });
  assert.deepEqual([r.order().join(' '), r.state('b').status, r.state('b').held], [order, 'parked', true], 'no move and no reveal');
  r.turn(() => r.h.b!.show());
  await r.settle();
  assert.deepEqual([r.state('b').status, r.order().join(' ')], ['live', 'b root a c'], 'the next show lands it at the row start');
});

test('case B2: placeOnAdd and placeOnReturn changed on a live panel move nothing', async () => {
  const r = await matrixRig();
  const entries = r.m.latest().entries;
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ placeOnAdd: 'row-start', placeOnReturn: 'row-end' }))), { now: [], later: ['placeOnAdd', 'placeOnReturn'], shadowed: [] });
  assert.deepEqual([r.order().join(' '), r.live().join(' ')], ['root a b c', 'root a b c']);
  assert.equal(r.entry('b').anchor === entries.find((p) => p.id === r.entry('b').id)!.anchor, true, "b's anchor is the object it was");
});

test('case B3: hideStickiness sticky to until-room on a hidden panel leaves it hidden with the hold it has', async () => {
  const r = await matrixRig({ ids: ['a', 'b', 'c'], park: true, width: 1700 });
  await r.settle();
  r.turn(() => r.h.b!.hide());
  await r.settle();
  assert.deepEqual([r.state('b').status, r.state('b').held], ['parked', true]);
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ hideStickiness: 'until-room' }))), { now: [], later: ['hideStickiness'], shadowed: [] });
  assert.deepEqual([r.state('b').status, r.state('b').held], ['parked', true], 'still hidden, hold unchanged');
  r.turn(() => r.h.a!.close());
  await r.settle();
  assert.equal(r.state('b').status, 'parked', 'room opening does not return a panel that was hidden under the sticky hold');
});

test('case B4: hideStickiness sticky to until-room on a live panel is read by the next hide', async () => {
  const r = await matrixRig({ ids: ['a', 'b', 'c'], park: true, width: 1700 });
  await r.settle();
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ hideStickiness: 'until-room' }))), { now: [], later: ['hideStickiness'], shadowed: [] });
  assert.equal(r.live().join(' '), 'root a b c', 'nothing hides at configure');
  r.turn(() => r.h.b!.hide());
  r.turn(() => r.h.c!.hide());
  await r.settle();
  assert.deepEqual([r.state('b').status, r.state('c').status], ['live', 'parked'], 'the until-room panel returns once more room opens than its own hide left; the sticky one stays hidden');
});

test('case B5: capacityReturn auto to manual on a stacked panel keeps it on the stack: it still returns when room opens and nothing is revealed at configure', async () => {
  const r = await matrixRig({ ids: ['a', 'b'], park: true, width: 1000 });
  await r.settle();
  assert.deepEqual([r.state('a').status, r.state('a').held], ['parked', false], 'a is on the stack, not held');
  assert.deepEqual(shape(r.turn(() => r.h.a!.configure({ capacityReturn: 'manual' }))), { now: [], later: ['capacityReturn'], shadowed: [] });
  assert.equal(r.live().join(' '), 'root b', 'no reveal');
  r.turn(() => r.h.b!.close());
  await r.settle();
  assert.equal(r.state('a').status, 'live', 'it stays returnable');
});

test('case B6: overflow park to scroll on a live park panel parks and returns nothing now, and the next opening does not park it', async () => {
  const c = matrixTemplate('c', { settings: { overflow: 'park' } });
  const r = await matrixRig({ ids: ['x', 'a', 'b'], park: true, width: 1300, extra: [c] });
  await r.settle();
  assert.equal(r.live().join(' '), 'root a b', 'x is parked for room');
  assert.deepEqual(shape(r.turn(() => r.h.a!.configure({ overflow: 'scroll' }))), { now: [], later: ['overflow'], shadowed: [] });
  assert.deepEqual([r.live().join(' '), r.state('x').status], ['root a b', 'parked'], 'nothing parks and nothing returns');
  r.turn(() => void r.ws.addPanel('c'));
  await r.settle();
  assert.equal(r.live().join(' '), 'root a c', 'opening c parks b, the park panel, and not a');
});

test('case B7: overflow scroll to park on a live panel parks nothing at configure and makes it eligible at the next overflow', async () => {
  const c = matrixTemplate('c', { settings: { overflow: 'park' } });
  const r = await matrixRig({ ids: ['a', 'b'], width: 1300, extra: [c] });
  await r.settle();
  assert.deepEqual(shape(r.turn(() => r.h.a!.configure({ overflow: 'park' }))), { now: [], later: ['overflow'], shadowed: [] });
  await r.settle();
  assert.equal(r.live().join(' '), 'root a b', 'nothing parks at configure: a is the only park panel and it fits');
  r.turn(() => void r.ws.addPanel('c'));
  await r.settle();
  assert.deepEqual([r.state('a').status, r.live().join(' ')], ['parked', 'root b c'], 'opening a second park panel overflows the row: the farthest park panel, a, goes');
});

test('case B8: scrollOnOpen none on a live panel: the next open does not scroll', async () => {
  const opened = async (none: boolean): Promise<number> => {
    const r = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e'], width: 1000 });
    await r.settle();
    if (none) {
      assert.deepEqual(shape(r.turn(() => r.h.c!.configure({ scrollOnOpen: 'none' }))), { now: [], later: ['scrollOnOpen'], shadowed: [] });
      await r.settle();
      assert.equal(r.m.container.scrollLeft, 0, 'nothing scrolls at configure');
    }
    r.turn(() => r.h.c!.close());
    r.turn(() => r.h.c!.open());
    await r.settle();
    const at = r.m.container.scrollLeft;
    r.m.unmount();
    return at;
  };
  assert.equal(await opened(false), 1452, 'control: reopened at the row end, the default scrolls c into view: right edge 2436 less the 984 visible');
  assert.equal(await opened(true), 0, 'none: the open scrolls nothing');
});

test('case B9: scrollOnMove follow to none: the next pin does not scroll, and nothing scrolls at configure', async () => {
  const pinned = async (none: boolean): Promise<number> => {
    const r = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e'], width: 1000 });
    await r.settle();
    r.turn(() => r.h.a!.scrollTo('start'));
    await r.settle();
    assert.equal(r.m.container.scrollLeft, 406, 'a at the left edge of the window, so b is in view');
    if (none) {
      assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ scrollOnMove: 'none' }))), { now: [], later: ['scrollOnMove'], shadowed: [] });
      await r.settle();
      assert.equal(r.m.container.scrollLeft, 406, 'nothing scrolls at configure');
    }
    assert.equal(letter(r.turn(() => r.h.b!.pin())), 'T');
    await r.settle();
    const at = r.m.container.scrollLeft;
    r.m.unmount();
    return at;
  };
  assert.equal(await pinned(false), 0, 'control: the pin carries b to the row start and the row follows it');
  assert.equal(await pinned(true), 406, 'none: the pin does not scroll');
});

test('case B10: keepMounted true on a previously live, unmounted parked panel mounts nothing until its next show and park', async () => {
  const r = await matrixRig({ ids: ['a', 'b', 'c'], park: true, width: 1000 });
  await r.settle();
  const engine = r.entry('a').id;
  assert.deepEqual([r.state('a').status, r.seen('a')], ['parked', null], 'a was live and is now parked and unmounted');
  const mounted = viewLog.mounted(engine);
  const unmounted = viewLog.unmounted(engine);
  assert.deepEqual(shape(r.turn(() => r.h.a!.configure({ keepMounted: true }))), { now: [], later: ['keepMounted'], shadowed: [] });
  await r.settle();
  assert.deepEqual([r.seen('a'), viewLog.mounted(engine) - mounted], [null, 0], 'no mount at configure');
  r.turn(() => r.h.a!.show());
  await r.settle();
  assert.equal(r.state('a').status, 'live');
  assert.equal(viewLog.mounted(engine) - mounted, 1, 'the next show mounts it');
  r.turn(() => r.h.b!.show());
  await r.settle();
  assert.deepEqual([r.state('a').status, r.seen('a')?.['data-hidden'], viewLog.unmounted(engine) - unmounted], ['parked', 'true', 0], 'and the park after that keeps the view mounted and hidden');
});

test('case B11: keepMounted true to false on a hidden kept panel unmounts it in the commit, and its picture and view state are untouched', async () => {
  const r = await matrixRig({ ids: ['a', 'b'], settings: { b: { keepMounted: true } } });
  await r.settle();
  const engine = r.entry('b').id;
  viewLog.setState(engine, 7);
  r.turn(() => r.h.b!.hide());
  await r.settle();
  assert.deepEqual([r.seen('b')?.['data-hidden'], r.seen('b')?.['data-n']], ['true', '7'], 'the hidden panel is mounted and holds its state');
  assert.deepEqual([...r.capture.captured], [engine], 'its park asked for a picture');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ keepMounted: false }))), { now: [], later: ['keepMounted'], shadowed: [] });
  await frames(2);
  assert.deepEqual([r.seen('b'), viewLog.unmounted(engine)], [null, 1], 'unmounted at once: two frames, far short of a slide');
  assert.deepEqual([r.capture.captured.length, r.capture.evicted.length], [1, 0], 'the picture was neither retaken nor evicted');
  r.turn(() => r.h.b!.show());
  await r.settle();
  assert.equal(r.seen('b')?.['data-n'], '7', 'the view state survived');
});

test('case B12: keepMounted true during a park exit does not keep the exiting view: it still unmounts when the exit ends', async () => {
  const r = await matrixRig({ ids: ['a', 'b'] });
  await r.settle();
  const engine = r.entry('b').id;
  r.turn(() => r.h.b!.hide());
  await frames(2);
  assert.equal(slotAt(r, engine) !== null, true, 'the exit is under way');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ keepMounted: true }))), { now: [], later: ['keepMounted'], shadowed: [] });
  await r.settle();
  assert.deepEqual([r.seen('b'), viewLog.unmounted(engine)], [null, 1], 'the exiting view unmounted');
});

test('case B13: keepMounted true beside viewState reset-on-park is a settings-conflict, and keeping the state in the same call is accepted', async () => {
  const r = await matrixRig({ settings: { b: { viewState: 'reset-on-park' } } });
  const entries = r.m.latest().entries;
  const refusal = refusedWith(r.turn(() => r.h.b!.configure({ keepMounted: true })), 'settings-conflict');
  assert.equal(refusal.setting, 'keepMounted');
  assert.match(refusal.message, /C6/);
  assert.equal(r.m.latest().entries === entries, true);
  assert.equal(done(r.turn(() => r.h.b!.configure({ keepMounted: true, viewState: 'keep' }))).changed, true);
  assert.deepEqual([r.state('b').settings.keepMounted, r.state('b').settings.viewState], [true, 'keep']);
});

test('case B14: viewState keep to reset-on-park on a parked panel reaches the next park only', async () => {
  const r = await matrixRig({ ids: ['a', 'b'] });
  await r.settle();
  viewLog.setState(r.entry('b').id, 7);
  r.turn(() => r.h.b!.hide());
  await r.settle();
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ viewState: 'reset-on-park' }))), { now: [], later: ['viewState'], shadowed: [] });
  r.turn(() => r.h.b!.show());
  await r.settle();
  assert.equal(r.seen('b')?.['data-n'], '7', 'the park that already happened kept the cell');
  r.turn(() => r.h.b!.hide());
  await r.settle();
  r.turn(() => r.h.b!.show());
  await r.settle();
  assert.equal(r.seen('b')?.['data-n'], '0', 'the next park released it');
});

test('case B15: viewState reset-on-park to keep on a parked panel reaches the next park only', async () => {
  const r = await matrixRig({ ids: ['a', 'b'], settings: { b: { viewState: 'reset-on-park' } } });
  await r.settle();
  viewLog.setState(r.entry('b').id, 7);
  r.turn(() => r.h.b!.hide());
  await r.settle();
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ viewState: 'keep' }))), { now: [], later: ['viewState'], shadowed: [] });
  r.turn(() => r.h.b!.show());
  await r.settle();
  assert.equal(r.seen('b')?.['data-n'], '0', 'the park that already happened released the cell');
  viewLog.setState(r.entry('b').id, 3);
  r.turn(() => r.h.b!.hide());
  await r.settle();
  r.turn(() => r.h.b!.show());
  await r.settle();
  assert.equal(r.seen('b')?.['data-n'], '3', 'the next park keeps it');
});

void act;
void mockWindow;
void thrownCode;
