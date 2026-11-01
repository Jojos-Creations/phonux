/**
 * A pin change a panel that is not live waits with: how it is stored and replaced, every path that makes the panel live
 * and applies it, what clears or drops it, that it is never saved, and what a person's pin records beside a code pin's.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import type { PanelSettings, Pinning, PinningWhenNotLive, SettingNote } from '../index.js';
import { memoryWorkspaceStorage } from '../fakeHost.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { brief } from './support/ops-rig.js';
import { pinRig, type PinRig } from './support/pin-rig.js';
import { rowScrollerFor } from './support/workspace-row.js';

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

const PLACE: Pinning = { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } };
const FIX: Pinning = { pinned: { placement: 'row-start', parkable: false }, unpinned: { placement: 'row-end', parkable: true } };
const PAIR: Pinning = { pinned: { parkable: false }, unpinned: { parkable: true } };
const IDS = ['a', 'b', 'c', 'd', 'e'];

/** Five park panels at 1000 px: root and e are live, a to d are engine-parked. */
async function rig(when: PinningWhenNotLive, pinning: Pinning = PLACE, own: Record<string, PanelSettings> = {}): Promise<PinRig> {
  const park = (id: string): PanelSettings => ({ overflow: 'park', pinning, pinningWhenNotLive: when, ...(own[id] ?? {}) });
  const r = await pinRig({ ids: IDS, width: 1000, settings: Object.fromEntries(IDS.map((id) => [id, park(id)])) });
  await r.settle();
  return r;
}
const deferral = (r: PinRig, id: string): unknown => r.state(id).deferredPin;
const quiet = { tuning: { saveQuietMs: 5 } };
const wait = (): Promise<void> => act(async () => void (await new Promise((done) => setTimeout(done, 80))));

// ---------------------------------------------------------------------------
// Storing, replacing and canceling
// ---------------------------------------------------------------------------

test('apply-on-next-show on a parked panel stores a deferral and changes nothing else: the row, the status and the permissions stay', async () => {
  const r = await rig('apply-on-next-show');
  const entries = r.m.latest().entries.map((p) => ({ id: p.id, live: p.live, collapsible: p.collapsible }));
  const result = r.turn(() => r.h.b!.pin());
  assert.deepEqual({ ok: result.ok, changed: result.ok && result.changed, deferred: (result as { deferred?: boolean }).deferred }, { ok: true, changed: true, deferred: true });
  assert.deepEqual(deferral(r, 'b'), { by: 'pin' });
  assert.deepEqual(r.m.latest().entries.map((p) => ({ id: p.id, live: p.live, collapsible: p.collapsible })), entries);
  assert.equal(r.state('b').pinned, false, 'the definition is not applied yet');
  assert.equal(r.order().join(' '), 'root a b c d e');
});

test('the last call wins: pin then unpin leaves unpin waiting, and a repeat of the waiting call is changed:false', async () => {
  const r = await rig('apply-on-next-show');
  r.turn(() => r.h.b!.pin());
  const again = r.turn(() => r.h.b!.pin());
  assert.deepEqual([again.ok, again.ok && again.changed], [true, false]);
  assert.deepEqual(deferral(r, 'b'), { by: 'pin' });
  r.turn(() => r.h.b!.unpin());
  assert.deepEqual(deferral(r, 'b'), { by: 'unpin' }, 'unpin replaces pin');
  const repeat = r.turn(() => r.h.b!.unpin());
  assert.deepEqual([repeat.ok, repeat.ok && repeat.changed], [true, false]);
  r.turn(() => r.h.b!.pin());
  assert.deepEqual(deferral(r, 'b'), { by: 'pin' }, 'and pin replaces unpin again');
});

test('a deferral is per panel: a deferral on one leaves the others without one', async () => {
  const r = await rig('apply-on-next-show');
  r.turn(() => r.h.b!.pin());
  assert.deepEqual(IDS.map((id) => deferral(r, id)), [null, { by: 'pin' }, null, null, null]);
});

test('a call whose result equals what the panel reads now cancels the deferral', async () => {
  const r = await rig('apply-on-next-show', PAIR, { b: { overflow: 'scroll' } });
  r.turn(() => r.h.b!.hide());
  assert.equal(r.state('b').pinned, false);
  r.turn(() => r.h.b!.pin());
  assert.deepEqual(deferral(r, 'b'), { by: 'pin' });
  const cancelled = r.turn(() => r.h.b!.unpin()) as { ok: boolean; deferred?: boolean };
  assert.deepEqual([cancelled.ok, cancelled.deferred === true, deferral(r, 'b')], [true, false, null], 'unpin equals the unpinned read');
});

// ---------------------------------------------------------------------------
// Every path that makes the panel live applies it
// ---------------------------------------------------------------------------

const APPLIED = 'applied inside the update that makes the panel live';

test(`show() ${APPLIED}: the panel lands at row-start and the deferral is gone`, async () => {
  const r = await rig('apply-on-next-show');
  r.turn(() => r.h.b!.pin());
  assert.equal(brief(r.turn(() => r.h.b!.show())), 'T');
  await r.settle();
  assert.deepEqual([r.state('b').status, r.state('b').pinned, deferral(r, 'b')], ['live', true, null]);
  assert.equal(r.order().join(' '), 'b root a c d e');
});

test(`a History click (activate) ${APPLIED}`, async () => {
  const r = await rig('apply-on-next-show');
  r.turn(() => r.h.b!.pin());
  r.turn(() => r.provided().activate(r.entry('b').id));
  await r.settle();
  assert.deepEqual([r.state('b').status, r.state('b').pinned, deferral(r, 'b')], ['live', true, null]);
  assert.equal(r.order().join(' '), 'b root a c d e');
});

test(`the Host-bag activate ${APPLIED}: the same call a view makes through the fake host`, async () => {
  const r = await rig('apply-on-next-show');
  r.turn(() => r.h.c!.pin());
  r.turn(() => void r.provided().activate(r.entry('c').id));
  await r.settle();
  assert.deepEqual([r.state('c').pinned, deferral(r, 'c')], [true, null]);
  assert.equal(r.order().join(' '), 'c root a b d e');
});

test(`the row gesture ${APPLIED}: a swipe toward the parked panel lands it first, then parks against the row it made`, async () => {
  const r = await rig('apply-on-next-show');
  r.turn(() => r.h.d!.pin());
  r.turn(() => r.h.b!.pin());
  mock.timers.enable({ apis: ['setTimeout'] });
  act(() => void r.m.container.dispatchEvent(new WheelEvent('wheel', { cancelable: true, bubbles: true, deltaX: -50 })));
  await advanceFrames(500);
  act(() => mock.timers.tick(400));
  assert.deepEqual(r.live(), ['d', 'root']);
  assert.deepEqual([r.state('d').pinned, deferral(r, 'd')], [true, null]);
  assert.deepEqual(deferral(r, 'b'), { by: 'pin' }, 'the panel the gesture did not reveal keeps its deferral');
  assert.equal(r.order().join(' '), 'd root a b c e');
});

test(`the automatic return ${APPLIED}: room appears, the parked panel returns, already landed`, async () => {
  const r = await rig('apply-on-next-show');
  r.turn(() => r.h.d!.pin());
  r.turn(() => r.h.b!.pin());
  r.turn(() => r.h.e!.close());
  await r.settle();
  assert.deepEqual(r.live(), ['d', 'root']);
  assert.deepEqual([r.state('d').pinned, deferral(r, 'd')], [true, null]);
  assert.deepEqual(deferral(r, 'b'), { by: 'pin' }, 'the panel that stayed parked keeps its deferral');
});

test(`undo ${APPLIED}`, async () => {
  const r = await rig('apply-on-next-show');
  r.turn(() => r.h.e!.close());
  await r.settle();
  assert.equal(brief(r.turn(() => r.h.e!.pin())), 'T');
  assert.deepEqual(deferral(r, 'e'), { by: 'pin' }, 'a closed declared panel stores it on its record');
  r.turn(() => r.provided().undoClose());
  await r.settle();
  assert.deepEqual([r.state('e').status, r.state('e').pinned, deferral(r, 'e')], ['live', true, null]);
  assert.equal(r.order().join(' '), 'e root a b c d');
});

test(`open() ${APPLIED}`, async () => {
  const r = await rig('apply-on-next-show');
  r.turn(() => r.h.e!.close());
  await advanceFrames(9000);
  assert.equal(r.state('e').status, 'closed');
  r.turn(() => r.h.e!.pin());
  assert.deepEqual(deferral(r, 'e'), { by: 'pin' });
  assert.equal(brief(r.turn(() => r.h.e!.open())), 'T');
  await r.settle();
  assert.deepEqual([r.state('e').status, r.state('e').pinned, deferral(r, 'e')], ['live', true, null]);
  assert.equal(r.order().join(' '), 'e root a b c d');
});

test('a deferred unpin applies the same way: a pinned panel parked, unpinned while parked, shown unpinned', async () => {
  const r = await rig('apply-on-next-show');
  r.turn(() => r.h.c!.pin());
  r.turn(() => r.h.c!.show());
  await r.settle();
  assert.equal(r.state('c').pinned, true);
  r.turn(() => r.h.c!.hide());
  r.turn(() => r.h.c!.unpin());
  assert.deepEqual(deferral(r, 'c'), { by: 'unpin' });
  r.turn(() => r.h.c!.show());
  await r.settle();
  assert.deepEqual([r.state('c').pinned, deferral(r, 'c')], [false, null]);
  assert.equal(r.order().join(' '), 'root a b d e c');
});

// ---------------------------------------------------------------------------
// live is normalized when a fixing pin lands
// ---------------------------------------------------------------------------

test('a deferred parkable:false applied through open() or undo leaves the panel live, never parked and fixed', async () => {
  for (const path of ['open', 'undo'] as const) {
    const r = await pinRig({ ids: ['a', 'b'], settings: { b: { pinning: FIX, pinningWhenNotLive: 'apply-on-next-show', overflow: 'scroll' } } });
    if (path === 'undo') {
      r.turn(() => r.h.b!.hide());
      assert.equal(r.entry('b').live, false, 'undo: the record is closed while hidden, so it holds live false');
    }
    r.turn(() => r.h.b!.close());
    if (path === 'open') await advanceFrames(9000);
    else await r.settle();
    r.turn(() => r.h.b!.pin());
    assert.deepEqual(deferral(r, 'b'), { by: 'pin' }, path);
    if (path === 'open') r.turn(() => r.h.b!.open());
    else r.turn(() => r.provided().undoClose());
    await r.settle();
    assert.equal(r.entry('b').live, true, `${path}: live`);
    assert.deepEqual([r.facts('b').parkable, r.state('b').status, r.state('b').pinned], [false, 'live', true], path);
    assert.equal(r.order().join(' '), 'b root a', path);
    assert.equal(brief(r.turn(() => r.h.b!.show())), 'F', `${path}: show() has nothing left to do`);
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// What clears or drops it
// ---------------------------------------------------------------------------

test('a live pin clears a waiting deferral: shown by the per-status table, the deferral is gone', async () => {
  const r = await rig({ parked: 'apply-on-next-show', hidden: 'show' });
  r.turn(() => r.h.b!.pin());
  assert.deepEqual(deferral(r, 'b'), { by: 'pin' });
  r.turn(() => r.h.b!.hide());
  assert.deepEqual([r.state('b').status, r.state('b').held, deferral(r, 'b')], ['parked', true, { by: 'pin' }]);
  const shown = r.turn(() => r.h.b!.unpin()) as { ok: boolean; shown?: boolean };
  assert.deepEqual([shown.ok, shown.shown], [true, true]);
  assert.deepEqual([r.state('b').status, deferral(r, 'b')], ['live', null]);
  assert.equal(r.state('b').pinned, false, 'the live unpin won, not the older pin');
});

test('a deferral that no longer passes its re-check is dropped with a note and the show still happens', async () => {
  const r = await pinRig({ ids: IDS, width: 1000, settings: { a: { overflow: 'scroll', pinning: FIX, pinningWhenNotLive: { hidden: 'apply-on-next-show' } } } });
  r.turn(() => r.h.a!.hide());
  r.turn(() => r.h.a!.pin());
  assert.deepEqual(deferral(r, 'a'), { by: 'pin' });
  r.turn(() => r.h.a!.setSlots(2));
  r.turn(() => r.h.a!.show());
  assert.deepEqual([r.state('a').status, deferral(r, 'a'), r.state('a').pinned], ['live', null, false]);
  const dropped: SettingNote[] = r.m.notes.filter((n) => n.code === 'deferred-pin-dropped');
  assert.equal(dropped.length, 1);
  assert.match(dropped[0]!.message, /wider than one slot/);
});

test('a closed record with a deferral drops it the same way when the slot count no longer fits', async () => {
  const r = await pinRig({ ids: ['a', 'b'], settings: { b: { overflow: 'scroll', pinning: FIX, pinningWhenNotLive: 'apply-on-next-show' } } });
  r.turn(() => r.h.b!.close());
  await advanceFrames(9000);
  r.turn(() => r.h.b!.pin());
  r.turn(() => r.h.b!.open());
  await r.settle();
  assert.deepEqual([r.state('b').status, deferral(r, 'b'), r.state('b').pinned], ['live', null, true], 'open() on a one-slot panel applies it');
});

// ---------------------------------------------------------------------------
// Never saved
// ---------------------------------------------------------------------------

test('a deferral is session only: the saved file holds no deferral and a second launch starts without one', async () => {
  const store = memoryWorkspaceStorage();
  const r = await pinRig({ ids: IDS, width: 1000, workspace: { storage: store, ...quiet }, settings: Object.fromEntries(IDS.map((id) => [id, { overflow: 'park', pinning: PLACE, pinningWhenNotLive: 'apply-on-next-show' } as PanelSettings])) });
  await r.settle();
  r.turn(() => r.h.b!.pin('person'));
  assert.deepEqual(deferral(r, 'b'), { by: 'pin' });
  await wait();
  const saved = await store.load();
  assert.ok(saved !== null, 'positive control: something was saved');
  assert.equal(JSON.stringify(saved).includes('deferredPin'), false);
  r.m.unmount();
  cleanup();
  const second = await pinRig({ ids: IDS, width: 1000, workspace: { storage: store, ...quiet }, settings: Object.fromEntries(IDS.map((id) => [id, { overflow: 'park', pinning: PLACE, pinningWhenNotLive: 'apply-on-next-show' } as PanelSettings])) });
  await second.settle();
  assert.deepEqual(IDS.map((id) => deferral(second, id)), [null, null, null, null, null]);
});

// ---------------------------------------------------------------------------
// The person's pin and a code pin
// ---------------------------------------------------------------------------

const overridesOf = async (store: ReturnType<typeof memoryWorkspaceStorage>): Promise<unknown[]> => ((await store.load())?.panels ?? []).map((p) => p.overrides);

test('a person pin records overrides.parkable, a code pin records nothing, and the next launch keeps the person\'s', async () => {
  const withPair = { c: { pinning: PAIR } };
  const store = memoryWorkspaceStorage();
  const r = await pinRig({ settings: withPair, workspace: { storage: store, ...quiet } });
  r.turn(() => r.h.c!.pin('person'));
  await wait();
  assert.deepEqual(await overridesOf(store), [{}, {}, { parkable: false }]);
  r.m.unmount();
  cleanup();
  const second = await pinRig({ settings: withPair, workspace: { storage: store, ...quiet } });
  await wait();
  assert.deepEqual(second.facts('c'), { parkable: false, listed: false, movable: false, clearable: false, pinned: true });
  second.turn(() => second.h.c!.unpin('person'));
  await wait();
  assert.deepEqual(await overridesOf(store), [{}, {}, { parkable: true }]);
  cleanup();
  const code = memoryWorkspaceStorage();
  const third = await pinRig({ settings: withPair, workspace: { storage: code, ...quiet } });
  third.turn(() => third.h.c!.pin());
  await wait();
  assert.equal(third.facts('c').parkable, false, 'the code pin holds for the session');
  assert.deepEqual(await overridesOf(code), [{}, {}, {}]);
});

test('a person pin that names a placement records overrides.anchor for every id; a half with no placement records none', async () => {
  const store = memoryWorkspaceStorage();
  const r = await pinRig({ settings: { c: { pinning: FIX } }, workspace: { storage: store, ...quiet } });
  r.turn(() => r.h.c!.pin('person'));
  await wait();
  const saved = (await overridesOf(store)) as Array<{ anchor?: unknown; parkable?: boolean }>;
  assert.equal(saved.length, 3);
  assert.ok(saved.every((o) => o.anchor !== undefined), 'every id carries its anchor');
  assert.deepEqual(saved.map((o) => o.parkable), [false, undefined, undefined], 'only the pinned panel carries parkable');
  cleanup();
  const pair = memoryWorkspaceStorage();
  const q = await pinRig({ settings: { c: { pinning: PAIR } }, workspace: { storage: pair, ...quiet } });
  q.turn(() => q.h.c!.pin('person'));
  await wait();
  assert.equal(JSON.stringify(await overridesOf(pair)).includes('anchor'), false);
});

// ---------------------------------------------------------------------------
// Scroll: one request per show path
// ---------------------------------------------------------------------------

async function scrollRig(settings: PanelSettings, pinning: Pinning = PLACE): Promise<{ r: PinRig; glides: () => number }> {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const r = await pinRig({ ids, width: 1000, settings: Object.fromEntries(ids.map((id) => [id, { overflow: 'scroll', pinning, ...settings } as PanelSettings])) });
  await r.settle();
  const scroller = rowScrollerFor(r.m.container);
  const original = scroller.glideTo.bind(scroller);
  let count = 0;
  scroller.glideTo = (to, o) => {
    count += 1;
    return original(to, o);
  };
  return { r, glides: () => count };
}

const FAR: Pinning = { pinned: { placement: 'row-end', parkable: false }, unpinned: { placement: 'row-start', parkable: true } };

test('a pin that shows a hidden panel asks the row for one scroll when it lands out of view', async () => {
  const { r, glides } = await scrollRig({ pinningWhenNotLive: 'show', scrollOnMove: 'none', scrollOnOpen: 'into-view' } as PanelSettings, FAR);
  r.m.container.scrollLeft = 0;
  r.turn(() => r.h.a!.hide());
  const before = glides();
  r.turn(() => r.h.a!.pin());
  await r.settle();
  assert.equal(glides() - before, 1, 'one request for the whole show');
  assert.equal(r.state('a').pinned, true);
});

test('a pin that shows a hidden panel where the row already shows it asks for no scroll', async () => {
  const { r, glides } = await scrollRig({ pinningWhenNotLive: 'show', scrollOnMove: 'none', scrollOnOpen: 'into-view' } as PanelSettings);
  r.turn(() => r.h.j!.hide());
  const before = glides();
  r.turn(() => r.h.j!.pin());
  await r.settle();
  assert.equal(glides() - before, 0);
  assert.equal(r.state('j').pinned, true);
});

test('scrollOnOpen none: the show path asks the row for no scroll', async () => {
  const { r, glides } = await scrollRig({ pinningWhenNotLive: 'show', scrollOnMove: 'none', scrollOnOpen: 'none' } as PanelSettings, FAR);
  r.turn(() => r.h.a!.hide());
  const before = glides();
  r.turn(() => r.h.a!.pin());
  await r.settle();
  assert.equal(glides() - before, 0);
});
