/**
 * The configure matrix: the 36 cells of the class table (4 classes by 9 statuses), then one probe per catalog name.
 * Every expectation is written from the configure design and the catalog's `on_configure` cells, never from the code
 * under test.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './support/jsdom-globals.js';
import { ROW_LAYER_Z } from '../rowConstants.js';
import { centerRank, slotZ } from '../rowSlotZ.js';
import { rowOffsetOf } from './support/strip.js';
import { act, createElement } from 'react';
import { LIBRARY_PANEL_DEFAULTS } from '../index.js';
import type { ConfigureResult, HeaderButton, PanelSettings, WorkspaceStorage } from '../index.js';
import { memoryWorkspaceStorage } from '../fakeHost.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { headerRig } from './support/header-rig.js';
import { drag, release } from './support/drag-gesture.js';
import { rowScrollerFor } from './support/workspace-row.js';
import { slotTransform } from './support/strip.js';
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

const summaryOf = (r: MatrixRig, id: string) => r.provided().panelList.find((s) => s.id === r.entry(id).key);

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
    assert.deepEqual({ ok: res.ok, changed: res.changed, now: [...res.now], later: [...res.later], shadowed: [...res.shadowed] }, { ok: true, changed: true, now: [], later: ['closable'], shadowed: [] });
    assert.equal(r.state(id).status, 'closed', 'a closed panel stays closed');
    assert.equal(r.provided().recentlyClosed === held || (held ?? []).every((s, k) => s === r.provided().recentlyClosed?.[k]), true, 'the window holds the very objects it held');
    assertSideEffects(a, before, cell);
    if (status === 'closed-declared') r.turn(() => r.h[id]!.open());
    else r.turn(() => r.provided().undoClose());
    await r.settle();
    assert.equal(r.state(id).status, 'live');
    assert.equal(!r.entry(id).settings!.closable, true, 'the record carried the edit into the reopened panel');
    assert.equal(letter(r.turn(() => r.h[id]!.close('person'))), 'not-closable');
    return;
  }
  assert.equal(out.kind, 'applied-now');
  const mounted = status === 'live' || status === 'hidden' ? r.seen(id) : null;
  if (status === 'live') assert.equal(mounted?.['data-close'], 'true', 'before: the view is offered the close control');
  assert.equal(!r.state(id).settings.closable, false, 'before: the History row offers a close');
  const res = done(a.configure({ closable: false }));
  assert.deepEqual({ ok: res.ok, changed: res.changed, now: [...res.now], later: [...res.later], shadowed: [...res.shadowed] }, { ok: true, changed: true, now: ['closable'], later: [], shadowed: [] });
  assert.equal(!r.state(id).settings.closable, true, 'after: the History row no longer offers a close, in the same commit');
  assert.equal(!r.entry(id).settings!.closable, true);
  assert.equal(r.state(id).settings.clearable, false, 'clearable re-derives false (C2)');
  if (status === 'live') assert.equal(r.seen(id)?.['data-close'], 'false', 'the view is no longer offered the close control');
  assert.equal(r.order().join(' '), before.order, 'nothing moved');
  assert.equal(r.live().join(' '), before.live, 'nothing parked or returned');
  assertSideEffects(a, before, cell);
  assert.equal(letter(r.turn(() => r.h[id]!.close('person'))), 'not-closable');
  if (cell.staysLive === true) {
    assert.equal(r.state(id).status, 'parked', 'control: the panel was parked when configured');
    r.turn(() => r.h[id]!.show());
    await r.settle();
    assert.equal(r.state(id).status, 'live', 'the acted-on panel is live and stays live');
    assert.deepEqual(r.live().filter((n) => n !== 'root'), [id], 'the row holds one park panel beside the root, so room was made by parking the one that was live');
    assert.equal(letter(r.turn(() => r.h[id]!.close('person'))), 'not-closable');
  }
}

const NEXT_PATCH = { hideStickiness: 'until-room', capacityReturn: 'manual' } as const;

const wait = (): Promise<void> => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 150))));
const keysOf = async (store: WorkspaceStorage): Promise<string[]> => ((await store.load())?.panels ?? []).map((p) => p.key ?? p.id ?? p.uid ?? '');

async function nextCell(status: Status): Promise<void> {
  const cell = CLASS_TABLE.NEXT[status];
  const store = memoryWorkspaceStorage();
  const a = await arrange(status, {}, { storage: store, tuning: { saveQuietMs: 5 } });
  const { r, id } = a;
  if (cell.projection !== null) await wait();
  const keysBefore = await keysOf(store);
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
    return;
  }
  if (out.kind === 'stored-on-record') {
    const res = done(a.configure(NEXT_PATCH));
    assert.deepEqual({ ok: res.ok, changed: res.changed, now: [...res.now], later: [...res.later], shadowed: [...res.shadowed] }, { ok: true, changed: true, now: [], later: ['hideStickiness', 'capacityReturn'], shadowed: [] });
    assert.equal(r.state(id).status, 'closed');
    assertSideEffects(a, before, cell);
    if (status === 'closed-declared') r.turn(() => r.h[id]!.open());
    else r.turn(() => r.provided().undoClose());
    await r.settle();
    assert.equal(r.state(id).status, 'live');
    assert.deepEqual([r.state(id).settings.hideStickiness, r.state(id).settings.capacityReturn], ['until-room', 'manual'], 'the record carried the edit into the reopened panel');
    return;
  }
  assert.equal(out.kind, 'stored');
  const flags = r.state(id);
  const res = done(a.configure(NEXT_PATCH));
  assert.deepEqual({ ok: res.ok, changed: res.changed, now: [...res.now], later: [...res.later], shadowed: [...res.shadowed] }, { ok: true, changed: true, now: [], later: ['hideStickiness', 'capacityReturn'], shadowed: [] });
  const read = r.ws.panels.get(id)!.getSettings();
  assert.deepEqual([read.value.hideStickiness, read.value.capacityReturn, read.source.hideStickiness], ['until-room', 'manual', 'instance']);
  assert.equal(r.order().join(' '), before.order, 'nothing moved');
  assert.equal(r.live().join(' '), before.live, 'nothing parked, shown or returned');
  assert.deepEqual([r.state(id).status, r.state(id).held], [flags.status, flags.held], 'the panel kept its state');
  for (const e of before.entries) if (e.id !== before.engineId) assert.equal(r.m.latest().entries.includes(e), true, `entry ${e.id} is the same object`);
  assert.equal(JSON.stringify(await store.load()), fileBefore, 'the call itself wrote nothing');
  await wait();
  assert.deepEqual(await keysOf(store), keysBefore, 'the next projection holds the same panels');
  assert.equal(cell.projection, 'none');
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
  const a = await arrange(status);
  const { r, id } = a;
  const patch = { maxSlots: 3 };
  const before = traceOf(a);
  const out = cell.outcome;
  const maxSlotsOf = (): unknown => r.ws.panels.get(id)!.getSettings().value.maxSlots;
  if (out.kind === 'refused') {
    const res = a.configure(patch);
    assertRefusal(a, before, res, out.code, 'maxSlots', LIBRARY_PANEL_DEFAULTS.maxSlots);
    assertSideEffects(a, before, cell);
    return;
  }
  if (out.kind === 'stored-on-record') {
    const res = done(a.configure(patch));
    assert.deepEqual({ ok: res.ok, changed: res.changed, now: [...res.now], later: [...res.later], shadowed: [...res.shadowed] }, { ok: true, changed: true, now: [], later: ['maxSlots'], shadowed: [] });
    assert.equal(r.state(id).status, 'closed');
    assertSideEffects(a, before, cell);
    if (status === 'closed-declared') r.turn(() => r.h[id]!.open());
    else r.turn(() => r.provided().undoClose());
    await r.settle();
    assert.equal(r.state(id).settings.maxSlots, 3, 'the record carried the edit into the reopened panel');
    return;
  }
  assert.equal(out.kind, 'applied-now');
  const kept = { status: r.state(id).status, held: r.state(id).held };
  const res = done(a.configure(patch));
  assert.deepEqual({ ok: res.ok, changed: res.changed, now: [...res.now], later: [...res.later], shadowed: [...res.shadowed] }, { ok: true, changed: true, now: ['maxSlots'], later: [], shadowed: [] });
  assert.equal(maxSlotsOf(), 3, 'the panel reads the new cap at once');
  assert.equal(r.order().join(' '), before.order, 'nothing moved');
  assert.equal(r.live().join(' '), before.live, 'nothing parked or returned');
  assert.deepEqual([r.state(id).status, r.state(id).held], [kept.status, kept.held], 'the panel kept its state');
  assertSideEffects(a, before, cell);
  if (cell.staysLive === true) {
    assert.equal(r.state(id).status, 'parked', 'control: the panel was parked when configured');
    r.turn(() => r.h[id]!.show());
    await r.settle();
    assert.equal(r.state(id).status, 'live', 'the acted-on panel is live and stays live');
    assert.deepEqual(r.live().filter((n) => n !== 'root'), [id], 'the row holds one park panel beside the root, so room was made by parking the one that was live');
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
  assert.deepEqual({ ...done(high) }, { ok: true, changed: true, now: [], later: ['hostCreatable'], shadowed: [], notes: [] }, 'a template key that cannot strand an instance is stored, whatever the instance is doing (a template names no panel, so it is never busy)');
  if (cell.counted === true) {
    const refusal = refusedWith(low, 'instance-limit');
    assert.equal(refusal.setting, lowered);
    assert.match(refusal.message, /2 instances/, 'the refusal counts the instances that exist');
  } else {
    assert.deepEqual({ ...done(low) }, { ok: true, changed: true, now: [], later: ['maxInstances'], shadowed: [], notes: [] }, 'an instance that is gone does not count');
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
  const read = (id: string): unknown[] => [r.seen(id)?.['data-close'], !r.state(id).settings.closable, r.state(id).settings.clearable];
  assert.deepEqual(read('b'), ['true', false, true], 'before: a close control is offered, History can close it, clearAll takes it');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ closable: false }))), { now: ['closable'], later: [], shadowed: [] });
  assert.deepEqual(read('b'), ['false', true, false], 'after, in that commit: no close control, no close from History, clearable re-derived false');
  assert.equal(letter(r.turn(() => r.h.b!.close('person'))), 'not-closable', 'close() answers not-closable');
  assert.equal(r.state('b').status, 'live');
  assert.deepEqual(read('c'), ['true', false, true], 'a neighbour is untouched');
  done(r.turn(() => r.h.b!.configure({ closable: true })));
  assert.deepEqual(read('b'), ['true', false, true], 'false to true restores all three');
  r.turn(() => r.h.c!.hide());
  await r.settle();
  done(r.turn(() => r.h.c!.configure({ closable: false })));
  assert.deepEqual([!r.state('c').settings.closable, r.seen('c'), r.state('c').status], [true, null, 'parked'], 'a hidden panel changes in the History row only');
  const root = refusedWith(r.turn(() => r.ws.panels.configure(r.ws.rootId, { closable: true })), 'settings-conflict');
  assert.equal(root.setting, 'closable');
  assert.match(root.message, /C5/);
  const clearable = refusedWith(r.turn(() => r.h.a!.configure({ closable: false, clearable: true })), 'settings-conflict');
  assert.equal(clearable.setting, 'clearable');
});

test('matrix:parkable', async () => {
  probe('parkable');
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const r = await matrixRig({ ids });
  const facts = (id: string): unknown[] => {
    const s = r.state(id);
    return [s.settings.parkable, s.listed, s.settings.movable, s.settings.clearable];
  };
  assert.deepEqual([facts('b'), r.provided().fixedViewCount], [[true, true, true, true], 1], 'before: an ordinary panel, one fixed column (the root)');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ parkable: false }))), { now: ['parkable'], later: [], shadowed: [] });
  assert.deepEqual([facts('b'), r.entry('b').collapsible, r.provided().fixedViewCount], [[false, false, false, false], false, 2], 'after, in that commit: listed, movable and clearable re-derived false; the row prices a second fixed column');
  assert.equal(letter(r.turn(() => r.h.b!.hide())), 'not-parkable');
  done(r.turn(() => r.h.b!.configure({ parkable: true })));
  assert.deepEqual([facts('b'), r.entry('b').collapsible], [[true, true, true, true], true], 'false to true lifts C1');
  r.turn(() => r.h.c!.setSlots(2, 'person'));
  assert.equal(refusedWith(r.turn(() => r.h.c!.configure({ parkable: false })), 'slots-above-max').ok, false, 'a two-slot panel cannot become a fixed column');
  assert.deepEqual(shape(r.turn(() => r.h.a!.configure({ parkable: false, resizable: true }))), { now: ['parkable', 'resizable'], later: [], shadowed: [] }, 'resizable true beside a fixed column stands: the panel asked for its size itself');
  assert.equal(r.state('a').settings.resizable, true);
  const s = soft();
  await s.run('K, H: would-reshape-row, the row untouched', async () => {
    r.turn(() => r.h.d!.hide());
    await r.settle();
    const hiddenEntries = r.m.latest().entries;
    const hiddenRenders = r.m.renders();
    refusedWith(r.turn(() => r.h.d!.configure({ parkable: false })), 'would-reshape-row');
    sameRow(r, hiddenEntries, hiddenRenders, 'place-only on a hidden panel');
  });
  await s.run('C, U: is-closed', () => {
    const w = mockWindow();
    r.turn(() => r.h.e!.close());
    refusedWith(r.turn(() => r.h.e!.configure({ parkable: false })), 'is-closed');
    w.pastWindow();
    refusedWith(r.turn(() => r.h.e!.configure({ parkable: false })), 'is-closed');
  });
  s.end();
});

test('matrix:movable', async () => {
  probe('movable');
  const r = await matrixRig();
  assert.equal(r.seen('b')?.['data-reorder'], 'true', 'before: the reorder grab is offered');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ movable: false }))), { now: ['movable'], later: [], shadowed: [] });
  assert.equal(r.seen('b')?.['data-reorder'], 'false', 'after, in that commit: no reorder grab');
  assert.equal(JSON.parse(r.seen('b')!['data-caps']!).movable, false, 'and the view reads movable false');
  assert.equal(letter(r.turn(() => r.h.b!.move(1, 'person'))), 'not-movable', 'a person is refused');
  assert.equal(letter(r.turn(() => r.h.b!.place('row-end', 'person'))), 'not-movable', 'a person is refused a placement too');
  assert.equal(r.order().join(' '), 'root a b c', 'nothing moved');
  assert.equal(letter(r.turn(() => r.h.b!.move(1))), 'T', 'the developer\'s own move is not limited');
  assert.equal(r.order().join(' '), 'root a c b');
  assert.equal(letter(r.turn(() => r.h.b!.place('row-start'))), 'T', 'nor is the developer\'s own place');
  assert.equal(r.order().join(' '), 'b root a c');
  assert.equal(r.seen('a')?.['data-reorder'], 'true', 'a neighbour is untouched');
  r.turn(() => r.h.c!.hide());
  await r.settle();
  done(r.turn(() => r.h.c!.configure({ movable: false })));
  assert.deepEqual([r.state('c').settings.movable, r.state('c').status], [false, 'parked'], 'a hidden panel stores it');
  assert.equal(letter(r.turn(() => r.h.c!.place('row-start'))), 'T', 'a placement of a hidden panel is not limited');
  assert.deepEqual(shape(r.turn(() => r.ws.panels.configure(r.ws.rootId, { movable: true }))), { now: ['movable'], later: [], shadowed: [] }, 'the root takes movable true; only closable and parkable answer C5');
});

test('matrix:crossable', async () => {
  probe('crossable');
  const r = await matrixRig();
  const rightOfA = (): unknown => JSON.parse(r.seen('a')!['data-neighbors']!).right;
  assert.deepEqual(rightOfA(), [390, 390], "before: a's drag crosses b and c");
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ crossable: false }))), { now: ['crossable'], later: [], shadowed: [] });
  assert.deepEqual(rightOfA(), [], "after, at once: a's drag sees b as a barrier");
  assert.equal(letter(r.turn(() => r.h.a!.move(1))), 'F', 'a move across it is judged by movePanel: accepted, nothing moves');
  assert.equal(r.order().join(' '), 'root a b c');
  done(r.turn(() => r.h.b!.configure({ crossable: true })));
  r.turn(() => r.h.b!.hide());
  await r.settle();
  assert.deepEqual(rightOfA(), [390], 'a hidden panel that stays crossable is no barrier');
  done(r.turn(() => r.h.b!.configure({ crossable: false })));
  assert.deepEqual(rightOfA(), [], 'a hidden panel that is not crossable is a barrier for the next drag too');
});

test('matrix:resizable', async () => {
  probe('resizable');
  const r = await matrixRig();
  r.turn(() => r.h.b!.setSlots(2, 'person'));
  assert.deepEqual([r.entry('b').slots, r.entry('b').overrides?.slots], [2, 2], 'before: the person chose two slots');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ resizable: false }))), { now: ['resizable'], later: [], shadowed: [] });
  assert.equal(letter(r.turn(() => r.h.b!.setSlots(1, 'person'))), 'not-resizable', 'after: setSlots is refused');
  assert.deepEqual([r.entry('b').slots, r.entry('b').overrides?.slots], [2, 2], "the slots and the person's saved size are never changed or dropped");
  assert.equal(letter(r.turn(() => r.h.a!.setSlots(2))), 'T', 'a neighbour still resizes');
  r.turn(() => r.h.c!.hide());
  await r.settle();
  done(r.turn(() => r.h.c!.configure({ resizable: false })));
  assert.equal(letter(r.turn(() => r.h.c!.setSlots(2, 'person'))), 'not-resizable', 'a hidden panel refuses too');
  const fixed = await matrixRig();
  done(fixed.turn(() => fixed.h.a!.configure({ parkable: false })));
  assert.equal(shape(fixed.turn(() => fixed.h.a!.configure({ resizable: true }))).now[0], 'resizable', 'C1: true asked for the fixed column itself stands');
  assert.equal(fixed.state('a').settings.resizable, true);
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

test('matrix:listed', async () => {
  probe('listed');
  const r = await matrixRig();
  const before = { id: r.entry('b').key!, order: r.order().join(' '), status: r.state('b').status };
  assert.equal(listedIds(r).includes(before.id), true, 'before: the panel is in panelList');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ listed: false }))), { now: ['listed'], later: [], shadowed: [] });
  assert.equal(listedIds(r).includes(before.id), false, 'after, in that commit: its History row is gone');
  assert.deepEqual([r.order().join(' '), r.state('b').status, r.seen('b') !== null], [before.order, 'live', true], 'its slot and state do not change');
  done(r.turn(() => r.h.b!.configure({ listed: true })));
  assert.equal(listedIds(r).includes(before.id), true, 'true puts the row back');
  r.turn(() => r.h.c!.hide());
  await r.settle();
  const quiet = done(r.turn(() => r.h.c!.configure({ listed: false })));
  assert.equal(listedIds(r).includes(r.entry('c').key!), false, 'a hidden panel leaves the list too');
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

const swipeRight = (r: MatrixRig, dx = 50): void => act(() => void r.m.container.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, cancelable: true, bubbles: true })));

test('matrix:edgeHold', async () => {
  probe('edgeHold');
  // Width 1000 gives a 968 window: the row scrolls, and b holds at the left edge beside one phone of strip.
  const r = await matrixRig({ ids: ['b', 'c'], width: 1000 });
  await r.settle();
  assert.deepEqual(r.provided().rowNumbers.held, []);
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ edgeHold: 'left' }))), { now: ['edgeHold'], later: [], shadowed: [] });
  assert.deepEqual(r.provided().rowNumbers.held.map((h) => [h.id, h.side]), [[r.entry('b').id, 'left']], 'in that commit b is drawn at the left edge');
  done(r.turn(() => r.h.b!.configure({ edgeHold: 'off' })));
  assert.deepEqual(r.provided().rowNumbers.held, [], 'off releases it in the same commit');
  r.m.unmount();
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

const slotAt = (r: MatrixRig, engineId: string): HTMLElement | null => r.m.container.querySelector<HTMLElement>(`[data-slot="${engineId}"]`)?.closest<HTMLElement>('[data-row-slot]') ?? null;
const axisOf = (el: HTMLElement | null, name: 'X' | 'Y'): number => {
  const match = el === null ? null : new RegExp(`translate${name}\\((-?[\\d.]+)px\\)`).exec(slotTransform(el));
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

test('matrix:resize', async () => {
  probe('resize');
  const r = await matrixRig();
  await r.settle();
  const revealed = (name: string): boolean => slotAt(r, r.entry(name).id)?.querySelector('[data-panel-size-reveal]') != null;
  assert.deepEqual([revealed('b'), revealed('c')], [false, false], 'before: both reflow');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ resize: 'reveal' }))), { now: ['resize'], later: [], shadowed: [] });
  assert.deepEqual([revealed('b'), revealed('c')], [true, false], 'after, in that commit: only b reveals');
});

test('matrix:layer', async () => {
  probe('layer');
  const r = await matrixRig();
  await r.settle();
  const z = (name: string): string | undefined => slotAt(r, r.entry(name).id)?.style.zIndex;
  // A resting slot's z-index is its tier plus twice its rank from the nearer end of the strip.
  const restZ = (name: string, tier: number = ROW_LAYER_Z.BASE): string => {
    const ids = r.provided().rowNumbers.ids;
    return String(slotZ(tier, centerRank(ids.indexOf(r.entry(name).id), ids.length), false));
  };
  assert.deepEqual([z('b'), z('c')], [restZ('b'), restZ('c')], 'before: both base');
  const before = [r.order().join(' '), r.provided().rowNumbers.widths.join(','), r.provided().rowNumbers.leftOffsets.join(',')];
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ layer: 'raised' }))), { now: ['layer'], later: [], shadowed: [] });
  assert.deepEqual([z('b'), z('c')], [restZ('b', ROW_LAYER_Z.RAISED), restZ('c')], 'after, in that commit: the z-index changes');
  assert.ok(Number(z('b')) >= ROW_LAYER_Z.RAISED && Number(z('c')) < ROW_LAYER_Z.RAISED, 'the raised tier is over every base slot');
  assert.deepEqual([r.order().join(' '), r.provided().rowNumbers.widths.join(','), r.provided().rowNumbers.leftOffsets.join(',')], before, 'row order and widths do not change');
  done(r.turn(() => r.h.b!.configure({ layer: 'base' })));
  assert.equal(z('b'), restZ('b'));
  const engine = r.entry('c').id;
  r.turn(() => r.h.c!.hide());
  await frames(2);
  const leaving = slotAt(r, engine);
  assert.equal(leaving !== null, true, 'control: the slot is mid-exit');
  const leavingZ = leaving!.style.zIndex;
  assert.ok(Number(leavingZ) < ROW_LAYER_Z.RAISED, 'it leaves in the base tier');
  done(r.turn(() => r.h.c!.configure({ layer: 'raised' })));
  assert.equal(slotAt(r, engine)?.style.zIndex, leavingZ, 'a slot mid-exit keeps the tier it left with');
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
  const leave = async (configure: 'top' | undefined): Promise<{ x: number; y: number }> => {
    const r = await matrixRig();
    await r.settle();
    const engine = r.entry('b').id;
    if (configure !== undefined) {
      assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ exitTo: configure }))), { now: [], later: ['exitTo'], shadowed: [] });
      assert.equal(r.order().join(' '), 'root a b c', 'nothing moves at configure');
    }
    r.turn(() => r.h.b!.hide());
    await frames(4);
    const slot = slotAt(r, engine);
    assert.equal(slot !== null, true, 'control: the slot is mid-exit');
    const out = { x: axisOf(slot, 'X'), y: axisOf(slot, 'Y') };
    r.m.unmount();
    return out;
  };
  const sideways = await leave(undefined);
  assert.equal(sideways.x !== 812 && sideways.y === 0, true, `control: a park leaves sideways (x ${sideways.x}, y ${sideways.y})`);
  const up = await leave('top');
  assert.equal(up.x === 812 && up.y < 0, true, `the next park leaves upward from its rest (x ${up.x}, y ${up.y})`);
  const r = await matrixRig();
  await r.settle();
  const engine = r.entry('b').id;
  r.turn(() => r.h.b!.hide());
  await frames(2);
  done(r.turn(() => r.h.b!.configure({ exitTo: 'top' })));
  await frames(3);
  assert.equal(axisOf(slotAt(r, engine), 'Y'), 0, 'an exit in progress keeps its style: still sideways, never upward');
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
const keysIn = async (store: Store): Promise<string[]> => (await fileOf(store)).panels.map((p) => p.key ?? p.id ?? p.uid ?? '');

test('matrix:restoreVisibility', async () => {
  probe('restoreVisibility');
  const store = memoryWorkspaceStorage();
  let r = await launch(store);
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ restoreVisibility: 'parked' }))), { now: [], later: ['restoreVisibility'], shadowed: [] });
  assert.equal(r.state('b').status, 'live', 'read only at the next launch: nothing changes now');
  r.turn(() => r.h.a!.move(1, 'person'));
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
});

test('matrix:slots', async () => {
  probe('slots');
  const r = await matrixRig();
  assert.equal(r.entry('b').slots, 1, 'before: one slot');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ slots: 2 }))), { now: [], later: ['slots'], shadowed: [] });
  assert.equal(r.entry('b').slots, 1, 'configure only stores it: the drawn panel is unchanged');
  assert.equal(thrownCode(() => r.h.b!.configure({ slots: 0 })), 'invalid-settings', 'outside 1 or more throws');
  assert.equal(thrownCode(() => r.h.b!.configure({ slots: 2.5 } as never)), 'invalid-settings');
  r.turn(() => r.h.b!.close());
  r.turn(() => r.h.b!.open());
  await r.settle();
  assert.equal(r.entry('b').slots, 2, 'the next open() uses the new default');
  r.turn(() => r.h.c!.setSlots(3, 'person'));
  assert.deepEqual(shape(r.turn(() => r.h.c!.configure({ slots: 2 }))), { now: [], later: ['slots'], shadowed: ['slots'] }, "the person's recorded count wins");
  assert.equal(r.entry('c').slots, 3);
  const conflict = refusedWith(r.turn(() => r.h.a!.configure({ maxSlots: 1, slots: 2 })), 'settings-conflict');
  assert.equal(conflict.setting, 'slots');
  assert.match(conflict.message, /C4/);
  r.turn(() => r.h.a!.configure({ slots: 2 }));
  const reset = r.turn(() => r.ws.panels.resetLayout('a'));
  assert.deepEqual([reset.ok && reset.changed, reset.ok && reset.panels], [true, ['a']], 'resetLayout reads it too');
  assert.equal(r.entry('a').slots, 2);
  assert.equal(letter(r.turn(() => r.h.a!.setSlots(3))), 'T', 'the verb resizes by whole slots');
  assert.equal(r.entry('a').slots, 3);
});

test('matrix:maxSlots', async () => {
  probe('maxSlots');
  const r = await matrixRig();
  assert.equal(letter(r.turn(() => r.h.b!.setSlots(3))), 'T', 'before: any count up to the window');
  assert.deepEqual(shape(r.turn(() => r.h.b!.configure({ maxSlots: 4 }))), { now: ['maxSlots'], later: [], shadowed: [] }, 'raising is accepted');
  const entries = r.m.latest().entries;
  const renders = r.m.renders();
  refusedWith(r.turn(() => r.h.b!.configure({ maxSlots: 2 })), 'slots-above-max');
  sameRow(r, entries, renders, 'lowering below the current slots');
  assert.equal(r.entry('b').slots, 3, 'a refusal never changes the panel');
  assert.equal(letter(r.turn(() => r.h.a!.setSlots(9))), 'T', 'a neighbour keeps its own cap');
  assert.equal(r.entry('b').settings?.maxSlots, 4);
  assert.equal(thrownCode(() => r.h.b!.configure({ maxSlots: 0 })), 'invalid-settings', 'outside 1 or more throws');
});

test('a tuning key that was removed before release is refused like any unknown key', async () => {
  const r = await matrixRig();
  for (const key of ['heightPerSlot', 'rowAlign']) {
    assert.equal(thrownCode(() => r.ws.panels.configureTuning({ [key]: 1 } as never)), 'invalid-settings', `${key} throws`);
  }
});

test('the class table ran every cell: executed cells equal 4 classes by 9 statuses, 36', () => {
  assert.equal(CLASSES.length * STATUSES.length, 36);
  assert.equal(cellsExecuted().size, 36);
  for (const cls of CLASSES) for (const status of STATUSES) assert.equal(cellsExecuted().has(`${cls}/${status}`), true, `${cls}/${status} ran`);
  assert.equal(Object.values(CLASS_TABLE).reduce((sum, row) => sum + Object.keys(row).length, 0), 36);
});

// The design copy is frozen; a catalog key added or removed after it is listed here, never in the copy.
const REMOVED_AFTER_DESIGN: readonly string[] = ['formFactor', 'formFactors', 'hideWhenLast', 'returnPriority', 'evictionRank', 'evictionOrder', 'scrollOnDrag', 'viewState', 'keepMounted', 'placeOnReturn', 'placeFallback', 'undoPlacement', 'closeExit', 'animated', 'persist', 'rememberLayout', 'undoWindowMs', 'reportClose', 'snapshot', 'draggable', 'placeable'];
const ADDED_AFTER_DESIGN: readonly string[] = ['edgeHold', 'resize', 'tuning.defaultEnterFrom', 'tuning.defaultExitTo', 'tuning.maxLivePanels', 'tuning.chrome', 'slots', 'maxSlots', 'tuning.resizeSettleSlides', 'tuning.phoneFit', 'tuning.phoneFitMin', 'tuning.phoneFitMax', 'hollowDot', 'movable', 'tuning.rowTop', 'tuning.phoneHeight', 'tuning.shrinkUnfocused', 'tuning.fastScroll', 'tuning.firstPressFocusOnly'];

test('the probes ran every catalog name once: 58 executed, equal to the catalog and to the design copy of it plus the names added after it', () => {
  const design = JSON.parse(readFileSync(new URL('./fixtures/catalog-design-copy.json', import.meta.url), 'utf8')) as { name: string }[];
  assert.equal(design.length, 60);
  assert.equal(CATALOG_NAMES.length, 58);
  assert.equal(probesExecuted().size, 58);
  assert.deepEqual([...probesExecuted()].sort(), [...CATALOG_NAMES].sort());
  assert.deepEqual([...probesExecuted()].sort(), [...design.map((d) => d.name).filter((name) => !REMOVED_AFTER_DESIGN.includes(name)), ...ADDED_AFTER_DESIGN].sort());
});
