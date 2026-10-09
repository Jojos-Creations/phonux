/**
 * `configureTemplate(id, { multiple: false })` counts every instance of the template that can come back: row entries,
 * declared panels closed inside the undo window or past it, and anonymous panels inside the undo window. Lowering
 * `maxInstances` and the creation paths keep counting row entries only.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import type { ConfigureResult, PanelSettings } from '../index.js';
import { cleanup } from './support/mount-harness.js';
import { pinRig, type PinRig } from './support/pin-rig.js';
import { markerTemplate } from './support/workspace-row.js';

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  cleanup();
});

/** A rig with a multiple template named m beside the panel a. */
const multiRig = (over: PanelSettings = {}): Promise<PinRig> => pinRig({ ids: ['a'], extra: [markerTemplate('m', { settings: { multiple: true, ...over } })] });

const flip = (r: PinRig): ConfigureResult => r.turn(() => r.ws.panels.configureTemplate('m', { multiple: false }));

const windowed = (r: PinRig): number => (r.provided().recentlyClosed ?? []).length;

const one = "template 'm': 1 instance exists, and a template that is not multiple allows only the one named 'm'";

/** The flip answers instance-limit on multiple with `message`, and commits nothing: same row array, same render count, same snapshot version. */
function refusedFlip(r: PinRig, message: string): void {
  const entries = r.m.latest().entries;
  const renders = r.m.renders();
  const version = r.ws.panels.getSnapshot().version;
  assert.deepEqual({ ...flip(r) }, { ok: false, code: 'instance-limit', setting: 'multiple', message });
  assert.equal(r.m.latest().entries === entries, true, 'the row is the same array');
  assert.equal(r.m.renders(), renders, 'nothing rendered');
  assert.equal(r.ws.panels.getSnapshot().version, version, 'the snapshot did not move');
}

const changed = (res: ConfigureResult, what: string): void => assert.deepEqual([res.ok, res.ok && res.changed], [true, true], res.ok ? what : `${what}: ${res.code}: ${res.message}`);

test('multiple true to false is refused while declared panels sit in the undo window', async () => {
  const r = await multiRig();
  r.turn(() => void [r.ws.addPanel('m', { id: 'm1' }), r.ws.addPanel('m', { id: 'm2' })]);
  await r.settle();
  r.turn(() => r.ws.panels.get('m1')!.close());
  r.turn(() => r.ws.panels.get('m2')!.close());
  assert.deepEqual([windowed(r), r.state('m1').status, r.state('m2').status], [2, 'closed', 'closed']);
  refusedFlip(r, "template 'm': 2 instances exist, and a template that is not multiple allows only the one named 'm'");
});

test('multiple true to false is refused while a declared panel is closed past the window', async () => {
  const r = await multiRig();
  r.turn(() => void r.ws.addPanel('m', { id: 'm1' }));
  await r.settle();
  mock.timers.enable({ apis: ['setTimeout'] });
  r.turn(() => r.ws.panels.get('m1')!.close());
  act(() => mock.timers.tick(10001));
  assert.deepEqual([windowed(r), r.state('m1').status], [0, 'closed']);
  refusedFlip(r, one);
});

test('multiple true to false is refused while an anonymous panel is in the undo window, and accepted once the window has passed', async () => {
  const r = await multiRig();
  const p = r.turn(() => r.ws.addPanel('m'));
  await r.settle();
  mock.timers.enable({ apis: ['setTimeout'] });
  r.turn(() => p.close());
  assert.equal(windowed(r), 1);
  refusedFlip(r, one);
  act(() => mock.timers.tick(10001));
  assert.equal(windowed(r), 0, 'the anonymous panel is gone');
  changed(flip(r), 'past the window');
});

test('multiple true to false is refused for one live instance whose id is not the template id', async () => {
  const r = await multiRig();
  r.turn(() => void r.ws.addPanel('m', { id: 'm2' }));
  await r.settle();
  assert.equal(r.state('m2').status, 'live', 'control: the instance is live');
  refusedFlip(r, one);
});

test('multiple true to false is accepted while the only instance is the singleton named like the template', async () => {
  const r = await pinRig({ ids: ['a'], extra: [markerTemplate('s', { settings: { multiple: false } })] });
  r.turn(() => void r.ws.addPanel('s'));
  await r.settle();
  assert.equal(r.state('s').status, 'live', 'control: the singleton is live');
  changed(r.turn(() => r.ws.panels.configureTemplate('s', { multiple: true })), 'false to true');
  changed(r.turn(() => r.ws.panels.configureTemplate('s', { multiple: false })), 'true to false');
  changed(r.turn(() => r.ws.panels.configureTemplate('s', { multiple: true })), 'false to true again');
  r.turn(() => r.ws.panels.get('s')!.close());
  assert.equal(r.state('s').status, 'closed');
  changed(r.turn(() => r.ws.panels.configureTemplate('s', { multiple: false })), 'closed singleton');
});

test('a panel addPanel refused for room is not an existing instance', async () => {
  const r = await multiRig({ maxInstances: 1 });
  r.turn(() => void r.ws.addPanel('m', { id: 'm1' }));
  await r.settle();
  assert.equal(r.turn(() => r.ws.addPanel('m', { id: 'm2' })).getState().status, 'closed', 'control: refused for room');
  refusedFlip(r, one);
});

test('multiple false to false with an instance named otherwise is accepted: nothing changes meaning', async () => {
  const r = await pinRig({ ids: ['a'], extra: [markerTemplate('s', { settings: { multiple: false } })] });
  r.turn(() => void r.ws.addPanel('s', { id: 's2' }));
  await r.settle();
  assert.equal(r.state('s2').status, 'live', 'control: the instance is live');
  changed(r.turn(() => r.ws.panels.configureTemplate('s', { multiple: false })), 'false to false');
});

test('maxInstances: lowering below the live count is refused, and closed records alone do not refuse it', async () => {
  const r = await multiRig({ maxInstances: 5 });
  r.turn(() => void [r.ws.addPanel('m', { id: 'm1' }), r.ws.addPanel('m', { id: 'm2' }), r.ws.addPanel('m', { id: 'm3' })]);
  await r.settle();
  const lowered = r.turn(() => r.ws.panels.configureTemplate('m', { maxInstances: 2 }));
  assert.deepEqual({ ...lowered }, { ok: false, code: 'instance-limit', setting: 'maxInstances', message: "template 'm': 3 instances exist, more than 2 allows" });
  mock.timers.enable({ apis: ['setTimeout'] });
  r.turn(() => r.ws.panels.get('m1')!.close());
  act(() => mock.timers.tick(10001));
  r.turn(() => r.ws.panels.get('m2')!.close());
  assert.deepEqual([r.state('m1').status, r.state('m2').status, r.state('m3').status, windowed(r)], ['closed', 'closed', 'live', 1]);
  changed(r.turn(() => r.ws.panels.configureTemplate('m', { maxInstances: 1 })), 'one live instance, two closed records');
});

test('closed records stay out of the creation count: at maxInstances 1 a closed panel does not block an addPanel, and its open() answers instance-limit while that one lives', async () => {
  const r = await multiRig({ maxInstances: 1 });
  r.turn(() => void r.ws.addPanel('m', { id: 'm1' }));
  await r.settle();
  mock.timers.enable({ apis: ['setTimeout'] });
  r.turn(() => r.ws.panels.get('m1')!.close());
  act(() => mock.timers.tick(10001));
  assert.equal(r.state('m1').status, 'closed');
  const m2 = r.turn(() => r.ws.addPanel('m', { id: 'm2' }));
  await r.settle();
  assert.equal(m2.getState().status, 'live');
  const reopened = r.turn(() => r.ws.panels.get('m1')!.open());
  assert.deepEqual([reopened.ok, reopened.ok ? undefined : reopened.code], [false, 'instance-limit']);
});

test('multiple true to false counts only this template: the closed and undo-window panels of another template do not refuse it', async () => {
  const r = await pinRig({ ids: ['a'], extra: [markerTemplate('m', { settings: { multiple: true } }), markerTemplate('n', { settings: { multiple: true } })] });
  mock.timers.enable({ apis: ['setTimeout'] });
  r.turn(() => r.h.a!.close());
  act(() => mock.timers.tick(10001));
  assert.equal(r.state('a').status, 'closed', 'control: a declared panel of another template is closed past the window');
  const p = r.turn(() => r.ws.addPanel('n'));
  await r.settle();
  r.turn(() => p.close());
  assert.equal(windowed(r), 1, 'control: an anonymous panel of another template is in the window');
  changed(flip(r), 'template m has no instance');
});
