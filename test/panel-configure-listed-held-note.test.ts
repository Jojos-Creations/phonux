/**
 * A configure call that leaves a held panel unlisted answers one hold-unlisted note in `ConfigureResult.notes` and
 * through onNote, whatever the panel's `revealOnScroll`; a panel that is not held, was already unlisted, is listed by
 * the call, or is shown or refused by the call's flip of `parkable` gets none.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import type { ConfigureResult, SettingNote } from '../index.js';
import { cleanup } from './support/mount-harness.js';
import { pinRig, type PinRig, type PinRigOptions } from './support/pin-rig.js';

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
  cleanup();
});

type Done = Extract<ConfigureResult, { ok: true }>;

const note = (panelId: string): SettingNote => ({ code: 'hold-unlisted', panelId, key: 'listed', message: 'listed: a held hide of an unlisted panel can be shown by code only' });

const answer = (changed: boolean, now: string[], notes: SettingNote[]): unknown => ({ ok: true, changed, now, later: [], shadowed: [], notes });

/** A rig with panel c hidden and settled: parked and held, and still listed unless its settings say otherwise. */
async function heldRig(o: PinRigOptions = {}): Promise<PinRig> {
  const r = await pinRig(o);
  r.turn(() => r.h.c!.hide());
  await r.settle();
  assert.deepEqual([r.state('c').status, r.state('c').held], ['parked', true], 'c is hidden and held');
  return r;
}

const holdNotes = (r: PinRig): SettingNote[] => r.m.notes.filter((n) => n.code === 'hold-unlisted');

test('a listed false configure of a held panel answers one hold-unlisted note and reports it once, whatever revealOnScroll is', async () => {
  const warn = mock.method(console, 'warn', () => undefined);
  for (const reveal of ['edges', 'any', 'never'] as const) {
    const r = await heldRig({ settings: { c: { revealOnScroll: reveal } } });
    assert.equal(r.facts('c').listed, true, `${reveal}: c is listed before the call`);
    const out = r.turn(() => r.h.c!.configure({ listed: false }));
    const n = note(r.entry('c').id);
    assert.deepEqual(out, answer(true, ['listed'], [n]), `${reveal}: the answer carries the note`);
    assert.deepEqual(r.m.notes, [n], `${reveal}: onNote heard it once`);
    assert.equal(r.facts('c').listed, false, `${reveal}: c left the list`);
    cleanup();
  }
  assert.equal(warn.mock.callCount(), 0, 'a note is not a conflict, so console.warn stays silent');
});

test('each call that unlists a held panel answers its own note, and a call that unlists nothing answers none', async () => {
  const r = await heldRig();
  const n = note(r.entry('c').id);
  const call = (patch: unknown): Done => r.turn(() => r.ws.panels.configure('c', patch as never)) as Done;

  assert.deepEqual(call({ title: 'Renamed' }).notes, [], 'a call that names no listing');
  assert.equal(r.m.notes.length, 0);
  assert.deepEqual(call({ listed: false }).notes, [n], 'the call that unlists c');
  assert.equal(r.m.notes.length, 1);
  const again = call({ listed: false });
  assert.deepEqual([again.changed, again.notes], [false, []], 'the same call again changes nothing');
  assert.equal(r.m.notes.length, 1);
  assert.deepEqual(call({ listed: true }).notes, [], 'listing c');
  assert.equal(r.facts('c').listed, true);
  assert.equal(r.m.notes.length, 1);
  assert.deepEqual(call({ listed: false }).notes, [n], 'another call, another note: the report is per call');
  assert.equal(r.m.notes.length, 2);
  const restored = call({ listed: null });
  assert.deepEqual([restored.changed, restored.now, restored.notes], [true, ['listed'], []], 'restoring the derived value lists c');
  assert.equal(r.facts('c').listed, true);
  assert.equal(r.m.notes.length, 2);
  cleanup();

  const u = await pinRig({ settings: { c: { listed: false } } });
  const callU = (patch: unknown): Done => u.turn(() => u.ws.panels.configure('c', patch as never)) as Done;
  assert.deepEqual(callU({ listed: true }).notes, [], 'c is live, so listing it raises nothing');
  u.turn(() => u.h.c!.hide());
  await u.settle();
  assert.deepEqual([u.state('c').status, u.state('c').held], ['parked', true]);
  assert.equal(u.facts('c').listed, true);
  assert.deepEqual(u.m.notes, [], 'a hold on a listed panel raises nothing');
  const nu = note(u.entry('c').id);
  const nulled = callU({ listed: null });
  assert.deepEqual([nulled.changed, nulled.now, nulled.notes], [true, ['listed'], [nu]], 'a null that restores an unlisting derived value is told like listed false');
  assert.deepEqual(u.m.notes, [nu]);
  assert.equal(u.facts('c').listed, false);
});

test('no note for a parked panel the engine parked, nor for a live one', async () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const r = await pinRig({ ids, width: 1000, settings: Object.fromEntries(ids.map((id) => [id, { overflow: 'park' as const }])) });
  await r.settle();
  assert.deepEqual([r.state('b').status, r.state('b').held], ['parked', false], 'b is parked for room');
  assert.equal(r.state('e').status, 'live');
  for (const id of ['b', 'e']) {
    const out = r.turn(() => r.h[id]!.configure({ listed: false }));
    assert.deepEqual(out, answer(true, ['listed'], []), id);
  }
  assert.equal(r.m.notes.length, 0);
});

test('no note when the held panel was already unlisted: nothing newly becomes unlisted', async () => {
  const r = await heldRig({ settings: { c: { listed: false } } });
  const n = note(r.entry('c').id);
  assert.deepEqual(r.m.notes, [n], 'the hold raised its own note');
  const out = r.turn(() => r.h.c!.configure({ listed: false }));
  assert.deepEqual(out, answer(true, ['listed'], []));
  assert.equal(r.m.notes.length, 1);
});

test('no note when the same call frees the panel: it is refused whole and stays held', async () => {
  const refused = await heldRig();
  const no = refused.turn(() => refused.h.c!.configure({ listed: false, parkable: false }));
  assert.equal(no.ok, false);
  assert.equal((no as Extract<ConfigureResult, { ok: false }>).code, 'would-reshape-row');
  assert.deepEqual([refused.state('c').status, refused.state('c').held], ['parked', true]);
  assert.equal(refused.facts('c').listed, true, 'a refusal writes nothing');
  assert.equal(refused.m.notes.length, 0);
});

