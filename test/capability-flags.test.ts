/**
 * closable, movable and resizable limit a person's gestures only, and the two keys movable replaced load as notes.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { resolvePanelSettings } from '../panelSettings.js';
import type { PanelSettings } from '../index.js';
import { cleanup } from './support/mount-harness.js';
import { pinRig } from './support/pin-rig.js';

afterEach(cleanup);

const letter = (a: { ok: boolean; changed?: boolean; code?: string }): string => (a.ok ? (a.changed ? 'T' : 'F') : (a.code as string));
const asSettings = (v: object): PanelSettings => v as PanelSettings;

test('movable follows parkable, any layer may set it, and the root accepts it', () => {
  assert.equal(resolvePanelSettings().value.movable, true);
  assert.deepEqual([resolvePanelSettings({ template: { parkable: false } }).value.movable, resolvePanelSettings({ template: { parkable: false } }).source.movable], [false, 'derived']);
  assert.equal(resolvePanelSettings({ template: { parkable: false, movable: true } }).value.movable, true);
  const root = resolvePanelSettings({ template: { movable: true } }, { root: true });
  assert.deepEqual([root.value.movable, root.conflicts.map((c) => [c.key, c.rule])], [true, []]);
});

test('a template or workspace default that names draggable or placeable is ignored and told once in development', () => {
  const log = mock.method(console, 'error', () => undefined);
  try {
    for (const layer of ['workspace', 'template', 'instance'] as const) {
      const res = resolvePanelSettings({ [layer]: asSettings({ draggable: false, placeable: false }) });
      assert.equal(res.value.movable, true, `${layer}: the key changed nothing`);
      assert.deepEqual([res.conflicts, res.notes], [[], []], layer);
      assert.equal('draggable' in res.value || 'placeable' in res.value, false);
    }
    assert.ok(log.mock.calls.every((c) => /^phonux: the \w+ setting '(draggable|placeable)' was removed/.test(String(c.arguments[0]))));
    assert.equal(log.mock.calls.length, 2, 'one message per key, not per layer');
  } finally {
    log.mock.restore();
  }
});

test('a saved instance layer holding draggable and placeable with one value loads as movable with a note', () => {
  for (const value of [true, false]) {
    const res = resolvePanelSettings({ instance: asSettings({ draggable: value, placeable: value, closable: false }) }, { lenient: true });
    assert.deepEqual([res.value.movable, res.source.movable, res.value.closable], [value, 'instance', false]);
    assert.deepEqual(res.notes.map((n) => [n.code, n.key]), [['invalid-saved-setting', 'movable']]);
  }
});

test('a saved instance layer where the two disagree, or only one is held, drops it with a note', () => {
  for (const instance of [{ draggable: false, placeable: true }, { draggable: false }, { placeable: false }]) {
    const res = resolvePanelSettings({ instance: asSettings(instance) }, { lenient: true });
    assert.equal(res.value.movable, true, JSON.stringify(instance));
    assert.deepEqual(res.notes.map((n) => [n.code, n.key]), Object.keys(instance).map((key) => ['invalid-saved-setting', key]), JSON.stringify(instance));
  }
});

test('a saved user layer holding draggable or placeable loads with a note', () => {
  const res = resolvePanelSettings({ user: { draggable: false } as never }, { lenient: true });
  assert.equal(res.value.movable, true);
  assert.deepEqual(res.notes.map((n) => [n.code, n.key]), [['invalid-saved-setting', 'draggable']]);
});

test('closable false: a person is refused, the developer is not', async () => {
  const person = await pinRig({ settings: { b: { closable: false } } });
  assert.equal(letter(person.turn(() => person.h.b!.close('person'))), 'not-closable');
  assert.equal(person.order().join(' '), 'root a b c');
  const code = await pinRig({ settings: { b: { closable: false } } });
  assert.equal(letter(code.turn(() => code.h.b!.close())), 'T');
  assert.equal(code.order().join(' '), 'root a c');
});

test('movable false: a person is refused a move and a placement, the developer is not, and a pin with a placement moves it', async () => {
  const settings = { b: { movable: false, pinning: { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } } } } as const;
  const r = await pinRig({ settings: settings as never });
  assert.equal(letter(r.turn(() => r.h.b!.move(1, 'person'))), 'not-movable');
  assert.equal(letter(r.turn(() => r.h.b!.place('row-start', 'person'))), 'not-movable');
  assert.equal(r.order().join(' '), 'root a b c');
  assert.equal(letter(r.turn(() => r.h.b!.move(1))), 'T');
  assert.equal(r.order().join(' '), 'root a c b');
  assert.equal(letter(r.turn(() => r.h.b!.place('row-start'))), 'T');
  assert.equal(r.order().join(' '), 'b root a c');
  assert.equal(letter(r.turn(() => r.h.b!.unpin())), 'T', 'a placement-bearing unpin');
  assert.equal(letter(r.turn(() => r.h.b!.pin())), 'T', 'a placement-bearing pin');
  assert.equal(r.order().join(' '), 'b root a c');
});

test('resizable false: a person is refused, the developer resizes, and maxSlots still clamps both', async () => {
  const r = await pinRig({ settings: { b: { resizable: false, maxSlots: 2 } } });
  assert.equal(letter(r.turn(() => r.h.b!.setSlots(2, 'person'))), 'not-resizable');
  assert.equal(letter(r.turn(() => r.h.b!.setSlots(2))), 'T');
  assert.equal(r.entry('b').slots, 2);
  assert.equal(letter(r.turn(() => r.h.b!.setSlots(3))), 'F', 'clamped to maxSlots: nothing changes');
  assert.equal(r.entry('b').slots, 2);
});

test('the root cannot be closed or moved or placed by anyone', async () => {
  const r = await pinRig();
  const root = r.ws.panels.get(r.ws.rootId)!;
  assert.equal(letter(r.turn(() => root.close())), 'not-closable');
  assert.equal(letter(r.turn(() => root.close('person'))), 'not-closable');
  assert.equal(letter(r.turn(() => root.move(1))), 'not-movable');
  assert.equal(letter(r.turn(() => root.place('row-end'))), 'not-movable');
  assert.equal(r.order().join(' '), 'root a b c');
});
