/**
 * `configureTemplate` naming `maxInstances` on a template that resolves to `multiple: false` answers one
 * `max-instances-moot` note in `ConfigureResult.notes` and reports it once through `onNote`; the limit is stored.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import type { ConfigureResult } from '../index.js';
import { cleanup } from './support/mount-harness.js';
import { pinRig } from './support/pin-rig.js';
import { markerTemplate } from './support/workspace-row.js';

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  cleanup();
});

const MOOT = { code: 'max-instances-moot', key: 'maxInstances', message: "maxInstances: template 'b' is not multiple, so this limit has no effect until multiple is true" };

const notesOf = (res: ConfigureResult): readonly unknown[] => (res.ok ? res.notes : ['refused']);

test('a maxInstances patch on a template that is not multiple answers one moot note and reports it once', async () => {
  const warn = mock.method(console, 'warn', () => {});
  const r = await pinRig();
  const res = r.turn(() => r.ws.panels.configureTemplate('b', { maxInstances: 3 }));
  assert.deepEqual({ ...res }, { ok: true, changed: true, shown: false, now: [], later: ['maxInstances'], shadowed: [], notes: [MOOT] });
  assert.deepEqual(r.m.notes, [MOOT], 'onNote heard it once');
  assert.equal(warn.mock.callCount(), 0, 'a note is not a conflict');
  assert.equal(r.ws.panels.get('b')!.getSettings().value.maxInstances, 3, 'the limit is stored');
});

test('each call that stores a patch naming the key answers its own note, null included, and a call that changes nothing answers none', async () => {
  const r = await pinRig();
  const call = (patch: Record<string, unknown>): ConfigureResult => r.turn(() => r.ws.panels.configureTemplate('b', patch as never));
  const answer = (res: ConfigureResult): [boolean, unknown, readonly unknown[]] => [res.ok, res.ok ? res.changed : undefined, notesOf(res)];
  assert.deepEqual(answer(call({ maxInstances: 3 })), [true, true, [MOOT]]);
  assert.deepEqual(answer(call({ maxInstances: 4 })), [true, true, [MOOT]]);
  assert.equal(r.m.notes.length, 2);
  assert.deepEqual(answer(call({ maxInstances: 4 })), [true, false, []]);
  assert.equal(r.m.notes.length, 2, 'an equal patch raises nothing more');
  assert.deepEqual(answer(call({ maxInstances: null })), [true, true, [MOOT]]);
  assert.equal(r.m.notes.length, 3, 'null names the key');
  assert.deepEqual(answer(call({ maxInstances: null })), [true, false, []]);
  assert.equal(r.m.notes.length, 3);
  assert.deepEqual(answer(call({ maxInstances: 7 })), [true, true, [MOOT]]);
  const both = call({ maxInstances: 7, hostCreatable: false });
  assert.deepEqual([both.ok && both.changed, both.ok ? both.later : undefined, notesOf(both)], [true, ['hostCreatable'], [MOOT]], 'the note follows the keys the patch names, not the keys this call changed');
  assert.equal(r.m.notes.length, 5);
});

test('no note when the template is multiple after the patch, or when the patch does not name maxInstances', async () => {
  const r = await pinRig({ extra: [markerTemplate('m', { settings: { multiple: true } })] });
  const call = (id: string, patch: Record<string, unknown>): [boolean, unknown, readonly unknown[], readonly unknown[]] => {
    const res = r.turn(() => r.ws.panels.configureTemplate(id, patch as never));
    return [res.ok, res.ok ? res.changed : undefined, res.ok ? res.later : [], notesOf(res)];
  };
  assert.deepEqual(call('m', { maxInstances: 5 }), [true, true, ['maxInstances'], []], 'a multiple template');
  assert.deepEqual(call('b', { multiple: true, maxInstances: 3 }), [true, true, ['multiple', 'maxInstances'], []], 'the patch makes the template multiple');
  assert.deepEqual(call('b', { multiple: false }), [true, true, ['multiple'], []], 'the stored limit is not named');
  assert.deepEqual(call('c', { hostCreatable: false }), [true, true, ['hostCreatable'], []]);
  assert.equal(r.m.notes.length, 0);
});

test('a refused call raises no note: the instance-limit answer carries none and onNote hears nothing', async () => {
  const r = await pinRig({ ids: ['a'], extra: [markerTemplate('m', { settings: { multiple: true } })] });
  r.turn(() => void [r.ws.addPanel('m', { id: 'm1' }), r.ws.addPanel('m', { id: 'm2' })]);
  await r.settle();
  const res = r.turn(() => r.ws.panels.configureTemplate('m', { multiple: false, maxInstances: 3 }));
  assert.deepEqual([res.ok, res.ok ? undefined : res.code, res.ok ? undefined : res.setting], [false, 'instance-limit', 'multiple']);
  assert.equal('notes' in res, false, 'a refusal has no notes member');
  assert.equal(r.m.notes.length, 0);
  assert.equal(r.ws.panels.get('m1')!.getSettings().value.multiple, true, 'nothing was stored');
});

test('the key is a template key: configure, the panel handle and configureTuning refuse it and report nothing', async () => {
  const r = await pinRig();
  const refusal = (res: ConfigureResult): [boolean, unknown, unknown] => [res.ok, res.ok ? undefined : res.code, res.ok ? undefined : res.setting];
  assert.deepEqual(refusal(r.turn(() => r.ws.panels.configure('b', { maxInstances: 2 } as never))), [false, 'wrong-scope', 'maxInstances']);
  assert.deepEqual(refusal(r.turn(() => r.h.b!.configure({ maxInstances: 2 } as never))), [false, 'wrong-scope', 'maxInstances']);
  assert.deepEqual(refusal(r.turn(() => r.ws.panels.configureTuning({ maxInstances: 2 } as never))), [false, 'wrong-scope', 'maxInstances']);
  assert.equal(r.m.notes.length, 0);
});
