/**
 * closable, movable and resizable limit a person's gestures only, and the two keys movable replaced load as notes.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { resolvePanelSettings } from '../panelSettings.js';
import { definePanel } from '../index.js';
import type { PanelSettings } from '../index.js';
import { PanelManagerError } from '../panelManagerError.js';
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

test('a template, workspace default or live instance layer that names draggable or placeable throws invalid-settings naming movable', () => {
  for (const layer of ['workspace', 'template', 'instance'] as const) {
    for (const key of ['draggable', 'placeable']) {
      for (const value of [true, false]) {
        assert.throws(
          () => resolvePanelSettings({ [layer]: asSettings({ [key]: value }) }),
          (e: unknown) => e instanceof PanelManagerError && e.code === 'invalid-settings' && e.message.includes(`${layer}.${key}`) && e.message.includes('movable'),
          `${layer}.${key}=${value}`,
        );
      }
    }
  }
});

test('definePanel with draggable: false or placeable throws invalid-settings naming movable', () => {
  for (const key of ['draggable', 'placeable']) {
    assert.throws(
      () => definePanel({ id: 'x', view: () => null, settings: { [key]: false } as never }),
      (e: unknown) => e instanceof PanelManagerError && e.code === 'invalid-settings' && e.message.includes('movable'),
      key,
    );
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

test('the root cannot be closed or placed by anyone, and a person cannot move it while its movable is unset', async () => {
  const r = await pinRig();
  const root = r.ws.panels.get(r.ws.rootId)!;
  assert.equal(letter(r.turn(() => root.close())), 'not-closable');
  assert.equal(letter(r.turn(() => root.close('person'))), 'not-closable');
  assert.equal(letter(r.turn(() => root.place('row-end'))), 'root-fixed');
  assert.equal(letter(r.turn(() => root.place('row-end', 'person'))), 'root-fixed');
  assert.equal(letter(r.turn(() => root.move(1, 'person'))), 'not-movable', 'the person\'s drag is what movable gates');
  assert.equal(r.order().join(' '), 'root a b c');
});

test('the developer reorders the root whatever its movable says: the handle move and the host move verb', async () => {
  const r = await pinRig();
  const root = r.ws.panels.get(r.ws.rootId)!;
  assert.equal(root.getState().settings.movable, false);
  assert.equal(letter(r.turn(() => root.move(1))), 'T');
  assert.equal(r.order().join(' '), 'a root b c');
  assert.equal(r.entry('root').anchor, undefined, 'the root is never anchored');
  r.turn(() => r.provided().move(r.ws.rootId, 'right'));
  assert.equal(r.order().join(' '), 'a b root c');
  assert.equal(letter(r.turn(() => root.move(-2))), 'T');
  assert.equal(r.order().join(' '), 'root a b c');
});

test('pin, pin(person), unpin and place on the root are refused with root-fixed, movable unset or true, and write no self-anchor', async () => {
  for (const movable of [undefined, true]) {
    const r = await pinRig();
    const root = r.ws.panels.get(r.ws.rootId)!;
    if (movable) assert.equal(letter(r.turn(() => root.configure({ movable: true }))), 'T');
    const before = JSON.stringify(r.m.latest().entries.map((p) => [p.id, p.anchor, p.live]));
    for (const call of [() => root.pin(), () => root.pin('person'), () => root.unpin(), () => root.unpin('person'), () => root.place('row-end'), () => root.place('row-end', 'person')]) {
      assert.equal(letter(r.turn(call)), 'root-fixed', `movable ${movable}`);
    }
    assert.equal(JSON.stringify(r.m.latest().entries.map((p) => [p.id, p.anchor, p.live])), before);
    assert.equal(r.entry('root').anchor, undefined);
    assert.equal(r.order().join(' '), 'root a b c');
  }
});

test('a live configure patch that names draggable or placeable throws invalid-settings naming movable', async () => {
  const r = await pinRig();
  for (const key of ['draggable', 'placeable']) {
    for (const run of [() => r.h.b!.configure({ [key]: false } as never), () => r.ws.panels.configure('b', { [key]: false } as never)]) {
      assert.throws(
        () => r.turn(run),
        (e: unknown) => e instanceof PanelManagerError && e.code === 'invalid-settings' && e.key === key && e.message.includes("'movable'") && !e.message.includes('unknown setting'),
        key,
      );
    }
  }
});
