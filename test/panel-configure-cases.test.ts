/**
 * The literal transition cases for configure, each a before value and an after value written out by hand: closable and
 * parkable first, then placement, holds, overflow and scrolling, then the edge scroll rows, the
 * root column and the protected-panel and side-effect cases. One test each, so a red one names the transition it pins.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { rowOffsetOf } from './support/strip.js';
import type { ConfigureResult } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag } from './support/drag-gesture.js';
import { slotTransform } from './support/strip.js';
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
  assert.deepEqual([r.seen('b')?.['data-close'], !r.state('b').settings.closable, r.state('b').settings.clearable], ['true', false, true]);
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ closable: false }))), { now: ['closable'], later: [], shadowed: [] });
  assert.equal(r.seen('b')?.['data-close'], 'false', 'the view is no longer offered the close control');
  assert.equal(letter(r.turn(() => r.h.b!.close('person'))), 'not-closable');
  assert.equal(!r.state('b').settings.closable, true, 'History offers no trash for it');
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
  assert.deepEqual([r.state('b').status, !r.entry('b').settings!.closable, r.order().join(' ')], ['live', true, 'root a b c']);
  assert.equal(letter(r.turn(() => r.h.b!.close('person'))), 'not-closable', 'undo restored it unclosable');
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

test('case A5: parkable true to false on a live phone panel: listed, movable and clearable re-derive false at the commit unless named, the settled row fits, a resizable true beside it stands and a measured park row accepts it', async () => {
  const r = await matrixRig({ ids: ['a', 'b', 'c'], settings: { a: { overflow: 'park' }, c: { overflow: 'park' } }, width: 1700 });
  await r.settle();
  assert.equal(r.live().join(' '), 'root a b c');
  const facts = (name: string): unknown[] => {
    const s = r.state(name);
    return [s.settings.parkable, s.listed, s.settings.movable, s.settings.clearable];
  };
  assert.deepEqual(facts('b'), [true, true, true, true]);
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ parkable: false }))), { now: ['parkable'], later: [], shadowed: [] }, 'a measured row holding park panels accepts it: no refusal for room');
  assert.deepEqual(facts('b'), [false, false, false, false], 'all three re-derived at the commit');
  await r.settle();
  assert.equal(parkPanelsFit(r), true, 'the settled row fits the window beside the new fixed column');
  assert.equal(r.state('b').status, 'live', 'the fixed column is live');
  const named = await matrixRig();
  assert.deepEqual(shape(named.turn(() => named.h.b!.configure({ parkable: false, listed: true }))), { now: ['parkable', 'listed'], later: [], shadowed: [] });
  assert.deepEqual([named.state('b').settings.parkable, named.state('b').listed, named.state('b').settings.movable], [false, true, false], 'a named key keeps its value');
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
    return [s.settings.parkable, s.listed, s.settings.movable, s.settings.clearable];
  };
  assert.deepEqual([facts(), r.entry('b').collapsible, r.provided().fixedViewCount], [[false, false, false, false], false, 2], 'before: a fixed column');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ parkable: true }))), { now: ['parkable'], later: [], shadowed: [] });
  assert.deepEqual([facts(), r.entry('b').collapsible, r.provided().fixedViewCount], [[true, true, true, true], true, 1], 'after: C1 is lifted and the derived keys follow parkable');
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

const ZONE = LIBRARY_TUNING_DEFAULTS.edgeScroll.zonePx;
const QUARTER = ZONE / 4;

test('edge scroll 6: a panel carries no tuning, so configure(id, { tuning }) is wrong-scope on a live, a hidden and a parked panel alike and a resolved panel holds none', async () => {
  const r = await dragRig();
  r.turn(() => r.h.s3!.hide());
  await r.settle();
  for (const name of ['s1', 's3']) {
    const answer = r.turn(() => r.h[name]!.configure({ tuning: { edgeScroll: { zonePx: QUARTER } } } as never));
    assert.equal(answer.ok, false, name);
    assert.equal((answer as { code?: string }).code, 'wrong-scope', name);
    assert.equal('tuning' in r.h[name]!.getSettings().value, false, `${name} holds no tuning`);
  }
});

test('root column 1: closable and parkable true on the root are each a settings-conflict naming the key and rule C5, with no forcedBy', async () => {
  const r = await matrixRig();
  const entries = r.m.latest().entries;
  const renders = r.m.renders();
  let executed = 0;
  for (const key of ['closable', 'parkable'] as const) {
    const refusal = refusedWith(r.turn(() => r.ws.panels.configure(r.ws.rootId, { [key]: true } as never)), 'settings-conflict');
    assert.equal(refusal.setting, key, `${key}: the result names the asked key`);
    assert.match(refusal.message, /C5/, `${key}: the message names rule C5`);
    assert.doesNotMatch(refusal.message, /because of/, `${key}: and names no forcing key`);
    executed += 1;
  }
  assert.equal(executed, 2);
  assert.deepEqual([r.m.latest().entries === entries, r.m.renders()], [true, renders], 'the root was not touched');
});

test('root column 2: resizable true on the root stands, the size settings being asked for the root itself', async () => {
  const r = await matrixRig();
  assert.equal(r.state(r.ws.rootId).settings.resizable, false, 'before: a fixed column is not resizable');
  assert.equal(shape(r.turn(() => r.ws.panels.configure(r.ws.rootId, { resizable: true }))).now[0], 'resizable');
  assert.equal(r.state(r.ws.rootId).settings.resizable, true);
});

type Cell = { reply: 'would-reshape-row' | 'is-closed' };
const FLIP_CELLS: readonly { parked: Cell; hidden: Cell; closed: Cell }[] = [{ parked: { reply: 'would-reshape-row' }, hidden: { reply: 'would-reshape-row' }, closed: { reply: 'is-closed' } }];

test('protected 8: rowGap re-prices the row in the commit of the call and takes every panel\'s slot with it', async () => {
  const r = await matrixRig();
  await r.settle();
  const x = (name: string): number => {
    const match = /translateX\((-?[\d.]+)px\)/.exec((() => { const s = slotAt(r, r.entry(name).id); return s === null || s === undefined ? '' : slotTransform(s); })());
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
