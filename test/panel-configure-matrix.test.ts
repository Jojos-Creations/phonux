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
  refusedWith,
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


test('the class table ran every cell: executed cells equal 4 classes by 9 statuses, 36', () => {
  assert.equal(CLASSES.length * STATUSES.length, 36);
  assert.equal(cellsExecuted().size, 36);
  for (const cls of CLASSES) for (const status of STATUSES) assert.equal(cellsExecuted().has(`${cls}/${status}`), true, `${cls}/${status} ran`);
  assert.equal(Object.values(CLASS_TABLE).reduce((sum, row) => sum + Object.keys(row).length, 0), 36);
});
