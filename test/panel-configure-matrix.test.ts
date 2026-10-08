/**
 * The configure matrix: the 36 cells of the class table (4 classes by 9 statuses), then one probe per catalog name.
 * Every expectation is written from design 7.6 and the catalog's `on_configure` cells; a red assertion here names the
 * entry whose behaviour it pins and is never loosened to pass.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import type { ConfigureResult, PanelSettings, WorkspaceStorage } from '../index.js';
import { memoryWorkspaceStorage } from '../fakeHost.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import {
  CLASSES,
  CLASS_TABLE,
  STATUSES,
  arrange,
  cell,
  cellsExecuted,
  done,
  letter,
  matrixRig,
  matrixTemplate,
  mockWindow,
  probe,
  refusedWith,
  soft,
  viewLog,
  type Arranged,
  type Cls,
  type MatrixRig,
  type Status,
} from './support/configure-matrix.js';

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  cleanup();
  viewLog.reset();
});

// ---------------------------------------------------------------------------
// What a cell watches
// ---------------------------------------------------------------------------

interface Trace {
  entries: MatrixRig['m'] extends { latest: () => infer P } ? (P extends { entries: infer E } ? E : never) : never;
  renders: number;
  version: number;
  order: string;
  live: string;
  evicted: number;
  unmounted: number;
  engineId: string | null;
}

const traceOf = (a: Arranged): Trace => {
  const { r, id } = a;
  const engineId = r.ws.panels.get(id)?.getState().engineId ?? null;
  return {
    entries: r.m.latest().entries,
    renders: r.m.renders(),
    version: r.ws.panels.getSnapshot().version,
    order: r.order().join(' '),
    live: r.live().join(' '),
    evicted: r.capture.evicted.length,
    unmounted: engineId === null ? 0 : viewLog.unmounted(engineId),
    engineId,
  };
};

/** The side effects a cell names, measured against the trace taken before the call. */
function assertSideEffects(a: Arranged, before: Trace, cell: (typeof CLASS_TABLE)['NOW']['live']): void {
  if (cell.evicts !== null) assert.equal(a.r.capture.evicted.length - before.evicted, cell.evicts, 'host evict calls the configure caused');
  if (cell.unmounts !== null && before.engineId !== null) assert.equal(viewLog.unmounted(before.engineId) - before.unmounted, cell.unmounts, 'view unmounts the configure caused');
}

/** A refusal leaves the panel's own settings as they were; the entries of the whole row are compared only when nothing else ran in the turn. */
function assertRefusal(a: Arranged, before: Trace, res: ConfigureResult, code: string, key: string, was: unknown): void {
  refusedWith(res, code);
  assert.ok((res as { message: string }).message.length > 0, 'a refusal carries a message');
  const settings = a.r.ws.panels.get(a.id)!.getSettings().value as unknown as Record<string, unknown>;
  assert.deepEqual(settings[key], was, `${key} is as it was`);
  if (code !== 'is-pending' && code !== 'busy') {
    assert.equal(a.r.m.latest().entries === before.entries, true, 'entries keep their reference');
    assert.equal(a.r.m.renders(), before.renders, 'no commit followed');
    assert.equal(a.r.ws.panels.getSnapshot().version, before.version, 'the snapshot version did not move');
  }
}

const summaryOf = (r: MatrixRig, id: string) => r.provided().panelList.find((s) => s.id === r.entry(id).id);

// ---------------------------------------------------------------------------
// NOW: closable true to false
// ---------------------------------------------------------------------------

async function nowCell(status: Status): Promise<void> {
  const cell = CLASS_TABLE.NOW[status];
  const a = await arrange(status);
  const { r, id } = a;
  const before = traceOf(a);
  const out = cell.outcome;
  if (out.kind === 'refused') {
    const res = a.configure({ closable: false });
    assertRefusal(a, before, res, out.code, 'closable', true);
    assertSideEffects(a, before, cell);
    return;
  }
  if (out.kind === 'stored-on-record') {
    const held = r.provided().recentlyClosed;
    const res = done(a.configure({ closable: false }));
    assert.deepEqual({ ok: res.ok, changed: res.changed, shown: res.shown, now: [...res.now], later: [...res.later], shadowed: [...res.shadowed] }, { ok: true, changed: true, shown: false, now: [], later: ['closable'], shadowed: [] });
    assert.equal(r.state(id).status, 'closed', 'a closed panel stays closed');
    assert.equal(r.provided().recentlyClosed === held || (held ?? []).every((s, k) => s === r.provided().recentlyClosed?.[k]), true, 'the window holds the very objects it held');
    assertSideEffects(a, before, cell);
    if (status === 'closed-declared') r.turn(() => r.h[id]!.open());
    else r.turn(() => r.provided().undoClose());
    await r.settle();
    assert.equal(r.state(id).status, 'live');
    assert.equal(r.entry(id).locked, true, 'the record carried the edit into the reopened panel');
    assert.equal(letter(r.turn(() => r.h[id]!.close())), 'not-closable');
    return;
  }
  assert.equal(out.kind, 'applied-now');
  const mounted = status === 'live' || status === 'hidden' ? r.seen(id) : null;
  if (status === 'live') assert.equal(mounted?.['data-close'], 'true', 'before: the view is offered the close control');
  assert.equal(summaryOf(r, id)?.locked, false, 'before: the History row offers a close');
  const res = done(a.configure({ closable: false }));
  assert.deepEqual({ ok: res.ok, changed: res.changed, shown: res.shown, now: [...res.now], later: [...res.later], shadowed: [...res.shadowed] }, { ok: true, changed: true, shown: false, now: ['closable'], later: [], shadowed: [] });
  assert.equal(summaryOf(r, id)?.locked, true, 'after: the History row no longer offers a close, in the same commit');
  assert.equal(r.entry(id).locked, true);
  assert.equal(r.state(id).settings.clearable, false, 'clearable re-derives false (C2)');
  if (status === 'live') assert.equal(r.seen(id)?.['data-close'], 'false', 'the view is no longer offered the close control');
  assert.equal(r.order().join(' '), before.order, 'nothing moved');
  assert.equal(r.live().join(' '), before.live, 'nothing parked or returned');
  assertSideEffects(a, before, cell);
  assert.equal(letter(r.turn(() => r.h[id]!.close())), 'not-closable');
  if (cell.staysLive === true) {
    assert.equal(r.state(id).status, 'parked', 'control: the panel was parked when configured');
    r.turn(() => r.h[id]!.show());
    await r.settle();
    assert.equal(r.state(id).status, 'live', 'the acted-on panel is live and stays live');
    assert.deepEqual(r.live().filter((n) => n !== 'root'), [id], 'the row holds one park panel beside the root, so room was made by parking the one that was live');
    assert.equal(letter(r.turn(() => r.h[id]!.close())), 'not-closable');
  }
}

// ---------------------------------------------------------------------------
// NEXT: hideStickiness, snapshot and persist together
// ---------------------------------------------------------------------------

const NEXT_PATCH = { hideStickiness: 'until-room', snapshot: 'never', persist: 'session' } as const;

const wait = (): Promise<void> => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 80))));
const keysOf = async (store: WorkspaceStorage): Promise<string[]> => ((await store.load())?.panels ?? []).map((p) => p.key ?? p.id);

async function nextCell(status: Status): Promise<void> {
  const cell = CLASS_TABLE.NEXT[status];
  const store = memoryWorkspaceStorage();
  const a = await arrange(status, {}, { storage: store, tuning: { saveQuietMs: 5 } });
  const { r, id } = a;
  const saves = cell.projection !== null;
  if (saves) await wait();
  const out = cell.outcome;
  const fileBefore = JSON.stringify(await store.load());
  const before = traceOf(a);
  if (out.kind === 'refused') {
    const res = a.configure(NEXT_PATCH);
    assertRefusal(a, before, res, out.code, 'hideStickiness', 'sticky');
    assertSideEffects(a, before, cell);
    await wait();
    assert.equal(cell.projection, 'none');
    assert.equal((await keysOf(store)).includes(id), status !== 'closed-anonymous', 'a refused call leaves the panel in the projection');
    void fileBefore;
    return;
  }
  if (out.kind === 'stored-on-record') {
    const res = done(a.configure(NEXT_PATCH));
    assert.deepEqual({ ok: res.ok, changed: res.changed, shown: res.shown, now: [...res.now], later: [...res.later], shadowed: [...res.shadowed] }, { ok: true, changed: true, shown: false, now: [], later: ['hideStickiness', 'snapshot', 'persist'], shadowed: [] });
    assert.equal(r.state(id).status, 'closed');
    assertSideEffects(a, before, cell);
    if (status === 'closed-declared') r.turn(() => r.h[id]!.open());
    else r.turn(() => r.provided().undoClose());
    await r.settle();
    assert.equal(r.state(id).status, 'live');
    assert.deepEqual([r.state(id).settings.hideStickiness, r.state(id).settings.snapshot, r.state(id).settings.persist], ['until-room', 'never', 'session'], 'the record carried the edit into the reopened panel');
    return;
  }
  assert.equal(out.kind, 'stored');
  const flags = r.state(id);
  const res = done(a.configure(NEXT_PATCH));
  assert.deepEqual({ ok: res.ok, changed: res.changed, shown: res.shown, now: [...res.now], later: [...res.later], shadowed: [...res.shadowed] }, { ok: true, changed: true, shown: false, now: [], later: ['hideStickiness', 'snapshot', 'persist'], shadowed: [] });
  const read = r.ws.panels.get(id)!.getSettings();
  assert.deepEqual([read.value.hideStickiness, read.value.snapshot, read.value.persist, read.source.hideStickiness], ['until-room', 'never', 'session', 'instance']);
  assert.equal(r.order().join(' '), before.order, 'nothing moved');
  assert.equal(r.live().join(' '), before.live, 'nothing parked, shown or returned');
  assert.deepEqual([r.state(id).status, r.state(id).held], [flags.status, flags.held], 'the panel kept its state');
  // The entries of every other panel are the objects they were.
  for (const e of before.entries) if (e.id !== before.engineId) assert.equal(r.m.latest().entries.includes(e), true, `entry ${e.id} is the same object`);
  // The file differs only at the next projection.
  assert.equal(JSON.stringify(await store.load()), fileBefore, 'the call itself wrote nothing');
  await wait();
  assert.equal((await keysOf(store)).includes(id), false, 'the next projection leaves the session panel out');
  assert.equal(cell.projection, 'next-save');
  if (cell.staysLive === true) {
    r.turn(() => r.h[id]!.show());
    await r.settle();
    assert.equal(r.state(id).status, 'live', 'the acted-on panel is live and stays live');
    assert.deepEqual(r.live().filter((n) => n !== 'root'), [id], 'the row holds one park panel beside the root, so room was made by parking the one that was live');
  }
  assertSideEffects(a, before, cell);
}


// ---------------------------------------------------------------------------
// STATE: keepMounted, read through the park latch
// ---------------------------------------------------------------------------

async function stateCell(status: Status): Promise<void> {
  const cell = CLASS_TABLE.STATE[status];
  // A hidden panel is mounted-but-hidden only when it was kept at the commit that parked it.
  const kept = status === 'hidden';
  const a = await arrange(status, kept ? { keepMounted: true } : {});
  const { r, id } = a;
  const patch = { keepMounted: !kept };
  const before = traceOf(a);
  const out = cell.outcome;
  if (out.kind === 'refused') {
    const res = a.configure(patch);
    assertRefusal(a, before, res, out.code, 'keepMounted', false);
    assertSideEffects(a, before, cell);
    return;
  }
  if (out.kind === 'stored-on-record') {
    const res = done(a.configure(patch));
    assert.deepEqual({ ok: res.ok, changed: res.changed, now: [...res.now], later: [...res.later], shadowed: [...res.shadowed] }, { ok: true, changed: true, now: [], later: ['keepMounted'], shadowed: [] });
    assert.equal(r.state(id).status, 'closed');
    assertSideEffects(a, before, cell);
    if (status === 'closed-declared') r.turn(() => r.h[id]!.open());
    else r.turn(() => r.provided().undoClose());
    await r.settle();
    assert.equal(r.state(id).settings.keepMounted, true, 'the record carried the edit into the reopened panel');
    return;
  }
  if (status === 'hidden') {
    assert.equal(r.seen(id)?.['data-hidden'], 'true', 'before: the held panel is mounted but not rendered');
    const res = done(a.configure(patch));
    assert.deepEqual([...res.now, ...res.later], ['keepMounted'], 'applied, whichever list the result files it under');
    await advanceFrames(32);
    assert.equal(r.seen(id), null, 'after two frames, far short of a slide: the view is unmounted');
    assert.deepEqual([r.state(id).status, r.state(id).held], ['parked', true], 'and the panel is still hidden');
    assert.equal(r.live().join(' '), before.live, 'nothing returned');
    assertSideEffects(a, before, cell);
    return;
  }
  assert.equal(out.kind, 'stored');
  const res = done(a.configure(patch));
  assert.deepEqual({ ok: res.ok, changed: res.changed, now: [...res.now], later: [...res.later], shadowed: [...res.shadowed] }, { ok: true, changed: true, now: [], later: ['keepMounted'], shadowed: [] });
  assert.equal(r.order().join(' '), before.order, 'nothing moved');
  assert.equal(r.live().join(' '), before.live, 'nothing parked or returned');
  assertSideEffects(a, before, cell);
  if (status === 'live') {
    assert.notEqual(r.seen(id), null, 'a live panel stays mounted');
    r.turn(() => r.h[id]!.hide());
    await r.settle();
    assert.equal(viewLog.unmounted(before.engineId!), 0, 'the next park keeps the view mounted');
    assert.equal(r.seen(id)?.['data-hidden'], 'true', 'and hides it');
  } else {
    assert.equal(r.seen(id), null, 'a parked panel stays unmounted until it is shown and parked again');
    r.turn(() => r.h[id]!.show());
    await r.settle();
    assert.equal(r.state(id).status, 'live', 'the shown panel is live and stays live');
    assert.deepEqual(r.live().filter((n) => n !== 'root'), [id]);
  }
}

// ---------------------------------------------------------------------------
// SCOPE: configureTemplate on a template with an instance in each status
// ---------------------------------------------------------------------------

async function scopeCell(status: Status): Promise<void> {
  const cell = CLASS_TABLE.SCOPE[status];
  const many = (extra: PanelSettings = {}) => matrixTemplate('m', { settings: { multiple: true, ...extra } });
  if (cell.outcome.kind === 'refused') {
    const never: WorkspaceStorage = { load: () => new Promise(() => undefined), save: () => undefined };
    const r = await matrixRig({ ids: [], extra: [many()], workspace: { storage: never } });
    assert.equal(r.ws.status, 'loading');
    const entries = r.m.latest().entries;
    refusedWith(r.turn(() => r.ws.panels.configureTemplate('m', { maxInstances: 2 })), cell.outcome.code);
    assert.equal(r.m.latest().entries === entries, true);
    return;
  }
  // Instance 'y' stays live; instance 'x' is the one in `status`.
  const narrow = status === 'parked' || status === 'protected';
  const r = await matrixRig({ ids: [], width: narrow ? 1000 : 4000, extra: [many(narrow ? { overflow: 'park' } : {})] });
  const singleton = r.turn(() => r.ws.addPanel('m', { id: 'y' }));
  await r.settle();
  let target = singleton;
  if (status !== 'closed-anonymous') {
    target = r.turn(() => r.ws.addPanel('m', { id: 'x' }));
    await r.settle();
  }
  if (status === 'parked' || status === 'protected') {
    const parked = [singleton, target].filter((h) => h.getState().status === 'parked');
    assert.equal(parked.length, 1, 'the row holds one of the two');
    target = parked[0]!;
  }
  let early: (() => void) | undefined;
  if (status === 'hidden') r.turn(() => target.hide());
  if (status === 'closed-declared') {
    const w = mockWindow();
    r.turn(() => target.close());
    w.pastWindow();
    assert.equal(target.getState().status, 'closed');
  }
  if (status === 'undo-window') r.turn(() => target.close());
  if (status === 'closed-anonymous') {
    const w = mockWindow();
    target = r.turn(() => r.ws.addPanel('m'));
    await r.settle();
    r.turn(() => target.close());
    w.pastWindow();
    assert.equal(target.getState().status, 'closed');
  }
  if (status === 'protected') early = () => void target.show();
  if (status === 'same-turn') early = () => void singleton.hide();
  const was = { evicted: r.capture.evicted.length };
  const raise = (): ConfigureResult => r.ws.panels.configureTemplate('m', { hostCreatable: false });
  const lower = (): ConfigureResult => r.ws.panels.configureTemplate('m', { maxInstances: 1 });
  const [high, low] = r.turn(() => {
    early?.();
    return [raise(), lower()] as const;
  });
  assert.deepEqual({ ...done(high) }, { ok: true, changed: true, shown: false, now: [], later: ['hostCreatable'], shadowed: [], notes: [] }, 'a template key that cannot strand an instance is stored, whatever the instance is doing (a template names no panel, so it is never busy)');
  if (cell.counted === true) {
    const refusal = refusedWith(low, 'instance-limit');
    assert.equal(refusal.setting, 'maxInstances');
    assert.match(refusal.message, /2 instances/, 'the refusal counts the instances that exist');
  } else {
    assert.deepEqual({ ...done(low) }, { ok: true, changed: true, shown: false, now: [], later: ['maxInstances'], shadowed: [], notes: [] }, 'an instance that is gone does not count');
  }
  assert.equal(r.capture.evicted.length - was.evicted, cell.evicts, 'no instance is touched');
}

// ---------------------------------------------------------------------------
// The loop: every cell its own test
// ---------------------------------------------------------------------------

const KITS: Readonly<Record<Cls, (status: Status) => Promise<void>>> = {
  NOW: nowCell,
  NEXT: nextCell,
  STATE: stateCell,
  SCOPE: scopeCell,
};

for (const cls of CLASSES) {
  for (const status of STATUSES) {
    test(`class cell ${cls} x ${status}`, async () => {
      cell(cls, status);
      await KITS[cls](status);
    });
  }
}


// ---------------------------------------------------------------------------
// The probes: one literal test per catalog name, in the catalog's order
// ---------------------------------------------------------------------------

const PAIR_PIN = { pinned: { parkable: false }, unpinned: { parkable: true } } as const;
const shape = (res: ConfigureResult): { now: string[]; later: string[]; shadowed: string[] } => {
  const d = done(res);
  return { now: [...d.now], later: [...d.later], shadowed: [...d.shadowed] };
};
const listedIds = (r: MatrixRig): string[] => r.provided().panelList.map((s) => s.id);
const thrownCode = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};
const sameRow = (r: MatrixRig, entries: unknown, renders: number, why: string): void => {
  assert.equal(r.m.latest().entries === entries, true, `${why}: entries keep their reference`);
  assert.equal(r.m.renders(), renders, `${why}: no commit followed`);
};

/** Every one of the nine statuses answers `patch` with wrong-scope naming `setting`, the engine untouched. */
async function wrongScopeInEveryStatus(patch: Record<string, unknown>, setting: string): Promise<void> {
  assert.equal(STATUSES.length, 9);
  for (const status of STATUSES) {
    const a = await arrange(status);
    const { r, id } = a;
    const entries = r.m.latest().entries;
    const handle = r.h[id]!;
    const res =
      status === 'protected'
        ? r.turn(() => {
            handle.show();
            return handle.configure(patch as never);
          })
        : a.configure(patch);
    const refusal = refusedWith(res, 'wrong-scope');
    assert.equal(refusal.setting, setting, `${status}: the refusal names the key`);
    if (status !== 'protected' && status !== 'same-turn' && status !== 'pending') assert.equal(r.m.latest().entries === entries, true, `${status}: entries keep their reference`);
    r.m.unmount();
    mock.timers.reset();
  }
}

test('matrix:closable', async () => {
  probe('closable');
  const r = await matrixRig();
  const read = (id: string): unknown[] => [r.seen(id)?.['data-close'], summaryOf(r, id)?.locked, r.state(id).settings.clearable];
  assert.deepEqual(read('b'), ['true', false, true], 'before: a close control is offered, History can close it, clearAll takes it');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ closable: false }))), { now: ['closable'], later: [], shadowed: [] });
  assert.deepEqual(read('b'), ['false', true, false], 'after, in that commit: no close control, no close from History, clearable re-derived false');
  assert.equal(letter(r.turn(() => r.h.b!.close())), 'not-closable', 'close() answers not-closable');
  assert.equal(r.state('b').status, 'live');
  assert.deepEqual(read('c'), ['true', false, true], 'a neighbour is untouched');
  done(r.turn(() => r.h.b!.configure({ closable: true })));
  assert.deepEqual(read('b'), ['true', false, true], 'false to true restores all three');
  r.turn(() => r.h.c!.hide());
  await r.settle();
  done(r.turn(() => r.h.c!.configure({ closable: false })));
  assert.deepEqual([summaryOf(r, 'c')?.locked, r.seen('c'), r.state('c').status], [true, null, 'parked'], 'a hidden panel changes in the History row only');
  const root = refusedWith(r.turn(() => r.ws.panels.configure(r.ws.rootId, { closable: true })), 'settings-conflict');
  assert.equal(root.setting, 'closable');
  assert.match(root.message, /C5/);
  const clearable = refusedWith(r.turn(() => r.h.a!.configure({ closable: false, clearable: true })), 'settings-conflict');
  assert.equal(clearable.setting, 'clearable');
});

test('matrix:parkable', async () => {
  probe('parkable');
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const r = await matrixRig({ ids, settings: { f: { pinningWhenNotLive: 'apply-on-next-show' }, g: { pinning: PAIR_PIN } } });
  const facts = (id: string): unknown[] => {
    const s = r.state(id);
    return [s.settings.parkable, s.listed, s.settings.draggable, s.settings.placeable, s.settings.clearable];
  };
  assert.deepEqual([facts('b'), r.provided().fixedViewCount], [[true, true, true, true, true], 1], 'before: an ordinary panel, one fixed column (the root)');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ parkable: false }))), { now: ['parkable'], later: [], shadowed: [] });
  assert.deepEqual([facts('b'), r.entry('b').collapsible, r.provided().fixedViewCount], [[false, false, false, false, false], false, 2], 'after, in that commit: listed, draggable, placeable and clearable re-derived false; the row prices a second fixed column');
  assert.equal(letter(r.turn(() => r.h.b!.hide())), 'not-parkable');
  done(r.turn(() => r.h.b!.configure({ parkable: true })));
  assert.deepEqual([facts('b'), r.entry('b').collapsible], [[true, true, true, true, true], true], 'false to true lifts C1');
  r.turn(() => r.h.c!.setFormFactor('tablet', 'person'));
  assert.equal(refusedWith(r.turn(() => r.h.c!.configure({ parkable: false })), 'tier-not-allowed').ok, false, 'a tablet panel cannot become a fixed column');
  assert.equal(refusedWith(r.turn(() => r.h.a!.configure({ parkable: false, resizable: true })), 'settings-conflict').setting, 'resizable', 'resizable true beside a fixed column is a conflict');
  const s = soft();
  await s.run('K, H with the default place-only: would-reshape-row, the row untouched', async () => {
    r.turn(() => r.h.d!.hide());
    await r.settle();
    const hiddenEntries = r.m.latest().entries;
    const hiddenRenders = r.m.renders();
    refusedWith(r.turn(() => r.h.d!.configure({ parkable: false })), 'would-reshape-row');
    sameRow(r, hiddenEntries, hiddenRenders, 'place-only on a hidden panel');
  });
  await s.run('K, H with apply-on-next-show: stored as deferredPin { parkable }, the panel stays hidden', async () => {
    r.turn(() => r.h.f!.hide());
    await r.settle();
    assert.deepEqual(shape(r.turn(() => r.h.f!.configure({ parkable: false }))), { now: ['parkable'], later: [], shadowed: [] });
    assert.deepEqual([r.state('f').deferredPin, r.state('f').status], [{ parkable: false }, 'parked']);
  });
  await s.run("a person's pin outvotes the flip: shadowed", () => {
    r.turn(() => r.h.g!.pin('person'));
    assert.equal(r.state('g').settings.parkable, false, 'control: the person pinned g into a fixed column');
    assert.deepEqual(shape(r.turn(() => r.h.g!.configure({ parkable: true }))), { now: ['parkable'], later: [], shadowed: ['parkable'] });
    assert.equal(r.state('g').settings.parkable, false);
  });
  await s.run('C, U with place-only: is-closed', () => {
    const w = mockWindow();
    r.turn(() => r.h.e!.close());
    refusedWith(r.turn(() => r.h.e!.configure({ parkable: false })), 'is-closed');
    w.pastWindow();
    refusedWith(r.turn(() => r.h.e!.configure({ parkable: false })), 'is-closed');
  });
  s.end();
});

test('matrix:draggable', async () => {
  probe('draggable');
  const r = await matrixRig();
  assert.equal(r.seen('b')?.['data-reorder'], 'true', 'before: the reorder grab is offered');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ draggable: false }))), { now: ['draggable'], later: [], shadowed: [] });
  assert.equal(r.seen('b')?.['data-reorder'], 'false', 'after, in that commit: no reorder grab');
  assert.equal(letter(r.turn(() => r.h.b!.move('right'))), 'not-draggable');
  assert.equal(r.order().join(' '), 'root a b c', 'nothing moved');
  assert.equal(r.seen('a')?.['data-reorder'], 'true', 'a neighbour is untouched');
  r.turn(() => r.h.c!.hide());
  await r.settle();
  done(r.turn(() => r.h.c!.configure({ draggable: false })));
  assert.deepEqual([r.state('c').settings.draggable, r.state('c').status], [false, 'parked'], 'a hidden panel stores it');
  const root = refusedWith(r.turn(() => r.ws.panels.configure(r.ws.rootId, { draggable: true })), 'settings-conflict');
  assert.equal(root.setting, 'draggable');
  assert.match(root.message, /C5/);
});

test('matrix:crossable', async () => {
  probe('crossable');
  const r = await matrixRig();
  const rightOfA = (): unknown => JSON.parse(r.seen('a')!['data-neighbors']!).right;
  assert.deepEqual(rightOfA(), [390, 390], "before: a's drag crosses b and c");
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ crossable: false }))), { now: ['crossable'], later: [], shadowed: [] });
  assert.deepEqual(rightOfA(), [], "after, at once: a's drag sees b as a barrier");
  assert.equal(letter(r.turn(() => r.h.a!.move('right'))), 'F', 'a move across it is judged by movePanel: accepted, nothing moves');
  assert.equal(r.order().join(' '), 'root a b c');
  done(r.turn(() => r.h.b!.configure({ crossable: true })));
  r.turn(() => r.h.b!.hide());
  await r.settle();
  assert.deepEqual(rightOfA(), [390], 'a hidden panel that stays crossable is no barrier');
  done(r.turn(() => r.h.b!.configure({ crossable: false })));
  assert.deepEqual(rightOfA(), [], 'a hidden panel that is not crossable is a barrier for the next drag too');
});

test('matrix:placeable', async () => {
  probe('placeable');
  const r = await matrixRig({ settings: { c: { pinning: { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } } } } });
  assert.equal(r.seen('b')?.['data-caps'] !== undefined && JSON.parse(r.seen('b')!['data-caps']!).placeable, true, 'before: placeable');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ placeable: false }))), { now: ['placeable'], later: [], shadowed: [] });
  assert.equal(JSON.parse(r.seen('b')!['data-caps']!).placeable, false, 'after, in that commit: the view reads placeable false');
  assert.equal(letter(r.turn(() => r.h.b!.place('row-end'))), 'not-placeable');
  assert.equal(letter(r.turn(() => r.h.b!.pin())), 'not-placeable', 'a placement-bearing pin() refuses too');
  assert.equal(r.order().join(' '), 'root a b c', 'nothing moved');
  assert.equal(letter(r.turn(() => r.h.a!.place('row-end'))), 'T', 'a neighbour still places');
  r.turn(() => r.h.c!.hide());
  await r.settle();
  done(r.turn(() => r.h.c!.configure({ placeable: false })));
  assert.equal(letter(r.turn(() => r.h.c!.place('row-start'))), 'not-placeable', 'a hidden panel refuses too');
  const root = refusedWith(r.turn(() => r.ws.panels.configure(r.ws.rootId, { placeable: true })), 'settings-conflict');
  assert.equal(root.setting, 'placeable');
  assert.match(root.message, /C5/);
});

test('matrix:resizable', async () => {
  probe('resizable');
  const r = await matrixRig();
  r.turn(() => r.h.b!.setFormFactor('tablet', 'person'));
  const savedTier = r.entry('b').overrides?.formFactor;
  assert.deepEqual([r.entry('b').formFactor, savedTier], ['tablet', 'tablet'], 'before: the person chose tablet');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ resizable: false }))), { now: ['resizable'], later: [], shadowed: [] });
  assert.equal(letter(r.turn(() => r.h.b!.setFormFactor('phone'))), 'not-resizable', 'after: setFormFactor is refused');
  assert.deepEqual([r.entry('b').formFactor, r.entry('b').overrides?.formFactor], ['tablet', 'tablet'], "the tier and the person's saved tier are never changed or dropped");
  assert.equal(letter(r.turn(() => r.h.a!.setFormFactor('tablet'))), 'T', 'a neighbour still resizes');
  r.turn(() => r.h.c!.hide());
  await r.settle();
  done(r.turn(() => r.h.c!.configure({ resizable: false })));
  assert.equal(letter(r.turn(() => r.h.c!.setFormFactor('tablet'))), 'not-resizable', 'a hidden panel refuses too');
  const fixed = await matrixRig();
  done(fixed.turn(() => fixed.h.a!.configure({ parkable: false })));
  assert.equal(refusedWith(fixed.turn(() => fixed.h.a!.configure({ resizable: true })), 'settings-conflict').setting, 'resizable', 'C1: true on a fixed column is a conflict');
});

test('matrix:formFactors', async () => {
  probe('formFactors');
  const r = await matrixRig();
  assert.deepEqual([...r.state('b').settings.formFactors], ['phone', 'tablet', 'desktop'], 'before: all three tiers');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ formFactors: ['phone', 'tablet'] }))), { now: ['formFactors'], later: [], shadowed: [] }, 'narrowing with the current tier inside is accepted');
  assert.equal(letter(r.turn(() => r.h.b!.setFormFactor('desktop'))), 'tier-not-allowed');
  assert.equal(letter(r.turn(() => r.h.b!.setFormFactor('tablet'))), 'T');
  assert.equal(shape(r.turn(() => r.h.b!.configure({ formFactors: ['phone', 'tablet', 'desktop'] }))).now[0], 'formFactors', 'widening is accepted');
  const entries = r.m.latest().entries;
  const renders = r.m.renders();
  refusedWith(r.turn(() => r.h.b!.configure({ formFactors: ['phone'] })), 'tier-not-allowed');
  sameRow(r, entries, renders, 'narrowing below the current tier');
  assert.equal(r.entry('b').formFactor, 'tablet', 'the tier is never changed by the call');
  const conflict = refusedWith(r.turn(() => r.h.a!.configure({ formFactor: 'tablet', formFactors: ['phone'] })), 'settings-conflict');
  assert.equal(conflict.setting, 'formFactor');
  assert.match(conflict.message, /C4/);
  assert.equal(thrownCode(() => r.h.a!.configure({ formFactors: [] })), 'invalid-settings', 'an empty set throws');
});

test('matrix:clearable', async () => {
  probe('clearable');
  const control = await matrixRig();
  control.turn(() => control.provided().clearAll());
  assert.equal(control.order().join(' '), 'root', 'control: clearAll takes every panel');
  const r = await matrixRig();
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ clearable: false }))), { now: [], later: ['clearable'], shadowed: [] });
  assert.equal(r.order().join(' '), 'root a b c', 'nothing happens at configure');
  r.turn(() => r.provided().clearAll());
  assert.equal(r.order().join(' '), 'root b', 'the next clearAll keeps the panel that is not clearable and takes the rest');
  const clash = refusedWith(r.turn(() => r.h.b!.configure({ closable: false, clearable: true })), 'settings-conflict');
  assert.equal(clash.setting, 'clearable');
  assert.match(clash.message, /C2/);
  done(r.turn(() => r.h.b!.configure({ clearable: null })));
  assert.deepEqual([r.state('b').settings.clearable, r.h.b!.getSettings().source.clearable], [true, 'derived'], 'null re-derives it');
});

test('matrix:hostCreatable', async () => {
  probe('hostCreatable');
  await wrongScopeInEveryStatus({ hostCreatable: false }, 'hostCreatable');
  const r = await matrixRig({ ids: ['a'], extra: [matrixTemplate('m', { settings: { multiple: true } })] });
  const instances = (): number => r.ws.panels.list().filter((h) => h.templateId === 'm').length;
  r.turn(() => r.provided().create({ view: 'm' } as never));
  await r.settle();
  assert.equal(instances(), 1, 'before: a Host-bag create naming the template makes a panel');
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTemplate('m', { hostCreatable: false }))) }, { ok: true, changed: true, shown: false, now: [], later: ['hostCreatable'], shadowed: [], notes: [] });
  r.turn(() => r.provided().create({ view: 'm' } as never));
  await r.settle();
  assert.equal(instances(), 1, 'after: the next Host-bag create makes none');
  assert.equal(r.ws.panels.list().filter((h) => h.templateId === 'm')[0]!.getState().status, 'live', 'the existing instance is untouched');
  r.turn(() => void r.ws.addPanel('m'));
  await r.settle();
  assert.equal(instances(), 2, 'and code addPanel still adds one');
  assert.equal(refusedWith(r.turn(() => r.h.a!.configure({ hostCreatable: true } as never)), 'wrong-scope').setting, 'hostCreatable');
  assert.equal(refusedWith(r.turn(() => r.ws.panels.configureTuning({ hostCreatable: true } as never)), 'wrong-scope').setting, 'hostCreatable');
  assert.equal(thrownCode(() => r.ws.panels.configureTemplate('nope', { hostCreatable: true })), 'unknown-template');
  const never = await matrixRig({ ids: [], extra: [matrixTemplate('m', { settings: { multiple: true } })], workspace: { storage: { load: () => new Promise(() => undefined), save: () => undefined } } });
  refusedWith(never.turn(() => never.ws.panels.configureTemplate('m', { hostCreatable: false })), 'not-ready');
});

test('matrix:multiple', async () => {
  probe('multiple');
  await wrongScopeInEveryStatus({ multiple: false }, 'multiple');
  const r = await matrixRig({ ids: [], extra: [matrixTemplate('m', { settings: { multiple: true } })] });
  const flip = (): ConfigureResult => r.ws.panels.configureTemplate('m', { multiple: false });
  assert.equal(done(r.turn(flip)).changed, true, 'with no instance, true to false is accepted');
  assert.equal(done(r.turn(() => r.ws.panels.configureTemplate('m', { multiple: true }))).changed, true, 'false to true is accepted');
  r.turn(() => void [r.ws.addPanel('m', { id: 'm1' }), r.ws.addPanel('m', { id: 'm2' })]);
  await r.settle();
  const entries = r.m.latest().entries;
  const renders = r.m.renders();
  const refusal = refusedWith(r.turn(flip), 'instance-limit');
  assert.equal(refusal.setting, 'multiple');
  assert.match(refusal.message, /2 instances/, 'the refusal carries the count');
  sameRow(r, entries, renders, 'two live instances');
  assert.deepEqual(r.ws.panels.list().filter((h) => h.templateId === 'm').map((h) => h.getState().status), ['live', 'live'], 'nothing is closed or renamed');
  assert.equal(refusedWith(r.turn(() => r.ws.panels.get('m1')!.configure({ multiple: false } as never)), 'wrong-scope').setting, 'multiple');
  const w = mockWindow();
  const s = soft();
  await s.run('a panel in the undo window still counts', () => {
    r.turn(() => r.ws.panels.get('m2')!.close());
    r.turn(() => r.ws.panels.get('m1')!.close());
    assert.equal((r.provided().recentlyClosed ?? []).length, 2, 'both are in the undo window');
    refusedWith(r.turn(flip), 'instance-limit');
  });
  await s.run('a declared closed record still counts', async () => {
    w.pastWindow();
    r.turn(() => r.ws.panels.get('m2')!.open());
    await r.settle();
    assert.equal(r.ws.panels.get('m1')!.getState().status, 'closed', 'm1 is a closed declared record');
    refusedWith(r.turn(flip), 'instance-limit');
  });
  s.end();
});

test('matrix:maxInstances', async () => {
  probe('maxInstances');
  await wrongScopeInEveryStatus({ maxInstances: 2 }, 'maxInstances');
  const r = await matrixRig({ ids: [], extra: [matrixTemplate('m', { settings: { multiple: true, maxInstances: 5 } })] });
  r.turn(() => void [r.ws.addPanel('m', { id: 'm1' }), r.ws.addPanel('m', { id: 'm2' }), r.ws.addPanel('m', { id: 'm3' })]);
  await r.settle();
  const entries = r.m.latest().entries;
  const renders = r.m.renders();
  const refusal = refusedWith(r.turn(() => r.ws.panels.configureTemplate('m', { maxInstances: 2 })), 'instance-limit');
  assert.equal(refusal.setting, 'maxInstances');
  assert.match(refusal.message, /3 instances/, 'the refusal carries the count');
  sameRow(r, entries, renders, 'lowering below the instances that exist');
  assert.deepEqual(r.ws.panels.list().map((h) => h.getState().status), ['live', 'live', 'live', 'live'], 'no instance is closed');
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTemplate('m', { maxInstances: 9 }))) }, { ok: true, changed: true, shown: false, now: [], later: ['maxInstances'], shadowed: [], notes: [] }, 'raising it is stored');
  assert.equal(done(r.turn(() => r.ws.panels.configureTemplate('m', { maxInstances: 3 }))).changed, true, 'lowering to the count is accepted');
  assert.equal(done(r.turn(() => r.ws.panels.configureTemplate('m', { maxInstances: null }))).changed, true, 'null is accepted');
  const single = await matrixRig({ ids: [], extra: [matrixTemplate('s', { settings: { multiple: false } })] });
  const moot = done(single.turn(() => single.ws.panels.configureTemplate('s', { maxInstances: 3 })));
  assert.equal(moot.notes.length + single.m.notes.length > 0, true, 'moot without multiple: a note says so, in the result or through onNote');
});

test('matrix:listed', async () => {
  probe('listed');
  const r = await matrixRig();
  const before = { id: r.entry('b').id, order: r.order().join(' '), status: r.state('b').status };
  assert.equal(listedIds(r).includes(before.id), true, 'before: the panel is in panelList');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ listed: false }))), { now: ['listed'], later: [], shadowed: [] });
  assert.equal(listedIds(r).includes(before.id), false, 'after, in that commit: its History row is gone');
  assert.deepEqual([r.order().join(' '), r.state('b').status, r.seen('b') !== null], [before.order, 'live', true], 'its slot and state do not change');
  done(r.turn(() => r.h.b!.configure({ listed: true })));
  assert.equal(listedIds(r).includes(before.id), true, 'true puts the row back');
  r.turn(() => r.h.c!.hide());
  await r.settle();
  const quiet = done(r.turn(() => r.h.c!.configure({ listed: false })));
  assert.equal(listedIds(r).includes(r.entry('c').id), false, 'a hidden panel leaves the list too');
  assert.equal(quiet.notes.some((n) => n.key === 'listed') || r.m.notes.some((n) => n.key === 'listed'), true, 'false on a held panel the gesture cannot release is showable by code only, and a note says so, in the result or through onNote');
});

test('matrix:startVisibility', async () => {
  probe('startVisibility');
  const r = await matrixRig();
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ startVisibility: 'parked' }))), { now: [], later: ['startVisibility'], shadowed: [] });
  assert.deepEqual([r.state('b').status, r.order().join(' ')], ['live', 'root a b c'], 'every existing panel keeps its state');
  const w = mockWindow();
  r.turn(() => r.h.b!.close());
  r.turn(() => r.h.c!.close());
  w.pastWindow();
  r.turn(() => r.h.c!.open());
  await r.settle();
  assert.equal(r.state('c').status, 'live', 'control: a panel with the default starts live');
  r.turn(() => r.h.b!.open());
  await r.settle();
  assert.equal(r.state('b').status, 'parked', 'C: the next open() uses the new value');
  const fixed = await matrixRig();
  const conflict = refusedWith(fixed.turn(() => fixed.h.a!.configure({ parkable: false, startVisibility: 'parked' })), 'settings-conflict');
  assert.equal(conflict.setting, 'startVisibility');
  assert.match(conflict.message, /C1/);
});

test('matrix:hideStickiness', async () => {
  probe('hideStickiness');
  const r = await matrixRig({ ids: ['a', 'b', 'c'], park: true, width: 1700 });
  await r.settle();
  assert.equal(r.live().join(' '), 'root a b c');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ hideStickiness: 'until-room' }))), { now: [], later: ['hideStickiness'], shadowed: [] });
  assert.equal(r.live().join(' '), 'root a b c', 'nothing is hidden or shown at configure');
  r.turn(() => r.h.b!.hide());
  await r.settle();
  assert.deepEqual([r.state('b').status, r.state('b').held], ['parked', true], 'the next hide() holds the panel');
  r.turn(() => r.h.c!.hide());
  await r.settle();
  assert.deepEqual([r.state('b').status, r.state('c').status], ['live', 'parked'], 'a second hide frees more slots than the first left: the until-room panel returns, the sticky one stays hidden');
});

test('matrix:hideWhenLast', async () => {
  probe('hideWhenLast');
  const control = await matrixRig({ ids: ['a', 'b'], root: false });
  control.turn(() => control.h.a!.close());
  assert.equal(letter(control.turn(() => control.h.b!.hide())), 'T', 'control: the last panel hides under the default');
  const r = await matrixRig({ ids: ['a', 'b'], root: false });
  r.turn(() => r.h.a!.close());
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ hideWhenLast: 'refuse' }))), { now: [], later: ['hideWhenLast'], shadowed: [] });
  assert.equal(r.state('b').status, 'live', 'configure hides nothing');
  assert.equal(letter(r.turn(() => r.h.b!.hide())), 'would-empty-row', 'the next hide() reads it');
  assert.equal(r.state('b').status, 'live');
  const hidden = await matrixRig({ ids: ['a', 'b'], root: false });
  hidden.turn(() => hidden.h.a!.hide());
  done(hidden.turn(() => hidden.h.a!.configure({ hideWhenLast: 'refuse' })));
  assert.equal(hidden.state('a').status, 'parked', 'a panel already hidden stays hidden');
});

test('matrix:capacityReturn', async () => {
  probe('capacityReturn');
  const c = matrixTemplate('c', { settings: { overflow: 'park' } });
  const control = await matrixRig({ ids: ['a', 'b'], park: true, width: 1000, extra: [c] });
  await control.settle();
  control.turn(() => void control.ws.addPanel('c'));
  await control.settle();
  control.turn(() => control.ws.panels.get('c')!.close());
  await control.settle();
  assert.equal(control.state('b').status, 'live', 'control: a panel parked for room returns when room opens');
  const r = await matrixRig({ ids: ['a', 'b'], park: true, width: 1000, extra: [c] });
  await r.settle();
  assert.deepEqual([r.state('a').status, r.state('b').status], ['parked', 'live']);
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ capacityReturn: 'manual' }))), { now: [], later: ['capacityReturn'], shadowed: [] });
  assert.equal(r.live().join(' '), 'root b', 'nothing returns at configure');
  r.turn(() => void r.ws.addPanel('c'));
  await r.settle();
  assert.equal(r.state('b').status, 'parked', 'opening c parks b after the commit');
  r.turn(() => r.ws.panels.get('c')!.close());
  await r.settle();
  assert.deepEqual([r.state('b').status, r.state('a').status], ['parked', 'live'], 'b was parked after it became manual, so it stays parked; a, parked before, still returns');
});

test('matrix:returnPriority', async () => {
  probe('returnPriority');
  const control = await matrixRig({ ids: ['a', 'b', 'c'], park: true, width: 1000 });
  await control.settle();
  assert.equal(control.live().join(' '), 'root c');
  control.turn(() => control.h.c!.close());
  await control.settle();
  assert.equal(control.live().join(' '), 'root b', 'control: the latest parked returns first');
  const r = await matrixRig({ ids: ['a', 'b', 'c'], park: true, width: 1000 });
  await r.settle();
  assert.deepEqual(shape(r.turn(() => r.h.a!.configure({ returnPriority: 5 }))), { now: [], later: ['returnPriority'], shadowed: [] });
  assert.equal(r.live().join(' '), 'root c', 'nothing returns at configure');
  r.turn(() => r.h.c!.close());
  await r.settle();
  assert.equal(r.live().join(' '), 'root a', 'the next walk of the stack returns the higher priority first');
});

test('matrix:overflow', async () => {
  probe('overflow');
  const opens = async (configure: boolean): Promise<string> => {
    const c = matrixTemplate('c', { settings: { overflow: 'park' } });
    const r = await matrixRig({ ids: ['a', 'b'], park: true, width: 1300, extra: [c] });
    await r.settle();
    if (configure) {
      assert.deepEqual(shape(r.turn(() => r.h.a!.configure({ overflow: 'scroll' }))), { now: [], later: ['overflow'], shadowed: [] });
      assert.equal(r.live().join(' '), 'root a b', 'nothing parks or returns at configure');
    }
    r.turn(() => void r.ws.addPanel('c'));
    await r.settle();
    r.m.unmount();
    return r.live().join(' ');
  };
  assert.equal(await opens(false), 'root b c', 'control: opening c parks a, the farthest');
  assert.equal(await opens(true), 'root a c', 'park to scroll: a is no longer parked for room, so b goes instead');
  const wide = await matrixRig({ ids: ['a', 'b', 'c'], width: 1300 });
  await wide.settle();
  assert.equal(wide.live().join(' '), 'root a b c', 'three scroll panels overflow a row of two');
  assert.deepEqual(shape(wide.turn(() => wide.h.a!.configure({ overflow: 'park' }))), { now: [], later: ['overflow'], shadowed: [] });
  await wide.settle();
  assert.equal(wide.live().join(' '), 'root a b c', 'scroll to park: eligible only at the next overflow, so nothing parks now');
  const fixed = await matrixRig();
  done(fixed.turn(() => fixed.h.a!.configure({ parkable: false })));
  const conflict = refusedWith(fixed.turn(() => fixed.h.a!.configure({ overflow: 'park' })), 'settings-conflict');
  assert.equal(conflict.setting, 'overflow');
});

test('matrix:evictionRank', async () => {
  probe('evictionRank');
  const opens = async (rank: number | undefined): Promise<string> => {
    const c = matrixTemplate('c', { settings: { overflow: 'park' } });
    const r = await matrixRig({ ids: ['a', 'b'], park: true, width: 1300, extra: [c] });
    await r.settle();
    if (rank !== undefined) {
      assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ evictionRank: rank }))), { now: [], later: ['evictionRank'], shadowed: [] });
      assert.equal(r.live().join(' '), 'root a b', 'nothing is re-evaluated at configure');
    }
    r.turn(() => void r.ws.addPanel('c'));
    await r.settle();
    r.m.unmount();
    return r.live().join(' ');
  };
  assert.equal(await opens(undefined), 'root b c', 'control: equal ranks park the farthest, a');
  assert.equal(await opens(-3), 'root a c', 'the lower rank is parked first at the next park decision');
});

test('matrix:evictionOrder', async () => {
  probe('evictionOrder');
  const showing = async (order: 'nearest' | undefined): Promise<string> => {
    const r = await matrixRig({ ids: ['a', 'b', 'c', 'd'], park: true, width: 1700 });
    await r.settle();
    assert.equal(r.live().join(' '), 'root b c d');
    if (order !== undefined) {
      assert.deepEqual(shape(r.turn(() => r.h.a!.configure({ evictionOrder: order }))), { now: [], later: ['evictionOrder'], shadowed: [] });
      assert.equal(r.live().join(' '), 'root b c d', 'nothing moves at configure');
    }
    r.turn(() => r.h.a!.show());
    await r.settle();
    r.m.unmount();
    return r.live().join(' ');
  };
  assert.equal(await showing(undefined), 'root a b c', 'control: farthest parks d');
  assert.equal(await showing('nearest'), 'root a c d', 'nearest parks b when a next needs room');
});

const swipeRight = (r: MatrixRig, dx = 50): void => act(() => void r.m.container.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, cancelable: true, bubbles: true })));

test('matrix:revealOnScroll', async () => {
  probe('revealOnScroll');
  // Window 398 wide shows only the root; b is parked by the engine for room and c is live beyond the window edge.
  const swiped = async (reveal: 'any' | 'never' | undefined): Promise<string> => {
    const r = await matrixRig({ ids: ['b', 'c'], park: true, width: 430 });
    await r.settle();
    assert.equal(r.live().join(' '), 'root c');
    if (reveal !== undefined) {
      assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ revealOnScroll: reveal }))), { now: [], later: ['revealOnScroll'], shadowed: [] });
      assert.equal(r.live().join(' '), 'root c', 'nothing is revealed by configure');
      assert.equal(r.m.container.scrollLeft, 0, 'and nothing scrolls');
    }
    swipeRight(r);
    await r.settle();
    const live = r.live().join(' ');
    if (reveal === 'never') assert.equal(letter(r.turn(() => r.h.b!.show())), 'T', 'show() always works');
    r.m.unmount();
    return live;
  };
  assert.equal(await swiped(undefined), 'root c', 'control: under edges the swipe steps past the engine-parked panel to c');
  assert.equal(await swiped('any'), 'root b', 'K: edges to any makes the engine-parked panel reachable');
  assert.equal(await swiped('never'), 'root c', 'never skips it');
  const held = await matrixRig({ ids: ['b', 'c'], width: 430 });
  held.turn(() => held.h.b!.hide());
  await held.settle();
  swipeRight(held);
  await held.settle();
  assert.equal(held.state('b').status, 'live', 'H: a hidden panel is reached under edges');
});

test('matrix:scrollOnOpen', async () => {
  probe('scrollOnOpen');
  const r = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e'], width: 1000 });
  await r.settle();
  assert.equal(r.m.container.scrollLeft, 0);
  assert.deepEqual(shape(r.turn(() => r.h.c!.configure({ scrollOnOpen: 'start' }))), { now: [], later: ['scrollOnOpen'], shadowed: [] });
  await r.settle();
  assert.equal(r.m.container.scrollLeft, 0, 'no scroll happens at configure');
  r.turn(() => r.h.c!.scrollTo());
  await r.settle();
  assert.equal(r.m.container.scrollLeft, 1218, "scrollTo() defaults to the setting: c's left edge 1234 less the 16 gap");
  done(r.turn(() => r.h.c!.configure({ scrollOnOpen: 'none' })));
  r.turn(() => r.h.a!.scrollTo('start'));
  await r.settle();
  r.turn(() => r.h.c!.scrollTo());
  await r.settle();
  assert.equal(r.m.container.scrollLeft, 640, "none: scrollTo() falls back to into-view, c's right edge 1624 less the 984 visible");
  const hidden = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e'], width: 1000 });
  hidden.turn(() => hidden.h.c!.hide());
  await hidden.settle();
  done(hidden.turn(() => hidden.h.c!.configure({ scrollOnOpen: 'start' })));
  assert.equal(hidden.m.container.scrollLeft, 0, 'K, H: stored, nothing scrolls');
  hidden.turn(() => hidden.h.c!.show());
  await hidden.settle();
  assert.equal(hidden.m.container.scrollLeft, 1218, 'the next show of the hidden panel reads it');
});

test('matrix:scrollOnMove', async () => {
  probe('scrollOnMove');
  const grown = async (none: boolean): Promise<number> => {
    const r = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e'], width: 1000 });
    await r.settle();
    if (none) {
      assert.deepEqual(shape(r.turn(() => r.h.a!.configure({ scrollOnMove: 'none' }))), { now: [], later: ['scrollOnMove'], shadowed: [] });
      await r.settle();
      assert.equal(r.m.container.scrollLeft, 0, 'nothing scrolls at configure');
    }
    r.turn(() => r.h.a!.setFormFactor('tablet'));
    await r.settle();
    const at = r.m.container.scrollLeft;
    r.m.unmount();
    return at;
  };
  assert.equal(await grown(false), 206, 'control: a in view grows to 768 and the row follows by the least distance that shows it whole');
  assert.equal(await grown(true), 0, 'the next move reads none: the row stays');
});

test('matrix:toggleWhenClosed', async () => {
  probe('toggleWhenClosed');
  const r = await matrixRig();
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ toggleWhenClosed: 'reopen' }))), { now: [], later: ['toggleWhenClosed'], shadowed: [] });
  r.turn(() => r.h.b!.close());
  r.turn(() => r.h.c!.close());
  assert.equal(letter(r.turn(() => r.h.c!.toggleVisibility())), 'F', 'control: the default ignores a toggle on a closed panel: accepted, nothing happens');
  assert.equal(r.state('c').status, 'closed');
  assert.equal(letter(r.turn(() => r.h.b!.toggleVisibility())), 'T', 'the next toggle reopens it');
  await r.settle();
  assert.equal(r.state('b').status, 'live');
  r.turn(() => r.h.c!.configure({ toggleWhenClosed: 'reopen' }));
  assert.equal(letter(r.turn(() => r.h.c!.toggleVisibility())), 'T', 'C, U: a record configured while closed is used by the next toggle');
});

test('matrix:showWhenClosed', async () => {
  probe('showWhenClosed');
  const r = await matrixRig();
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ showWhenClosed: 'reopen' }))), { now: [], later: ['showWhenClosed'], shadowed: [] });
  r.turn(() => r.h.b!.close());
  r.turn(() => r.h.c!.close());
  assert.equal(letter(r.turn(() => r.h.c!.show())), 'is-closed', 'control: the default refuses show() on a closed panel');
  assert.equal(letter(r.turn(() => r.h.b!.show())), 'T', 'the next show() reopens it');
  await r.settle();
  assert.equal(r.state('b').status, 'live');
  r.turn(() => r.h.c!.configure({ showWhenClosed: 'reopen' }));
  assert.equal(letter(r.turn(() => r.h.c!.show())), 'T', 'C, U: a record configured while closed is used');
});

test('matrix:viewState', async () => {
  probe('viewState');
  const r = await matrixRig({ ids: ['a', 'b', 'c', 'd'] });
  const n = (id: string): string | undefined => r.seen(id)?.['data-n'];
  const id = (name: string): string => r.entry(name).id;
  for (const name of ['b', 'c', 'd']) viewLog.setState(id(name), 7);
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ viewState: 'reset-on-park' }))), { now: [], later: ['viewState'], shadowed: [] });
  assert.equal(n('b'), '7', 'nothing is released at configure');
  for (const name of ['b', 'c']) r.turn(() => r.h[name]!.hide());
  await r.settle();
  for (const name of ['b', 'c']) r.turn(() => r.h[name]!.show());
  await r.settle();
  assert.deepEqual([n('b'), n('c')], ['0', '7'], 'the next park released the cell under reset-on-park and kept it under keep');
  r.turn(() => r.h.d!.hide());
  await r.settle();
  done(r.turn(() => r.h.d!.configure({ viewState: 'reset-on-park' })));
  r.turn(() => r.h.d!.show());
  await r.settle();
  assert.equal(n('d'), '7', 'a change made after a park reaches the next park only');
  const e = await matrixRig({ ids: ['a'], settings: { a: { keepMounted: true } } });
  const clash = refusedWith(e.turn(() => e.h.a!.configure({ viewState: 'reset-on-park' })), 'settings-conflict');
  assert.equal(clash.setting, 'keepMounted', 'with keepMounted true, reset-on-park is a conflict: the asked keepMounted is the one C6 overrides');
  assert.match(clash.message, /C6/);
  assert.equal(done(e.turn(() => e.h.a!.configure({ keepMounted: false, viewState: 'reset-on-park' }))).changed, true, 'patching keepMounted false in the same call is accepted');
});

test('matrix:keepMounted', async () => {
  probe('keepMounted');
  const r = await matrixRig({ ids: ['a', 'b', 'c'] });
  const engine = (name: string): string => r.entry(name).id;
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ keepMounted: true }))), { now: [], later: ['keepMounted'], shadowed: [] });
  for (const name of ['b', 'c']) r.turn(() => r.h[name]!.hide());
  await r.settle();
  assert.deepEqual([r.seen('b')?.['data-hidden'], viewLog.unmounted(engine('b'))], ['true', 0], 'L, T: the next park keeps the view mounted and hidden');
  assert.deepEqual([r.seen('c'), viewLog.unmounted(engine('c'))], [null, 1], 'control: the default unmounts it');
  for (const name of ['b', 'c']) r.turn(() => r.h[name]!.show());
  await r.settle();
  assert.deepEqual([viewLog.mounted(engine('b')), viewLog.mounted(engine('c'))], [1, 2], 'and showing it again remounts only the one that was unmounted');
  done(r.turn(() => r.h.b!.configure({ keepMounted: false })));
  r.turn(() => r.h.b!.hide());
  await r.settle();
  assert.equal(r.seen('b'), null, 'true to false: the next park unmounts');
  const conflict = await matrixRig({ ids: ['a'], settings: { a: { viewState: 'reset-on-park' } } });
  const clash = refusedWith(conflict.turn(() => conflict.h.a!.configure({ keepMounted: true })), 'settings-conflict');
  assert.equal(clash.setting, 'keepMounted');
  assert.match(clash.message, /C6/);
});

test('the class table ran every cell: executed cells equal 4 classes by 9 statuses, 36', () => {
  assert.equal(CLASSES.length * STATUSES.length, 36);
  assert.equal(cellsExecuted().size, 36);
  for (const cls of CLASSES) for (const status of STATUSES) assert.equal(cellsExecuted().has(`${cls}/${status}`), true, `${cls}/${status} ran`);
  assert.equal(Object.values(CLASS_TABLE).reduce((sum, row) => sum + Object.keys(row).length, 0), 36);
});
