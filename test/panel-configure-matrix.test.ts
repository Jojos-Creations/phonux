/**
 * The configure matrix: the 36 cells of the class table (4 classes by 9 statuses), then one probe per catalog name.
 * Every expectation is written from the configure design and the catalog's `on_configure` cells, never from the code
 * under test.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './support/jsdom-globals.js';
import { act, createElement } from 'react';
import type { ConfigureResult, HeaderButton, PanelSettings, WorkspaceStorage } from '../index.js';
import { memoryWorkspaceStorage } from '../fakeHost.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { headerRig } from './support/header-rig.js';
import { drag, release } from './support/drag-gesture.js';
import { rowScrollerFor } from './support/workspace-row.js';
import {
  CATALOG_NAMES,
  CLASSES,
  CLASS_TABLE,
  HALF_ZONE_POINTER,
  LIBRARY_TUNING_DEFAULTS,
  STATUSES,
  arrange,
  cell,
  cellsExecuted,
  done,
  dragRig,
  heldScroll,
  letter,
  matrixRig,
  matrixTemplate,
  mockWindow,
  probe,
  probesExecuted,
  refusedWith,
  soft,
  viewLog,
  type Arranged,
  type Cls,
  type MatrixRig,
  type MatrixRigOptions,
  type Status,
} from './support/configure-matrix.js';

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  cleanup();
  viewLog.reset();
});

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

function assertSideEffects(a: Arranged, before: Trace, cell: (typeof CLASS_TABLE)['NOW']['live']): void {
  if (cell.evicts !== null) assert.equal(a.r.capture.evicted.length - before.evicted, cell.evicts, 'host evict calls the configure caused');
  if (cell.unmounts !== null && before.engineId !== null) assert.equal(viewLog.unmounted(before.engineId) - before.unmounted, cell.unmounts, 'view unmounts the configure caused');
}

// P and F cells ran another operation in the turn, so the whole row is compared only for the other refusals.
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

const NEXT_PATCH = { hideStickiness: 'until-room', snapshot: 'never', persist: 'session' } as const;

const wait = (): Promise<void> => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 150))));
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
  for (const e of before.entries) if (e.id !== before.engineId) assert.equal(r.m.latest().entries.includes(e), true, `entry ${e.id} is the same object`);
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
  const closedCounts = status === 'closed-declared' || status === 'undo-window';
  const lowered = closedCounts ? 'multiple' : 'maxInstances';
  const lower = (): ConfigureResult => r.ws.panels.configureTemplate('m', closedCounts ? { multiple: false } : { maxInstances: 1 });
  const [high, low] = r.turn(() => {
    early?.();
    return [raise(), lower()] as const;
  });
  assert.deepEqual({ ...done(high) }, { ok: true, changed: true, shown: false, now: [], later: ['hostCreatable'], shadowed: [], notes: [] }, 'a template key that cannot strand an instance is stored, whatever the instance is doing (a template names no panel, so it is never busy)');
  if (cell.counted === true) {
    const refusal = refusedWith(low, 'instance-limit');
    assert.equal(refusal.setting, lowered);
    assert.match(refusal.message, /2 instances/, 'the refusal counts the instances that exist');
  } else {
    assert.deepEqual({ ...done(low) }, { ok: true, changed: true, shown: false, now: [], later: ['maxInstances'], shadowed: [], notes: [] }, 'an instance that is gone does not count');
  }
  assert.equal(r.capture.evicted.length - was.evicted, cell.evicts, 'no instance is touched');
}

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


const slot = (label: string): HeaderButton => ({ icon: createElement('i', { 'data-icon': label }), label, onClick: () => undefined });
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
  assert.deepEqual(shape(r.turn(() => r.h.a!.configure({ parkable: false, resizable: true }))), { now: ['parkable', 'resizable'], later: [], shadowed: [] }, 'resizable true beside a fixed column stands: the panel asked for its size itself');
  assert.equal(r.state('a').settings.resizable, true);
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
    assert.deepEqual(shape(r.turn(() => r.h.f!.configure({ parkable: false }))), { now: [], later: ['parkable'], shadowed: [] });
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
  const savedTier = r.entry('b').overrides?.slots;
  assert.deepEqual([r.entry('b').formFactor, savedTier], ['tablet', 2], 'before: the person chose tablet, two slots');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ resizable: false }))), { now: ['resizable'], later: [], shadowed: [] });
  assert.equal(letter(r.turn(() => r.h.b!.setFormFactor('phone'))), 'not-resizable', 'after: setFormFactor is refused');
  assert.deepEqual([r.entry('b').formFactor, r.entry('b').overrides?.slots], ['tablet', 2], "the tier and the person's saved size are never changed or dropped");
  assert.equal(letter(r.turn(() => r.h.a!.setFormFactor('tablet'))), 'T', 'a neighbour still resizes');
  r.turn(() => r.h.c!.hide());
  await r.settle();
  done(r.turn(() => r.h.c!.configure({ resizable: false })));
  assert.equal(letter(r.turn(() => r.h.c!.setFormFactor('tablet'))), 'not-resizable', 'a hidden panel refuses too');
  const fixed = await matrixRig();
  done(fixed.turn(() => fixed.h.a!.configure({ parkable: false })));
  assert.equal(shape(fixed.turn(() => fixed.h.a!.configure({ resizable: true }))).now[0], 'resizable', 'C1: true asked for the fixed column itself stands');
  assert.equal(fixed.state('a').settings.resizable, true);
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

test('matrix:frame', async () => {
  probe('frame');
  const r = await matrixRig();
  const headers = (id: string): number => r.m.container.querySelector(`[data-slot="${r.entry(id).id}"]`)!.closest('[data-row-slot]')!.querySelectorAll('[data-panel-chrome-part="header"]').length;
  assert.equal(headers('b'), 0, 'before: the view draws no frame and the template says none');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ frame: 'auto' }))), { now: ['frame'], later: [], shadowed: [] });
  await r.settle();
  assert.equal(headers('b'), 1, 'after: the library draws its frame around the view');
  assert.equal(headers('c'), 0, 'a neighbour is untouched');
  done(r.turn(() => r.h.b!.configure({ frame: 'none' })));
  await r.settle();
  assert.equal(headers('b'), 0, 'none takes it away again');
  r.turn(() => r.h.c!.hide());
  await r.settle();
  const parked = done(r.turn(() => r.h.c!.configure({ frame: 'auto' })));
  assert.equal(parked.changed, true, 'a parked panel stores it for when it returns');
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
  const held = await matrixRig({ ids: ['a', 'b', 'c'], park: true, width: 1700 });
  await held.settle();
  held.turn(() => held.h.b!.hide());
  await held.settle();
  done(held.turn(() => held.h.b!.configure({ hideStickiness: 'until-room' })));
  assert.deepEqual([held.state('b').status, held.state('b').held, held.live().join(' ')], ['parked', true, 'root a c'], 'a hidden panel keeps the hold it has and configure shows nothing');
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
  const held = await matrixRig({ ids: ['a', 'b'], park: true, width: 1300 });
  await held.settle();
  held.turn(() => held.h.a!.hide());
  await held.settle();
  done(held.turn(() => held.h.a!.configure({ capacityReturn: 'manual' })));
  assert.deepEqual([held.state('a').status, held.state('a').held], ['parked', true], 'a panel already held stays held and nothing is revealed');
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
  const r = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e'], width: 1000, workspace: { tuning: { rowGesture: 'free' } } });
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
  const hidden = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e'], width: 1000, workspace: { tuning: { rowGesture: 'free' } } });
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
    const r = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e'], width: 1000, workspace: { tuning: { rowGesture: 'free' } } });
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
  assert.equal(await grown(false), 234, 'control: a in view grows to two slots, 796 px, and the row follows by the least distance that shows it whole');
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

const slotAt = (r: MatrixRig, engineId: string): HTMLElement | null => r.m.container.querySelector<HTMLElement>(`[data-slot="${engineId}"]`)?.parentElement ?? null;
const axisOf = (el: HTMLElement | null, name: 'X' | 'Y'): number => {
  const match = el === null ? null : new RegExp(`translate${name}\\((-?[\\d.]+)px\\)`).exec(el.style.transform);
  return match === null ? 0 : Number(match[1]);
};
const frames = (n: number): Promise<void> => advanceFrames(n * 16);

test('matrix:placeOnAdd', async () => {
  probe('placeOnAdd');
  const r = await matrixRig();
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ placeOnAdd: 'row-start' }))), { now: [], later: ['placeOnAdd'], shadowed: [] });
  assert.equal(r.order().join(' '), 'root a b c', 'no live panel moves');
  r.turn(() => r.h.a!.close());
  r.turn(() => r.h.a!.open());
  await r.settle();
  assert.equal(r.order().join(' '), 'root b c a', 'control: the default adds at the row end');
  r.turn(() => r.h.b!.close());
  r.turn(() => r.h.b!.open());
  await r.settle();
  assert.equal(r.order().join(' '), 'b root c a', 'the next add of this panel lands where the new value says');
  r.turn(() => r.h.c!.hide());
  await r.settle();
  done(r.turn(() => r.h.c!.configure({ placeOnAdd: 'row-start' })));
  assert.equal(r.order().join(' '), 'b root c a', 'a hidden panel does not move either');
  assert.equal(r.state('c').status, 'parked');
  assert.equal(thrownCode(() => r.h.a!.configure({ placeOnAdd: 'in-place' } as never)), 'invalid-settings', 'in-place throws');
  assert.equal(r.order().join(' '), 'b root c a');
  r.turn(() => r.h.c!.show());
  await r.settle();
  done(r.turn(() => r.h.a!.configure({ placeOnAdd: 'row-start' })));
  const reset = r.turn(() => r.ws.panels.resetLayout('a'));
  assert.deepEqual([reset.ok && reset.changed, reset.ok && reset.panels], [true, ['a']], 'resetLayout reads it');
  assert.equal(r.order().join(' '), 'a b root c');
});

test('matrix:placeOnShow', async () => {
  probe('placeOnShow');
  const r = await matrixRig();
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ placeOnShow: 'row-start' }))), { now: [], later: ['placeOnShow'], shadowed: [] });
  assert.equal(r.order().join(' '), 'root a b c', 'nothing moves at configure');
  r.turn(() => r.h.b!.hide());
  r.turn(() => r.h.a!.hide());
  await r.settle();
  assert.deepEqual([r.state('b').status, r.state('a').status, r.order().join(' ')], ['parked', 'parked', 'root a b c'], 'a hidden panel is neither re-placed nor revealed');
  r.turn(() => r.h.a!.show());
  await r.settle();
  assert.equal(r.order().join(' '), 'root a b c', 'control: the default shows in place');
  r.turn(() => r.h.b!.show());
  await r.settle();
  assert.equal(r.order().join(' '), 'b root a c', 'the next show uses the new placement');
});

test('matrix:placeOnReturn', async () => {
  probe('placeOnReturn');
  const returned = async (placement: 'row-end' | undefined): Promise<string> => {
    const r = await matrixRig({ ids: ['a', 'b', 'c'], park: true, width: 1000, settings: { a: { returnPriority: 5 } } });
    await r.settle();
    assert.equal(r.live().join(' '), 'root c');
    if (placement !== undefined) {
      assert.deepEqual(shape(r.turn(() => r.h.a!.configure({ placeOnReturn: placement }))), { now: [], later: ['placeOnReturn'], shadowed: [] });
      assert.equal(r.order().join(' '), 'root a b c', 'nothing moves at configure');
    }
    r.turn(() => r.h.c!.close());
    await r.settle();
    assert.equal(r.state('a').status, 'live', 'a returned first by its priority');
    const order = r.order().join(' ');
    r.m.unmount();
    return order;
  };
  assert.equal(await returned(undefined), 'root a b', 'control: in place');
  assert.equal(await returned('row-end'), 'root b a', 'K: the panel takes the new value when it returns');
});

test('matrix:placeFallback', async () => {
  probe('placeFallback');
  const reopened = async (fallback: 'row-start' | undefined): Promise<string> => {
    const r = await matrixRig({ settings: { a: { placeOnAdd: { after: 'ghost' } }, b: { placeOnAdd: { after: 'ghost' } } } });
    if (fallback !== undefined) {
      assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ placeFallback: fallback }))), { now: [], later: ['placeFallback'], shadowed: [] });
      assert.equal(r.order().join(' '), 'root a b c', 'nothing moves at configure');
    }
    r.turn(() => r.h.b!.close());
    r.turn(() => r.h.b!.open());
    await r.settle();
    const order = r.order().join(' ');
    r.m.unmount();
    return order;
  };
  assert.equal(await reopened(undefined), 'root a c b', 'control: a missing target falls back to the row end');
  assert.equal(await reopened('row-start'), 'b root a c', 'the next add with a missing target uses the new fallback');
  const r = await matrixRig();
  assert.equal(thrownCode(() => r.h.b!.configure({ placeFallback: 'order' } as never)), 'invalid-settings', 'a value outside the named positions throws');
});

test('matrix:undoPlacement', async () => {
  probe('undoPlacement');
  const r = await matrixRig();
  r.turn(() => r.h.a!.close());
  r.turn(() => r.provided().undoClose());
  await r.settle();
  assert.equal(r.order().join(' '), 'root a b c', 'control: the default puts an undone panel back in its old slot');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ undoPlacement: 'row-end' }))), { now: [], later: ['undoPlacement'], shadowed: [] });
  assert.equal(r.order().join(' '), 'root a b c', 'nothing moves at configure');
  r.turn(() => r.h.b!.close());
  r.turn(() => r.provided().undoClose());
  await r.settle();
  assert.equal(r.order().join(' '), 'root a c b', 'the undo places by the new value');
  r.turn(() => r.h.a!.close());
  done(r.turn(() => r.h.a!.configure({ undoPlacement: 'row-start' })));
  r.turn(() => r.provided().undoClose());
  await r.settle();
  assert.equal(r.order().join(' '), 'a root c b', 'U: a configure inside the undo window changes where that undo puts the panel');
});

test('matrix:layer', async () => {
  probe('layer');
  const r = await matrixRig();
  await r.settle();
  const z = (name: string): string | undefined => slotAt(r, r.entry(name).id)?.style.zIndex;
  assert.deepEqual([z('b'), z('c')], ['1', '1'], 'before: both base');
  const before = [r.order().join(' '), r.provided().rowNumbers.widths.join(','), r.provided().rowNumbers.leftOffsets.join(',')];
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ layer: 'raised' }))), { now: ['layer'], later: [], shadowed: [] });
  assert.deepEqual([z('b'), z('c')], ['2', '1'], 'after, in that commit: the z-index changes');
  assert.deepEqual([r.order().join(' '), r.provided().rowNumbers.widths.join(','), r.provided().rowNumbers.leftOffsets.join(',')], before, 'row order and widths do not change');
  done(r.turn(() => r.h.b!.configure({ layer: 'base' })));
  assert.equal(z('b'), '1');
  const engine = r.entry('c').id;
  r.turn(() => r.h.c!.hide());
  await frames(2);
  const leaving = slotAt(r, engine);
  assert.equal(leaving !== null, true, 'control: the slot is mid-exit');
  assert.equal(leaving!.style.zIndex, '1');
  done(r.turn(() => r.h.c!.configure({ layer: 'raised' })));
  assert.equal(slotAt(r, engine)?.style.zIndex, '1', 'a slot mid-exit keeps the z-index it left with');
});

test('matrix:enterFrom', async () => {
  probe('enterFrom');
  const startX = async (configure: 'left' | undefined): Promise<number> => {
    const r = await matrixRig();
    await r.settle();
    if (configure !== undefined) {
      assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ enterFrom: configure }))), { now: [], later: ['enterFrom'], shadowed: [] });
      assert.equal(r.order().join(' '), 'root a b c', 'nothing moves at configure');
    }
    r.turn(() => r.h.b!.hide());
    await r.settle();
    r.turn(() => r.h.b!.show());
    const x = axisOf(slotAt(r, r.entry('b').id), 'X');
    r.m.unmount();
    return x;
  };
  assert.equal(await startX(undefined), 812 + 406, 'control: b rests at 812 and enters from the right, one span beyond');
  assert.equal(await startX('left'), 812 - 406, 'the next enter starts one span before the rest');
  const r = await matrixRig();
  await r.settle();
  r.turn(() => r.h.b!.hide());
  await r.settle();
  r.turn(() => r.h.b!.show());
  const engine = r.entry('b').id;
  await frames(2);
  done(r.turn(() => r.h.b!.configure({ enterFrom: 'left' })));
  await frames(3);
  const x = axisOf(slotAt(r, engine), 'X');
  assert.equal(x >= 812 && x < 1218, true, `a slide in progress keeps its start side: x ${x} is still between the rest and the right start`);
});

test('matrix:exitTo', async () => {
  probe('exitTo');
  const exitX = async (configure: 'right' | undefined): Promise<number> => {
    const r = await matrixRig({ settings: { b: { exitTo: 'left' } } });
    await r.settle();
    if (configure !== undefined) {
      assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ exitTo: configure }))), { now: [], later: ['exitTo'], shadowed: [] });
      assert.equal(r.order().join(' '), 'root a b c', 'nothing moves at configure');
    }
    const engine = r.entry('b').id;
    r.turn(() => r.h.b!.hide());
    await frames(6);
    const slot = slotAt(r, engine);
    assert.equal(slot !== null, true, 'the slot is mid-exit');
    const x = axisOf(slot, 'X');
    r.m.unmount();
    return x;
  };
  assert.equal((await exitX(undefined)) < 812, true, 'control: left leaves below the rest x of 812');
  assert.equal((await exitX('right')) > 812, true, 'the next park exits to the right');
  const r = await matrixRig({ settings: { b: { exitTo: 'left' } } });
  await r.settle();
  const engine = r.entry('b').id;
  r.turn(() => r.h.b!.hide());
  await frames(2);
  const before = axisOf(slotAt(r, engine), 'X');
  done(r.turn(() => r.h.b!.configure({ exitTo: 'right' })));
  await frames(3);
  assert.equal(axisOf(slotAt(r, engine), 'X') < before, true, 'an exit in progress is unchanged: it keeps heading left');
});

test('matrix:closeExit', async () => {
  probe('closeExit');
  const exitOf = async (configure: 'down' | undefined): Promise<{ x: number; y: number }> => {
    const r = await matrixRig({ wired: true, settings: { b: { closeExit: 'left' } } });
    await r.settle();
    if (configure !== undefined) {
      assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ closeExit: configure }))), { now: [], later: ['closeExit'], shadowed: [] });
    }
    const engine = r.entry('b').id;
    r.turn(() => r.h.b!.close());
    await frames(3);
    const slot = slotAt(r, engine);
    assert.equal(slot !== null, true, 'the slot is mid-exit');
    const out = { x: axisOf(slot, 'X'), y: axisOf(slot, 'Y') };
    r.m.unmount();
    return out;
  };
  const left = await exitOf(undefined);
  assert.deepEqual([left.x < 812, left.y], [true, 0], 'control: left slides sideways');
  const down = await exitOf('down');
  assert.deepEqual([down.x, down.y > 0], [812, true], 'the next close slides down');
  const r = await matrixRig();
  assert.deepEqual(r.turn(() => [letter(r.h.b!.close()), letter(r.h.b!.configure({ closeExit: 'down' }))]), ['T', 'busy'], 'a configure in the turn of a close is busy');
});

test('matrix:animated', async () => {
  probe('animated');
  const stillSliding = async (configure: boolean): Promise<boolean> => {
    const r = await matrixRig({ ids: ['a', 'b', 'c'] });
    await r.settle();
    const engine = r.entry('b').id;
    if (configure) {
      assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ animated: false }))), { now: [], later: ['animated'], shadowed: [] });
      assert.equal(r.order().join(' '), 'root a b c', 'nothing moves at configure');
    }
    r.turn(() => r.h.b!.hide());
    await frames(3);
    const present = slotAt(r, engine) !== null;
    r.m.unmount();
    return present;
  };
  assert.equal(await stillSliding(false), true, 'control: an animated exit is still sliding after three frames');
  assert.equal(await stillSliding(true), false, 'the next exit of this panel has no duration');
  const r = await matrixRig({ ids: ['a', 'b', 'c'] });
  await r.settle();
  const engine = r.entry('b').id;
  r.turn(() => r.h.b!.hide());
  await frames(2);
  done(r.turn(() => r.h.b!.configure({ animated: false })));
  await frames(3);
  assert.equal(slotAt(r, engine) !== null, true, 'an animation running finishes as started: five frames in, it is still sliding');
});

test('matrix:formFactor', async () => {
  probe('formFactor');
  const r = await matrixRig();
  assert.deepEqual([r.entry('b').formFactor, r.state('b').settings.formFactor], ['phone', 'phone']);
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ formFactor: 'tablet' }))), { now: [], later: ['formFactor'], shadowed: [] });
  assert.deepEqual([r.entry('b').formFactor, r.state('b').formFactor, r.h.b!.getSettings().value.formFactor], ['phone', 'phone', 'tablet'], 'a live panel is never resized: only the default tier changes');
  r.turn(() => r.h.b!.close());
  r.turn(() => r.h.b!.open());
  await r.settle();
  assert.equal(r.entry('b').formFactor, 'tablet', 'the next open() uses the new default');
  r.turn(() => r.h.c!.setFormFactor('desktop', 'person'));
  const shadowed = shape(r.turn(() => r.h.c!.configure({ formFactor: 'tablet' })));
  assert.deepEqual(shadowed, { now: [], later: ['formFactor'], shadowed: ['formFactor'] }, "the person's recorded tier wins");
  assert.equal(r.entry('c').formFactor, 'desktop');
  const conflict = refusedWith(r.turn(() => r.h.a!.configure({ formFactors: ['phone'], formFactor: 'tablet' })), 'settings-conflict');
  assert.equal(conflict.setting, 'formFactor');
  r.turn(() => r.h.a!.configure({ formFactor: 'tablet' }));
  const reset = r.turn(() => r.ws.panels.resetLayout('a'));
  assert.deepEqual([reset.ok && reset.changed, reset.ok && reset.panels], [true, ['a']], 'resetLayout reads it too');
  assert.equal(r.entry('a').formFactor, 'tablet');
});

test('matrix:title', async () => {
  probe('title');
  const logged: string[] = [];
  const r = await matrixRig({ settings: { b: { title: 'Bee' } }, over: { onPanelsClosed: (e) => void logged.push(e.title) } });
  assert.deepEqual([r.seen('b')?.['data-title'], summaryOf(r, 'b')?.title], ['Bee', 'Bee']);
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ title: 'Renamed' }))), { now: ['title'], later: [], shadowed: [] });
  assert.deepEqual([r.seen('b')?.['data-title'], summaryOf(r, 'b')?.title, r.state('b').title], ['Renamed', 'Renamed', 'Renamed'], 'after, in that commit: the header title and the History row');
  done(r.turn(() => r.h.b!.configure({ title: null })));
  assert.equal(r.seen('b')?.['data-title'], 'Bee', 'null restores the cascade value');
  r.turn(() => r.h.c!.hide());
  await r.settle();
  done(r.turn(() => r.h.c!.configure({ title: 'Hidden title' })));
  assert.equal(summaryOf(r, 'c')?.title, 'Hidden title', 'K, H: the History row changes at once');
  r.turn(() => r.h.b!.close());
  done(r.turn(() => r.h.b!.configure({ title: 'After close' })));
  assert.deepEqual(logged, ['Bee'], 'the closed-pages log entry keeps the old title');
  r.turn(() => r.provided().undoClose());
  await r.settle();
  assert.equal(r.seen('b')?.['data-title'], 'After close', 'U: the undo rebuilds with the new title');
});

test('matrix:pinning', async () => {
  probe('pinning');
  const r = await matrixRig();
  const SWAPPED = { pinned: { parkable: true }, unpinned: { parkable: false } };
  assert.deepEqual([r.state('c').pinned, r.seen('c')?.['data-pinned']], [false, 'false'], 'before: c is right of the root, so not pinned');
  const order = r.order().join(' ');
  const renders = r.m.renders();
  assert.deepEqual(shape(r.turn(() => r.h.c!.configure({ pinning: SWAPPED }))), { now: ['pinning'], later: [], shadowed: [] });
  assert.equal(r.state('c').pinned, true, 'after, in that commit: PanelState.pinned is re-read from the new definition');
  assert.deepEqual([r.order().join(' '), r.live().join(' ')], [order, 'root a b c'], 'nothing moves, parks, shows or scrolls');
  assert.equal(r.m.renders() - renders, 1, 'one commit');
  assert.equal(r.seen('c')?.['data-pinned'], 'false', 'usePanelPinned keeps its meaning: left of the root');
  assert.equal(thrownCode(() => r.h.c!.configure({ pinning: { pinned: { placement: 'row-end' }, unpinned: { placement: 'row-end' } } } as never)), 'invalid-settings', 'a definition that cannot be read after a drag throws');
  assert.equal(thrownCode(() => r.h.c!.configure({ pinning: { pinned: { placement: 'in-place' }, unpinned: { placement: 'row-end' } } } as never)), 'invalid-settings', 'in-place throws');
  assert.equal(r.state('c').pinned, true, 'a refused definition changed nothing');
});

test('matrix:pinningWhenNotLive', async () => {
  probe('pinningWhenNotLive');
  const r = await matrixRig({ ids: ['a', 'b', 'c', 'd'] });
  r.turn(() => r.h.b!.hide());
  r.turn(() => r.h.c!.hide());
  r.turn(() => r.h.d!.hide());
  await r.settle();
  assert.equal(r.order().join(' '), 'root a b c d');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ pinningWhenNotLive: 'refuse' }))), { now: [], later: ['pinningWhenNotLive'], shadowed: [] });
  assert.equal(r.order().join(' '), 'root a b c d', 'nothing moves at configure');
  assert.equal(letter(r.turn(() => r.h.b!.pin())), 'would-reshape-row', 'the next pin change reads refuse');
  assert.equal(letter(r.turn(() => r.h.c!.pin())), 'T', 'control: place-only places the hidden panel in place');
  assert.deepEqual([r.order().join(' '), r.state('c').status], ['c root a b d', 'parked'], 'and it stays hidden');
  done(r.turn(() => r.h.d!.configure({ pinningWhenNotLive: 'show' })));
  const shown = r.turn(() => r.h.d!.pin());
  assert.deepEqual([shown.ok && shown.shown, r.state('d').status], [true, 'live'], 'show: the hold is released and the change applies');
  done(r.turn(() => r.h.b!.configure({ pinningWhenNotLive: 'apply-on-next-show' })));
  assert.deepEqual(r.turn(() => r.h.b!.pin()).ok && r.state('b').deferredPin, { by: 'pin' }, 'apply-on-next-show stores it');
  done(r.turn(() => r.h.b!.configure({ pinningWhenNotLive: 'refuse' })));
  assert.deepEqual(r.state('b').deferredPin, { by: 'pin' }, 'a flip of this setting neither applies nor drops a stored deferred pin');
});

test('matrix:headerButtons', async () => {
  probe('headerButtons');
  const rig = await headerRig({ ids: ['a', 'b'], slots: { keep: slot('Keep') } });
  const labels = (id: string): (string | null)[] => rig.buttons(id).map((b) => b.getAttribute('aria-label'));
  assert.deepEqual(labels('a'), ['Keep']);
  assert.deepEqual(shape(rig.turn(() => rig.h.a!.configure({ headerButtons: { extra: slot('Extra') } }))), { now: ['headerButtons'], later: [], shadowed: [] });
  assert.deepEqual(labels('a'), ['Extra', 'Keep'], 'a slot appears in the commit of the call, ordered by order then slot id');
  rig.turn(() => rig.h.a!.configure({ headerButtons: { extra: slot('Renamed') } }));
  assert.deepEqual(labels('a'), ['Renamed', 'Keep'], 'a changed slot shows at the commit');
  act(() => rig.buttons('a')[0]!.focus());
  rig.turn(() => rig.h.a!.configure({ headerButtons: { extra: false } }));
  assert.deepEqual(labels('a'), ['Keep'], 'false removes the slot in that commit');
  assert.equal(document.activeElement === rig.row('a'), true, 'a focused button that leaves moves focus to the header row');
  rig.turn(() => rig.h.a!.configure({ headerButtons: { extra: slot('Back') } }));
  rig.turn(() => rig.h.a!.configure({ headerButtons: { extra: null } } as never));
  assert.deepEqual(labels('a'), ['Keep'], 'null deletes the instance entry');
  rig.turn(() => rig.h.b!.hide());
  await advanceFrames(900);
  done(rig.turn(() => rig.h.b!.configure({ headerButtons: { later: slot('Later') } })));
  assert.deepEqual([rig.row('b'), Object.keys(rig.h.b!.getSettings().value.headerButtons)], [null, ['keep', 'later']], 'K, H: stored, nothing drawn');
  rig.turn(() => rig.h.b!.show());
  await advanceFrames(900);
  assert.deepEqual(labels('b'), ['Keep', 'Later'], 'first drawn when it returns: keep before later by slot id');
});

type Store = ReturnType<typeof memoryWorkspaceStorage>;
const settleSave = (): Promise<void> => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 150))));

async function launch(store: Store, o: MatrixRigOptions = {}): Promise<MatrixRig> {
  const r = await matrixRig({ ...o, workspace: { ...o.workspace, storage: store, tuning: { saveQuietMs: 5, ...(o.workspace?.tuning ?? {}) } } });
  await settleSave();
  return r;
}
async function quit(r: MatrixRig): Promise<void> {
  await settleSave();
  r.m.unmount();
}
const fileOf = async (store: Store) => (await store.load())!;
const keysIn = async (store: Store): Promise<string[]> => (await fileOf(store)).panels.map((p) => p.key ?? p.id);

test('matrix:persist', async () => {
  probe('persist');
  const store = memoryWorkspaceStorage();
  const settings = { c: { placeOnAdd: { after: 'b' } } } as Record<string, PanelSettings>;
  let r = await launch(store, { settings });
  assert.equal(r.order().join(' '), 'root a b c');
  assert.deepEqual(await keysIn(store), ['a', 'b', 'c'], 'before: the panel is in the file');
  const clash = refusedWith(r.turn(() => r.h.b!.configure({ persist: 'session', rememberLayout: true })), 'settings-conflict');
  assert.equal(clash.setting, 'rememberLayout');
  assert.match(clash.message, /C3/);
  const entry = r.entry('b');
  const file = JSON.stringify(await store.load());
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ persist: 'session' }))), { now: [], later: ['persist'], shadowed: [] });
  assert.deepEqual([r.order().join(' '), r.live().join(' '), r.entry('b').anchor === entry.anchor], ['root a b c', 'root a b c', true], 'no row effect: the live panel is untouched');
  assert.equal(JSON.stringify(await store.load()), file, 'the call itself writes nothing');
  r.turn(() => r.h.a!.move('right', 'person'));
  await settleSave();
  assert.deepEqual(await keysIn(store), ['a', 'c'], 'the next projection leaves the session panel out');
  const saved = await fileOf(store);
  assert.equal(saved.panels.find((p) => (p.key ?? p.id) === 'c')!.anchor?.panel, 'root', 'and a panel that hung on it gets a derived anchor');
  done(r.turn(() => r.h.b!.configure({ persist: 'saved' })));
  r.turn(() => r.h.a!.move('left', 'person'));
  await settleSave();
  assert.equal((await keysIn(store)).includes('b'), true, 'session to saved: written at the next save');
  await quit(r);
  r = await launch(store, { settings });
  assert.equal(r.order().includes('b'), true);
  await quit(r);
});

test('matrix:rememberLayout', async () => {
  probe('rememberLayout');
  const store = memoryWorkspaceStorage();
  const right = (priority: number) => ({ panel: 'root', position: 'right', priority });
  const overrides = async (): Promise<Record<string, unknown>> => Object.fromEntries((await fileOf(store)).panels.map((p) => [p.key ?? p.id, p.overrides]));
  let r = await launch(store);
  r.turn(() => r.h.c!.move('left', 'person'));
  await quit(r);
  const first = await overrides();
  assert.deepEqual(first, { a: { anchor: right(0) }, c: { anchor: right(1) }, b: { anchor: right(2) } }, 'launch 1: the person left a layout');
  r = await launch(store);
  assert.equal(r.order().join(' '), 'root a c b', 'launch 2 applies it');
  for (const name of ['b', 'c']) assert.deepEqual(shape(r.turn(() => r.h[name]!.configure({ rememberLayout: false }))), { now: [], later: ['rememberLayout'], shadowed: [] });
  assert.equal(r.order().join(' '), 'root a c b', 'nothing moves');
  r.turn(() => r.h.c!.move('right', 'person'));
  assert.equal(r.order().join(' '), 'root a b c', 'the session moves on');
  await settleSave();
  assert.deepEqual(await overrides(), first, 'true to false: the gesture is not recorded and the file keeps every stored override');
  await quit(r);
  r = await launch(store, { settings: { b: { rememberLayout: false }, c: { rememberLayout: false } } });
  assert.equal(r.order().join(' '), 'root a b c', 'with it false at launch, the stored overrides are not applied');
  await quit(r);
  assert.deepEqual(await overrides(), first, 'and the file still carries them');
  r = await launch(store);
  assert.equal(r.order().join(' '), 'root a c b', 'false to true: applying resumes');
  r.turn(() => r.h.b!.move('left', 'person'));
  await quit(r);
  assert.deepEqual((await overrides()).b, { anchor: right(1) }, 'and recording resumes');
  const clash = await matrixRig();
  const refusal = refusedWith(clash.turn(() => clash.h.b!.configure({ persist: 'session', rememberLayout: true })), 'settings-conflict');
  assert.equal(refusal.setting, 'rememberLayout');
  assert.match(refusal.message, /C3/, 'C3: true under persist session is a conflict');
});

test('matrix:restoreVisibility', async () => {
  probe('restoreVisibility');
  const store = memoryWorkspaceStorage();
  let r = await launch(store);
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ restoreVisibility: 'parked' }))), { now: [], later: ['restoreVisibility'], shadowed: [] });
  assert.equal(r.state('b').status, 'live', 'read only at the next launch: nothing changes now');
  r.turn(() => r.h.a!.move('right', 'person'));
  await quit(r);
  r = await launch(store, { settings: { b: { restoreVisibility: 'parked' } } });
  assert.deepEqual([r.state('b').status, r.state('c').status], ['parked', 'live'], 'the next launch restores b parked and c as it was');
  await quit(r);
  const fixed = await matrixRig();
  const clash = refusedWith(fixed.turn(() => fixed.h.a!.configure({ parkable: false, restoreVisibility: 'parked' })), 'settings-conflict');
  assert.equal(clash.setting, 'restoreVisibility');
  assert.match(clash.message, /C1/);
});

test('matrix:afterClose', async () => {
  probe('afterClose');
  const store = memoryWorkspaceStorage();
  let r = await launch(store);
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ afterClose: 'return-next-launch' }))), { now: [], later: ['afterClose'], shadowed: [] });
  r.turn(() => r.h.b!.close());
  r.turn(() => r.h.c!.close());
  await quit(r);
  r = await launch(store, { settings: { b: { afterClose: 'return-next-launch' } } });
  assert.deepEqual([r.state('b').status, r.state('c').status], ['live', 'closed'], 'the closed panel that returns is back, the stay-closed one is not');
  const dismissed = JSON.stringify((await fileOf(store)).dismissed ?? []);
  done(r.turn(() => r.h.c!.configure({ afterClose: 'return-next-launch' })));
  await quit(r);
  assert.equal(JSON.stringify((await fileOf(store)).dismissed ?? []), dismissed, 'an existing tombstone is neither added nor removed by the flip');
  const clash = await matrixRig();
  const refusal = refusedWith(clash.turn(() => clash.h.a!.configure({ persist: 'session', afterClose: 'stay-closed' })), 'settings-conflict');
  assert.equal(refusal.setting, 'afterClose');
  assert.match(refusal.message, /C3/);
});

test('matrix:undoWindowMs', async () => {
  probe('undoWindowMs');
  const r = await matrixRig();
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ undoWindowMs: 0 }))), { now: [], later: ['undoWindowMs'], shadowed: [] });
  assert.equal((r.provided().recentlyClosed ?? []).length, 0, 'nothing closes at configure');
  r.turn(() => r.h.c!.close());
  assert.equal((r.provided().recentlyClosed ?? []).length, 1, 'control: a close with the default opens the undo window');
  done(r.turn(() => r.h.c!.configure({ undoWindowMs: 0 })));
  assert.equal((r.provided().recentlyClosed ?? []).length, 1, 'an open window keeps the end it has');
  r.turn(() => r.provided().undoClose());
  await r.settle();
  r.turn(() => r.h.b!.close());
  assert.equal((r.provided().recentlyClosed ?? []).length, 0, 'the next close of the configured panel has no undo window');
});

test('matrix:reportClose', async () => {
  probe('reportClose');
  const reported: string[] = [];
  const r = await matrixRig({ over: { onPanelsClosed: (e) => void reported.push(e.id.slice(e.id.indexOf('#') + 1)) } });
  const engine = (name: string): string => r.entry(name).id;
  const [b, c] = [engine('b'), engine('c')];
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ reportClose: false }))), { now: [], later: ['reportClose'], shadowed: [] });
  assert.equal(reported.length, 0, 'nothing is reported at configure');
  r.turn(() => r.h.c!.close());
  r.turn(() => r.h.b!.close());
  assert.deepEqual(reported, [c], 'the next close reads the new value: c is reported, b is not');
  assert.equal(reported.includes(b), false);
});

test('matrix:snapshot', async () => {
  probe('snapshot');
  const r = await matrixRig();
  const [b, c] = [r.entry('b').id, r.entry('c').id];
  const s = soft();
  await s.run('switching to never asks the host to evict the stored picture once, from the commit', () => {
    assert.deepEqual(r.capture.evicted, [], 'before: nothing evicted');
    assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ snapshot: 'never' }))), { now: [], later: ['snapshot'], shadowed: [] });
    assert.deepEqual(r.capture.evicted, [b], 'evicted once, for this panel');
  });
  await s.run('the next park asks for no picture where an untouched panel does', async () => {
    r.turn(() => r.h.b!.hide());
    r.turn(() => r.h.c!.hide());
    await r.settle();
    assert.deepEqual(r.capture.captured, [c]);
  });
  s.end();
});

test('matrix:scrollOnDrag', async () => {
  probe('scrollOnDrag');
  const r = await dragRig();
  assert.equal(r.m.container.scrollLeft, 0);
  assert.equal((await heldScroll(r, 's1', HALF_ZONE_POINTER)) > 0, true, 'before: a held drag half a zone inside the right edge scrolls the row');
  const at = r.m.container.scrollLeft;
  assert.deepEqual(shape(r.turn(() => r.h.s2!.configure({ scrollOnDrag: 'none' }))), { now: [], later: ['scrollOnDrag'], shadowed: [] });
  await r.settle();
  assert.equal(r.m.container.scrollLeft, at, 'nothing scrolls at configure');
  assert.equal(await heldScroll(r, 's2', HALF_ZONE_POINTER), 0, 'the next drag of this panel leaves the row where it is');
  assert.equal((await heldScroll(r, 's1', HALF_ZONE_POINTER)) > 0, true, 'a neighbour still scrolls it');
});

test('matrix:tuning.rowGap', async () => {
  probe('tuning.rowGap');
  await wrongScopeInEveryStatus({ tuning: { rowGap: 20 } }, 'tuning.rowGap');
  const r = await matrixRig();
  await r.settle();
  const xOf = (name: string): number => axisOf(slotAt(r, r.entry(name).id), 'X');
  assert.deepEqual(['a', 'b', 'c'].map(xOf), [406, 812, 1218], 'before: 390 plus the default gap of 16 apart');
  const renders = r.m.renders();
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ rowGap: 40 }))) }, { ok: true, changed: true, shown: false, now: ['tuning.rowGap'], later: [], shadowed: [], notes: [] });
  assert.equal(r.m.renders() - renders, 1, 'one commit');
  assert.deepEqual([r.ws.tuning.rowGap, r.m.latest().rowNumbers.stripWidth], [40, 4 * 390 + 3 * 40], 'the whole row is priced at the new gap in the commit of the call');
  await r.settle();
  assert.deepEqual(['a', 'b', 'c'].map(xOf), [430, 860, 1290], 'after: 390 plus 40 apart');
  const taken = await matrixRig();
  assert.deepEqual(taken.turn(() => [letter(taken.h.a!.hide()), letter(taken.ws.panels.configureTuning({ rowGap: 30 }))]), ['T', 'busy'], 'busy while any panel has a token');
  assert.equal(thrownCode(() => r.ws.panels.configureTuning({ rowGap: 201 })), 'invalid-settings', 'outside 0 to 200 throws');
  const parked = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e', 'f'], park: true, width: 1950, workspace: { tuning: { rowGap: 0 } } });
  await parked.settle();
  assert.equal(parked.live().filter((n) => n !== 'root').length, 4, 'park mode at gap 0 holds four beside the root');
  done(parked.turn(() => parked.ws.panels.configureTuning({ rowGap: 40 })));
  await parked.settle();
  assert.equal(parked.live().filter((n) => n !== 'root').length, 3, 'a smaller capacity parks the fewest park panels');
  const unmeasured = await matrixRig({ width: 0 });
  const entries = unmeasured.m.latest().entries;
  done(unmeasured.turn(() => unmeasured.ws.panels.configureTuning({ rowGap: 40 })));
  assert.deepEqual([unmeasured.ws.tuning.rowGap, unmeasured.m.latest().entries === entries], [40, true], 'unmeasured: stored');
});

test('matrix:tuning.dragToClose', async () => {
  probe('tuning.dragToClose');
  const r = await dragRig();
  const handle = (name: string): Element => r.m.container.querySelector(`[data-handle="${r.entry(name).id}"]`)!;
  await drag(handle('s2'), { dx: 0, dy: 100 });
  await advanceFrames(40 * 16);
  assert.equal(r.state('s2').status, 'closed', 'control: a 100 px drag down closes a panel under the default minimum of 80');
  assert.deepEqual(shape(r.turn(() => r.h.s1!.configure({ tuning: { dragToClose: { minDistancePx: 120 } } }))), { now: [], later: ['tuning.dragToClose'], shadowed: [] });
  await drag(handle('s1'), { dx: 0, dy: 100, keepDown: true });
  done(r.turn(() => r.h.s1!.configure({ tuning: { dragToClose: { minDistancePx: 90 } } })));
  await release(0, 100);
  await advanceFrames(40 * 16);
  assert.equal(r.state('s1').status, 'closed', 'a drag in flight is judged by the values current at the release: 90 px is short of 100');
  await drag(handle('s3'), { dx: 0, dy: 100 });
  await advanceFrames(40 * 16);
  assert.equal(r.state('s3').status, 'closed', 'a neighbour keeps the default');
  done(r.turn(() => r.ws.panels.configureTuning({ dragToClose: { minDistancePx: 150 } })));
  await drag(handle('s4'), { dx: 0, dy: 100 });
  await advanceFrames(40 * 16);
  assert.equal(r.state('s4').status, 'live', 'configureTuning sets the default for panels without a leaf');
  done(r.turn(() => r.h.s5!.configure({ tuning: { dragToClose: null } } as never)));
  assert.equal(r.h.s5!.getSettings().source['tuning.dragToClose'], 'workspace', 'null removes a panel leaf, so the workspace default is read again');
});

test('matrix:tuning.slide', async () => {
  probe('tuning.slide');
  const present = async (configure: boolean): Promise<boolean> => {
    const r = await matrixRig({ ids: ['a', 'b', 'c'] });
    await r.settle();
    const engine = r.entry('b').id;
    if (configure) {
      assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ tuning: { slide: { durationSec: 0.05 } } }))), { now: [], later: ['tuning.slide'], shadowed: [] });
      assert.equal(r.order().join(' '), 'root a b c', 'nothing moves at configure');
    }
    r.turn(() => r.h.b!.hide());
    await frames(6);
    const still = slotAt(r, engine) !== null;
    r.m.unmount();
    return still;
  };
  assert.equal(await present(false), true, 'control: a park under the default 0.4 s slide is still sliding after six frames');
  assert.equal(await present(true), false, 'the next exit reads the shorter slide');
  const r = await matrixRig();
  done(r.turn(() => r.ws.panels.configureTuning({ slide: { durationSec: 0.2 } })));
  assert.equal(r.h.a!.getSettings().value.tuning.slide.durationSec, 0.2, 'configureTuning sets the default for panels without a leaf');
  const running = await matrixRig({ ids: ['a', 'b', 'c'] });
  await running.settle();
  const engine = running.entry('b').id;
  running.turn(() => running.h.b!.hide());
  await frames(2);
  done(running.turn(() => running.h.b!.configure({ tuning: { slide: { durationSec: 0.05 } } })));
  await frames(4);
  assert.equal(slotAt(running, engine) !== null, true, 'an animation running keeps its timing: six frames in, the 0.4 s exit is still sliding');
});

test('matrix:tuning.hopFraction', async () => {
  probe('tuning.hopFraction');
  const r = await matrixRig();
  const steps = (): unknown => JSON.parse(r.seen('a')!['data-steps']!);
  assert.deepEqual(steps(), [0, 1], 'before: half of a 390 neighbour plus half a gap is 203 px, so 150 px hops nothing and 250 px hops one');
  assert.deepEqual(shape(r.turn(() => r.h.a!.configure({ tuning: { hopFraction: 0.25 } }))), { now: [], later: ['tuning.hopFraction'], shadowed: [] });
  assert.deepEqual(steps(), [1, 1], 'after: a quarter plus half a gap is 105.5 px, so 150 px hops one');
  assert.equal(JSON.parse(r.seen('b')!['data-steps']!)[0], 0, 'a neighbour keeps the default');
  assert.equal(thrownCode(() => r.h.a!.configure({ tuning: { hopFraction: 1.5 } })), 'invalid-settings', 'outside (0, 1] throws');
  done(r.turn(() => r.ws.panels.configureTuning({ hopFraction: 0.8 })));
  assert.deepEqual(JSON.parse(r.seen('b')!['data-steps']!), [0, 0], 'configureTuning sets the default for panels without a leaf: 0.8 of 390 plus 8 is 320');
  assert.deepEqual(steps(), [1, 1], "and a panel's own leaf still wins");
});

test('matrix:tuning.edgeScroll', async () => {
  probe('tuning.edgeScroll');
  const quarter = LIBRARY_TUNING_DEFAULTS.edgeScroll.zonePx / 4;
  const r = await dragRig();
  assert.equal((await heldScroll(r, 's1', HALF_ZONE_POINTER)) > 0, true, 'before: half the default zone from the edge scrolls');
  assert.deepEqual(shape(r.turn(() => r.h.s2!.configure({ tuning: { edgeScroll: { zonePx: quarter } } }))), { now: [], later: ['tuning.edgeScroll'], shadowed: [] });
  assert.equal(await heldScroll(r, 's2', HALF_ZONE_POINTER), 0, 'after: a quarter-zone band leaves the same pointer outside it');
  assert.equal((await heldScroll(r, 's1', HALF_ZONE_POINTER)) > 0, true, 'a neighbour keeps the default');
});

test('matrix:tuning.saveQuietMs', async () => {
  probe('tuning.saveQuietMs');
  await wrongScopeInEveryStatus({ tuning: { saveQuietMs: 700 } }, 'tuning.saveQuietMs');
  const saves: number[] = [];
  const storage: WorkspaceStorage = { load: async () => null, save: () => void saves.push(saves.length) };
  const w = mockWindow();
  const r = await matrixRig({ workspace: { storage } });
  const tick = (ms: number): void => act(() => mock.timers.tick(ms));
  tick(500);
  const base = saves.length;
  assert.equal(base > 0, true, 'the restore settled and its first save came after the default 500 ms');
  r.turn(() => r.h.a!.move('right', 'person'));
  tick(499);
  assert.equal(saves.length, base, 'before: a change is not saved before the quiet time');
  tick(1);
  assert.equal(saves.length, base + 1, 'and is saved at it');
  r.turn(() => r.h.a!.move('left', 'person'));
  tick(300);
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ saveQuietMs: 2000 }))) }, { ok: true, changed: true, shown: false, now: [], later: ['tuning.saveQuietMs'], shadowed: [], notes: [] });
  tick(200);
  assert.equal(saves.length, base + 2, 'a timer already armed keeps its deadline');
  r.turn(() => r.h.a!.move('right', 'person'));
  tick(1999);
  assert.equal(saves.length, base + 2, 'the next arm uses the new value');
  tick(1);
  assert.equal(saves.length, base + 3);
  void w;
});

test('matrix:tuning.gestureLockMs', async () => {
  probe('tuning.gestureLockMs');
  await wrongScopeInEveryStatus({ tuning: { gestureLockMs: 700 } }, 'tuning.gestureLockMs');
  const swipes = async (gestureLockMs: number | undefined): Promise<(number | null)[]> => {
    const r = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], width: 1000 });
    await r.settle();
    mockWindow();
    const scroller = rowScrollerFor(r.m.container);
    if (gestureLockMs !== undefined) done(r.turn(() => r.ws.panels.configureTuning({ gestureLockMs })));
    const wheel = (deltaX: number): void => act(() => void r.m.container.dispatchEvent(new WheelEvent('wheel', { deltaX, cancelable: true, bubbles: true })));
    wheel(100);
    const first = scroller.glideTarget();
    act(() => mock.timers.tick(30));
    wheel(-100);
    const second = scroller.glideTarget();
    mock.timers.reset();
    r.m.unmount();
    return [first, second];
  };
  const [firstDefault, secondDefault] = await swipes(undefined);
  assert.equal(firstDefault !== null, true, 'control: the first swipe starts a glide');
  assert.equal(secondDefault, firstDefault, 'under the default 60 ms lock a second swipe 30 ms later is ignored');
  const [firstShort, secondShort] = await swipes(10);
  assert.notEqual(secondShort, firstShort, 'under 10 ms the same second swipe acts');
});

test('matrix:tuning.gestureQuietMs', async () => {
  probe('tuning.gestureQuietMs');
  await wrongScopeInEveryStatus({ tuning: { gestureQuietMs: 300 } }, 'tuning.gestureQuietMs');
  const smallerSwipeActs = async (gestureQuietMs: number | undefined): Promise<boolean> => {
    const r = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], width: 1000 });
    await r.settle();
    mockWindow();
    const scroller = rowScrollerFor(r.m.container);
    if (gestureQuietMs !== undefined) done(r.turn(() => r.ws.panels.configureTuning({ gestureQuietMs })));
    const wheel = (deltaX: number): void => act(() => void r.m.container.dispatchEvent(new WheelEvent('wheel', { deltaX, cancelable: true, bubbles: true })));
    wheel(100);
    const first = scroller.glideTarget();
    act(() => mock.timers.tick(120));
    wheel(50);
    const second = scroller.glideTarget();
    mock.timers.reset();
    r.m.unmount();
    assert.notEqual(first, null, 'control: the first swipe starts a glide');
    return second !== first;
  };
  assert.equal(await smallerSwipeActs(undefined), false, 'under the default 150 ms a smaller swipe 120 ms later is a decaying tail');
  assert.equal(await smallerSwipeActs(100), true, 'under 100 ms the same swipe is fresh and acts');
  const r = await matrixRig();
  await r.settle();
  assert.equal(thrownCode(() => r.ws.panels.configureTuning({ gestureQuietMs: 0 })), 'invalid-settings', 'a quiet time below 1 throws');
});

test('matrix:tuning.returnTieBreak', async () => {
  probe('tuning.returnTieBreak');
  await wrongScopeInEveryStatus({ tuning: { returnTieBreak: 'row-order' } }, 'tuning.returnTieBreak');
  const returned = async (tieBreak: 'earliest-first' | undefined): Promise<string> => {
    const r = await matrixRig({ ids: ['a', 'b', 'c'], park: true, width: 1000 });
    await r.settle();
    assert.equal(r.live().join(' '), 'root c');
    if (tieBreak !== undefined) {
      assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ returnTieBreak: tieBreak }))) }, { ok: true, changed: true, shown: false, now: [], later: ['tuning.returnTieBreak'], shadowed: [], notes: [] });
      assert.equal(r.live().join(' '), 'root c', 'nothing returns now');
    }
    r.turn(() => r.h.c!.close());
    await r.settle();
    const live = r.live().join(' ');
    r.m.unmount();
    return live;
  };
  assert.equal(await returned(undefined), 'root b', 'control: equal priorities return the latest parked first');
  assert.equal(await returned('earliest-first'), 'root a', 'the next walk of the stack returns the earliest first');
});

test('matrix:tuning.dropTieBreak', async () => {
  probe('tuning.dropTieBreak');
  await wrongScopeInEveryStatus({ tuning: { dropTieBreak: 'rightmost' } }, 'tuning.dropTieBreak');
  const dropped = async (tieBreak: 'rightmost' | undefined): Promise<string> => {
    const r = await matrixRig({ ids: ['a', 'b', 'c', 'd'], park: true, width: 2100 });
    await r.settle();
    assert.equal(r.live().join(' '), 'root a b c d');
    if (tieBreak !== undefined) {
      assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ dropTieBreak: tieBreak }))) }, { ok: true, changed: true, shown: false, now: [], later: ['tuning.dropTieBreak'], shadowed: [], notes: [] });
      assert.equal(r.live().join(' '), 'root a b c d', 'nothing parks now');
    }
    done(r.turn(() => r.ws.panels.configureTuning({ rowGap: 150 })));
    await r.settle();
    const live = r.live().join(' ');
    r.m.unmount();
    return live;
  };
  assert.equal(await dropped(undefined), 'root c d', 'control: a capacity drop parks the leftmost of equal ranks');
  assert.equal(await dropped('rightmost'), 'root a b', 'the next drop parks the rightmost');
});

test('matrix:tuning.rowGesture', async () => {
  probe('tuning.rowGesture');
  await wrongScopeInEveryStatus({ tuning: { rowGesture: 'free' } }, 'tuning.rowGesture');
  const r = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], width: 1000 });
  await r.settle();
  const scroller = rowScrollerFor(r.m.container);
  const wheel = (): void => act(() => void r.m.container.dispatchEvent(new WheelEvent('wheel', { deltaX: 50, cancelable: true, bubbles: true })));
  wheel();
  assert.equal(scroller.glideTarget() !== null, true, 'before: step starts a glide on a swipe');
  await r.settle();
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ rowGesture: 'free' }))) }, { ok: true, changed: true, shown: false, now: [], later: ['tuning.rowGesture'], shadowed: [], notes: [] });
  assert.equal(r.live().length, 11, 'no panel moves');
  const at = r.m.container.scrollLeft;
  await r.settle();
  wheel();
  assert.deepEqual([scroller.glideTarget(), r.m.container.scrollLeft], [null, at], 'after the next render: free installs no listener, so a swipe is left to the browser');
});

test('matrix:tuning.initialScroll', async () => {
  probe('tuning.initialScroll');
  await wrongScopeInEveryStatus({ tuning: { initialScroll: 'end' } }, 'tuning.initialScroll');
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const r = await matrixRig({ ids, width: 1000 });
  await r.settle();
  assert.equal(r.m.container.scrollLeft, 0, 'before: the strip starts at the left');
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ initialScroll: 'end' }))) }, { ok: true, changed: true, shown: false, now: [], later: ['tuning.initialScroll'], shadowed: [], notes: [] });
  await r.settle();
  assert.equal(r.m.container.scrollLeft, 0, 'nothing scrolls now');
  const next = await matrixRig({ ids, width: 1000, workspace: { tuning: { initialScroll: 'end', rowGesture: 'free' } } });
  await next.settle();
  assert.equal(next.m.container.scrollLeft, 3482, 'a mount that reads end puts the strip at its farthest legal scroll: 4450 less the 968 window');
  assert.equal(r.ws.tuning.initialScroll, 'end', 'the workspace now holds it for its next mount');
});

test('matrix:tuning.chrome', async () => {
  probe('tuning.chrome');
  await wrongScopeInEveryStatus({ tuning: { chrome: { mode: 'hover-or-active' } } }, 'tuning.chrome');
  const r = await matrixRig();
  await r.settle();
  assert.deepEqual({ ...r.ws.tuning.chrome }, { mode: 'always', fadeMs: 120, fadeEase: 'easeOut', slideMs: 140, slidePx: 8, graceMs: 250 });
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ chrome: { fadeMs: 60 } }))) }, { ok: true, changed: true, shown: false, now: ['tuning.chrome'], later: [], shadowed: [], notes: [] });
  assert.deepEqual({ ...r.ws.tuning.chrome }, { mode: 'always', fadeMs: 60, fadeEase: 'easeOut', slideMs: 140, slidePx: 8, graceMs: 250 }, 'a one-member patch keeps the other members');
  assert.equal(done(r.turn(() => r.ws.panels.configureTuning({ chrome: { fadeMs: 60 } }))).changed, false, 'an equal patch changes nothing');
  assert.equal(thrownCode(() => r.ws.panels.configureTuning({ chrome: { slidePx: 201 } })), 'invalid-settings', 'outside 0 to 200 throws');
  assert.equal(thrownCode(() => r.ws.panels.configureTuning({ chrome: { mode: 'sometimes' } as never })), 'invalid-settings');
  assert.equal(r.ws.tuning.chrome.fadeMs, 60, 'a refused patch left the value');
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ chrome: { fadeEase: 'linear' } }))) }, { ok: true, changed: true, shown: false, now: ['tuning.chrome'], later: [], shadowed: [], notes: [] } as never, 'fadeEase applies at once, like the other members');
  assert.deepEqual({ ...r.ws.tuning.chrome }, { mode: 'always', fadeMs: 60, fadeEase: 'linear', slideMs: 140, slidePx: 8, graceMs: 250 }, 'a fadeEase-only patch keeps the other members');
  assert.equal(thrownCode(() => r.ws.panels.configureTuning({ chrome: { fadeEase: 'cubic-out' } as never })), 'invalid-settings');
  assert.equal(r.ws.tuning.chrome.fadeEase, 'linear', 'a refused patch left the value');
});

test('matrix:tuning.resizeSettleSlides', async () => {
  probe('tuning.resizeSettleSlides');
  await wrongScopeInEveryStatus({ tuning: { resizeSettleSlides: 2 } }, 'tuning.resizeSettleSlides');
  const r = await matrixRig();
  await r.settle();
  assert.equal(r.ws.tuning.resizeSettleSlides, 1.25);
  const result = done(r.turn(() => r.ws.panels.configureTuning({ resizeSettleSlides: 2 })));
  assert.deepEqual([result.ok, result.changed, result.now], [true, true, ['tuning.resizeSettleSlides']], 'class NOW: applied at this commit');
  assert.equal(r.ws.tuning.resizeSettleSlides, 2);
  assert.equal(done(r.turn(() => r.ws.panels.configureTuning({ resizeSettleSlides: 2 }))).changed, false, 'an equal value changes nothing');
  for (const bad of [-0.1, 10.1, Number.NaN, Number.POSITIVE_INFINITY, '2']) {
    assert.equal(thrownCode(() => r.ws.panels.configureTuning({ resizeSettleSlides: bad } as never)), 'invalid-settings', `${String(bad)} throws`);
  }
  assert.equal(r.ws.tuning.resizeSettleSlides, 2, 'a refused value changed nothing');
  done(r.turn(() => r.ws.panels.configureTuning({ resizeSettleSlides: 0 })));
  assert.equal(r.ws.tuning.resizeSettleSlides, 0, '0 is accepted');
});

test('matrix:tuning.maxLivePanels', async () => {
  probe('tuning.maxLivePanels');
  await wrongScopeInEveryStatus({ tuning: { maxLivePanels: 2 } }, 'tuning.maxLivePanels');
  const r = await matrixRig({ ids: ['a', 'b', 'c', 'd'], park: true, width: 4000 });
  await r.settle();
  assert.equal(r.live().join(' '), 'root a b c d', 'before: no cap, and the window holds every panel');
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ maxLivePanels: 2 }))) }, { ok: true, changed: true, shown: false, now: ['tuning.maxLivePanels'], later: [], shadowed: [], notes: [] });
  await r.settle();
  assert.equal(r.live().join(' '), 'root c d', 'the two leftmost park at this commit');
  assert.equal(r.ws.tuning.maxLivePanels, 2);
  for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, '3', true]) {
    assert.equal(thrownCode(() => r.ws.panels.configureTuning({ maxLivePanels: bad } as never)), 'invalid-settings', `${String(bad)} throws`);
  }
  assert.equal(r.ws.tuning.maxLivePanels, 2, 'a refused value changes nothing');
  assert.equal(r.live().join(' '), 'root c d');
  done(r.turn(() => r.ws.panels.configureTuning({ maxLivePanels: null })));
  await r.settle();
  assert.equal(r.ws.tuning.maxLivePanels, null);
  assert.equal(r.live().join(' '), 'root a b c d', 'null removes the cap and, under capacityReturn auto, the parked pair returns');
  const unmeasured = await matrixRig({ ids: ['a', 'b', 'c'], park: true, width: 0 });
  done(unmeasured.turn(() => unmeasured.ws.panels.configureTuning({ maxLivePanels: 1 })));
  assert.deepEqual([unmeasured.ws.tuning.maxLivePanels, unmeasured.live().join(' ')], [1, 'root c'], 'unmeasured: applies at once');
});

test('matrix:slots', async () => {
  probe('slots');
  const r = await matrixRig();
  assert.equal(r.entry('b').slots, 1, 'before: one slot');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ slots: 2 }))), { now: [], later: ['slots'], shadowed: [] });
  assert.equal(r.entry('b').slots, 1, 'configure only stores it: the drawn panel is unchanged');
  assert.equal(thrownCode(() => r.h.b!.configure({ slots: 0 })), 'invalid-settings', 'outside 1 or more throws');
  assert.equal(thrownCode(() => r.h.b!.configure({ slots: 2.5 } as never)), 'invalid-settings');
  assert.equal(letter(r.turn(() => r.h.a!.setSlots(2))), 'T', 'the verb resizes by whole slots');
  assert.equal(r.entry('a').slots, 2);
  assert.equal(r.entry('a').formFactor, 'tablet', 'and formFactor reports the tier of the count');
});

test('matrix:maxSlots', async () => {
  probe('maxSlots');
  const r = await matrixRig();
  assert.equal(letter(r.turn(() => r.h.b!.setSlots(3))), 'T', 'before: any count up to the window');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ maxSlots: 4 }))), { now: ['maxSlots'], later: [], shadowed: [] }, 'raising is accepted');
  refusedWith(r.turn(() => r.h.b!.configure({ maxSlots: 2 })), 'tier-not-allowed');
  assert.equal(r.entry('b').slots, 3, 'a refusal never changes the panel');
  assert.equal(letter(r.turn(() => r.h.a!.setSlots(9))), 'T', 'a neighbour keeps its own cap');
  assert.equal(r.entry('b').settings?.maxSlots, 4);
  assert.equal(thrownCode(() => r.h.b!.configure({ maxSlots: 0 })), 'invalid-settings', 'outside 1 or more throws');
});

test('matrix:tuning.heightPerSlot', async () => {
  probe('tuning.heightPerSlot');
  await wrongScopeInEveryStatus({ tuning: { heightPerSlot: 20 } }, 'tuning.heightPerSlot');
  const r = await matrixRig();
  assert.equal(r.ws.tuning.heightPerSlot, 48, 'before: the library default');
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ heightPerSlot: 20 }))) }, { ok: true, changed: true, shown: false, now: ['tuning.heightPerSlot'], later: [], shadowed: [], notes: [] });
  assert.equal(r.ws.tuning.heightPerSlot, 20);
  assert.equal(done(r.turn(() => r.ws.panels.configureTuning({ heightPerSlot: 20 }))).changed, false, 'an equal value changes nothing');
  for (const bad of [-1, 2001, 1.5, Number.NaN, '48']) assert.equal(thrownCode(() => r.ws.panels.configureTuning({ heightPerSlot: bad } as never)), 'invalid-settings', `${String(bad)} throws`);
  assert.equal(r.ws.tuning.heightPerSlot, 20, 'a refused value changes nothing');
});

test('matrix:tuning.rowAlign', async () => {
  probe('tuning.rowAlign');
  await wrongScopeInEveryStatus({ tuning: { rowAlign: 'top' } }, 'tuning.rowAlign');
  const r = await matrixRig();
  assert.equal(r.ws.tuning.rowAlign, 'center', 'before: the library default');
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ rowAlign: 'bottom' }))) }, { ok: true, changed: true, shown: false, now: ['tuning.rowAlign'], later: [], shadowed: [], notes: [] });
  assert.equal(r.ws.tuning.rowAlign, 'bottom');
  for (const bad of ['middle', 3, true]) assert.equal(thrownCode(() => r.ws.panels.configureTuning({ rowAlign: bad } as never)), 'invalid-settings', `${String(bad)} throws`);
  assert.equal(r.ws.tuning.rowAlign, 'bottom', 'a refused value changes nothing');
});

test('matrix:tuning.shrinkOutOfView', async () => {
  probe('tuning.shrinkOutOfView');
  await wrongScopeInEveryStatus({ tuning: { shrinkOutOfView: 'visible' } }, 'tuning.shrinkOutOfView');
  const r = await matrixRig();
  assert.equal(r.ws.tuning.shrinkOutOfView, 'off', 'before: the library default');
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ shrinkOutOfView: 'visible' }))) }, { ok: true, changed: true, shown: false, now: ['tuning.shrinkOutOfView'], later: [], shadowed: [], notes: [] });
  assert.equal(r.ws.tuning.shrinkOutOfView, 'visible');
  for (const bad of ['on', 1, true]) assert.equal(thrownCode(() => r.ws.panels.configureTuning({ shrinkOutOfView: bad } as never)), 'invalid-settings', `${String(bad)} throws`);
  assert.equal(r.ws.tuning.shrinkOutOfView, 'visible', 'a refused value changes nothing');
});

test('the class table ran every cell: executed cells equal 4 classes by 9 statuses, 36', () => {
  assert.equal(CLASSES.length * STATUSES.length, 36);
  assert.equal(cellsExecuted().size, 36);
  for (const cls of CLASSES) for (const status of STATUSES) assert.equal(cellsExecuted().has(`${cls}/${status}`), true, `${cls}/${status} ran`);
  assert.equal(Object.values(CLASS_TABLE).reduce((sum, row) => sum + Object.keys(row).length, 0), 36);
});

// The design copy is frozen; a catalog key added after it is listed here, never in the copy.
const ADDED_AFTER_DESIGN: readonly string[] = ['tuning.maxLivePanels', 'tuning.chrome', 'slots', 'maxSlots', 'tuning.heightPerSlot', 'tuning.rowAlign', 'tuning.resizeSettleSlides', 'tuning.shrinkOutOfView', 'frame'];

test('the probes ran every catalog name once: 70 executed, equal to the catalog and to the design copy of it plus the names added after it', () => {
  const design = JSON.parse(readFileSync(new URL('../design/0.2-rev7/DESIGN-phonux-0.2-rev7-catalog.json', import.meta.url), 'utf8')) as { name: string }[];
  assert.equal(design.length, 62);
  assert.equal(CATALOG_NAMES.length, 70);
  assert.equal(probesExecuted().size, 70);
  assert.deepEqual([...probesExecuted()].sort(), [...CATALOG_NAMES].sort());
  assert.deepEqual([...probesExecuted()].sort(), [...design.map((d) => d.name), ...ADDED_AFTER_DESIGN].sort());
});
