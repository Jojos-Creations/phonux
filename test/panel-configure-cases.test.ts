/**
 * The literal transition cases for configure, each a before value and an after value written out by hand: closable and
 * parkable first, then placement, holds, overflow and scrolling, then the edge scroll rows, the
 * root column and the protected-panel and side-effect cases. One test each, so a red one names the transition it pins.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import type { ConfigureResult } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag } from './support/drag-gesture.js';
import {
  EDGE_WINDOW,
  HALF_ZONE_POINTER,
  LIBRARY_TUNING_DEFAULTS,
  dragRig,
  done,
  heldScroll,
  hold,
  letter,
  lift,
  matrixRig,
  matrixTemplate,
  mockWindow,
  pressAndMove,
  refusedWith,
  soft,
  viewLog,
  type MatrixRig,
} from './support/configure-matrix.js';

afterEach(async () => {
  // A test that left the pointer down must not leave motion's window listeners live for the next one.
  document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  await advanceFrames(5 * 16);
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
const summaryOf = (r: MatrixRig, name: string) => r.provided().panelList.find((s) => s.id === r.entry(name).key);
const thrownCode = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};
const slotAt = (r: MatrixRig, engineId: string): HTMLElement | null => r.m.container.querySelector<HTMLElement>(`[data-slot="${engineId}"]`)?.closest<HTMLElement>('[data-row-slot]') ?? null;

function parkPanelsFit(r: MatrixRig): boolean {
  const n = r.m.latest().rowNumbers;
  if (!Number.isFinite(n.windowWidth) || n.parkLiveWidths.length <= 1) return true;
  const gap = r.ws.tuning.rowGap;
  const used = [...n.reservedWidths, ...n.parkLiveWidths].reduce((sum, w) => sum + w, 0) + (n.reservedWidths.length + n.parkLiveWidths.length - 1) * gap;
  return used <= n.windowWidth;
}

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
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
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

test('case A5: parkable true to false on a live phone panel: listed, draggable, placeable and clearable re-derive false at the commit unless named, the settled row fits, a resizable true beside it stands and a measured park row accepts it', async () => {
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
  assert.deepEqual(shape(named.turn(() => named.h.a!.configure({ parkable: false, resizable: true }))), { now: ['parkable', 'resizable'], later: [], shadowed: [] });
  assert.deepEqual([named.state('a').settings.parkable, named.state('a').settings.resizable], [false, true], 'a resizable true the panel asked for beside its fixed column stands');
});

test('case A6: parkable true to false on a two-slot panel is slots-above-max and changes nothing', async () => {
  const r = await matrixRig();
  r.turn(() => r.h.b!.setSlots(2, 'person'));
  const entries = r.m.latest().entries;
  const renders = r.m.renders();
  refusedWith(r.turn(() => r.h.b!.configure({ parkable: false })), 'slots-above-max');
  assert.deepEqual([r.m.latest().entries === entries, r.m.renders(), r.entry('b').collapsible, r.entry('b').slots], [true, renders, true, 2]);
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

test('case B2: placeOnAdd changed on a live panel moves nothing', async () => {
  const r = await matrixRig();
  const entries = r.m.latest().entries;
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ placeOnAdd: 'row-start' }))), { now: [], later: ['placeOnAdd'], shadowed: [] });
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
  assert.deepEqual([r.state('a').status, r.live().join(' ')], ['parked', 'root b c'], 'opening a second park panel overflows the row: the oldest park panel, a, goes');
});

test('case B8: scrollOnOpen none on a live panel: the next open does not scroll', async () => {
  const opened = async (none: boolean): Promise<number> => {
    const r = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e'], width: 1000, workspace: { tuning: { rowGesture: 'step' } } });
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

const ZONE = LIBRARY_TUNING_DEFAULTS.edgeScroll.zonePx;
const QUARTER = ZONE / 4;

test('edge scroll 3: tuning.edgeScroll zonePx from the default to a quarter of it through configure(id): half the default zone from the edge scrolls under the default and not after the change', async () => {
  const r = await dragRig();
  assert.equal(HALF_ZONE_POINTER, EDGE_WINDOW - ZONE / 2);
  assert.equal((await heldScroll(r, 's1', HALF_ZONE_POINTER)) > 0, true, 'positive control: under the default zone the pointer is inside the band');
  await r.settle();
  assert.deepEqual(shape(r.turn(() => r.h.s1!.configure({ tuning: { edgeScroll: { zonePx: QUARTER } } }))), { now: [], later: ['tuning.edgeScroll'], shadowed: [] });
  const at = r.m.container.scrollLeft;
  await r.settle();
  assert.equal(r.m.container.scrollLeft, at, 'nothing scrolls at configure');
  assert.equal(await heldScroll(r, 's1', HALF_ZONE_POINTER), 0, 'after the change the same pointer is outside a quarter-width band');
  assert.equal(QUARTER, 12);
});

test('edge scroll 4: a drag in flight keeps the edge numbers it began with', async () => {
  const r = await dragRig();
  await pressAndMove(r, 's1', HALF_ZONE_POINTER);
  await hold(1);
  const a = r.m.container.scrollLeft;
  await hold(10);
  const b = r.m.container.scrollLeft;
  done(r.turn(() => r.h.s1!.configure({ tuning: { edgeScroll: { zonePx: QUARTER } } })));
  await hold(10);
  const c = r.m.container.scrollLeft;
  assert.equal(b - a > 0, true, 'control: scrolling');
  assert.equal(Math.abs(c - b - (b - a)) < 1e-6, true, `the pace after the change equals the pace before it (${b - a} then ${c - b})`);
  await lift(HALF_ZONE_POINTER);
});

test('edge scroll 5: configureTuning sets the default zone for panels without a leaf, a panel leaf wins, and null removes the leaf', async () => {
  const r = await dragRig();
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ edgeScroll: { zonePx: QUARTER } }))) }, { ok: true, changed: true, shown: false, now: [], later: ['tuning.edgeScroll'], shadowed: [], notes: [] });
  assert.equal(await heldScroll(r, 's3', HALF_ZONE_POINTER), 0, 'a panel with no leaf reads the new workspace default');
  done(r.turn(() => r.h.s1!.configure({ tuning: { edgeScroll: { zonePx: ZONE } } })));
  assert.equal((await heldScroll(r, 's1', HALF_ZONE_POINTER)) > 0, true, "a panel's own leaf wins over the workspace default");
  done(r.turn(() => r.h.s1!.configure({ tuning: { edgeScroll: null } } as never)));
  assert.equal(r.h.s1!.getSettings().source['tuning.edgeScroll'], 'workspace', 'null removed the leaf');
  assert.equal(await heldScroll(r, 's1', HALF_ZONE_POINTER), 0, 'so the panel reads the workspace default again');
  done(r.turn(() => r.ws.panels.configureTuning({ edgeScroll: null } as never)));
  assert.equal((await heldScroll(r, 's3', HALF_ZONE_POINTER)) > 0, true, 'null at the workspace puts the library default back');
});

test('edge scroll 6: a hidden panel and an engine-parked panel store the tuning, and it applies when the panel is next dragged', async () => {
  const hidden = await dragRig();
  hidden.turn(() => hidden.h.s3!.hide());
  await hidden.settle();
  assert.deepEqual(shape(hidden.turn(() => hidden.h.s3!.configure({ tuning: { edgeScroll: { zonePx: QUARTER } } }))), { now: [], later: ['tuning.edgeScroll'], shadowed: [] });
  assert.deepEqual([hidden.state('s3').status, hidden.h.s3!.getSettings().value.tuning.edgeScroll.zonePx], ['parked', QUARTER], 'stored on the hidden panel');
  hidden.turn(() => hidden.h.s3!.show());
  await hidden.settle();
  assert.equal(await heldScroll(hidden, 's3', HALF_ZONE_POINTER), 0, 'shown again, its quarter-width zone leaves the pointer outside the band');
  const parked = await dragRig({ park: true });
  const away = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'].find((name) => parked.state(name).status === 'parked' && !parked.state(name).held);
  assert.notEqual(away, undefined, 'the engine parked some panels for room');
  assert.deepEqual(shape(parked.turn(() => parked.h[away!]!.configure({ tuning: { edgeScroll: { zonePx: QUARTER } } }))), { now: [], later: ['tuning.edgeScroll'], shadowed: [] });
  assert.deepEqual([parked.state(away!).status, parked.h[away!]!.getSettings().value.tuning.edgeScroll.zonePx], ['parked', QUARTER], 'stored on the parked panel, which stays parked');
});

test('root column 1: closable, parkable, draggable and placeable true on the root are each a settings-conflict naming the key and rule C5, with no forcedBy', async () => {
  const r = await matrixRig();
  const entries = r.m.latest().entries;
  const renders = r.m.renders();
  let executed = 0;
  for (const key of ['closable', 'parkable', 'draggable', 'placeable'] as const) {
    const refusal = refusedWith(r.turn(() => r.ws.panels.configure(r.ws.rootId, { [key]: true } as never)), 'settings-conflict');
    assert.equal(refusal.setting, key, `${key}: the result names the asked key`);
    assert.match(refusal.message, /C5/, `${key}: the message names rule C5`);
    assert.doesNotMatch(refusal.message, /because of/, `${key}: and names no forcing key`);
    executed += 1;
  }
  assert.equal(executed, 4);
  assert.deepEqual([r.m.latest().entries === entries, r.m.renders()], [true, renders], 'the root was not touched');
});

test('root column 2: resizable true on the root stands, the size settings being asked for the root itself', async () => {
  const r = await matrixRig();
  assert.equal(r.state(r.ws.rootId).settings.resizable, false, 'before: a fixed column is not resizable');
  assert.equal(shape(r.turn(() => r.ws.panels.configure(r.ws.rootId, { resizable: true }))).now[0], 'resizable');
  assert.equal(r.state(r.ws.rootId).settings.resizable, true);
});

type Cell = { reply: 'would-reshape-row' | 'is-closed' | 'shown' | 'deferred' | 'stored'; fixed: boolean };
const PIN_CELLS: readonly { value: unknown; parked: Cell; hidden: Cell; closed: Cell }[] = [
  { value: 'place-only', parked: { reply: 'would-reshape-row', fixed: false }, hidden: { reply: 'would-reshape-row', fixed: false }, closed: { reply: 'is-closed', fixed: false } },
  { value: 'refuse', parked: { reply: 'would-reshape-row', fixed: false }, hidden: { reply: 'would-reshape-row', fixed: false }, closed: { reply: 'is-closed', fixed: false } },
  { value: 'show', parked: { reply: 'shown', fixed: true }, hidden: { reply: 'shown', fixed: true }, closed: { reply: 'is-closed', fixed: false } },
  { value: 'apply-on-next-show', parked: { reply: 'deferred', fixed: false }, hidden: { reply: 'deferred', fixed: false }, closed: { reply: 'stored', fixed: false } },
  { value: { parked: 'show', hidden: 'refuse', closed: 'apply-on-next-show' }, parked: { reply: 'shown', fixed: true }, hidden: { reply: 'would-reshape-row', fixed: false }, closed: { reply: 'stored', fixed: false } },
  { value: { parked: 'apply-on-next-show', hidden: 'show', closed: 'refuse' }, parked: { reply: 'deferred', fixed: false }, hidden: { reply: 'shown', fixed: true }, closed: { reply: 'is-closed', fixed: false } },
];

test('root column 3: pinningWhenNotLive over its four values and the per-status object decides what configure(parkable false) answers on a parked, hidden, closed declared and undo-window panel', async () => {
  const s = soft();
  let executed = 0;
  for (const cell of PIN_CELLS) {
    const label = JSON.stringify(cell.value);
    const settings = { a: { pinningWhenNotLive: cell.value } } as never;
    const check = (name: string, expected: Cell, r: MatrixRig, res: ConfigureResult, id: string): void => {
      if (expected.reply === 'would-reshape-row' || expected.reply === 'is-closed') {
        refusedWith(res, expected.reply);
        assert.equal(r.state(id).settings.parkable, true, `${name}: nothing changed`);
        return;
      }
      const ok = done(res);
      if (expected.reply === 'shown') {
        assert.deepEqual([ok.shown, r.state(id).status, r.state(id).settings.parkable], [true, 'live', false], `${name}: the show path ran and the flip applied in the same commit`);
      } else if (expected.reply === 'deferred') {
        assert.deepEqual([ok.shown, r.state(id).status, r.state(id).deferredPin], [false, 'parked', { parkable: false }], `${name}: stored as deferredPin { parkable }`);
      } else {
        assert.equal(r.state(id).status, 'closed', `${name}: stays closed, the edit stored on the record`);
      }
    };
    await s.run(`${label} on an engine-parked panel`, async () => {
      executed += 1;
      const r = await matrixRig({ ids: ['a', 'b', 'c'], park: true, width: 1000, settings });
      await r.settle();
      assert.deepEqual([r.state('a').status, r.state('a').held], ['parked', false]);
      // The panel is a park panel, so the flip names overflow scroll too: a fixed column forces it, and a template ask of park would be a conflict.
      check('K', cell.parked, r, r.turn(() => r.h.a!.configure({ parkable: false, overflow: 'scroll' })), 'a');
      r.m.unmount();
    });
    await s.run(`${label} on a hidden panel`, async () => {
      executed += 1;
      const r = await matrixRig({ settings });
      r.turn(() => r.h.a!.hide());
      await r.settle();
      assert.deepEqual([r.state('a').status, r.state('a').held], ['parked', true]);
      check('H', cell.hidden, r, r.turn(() => r.h.a!.configure({ parkable: false })), 'a');
      r.m.unmount();
    });
    await s.run(`${label} on a closed declared panel`, async () => {
      executed += 1;
      const r = await matrixRig({ settings });
      try {
        const w = mockWindow();
        r.turn(() => r.h.a!.close());
        w.pastWindow();
        check('C', cell.closed, r, r.turn(() => r.h.a!.configure({ parkable: false })), 'a');
      } finally {
        mock.timers.reset();
        r.m.unmount();
      }
    });
    await s.run(`${label} on a panel in the undo window`, async () => {
      executed += 1;
      const r = await matrixRig({ settings });
      r.turn(() => r.h.a!.close());
      check('U', cell.closed, r, r.turn(() => r.h.a!.configure({ parkable: false })), 'a');
      r.m.unmount();
    });
  }
  assert.equal(executed, PIN_CELLS.length * 4, 'every value ran in each of the four statuses');
  s.end();
});

test('protected 4: resetLayout slot growth in a park row parks the fewest park panels and lists them', async () => {
  const r = await matrixRig({ ids: ['a', 'b', 'c'], park: true, width: 1700 });
  await r.settle();
  assert.equal(r.live().join(' '), 'root a b c');
  done(r.turn(() => r.h.b!.configure({ slots: 2 })));
  assert.equal(r.live().join(' '), 'root a b c', 'configure resizes nothing');
  const reset = r.turn(() => r.ws.panels.resetLayout('b'));
  await r.settle();
  assert.deepEqual({ ...reset }, { ok: true, changed: true, panels: ['b'], parked: ['a'], returned: [] }, 'a 768 px b leaves room for one more 390 px panel: the leftmost of the others goes');
  assert.deepEqual([r.entry('b').slots, r.state('a').status, r.live().join(' ')], [2, 'parked', 'root c b']);
});

test('protected 8: rowGap re-prices the row in the commit of the call and takes every panel\'s slot with it', async () => {
  const r = await matrixRig();
  await r.settle();
  const x = (name: string): number => {
    const match = /translateX\((-?[\d.]+)px\)/.exec(slotAt(r, r.entry(name).id)?.style.transform ?? '');
    return match === null ? 0 : Number(match[1]);
  };
  assert.deepEqual(['a', 'b', 'c'].map(x), [406, 812, 1218]);
  const renders = r.m.renders();
  done(r.turn(() => r.ws.panels.configureTuning({ rowGap: 0 })));
  assert.equal(r.m.renders() - renders, 1, 'one commit');
  assert.equal(r.m.latest().rowNumbers.stripWidth, 4 * 390, 'priced at gap 0 in that commit');
  await r.settle();
  assert.deepEqual(['a', 'b', 'c'].map(x), [390, 780, 1170], 'every slot rests one panel width apart');
});
