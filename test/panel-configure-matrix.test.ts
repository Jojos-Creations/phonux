/**
 * The configure matrix: the 36 cells of the class table (4 classes by 9 statuses), then one probe per catalog name.
 * Every expectation is written from the configure design and the catalog's `on_configure` cells, never from the code
 * under test.
 */
import { ROW_LAYER_Z } from '../rowConstants.js';
import { centerRank, slotZ } from '../rowSlotZ.js';
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './support/jsdom-globals.js';
import { rowOffsetOf } from './support/strip.js';
import { act, createElement } from 'react';
import { LIBRARY_PANEL_DEFAULTS } from '../index.js';
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

test('matrix:hostCreatable', async () => {
  probe('hostCreatable');
  await wrongScopeInEveryStatus({ hostCreatable: false }, 'hostCreatable');
  const r = await matrixRig({ ids: ['a'], extra: [matrixTemplate('m', { settings: { multiple: true } })] });
  const instances = (): number => r.ws.panels.list().filter((h) => h.templateId === 'm').length;
  r.turn(() => r.provided().create({ view: 'm' } as never));
  await r.settle();
  assert.equal(instances(), 1, 'before: a Host-bag create naming the template makes a panel');
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTemplate('m', { hostCreatable: false }))) }, { ok: true, changed: true, now: [], later: ['hostCreatable'], shadowed: [], notes: [] });
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

test('matrix:hollowDot', async () => {
  probe('hollowDot');
  await wrongScopeInEveryStatus({ hollowDot: true }, 'hollowDot');
  const r = await matrixRig({ ids: ['a'], extra: [matrixTemplate('m', { settings: { multiple: true } })] });
  assert.equal(r.ws.panels.configureTemplate('m', { hollowDot: true }).ok, true, 'a template-scope hollowDot is accepted');
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
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTemplate('m', { maxInstances: 9 }))) }, { ok: true, changed: true, now: [], later: ['maxInstances'], shadowed: [], notes: [] }, 'raising it is stored');
  assert.equal(done(r.turn(() => r.ws.panels.configureTemplate('m', { maxInstances: 3 }))).changed, true, 'lowering to the count is accepted');
  assert.equal(done(r.turn(() => r.ws.panels.configureTemplate('m', { maxInstances: null }))).changed, true, 'null is accepted');
  const single = await matrixRig({ ids: [], extra: [matrixTemplate('s', { settings: { multiple: false } })] });
  const moot = done(single.turn(() => single.ws.panels.configureTemplate('s', { maxInstances: 3 })));
  assert.equal(moot.notes.length + single.m.notes.length > 0, true, 'moot without multiple: a note says so, in the result or through onNote');
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
  assert.equal(await opens(false), 'root b c', 'control: opening c parks a, the oldest');
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
      assert.equal(rowOffsetOf(r.m.container), 0, 'and nothing scrolls');
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
  const r = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e'], width: 1000, workspace: { tuning: { rowGesture: 'step' } } });
  await r.settle();
  assert.equal(rowOffsetOf(r.m.container), 0);
  assert.deepEqual(shape(r.turn(() => r.h.c!.configure({ scrollOnOpen: 'start' }))), { now: [], later: ['scrollOnOpen'], shadowed: [] });
  await r.settle();
  assert.equal(rowOffsetOf(r.m.container), 0, 'no scroll happens at configure');
  r.turn(() => r.h.c!.scrollTo());
  await r.settle();
  assert.equal(rowOffsetOf(r.m.container), 1218, "scrollTo() defaults to the setting: c's left edge 1320 less the 16 gap is 1304, and the nearest stop that shows c is 1218");
  done(r.turn(() => r.h.c!.configure({ scrollOnOpen: 'none' })));
  r.turn(() => r.h.a!.scrollTo('start'));
  await r.settle();
  r.turn(() => r.h.c!.scrollTo());
  await r.settle();
  assert.equal(rowOffsetOf(r.m.container), 812, "none: scrollTo() falls back to into-view: c's right edge 1710 less the 984 visible is 726, and the stop that shows c whole is 812");
  const hidden = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e'], width: 1000, workspace: { tuning: { rowGesture: 'step' } } });
  hidden.turn(() => hidden.h.c!.hide());
  await hidden.settle();
  done(hidden.turn(() => hidden.h.c!.configure({ scrollOnOpen: 'start' })));
  assert.equal(rowOffsetOf(hidden.m.container), 0, 'K, H: stored, nothing scrolls');
  hidden.turn(() => hidden.h.c!.show());
  await hidden.settle();
  assert.equal(rowOffsetOf(hidden.m.container), 1218, 'the next show of the hidden panel reads it');
});

test('matrix:scrollOnMove', async () => {
  probe('scrollOnMove');
  const grown = async (none: boolean): Promise<number> => {
    const r = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e'], width: 1000, workspace: { tuning: { rowGesture: 'step' } } });
    await r.settle();
    if (none) {
      assert.deepEqual(shape(r.turn(() => r.h.a!.configure({ scrollOnMove: 'none' }))), { now: [], later: ['scrollOnMove'], shadowed: [] });
      await r.settle();
      assert.equal(rowOffsetOf(r.m.container), 0, 'nothing scrolls at configure');
    }
    r.turn(() => r.h.a!.setSlots(2));
    await r.settle();
    const at = rowOffsetOf(r.m.container);
    r.m.unmount();
    return at;
  };
  assert.equal(await grown(false), 406, 'control: a in view grows to two slots, 796 px, and the row follows to the stop that shows it whole, 406');
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

const slotAt = (r: MatrixRig, engineId: string): HTMLElement | null => r.m.container.querySelector<HTMLElement>(`[data-slot="${engineId}"]`)?.closest<HTMLElement>('[data-row-slot]') ?? null;
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

test('matrix:tuning.defaultEnterFrom', async () => {
  probe('tuning.defaultEnterFrom');
  await wrongScopeInEveryStatus({ tuning: { defaultEnterFrom: 'top' } }, 'tuning.defaultEnterFrom');
  const enter = async (tuning: 'top' | undefined, own?: 'left'): Promise<{ x: number; y: number }> => {
    const r = await matrixRig();
    await r.settle();
    if (own !== undefined) done(r.turn(() => r.h.b!.configure({ enterFrom: own })));
    if (tuning !== undefined) {
      assert.deepEqual(shape(r.turn(() => r.ws.panels.configureTuning({ defaultEnterFrom: tuning }))), { now: [], later: ['tuning.defaultEnterFrom'], shadowed: [] });
      assert.equal(r.order().join(' '), 'root a b c', 'nothing moves at configure');
    }
    r.turn(() => r.h.b!.hide());
    await r.settle();
    r.turn(() => r.h.b!.show());
    const slot = slotAt(r, r.entry('b').id);
    const out = { x: axisOf(slot, 'X'), y: axisOf(slot, 'Y') };
    r.m.unmount();
    return out;
  };
  assert.deepEqual(await enter(undefined), { x: 812 + 406, y: 0 }, 'control: the default enters from the right, one span beyond');
  const top = await enter('top');
  assert.equal(top.x === 812 && top.y < 0, true, `a panel at auto takes the workspace's top (x ${top.x}, y ${top.y})`);
  assert.deepEqual(await enter('top', 'left'), { x: 812 - 406, y: 0 }, "the panel's own left wins over the workspace's top");
  const r = await matrixRig();
  await r.settle();
  const engine = r.entry('b').id;
  r.turn(() => r.h.b!.hide());
  await r.settle();
  r.turn(() => r.h.b!.show());
  await frames(2);
  done(r.turn(() => r.ws.panels.configureTuning({ defaultEnterFrom: 'top' })));
  await frames(3);
  const x = axisOf(slotAt(r, engine), 'X');
  assert.equal(x > 812 && x < 1218 && axisOf(slotAt(r, engine), 'Y') === 0, true, `an entrance in progress keeps its style: x ${x} is still sliding in from the right`);
});

test('matrix:tuning.defaultExitTo', async () => {
  probe('tuning.defaultExitTo');
  await wrongScopeInEveryStatus({ tuning: { defaultExitTo: 'bottom' } }, 'tuning.defaultExitTo');
  const leave = async (tuning: 'bottom' | undefined, own?: 'right'): Promise<{ x: number; y: number }> => {
    const r = await matrixRig();
    await r.settle();
    const engine = r.entry('b').id;
    if (own !== undefined) done(r.turn(() => r.h.b!.configure({ exitTo: own })));
    if (tuning !== undefined) {
      assert.deepEqual(shape(r.turn(() => r.ws.panels.configureTuning({ defaultExitTo: tuning }))), { now: [], later: ['tuning.defaultExitTo'], shadowed: [] });
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
  assert.equal(sideways.x < 812 && sideways.y === 0, true, `control: a park leaves to the left (x ${sideways.x}, y ${sideways.y})`);
  const down = await leave('bottom');
  assert.equal(down.x === 812 && down.y > 0, true, `a panel at auto takes the workspace's bottom (x ${down.x}, y ${down.y})`);
  const right = await leave('bottom', 'right');
  assert.equal(right.x > 812 && right.y === 0, true, `the panel's own right wins over the workspace's bottom (x ${right.x}, y ${right.y})`);
  const r = await matrixRig();
  await r.settle();
  const engine = r.entry('b').id;
  r.turn(() => r.h.b!.hide());
  await frames(2);
  done(r.turn(() => r.ws.panels.configureTuning({ defaultExitTo: 'bottom' })));
  await frames(3);
  assert.equal(axisOf(slotAt(r, engine), 'Y'), 0, 'an exit in progress keeps its style: still sideways, never downward');
});

test('matrix:tuning.shrinkUnfocused', async () => {
  probe('tuning.shrinkUnfocused');
  await wrongScopeInEveryStatus({ tuning: { shrinkUnfocused: true } }, 'tuning.shrinkUnfocused');
  const r = await matrixRig();
  await r.settle();
  const press = (id: string): void => r.turn(() => void r.slot(id)!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })));
  const widths = (id: string): unknown[] => [r.entry(id).slots, r.entry(id).savedSlots];
  r.turn(() => r.h.b!.setSlots(2, 'person'));
  press('c');
  assert.deepEqual(widths('b'), [2, undefined], 'control: off by default, b stays two wide while c is active');
  assert.deepEqual(shape(r.turn(() => r.ws.panels.configureTuning({ shrinkUnfocused: true }))), { now: [], later: ['tuning.shrinkUnfocused'], shadowed: [] });
  assert.deepEqual(widths('b'), [2, undefined], 'nothing resizes at configure');
  press('c');
  assert.deepEqual(widths('b'), [1, 2], 'c used again: b rests at one phone and keeps two');
  press('b');
  assert.deepEqual(widths('b'), [2, undefined], 'b active again: back to two');
  for (const bad of ['yes', 1]) assert.equal(thrownCode(() => r.ws.panels.configureTuning({ shrinkUnfocused: bad } as never)), 'invalid-settings', `${String(bad)} throws`);
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

test('matrix:tuning.rowGap', async () => {
  probe('tuning.rowGap');
  await wrongScopeInEveryStatus({ tuning: { rowGap: 20 } }, 'tuning.rowGap');
  const r = await matrixRig();
  await r.settle();
  const xOf = (name: string): number => axisOf(slotAt(r, r.entry(name).id), 'X');
  assert.deepEqual(['a', 'b', 'c'].map(xOf), [406, 812, 1218], 'before: 390 plus the default gap of 16 apart');
  const renders = r.m.renders();
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ rowGap: 40 }))) }, { ok: true, changed: true, now: ['tuning.rowGap'], later: [], shadowed: [], notes: [] });
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

test('matrix:tuning.rowTop', async () => {
  probe('tuning.rowTop');
  await wrongScopeInEveryStatus({ tuning: { rowTop: 162 } }, 'tuning.rowTop');
  const r = await matrixRig();
  await r.settle();
  const renders = r.m.renders();
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ rowTop: 162 }))) }, { ok: true, changed: true, now: ['tuning.rowTop'], later: [], shadowed: [], notes: [] });
  assert.equal(r.m.renders() - renders, 1, 'one commit');
  assert.equal(r.ws.tuning.rowTop, 162, 'stored at the commit of the call');
  done(r.turn(() => r.ws.panels.configureTuning({ rowTop: 200 })));
  await r.settle();
  assert.equal(r.ws.tuning.rowTop, 200, 'a second value replaces the first');
  done(r.turn(() => r.ws.panels.configureTuning({ rowTop: null })));
  await r.settle();
  assert.equal(r.ws.tuning.rowTop, null, 'null restores the default room');
  const taken = await matrixRig();
  assert.deepEqual(taken.turn(() => [letter(taken.h.a!.hide()), letter(taken.ws.panels.configureTuning({ rowTop: 30 }))]), ['T', 'T'], 'applied while a token is held: the patch does not re-price the row');
  assert.equal(thrownCode(() => r.ws.panels.configureTuning({ rowTop: 401 })), 'invalid-settings', 'outside 0 to 400 throws');
  const unmeasured = await matrixRig({ width: 0 });
  const entries = unmeasured.m.latest().entries;
  done(unmeasured.turn(() => unmeasured.ws.panels.configureTuning({ rowTop: 40 })));
  assert.deepEqual([unmeasured.ws.tuning.rowTop, unmeasured.m.latest().entries === entries], [40, true], 'unmeasured: stored');
});

test('matrix:tuning.phoneHeight', async () => {
  probe('tuning.phoneHeight');
  await wrongScopeInEveryStatus({ tuning: { phoneHeight: 'auto' } }, 'tuning.phoneHeight');
  const r = await matrixRig();
  await r.settle();
  const renders = r.m.renders();
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ phoneHeight: 'auto' }))) }, { ok: true, changed: true, now: ['tuning.phoneHeight'], later: [], shadowed: [], notes: [] });
  assert.equal(r.m.renders() - renders, 1, 'one commit');
  assert.equal(r.ws.tuning.phoneHeight, 'auto', 'stored at the commit of the call');
  done(r.turn(() => r.ws.panels.configureTuning({ phoneHeight: 'fit' })));
  await r.settle();
  assert.equal(r.ws.tuning.phoneHeight, 'fit', 'the default is restored by a second call');
  const taken = await matrixRig();
  assert.deepEqual(taken.turn(() => [letter(taken.h.a!.hide()), letter(taken.ws.panels.configureTuning({ phoneHeight: 'auto' }))]), ['T', 'T'], 'applied while a token is held: the patch does not re-price the row');
  assert.equal(thrownCode(() => r.ws.panels.configureTuning({ phoneHeight: 'tall' as never })), 'invalid-settings', 'a value other than fit or auto throws');
});

test('matrix:tuning.dragToClose', async () => {
  probe('tuning.dragToClose');
  await wrongScopeInEveryStatus({ tuning: { dragToClose: { minDistancePx: 120 } } }, 'tuning.dragToClose');
  const r = await dragRig();
  const handle = (name: string): Element => r.m.container.querySelector(`[data-handle="${r.entry(name).id}"]`)!;
  await drag(handle('s2'), { dx: 0, dy: 100 });
  await advanceFrames(40 * 16);
  assert.equal(r.state('s2').status, 'closed', 'control: a 100 px drag down closes a panel under the default minimum of 80');
  assert.deepEqual(shape(r.turn(() => r.ws.panels.configureTuning({ dragToClose: { minDistancePx: 120 } }))), { now: [], later: ['tuning.dragToClose'], shadowed: [] });
  await drag(handle('s1'), { dx: 0, dy: 100, keepDown: true });
  done(r.turn(() => r.ws.panels.configureTuning({ dragToClose: { minDistancePx: 90 } })));
  await release(0, 100);
  await advanceFrames(40 * 16);
  assert.equal(r.state('s1').status, 'closed', 'a drag in flight is judged by the values current at the release: 90 px is short of 100');
  done(r.turn(() => r.ws.panels.configureTuning({ dragToClose: { minDistancePx: 150 } })));
  await drag(handle('s4'), { dx: 0, dy: 100 });
  await advanceFrames(40 * 16);
  assert.equal(r.state('s4').status, 'live', 'every panel reads the new minimum');
  await drag(handle('s3'), { dx: 0, dy: 160 });
  await advanceFrames(40 * 16);
  assert.equal(r.state('s3').status, 'closed', 'and 160 px is past it');
  done(r.turn(() => r.ws.panels.configureTuning({ dragToClose: null } as never)));
  assert.equal(r.ws.tuning.dragToClose.minDistancePx, LIBRARY_TUNING_DEFAULTS.dragToClose.minDistancePx, 'null puts the library default back');
});

test('matrix:tuning.slide', async () => {
  probe('tuning.slide');
  await wrongScopeInEveryStatus({ tuning: { slide: { durationSec: 0.05 } } }, 'tuning.slide');
  const present = async (configure: boolean): Promise<boolean> => {
    const r = await matrixRig({ ids: ['a', 'b', 'c'] });
    await r.settle();
    const engine = r.entry('b').id;
    if (configure) {
      assert.deepEqual(shape(r.turn(() => r.ws.panels.configureTuning({ slide: { durationSec: 0.05 } }))), { now: [], later: ['tuning.slide'], shadowed: [] });
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
  const running = await matrixRig({ ids: ['a', 'b', 'c'] });
  await running.settle();
  const engine = running.entry('b').id;
  running.turn(() => running.h.b!.hide());
  await frames(2);
  done(running.turn(() => running.ws.panels.configureTuning({ slide: { durationSec: 0.05 } })));
  await frames(4);
  assert.equal(slotAt(running, engine) !== null, true, 'an animation running keeps its timing: six frames in, the 0.4 s exit is still sliding');
});

test('matrix:tuning.hopFraction', async () => {
  probe('tuning.hopFraction');
  await wrongScopeInEveryStatus({ tuning: { hopFraction: 0.25 } }, 'tuning.hopFraction');
  const r = await matrixRig();
  const steps = (): unknown => JSON.parse(r.seen('a')!['data-steps']!);
  assert.deepEqual(steps(), [0, 1], 'before: half of a 390 neighbour plus half a gap is 203 px, so 150 px hops nothing and 250 px hops one');
  assert.deepEqual(shape(r.turn(() => r.ws.panels.configureTuning({ hopFraction: 0.25 }))), { now: [], later: ['tuning.hopFraction'], shadowed: [] });
  assert.deepEqual(steps(), [1, 1], 'after: a quarter plus half a gap is 105.5 px, so 150 px hops one');
  assert.deepEqual(JSON.parse(r.seen('b')!['data-steps']!), [1, 1], 'a neighbour reads the same workspace value');
  assert.equal(thrownCode(() => r.ws.panels.configureTuning({ hopFraction: 1.5 })), 'invalid-settings', 'outside (0, 1] throws');
  done(r.turn(() => r.ws.panels.configureTuning({ hopFraction: 0.8 })));
  assert.deepEqual(JSON.parse(r.seen('b')!['data-steps']!), [0, 0], 'configureTuning moves every panel: 0.8 of 390 plus 8 is 320');
  assert.deepEqual(steps(), [0, 0]);
});

test('matrix:tuning.edgeScroll', async () => {
  probe('tuning.edgeScroll');
  await wrongScopeInEveryStatus({ tuning: { edgeScroll: { zonePx: 12 } } }, 'tuning.edgeScroll');
  const quarter = LIBRARY_TUNING_DEFAULTS.edgeScroll.zonePx / 4;
  const r = await dragRig();
  assert.equal((await heldScroll(r, 's1', HALF_ZONE_POINTER)) > 0, true, 'before: half the default zone from the edge scrolls');
  assert.deepEqual(shape(r.turn(() => r.ws.panels.configureTuning({ edgeScroll: { zonePx: quarter } }))), { now: [], later: ['tuning.edgeScroll'], shadowed: [] });
  assert.equal(await heldScroll(r, 's2', HALF_ZONE_POINTER), 0, 'after: a quarter-zone band leaves the same pointer outside it');
  assert.equal(await heldScroll(r, 's1', HALF_ZONE_POINTER), 0, 'for every panel');
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
  assert.equal(base, 0, 'the restore settled and opening saved nothing; the first change is saved at the default 500 ms, below');
  r.turn(() => r.h.a!.move(1, 'person'));
  tick(499);
  assert.equal(saves.length, base, 'before: a change is not saved before the quiet time');
  tick(1);
  assert.equal(saves.length, base + 1, 'and is saved at it');
  r.turn(() => r.h.a!.move(-1, 'person'));
  tick(300);
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ saveQuietMs: 2000 }))) }, { ok: true, changed: true, now: [], later: ['tuning.saveQuietMs'], shadowed: [], notes: [] });
  tick(200);
  assert.equal(saves.length, base + 2, 'a timer already armed keeps its deadline');
  r.turn(() => r.h.a!.move(1, 'person'));
  tick(1999);
  assert.equal(saves.length, base + 2, 'the next arm uses the new value');
  tick(1);
  assert.equal(saves.length, base + 3);
  void w;
});

test('matrix:tuning.gestureLockMs', async () => {
  probe('tuning.gestureLockMs');
  await wrongScopeInEveryStatus({ tuning: { gestureLockMs: 700 } }, 'tuning.gestureLockMs');
  // The lock reads performance.now, which the fake timers leave alone: a clock the test moves puts the second event an exact interval after the first.
  // Both events are one phone width plus the row gap (406) in one direction, so the second carries a whole step of travel.
  const swipes = async (gestureLockMs: number | undefined): Promise<(number | null)[]> => {
    const r = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], width: 1000 });
    await r.settle();
    mockWindow();
    let clock = 1000;
    const now = mock.method(performance, 'now', () => clock);
    const scroller = rowScrollerFor(r.m.container);
    if (gestureLockMs !== undefined) done(r.turn(() => r.ws.panels.configureTuning({ gestureLockMs })));
    const wheel = (deltaX: number): void => act(() => void r.m.container.dispatchEvent(new WheelEvent('wheel', { deltaX, cancelable: true, bubbles: true })));
    wheel(406);
    const first = scroller.glideTarget();
    clock += 10;
    wheel(406);
    const second = scroller.glideTarget();
    now.mock.restore();
    mock.timers.reset();
    r.m.unmount();
    return [first, second];
  };
  const [firstDefault, secondDefault] = await swipes(undefined);
  assert.equal(firstDefault !== null, true, 'control: the first swipe starts a glide');
  assert.equal(secondDefault, firstDefault, 'under the default 30 ms lock a second step of travel 10 ms later is held back');
  const [firstShort, secondShort] = await swipes(5);
  assert.notEqual(secondShort, firstShort, 'under 5 ms the same second step acts');
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
      assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ returnTieBreak: tieBreak }))) }, { ok: true, changed: true, now: [], later: ['tuning.returnTieBreak'], shadowed: [], notes: [] });
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
      assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ dropTieBreak: tieBreak }))) }, { ok: true, changed: true, now: [], later: ['tuning.dropTieBreak'], shadowed: [], notes: [] });
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
  await wrongScopeInEveryStatus({ tuning: { rowGesture: 'off' } }, 'tuning.rowGesture');
  const r = await matrixRig({ ids: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], width: 1000 });
  await r.settle();
  const scroller = rowScrollerFor(r.m.container);
  const wheel = (): void => act(() => void r.m.container.dispatchEvent(new WheelEvent('wheel', { deltaX: 50, cancelable: true, bubbles: true })));
  wheel();
  assert.equal(scroller.glideTarget() !== null, true, 'before: step starts a glide on a swipe');
  await r.settle();
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ rowGesture: 'off' }))) }, { ok: true, changed: true, now: [], later: ['tuning.rowGesture'], shadowed: [], notes: [] });
  assert.equal(r.live().length, 11, 'no panel moves');
  const at = rowOffsetOf(r.m.container);
  await r.settle();
  wheel();
  assert.deepEqual([scroller.glideTarget(), rowOffsetOf(r.m.container)], [null, at], 'after the next render: off installs no listener, so a swipe does nothing');
  assert.equal(thrownCode(() => r.ws.panels.configureTuning({ rowGesture: 'free' } as never)), 'invalid-settings', "'free' is not a gesture: it throws like any other value outside the set");
});

test('matrix:tuning.initialScroll', async () => {
  probe('tuning.initialScroll');
  await wrongScopeInEveryStatus({ tuning: { initialScroll: 'end' } }, 'tuning.initialScroll');
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const r = await matrixRig({ ids, width: 1000 });
  await r.settle();
  assert.equal(rowOffsetOf(r.m.container), 0, 'before: the strip starts at the left');
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ initialScroll: 'end' }))) }, { ok: true, changed: true, now: [], later: ['tuning.initialScroll'], shadowed: [], notes: [] });
  await r.settle();
  assert.equal(rowOffsetOf(r.m.container), 0, 'nothing scrolls now');
  const next = await matrixRig({ ids, width: 1000, workspace: { tuning: { initialScroll: 'end', rowGesture: 'step' } } });
  await next.settle();
  // The row's end is 4450 plus 86 of centering at each end, less the 968 window: 3654, the last stop.
  assert.equal(rowOffsetOf(next.m.container), 3654, 'a mount that reads end puts the strip at its farthest legal scroll');
  assert.equal(r.ws.tuning.initialScroll, 'end', 'the workspace now holds it for its next mount');
});

test('matrix:tuning.chrome', async () => {
  probe('tuning.chrome');
  await wrongScopeInEveryStatus({ tuning: { chrome: { mode: 'hover-or-active' } } }, 'tuning.chrome');
  const r = await matrixRig();
  await r.settle();
  assert.deepEqual({ ...r.ws.tuning.chrome }, { mode: 'always', fadeMs: 120, fadeEase: 'easeOut' });
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ chrome: { fadeMs: 60 } }))) }, { ok: true, changed: true, now: ['tuning.chrome'], later: [], shadowed: [], notes: [] });
  assert.deepEqual({ ...r.ws.tuning.chrome }, { mode: 'always', fadeMs: 60, fadeEase: 'easeOut' }, 'a one-member patch keeps the other members');
  assert.equal(done(r.turn(() => r.ws.panels.configureTuning({ chrome: { fadeMs: 60 } }))).changed, false, 'an equal patch changes nothing');
  assert.equal(thrownCode(() => r.ws.panels.configureTuning({ chrome: { fadeMs: 10001 } })), 'invalid-settings', 'outside 0 to 10000 throws');
  assert.equal(thrownCode(() => r.ws.panels.configureTuning({ chrome: { mode: 'sometimes' } as never })), 'invalid-settings');
  assert.equal(r.ws.tuning.chrome.fadeMs, 60, 'a refused patch left the value');
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ chrome: { fadeEase: 'linear' } }))) }, { ok: true, changed: true, now: ['tuning.chrome'], later: [], shadowed: [], notes: [] } as never, 'fadeEase applies at once, like the other members');
  assert.deepEqual({ ...r.ws.tuning.chrome }, { mode: 'always', fadeMs: 60, fadeEase: 'linear' }, 'a fadeEase-only patch keeps the other members');
  assert.equal(thrownCode(() => r.ws.panels.configureTuning({ chrome: { fadeEase: 'cubic-out' } as never })), 'invalid-settings');
  assert.equal(r.ws.tuning.chrome.fadeEase, 'linear', 'a refused patch left the value');
});

test('matrix:tuning.resizeSettleSlides', async () => {
  probe('tuning.resizeSettleSlides');
  await wrongScopeInEveryStatus({ tuning: { resizeSettleSlides: 2 } }, 'tuning.resizeSettleSlides');
  const r = await matrixRig();
  await r.settle();
  assert.equal(r.ws.tuning.resizeSettleSlides, 1 / 3);
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
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ maxLivePanels: 2 }))) }, { ok: true, changed: true, now: ['tuning.maxLivePanels'], later: [], shadowed: [], notes: [] });
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

test('matrix:tuning.phoneFit', async () => {
  probe('tuning.phoneFit');
  await wrongScopeInEveryStatus({ tuning: { phoneFit: 'fit' } }, 'tuning.phoneFit');
  const r = await matrixRig();
  assert.equal(r.ws.tuning.phoneFit, 'off', 'before: the library default');
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ phoneFit: 'fit' }))) }, { ok: true, changed: true, now: ['tuning.phoneFit'], later: [], shadowed: [], notes: [] });
  assert.equal(r.ws.tuning.phoneFit, 'fit');
  for (const bad of ['on', 1, true]) assert.equal(thrownCode(() => r.ws.panels.configureTuning({ phoneFit: bad } as never)), 'invalid-settings', `${String(bad)} throws`);
  assert.equal(r.ws.tuning.phoneFit, 'fit', 'a refused value changes nothing');
});

test('matrix:tuning.phoneFitMin', async () => {
  probe('tuning.phoneFitMin');
  await wrongScopeInEveryStatus({ tuning: { phoneFitMin: 0.9 } }, 'tuning.phoneFitMin');
  const r = await matrixRig();
  assert.equal(r.ws.tuning.phoneFitMin, 0.82, 'before: the library default');
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ phoneFitMin: 0.9 }))) }, { ok: true, changed: true, now: ['tuning.phoneFitMin'], later: [], shadowed: [], notes: [] });
  assert.equal(r.ws.tuning.phoneFitMin, 0.9);
  for (const bad of [0, -1, 1.5, '0.9', Number.NaN]) assert.equal(thrownCode(() => r.ws.panels.configureTuning({ phoneFitMin: bad } as never)), 'invalid-settings', `${String(bad)} throws`);
  assert.equal(r.ws.tuning.phoneFitMin, 0.9, 'a refused value changes nothing');
});

test('matrix:tuning.phoneFitMax', async () => {
  probe('tuning.phoneFitMax');
  await wrongScopeInEveryStatus({ tuning: { phoneFitMax: 1.2 } }, 'tuning.phoneFitMax');
  const r = await matrixRig();
  assert.equal(r.ws.tuning.phoneFitMax, 1.13, 'before: the library default');
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTuning({ phoneFitMax: 1.2 }))) }, { ok: true, changed: true, now: ['tuning.phoneFitMax'], later: [], shadowed: [], notes: [] });
  assert.equal(r.ws.tuning.phoneFitMax, 1.2);
  for (const bad of [0.9, 4.5, '1.2', Number.NaN]) assert.equal(thrownCode(() => r.ws.panels.configureTuning({ phoneFitMax: bad } as never)), 'invalid-settings', `${String(bad)} throws`);
  assert.equal(r.ws.tuning.phoneFitMax, 1.2, 'a refused value changes nothing');
});

test('the class table ran every cell: executed cells equal 4 classes by 9 statuses, 36', () => {
  assert.equal(CLASSES.length * STATUSES.length, 36);
  assert.equal(cellsExecuted().size, 36);
  for (const cls of CLASSES) for (const status of STATUSES) assert.equal(cellsExecuted().has(`${cls}/${status}`), true, `${cls}/${status} ran`);
  assert.equal(Object.values(CLASS_TABLE).reduce((sum, row) => sum + Object.keys(row).length, 0), 36);
});

// The design copy is frozen; a catalog key added or removed after it is listed here, never in the copy.
const REMOVED_AFTER_DESIGN: readonly string[] = ['formFactor', 'formFactors', 'hideWhenLast', 'returnPriority', 'evictionRank', 'evictionOrder', 'scrollOnDrag', 'viewState', 'keepMounted', 'placeOnReturn', 'placeFallback', 'undoPlacement', 'closeExit', 'animated', 'persist', 'rememberLayout', 'undoWindowMs', 'reportClose', 'snapshot', 'draggable', 'placeable'];
const ADDED_AFTER_DESIGN: readonly string[] = ['edgeHold', 'resize', 'tuning.defaultEnterFrom', 'tuning.defaultExitTo', 'tuning.maxLivePanels', 'tuning.chrome', 'slots', 'maxSlots', 'tuning.resizeSettleSlides', 'tuning.phoneFit', 'tuning.phoneFitMin', 'tuning.phoneFitMax', 'hollowDot', 'movable', 'tuning.rowTop', 'tuning.phoneHeight', 'tuning.shrinkUnfocused'];

test('the probes ran every catalog name once: 56 executed, equal to the catalog and to the design copy of it plus the names added after it', () => {
  const design = JSON.parse(readFileSync(new URL('./fixtures/catalog-design-copy.json', import.meta.url), 'utf8')) as { name: string }[];
  assert.equal(design.length, 60);
  assert.equal(CATALOG_NAMES.length, 56);
  assert.equal(probesExecuted().size, 56);
  assert.deepEqual([...probesExecuted()].sort(), [...CATALOG_NAMES].sort());
  assert.deepEqual([...probesExecuted()].sort(), [...design.map((d) => d.name).filter((name) => !REMOVED_AFTER_DESIGN.includes(name)), ...ADDED_AFTER_DESIGN].sort());
});
