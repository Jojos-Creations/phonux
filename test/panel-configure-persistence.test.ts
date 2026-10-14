/**
 * What configure does to the saved file and what the file does to a configure, over launches that share one in-memory
 * storage: the person's overrides survive any configure, the developer's instance layer is saved only for a panel code
 * does not declare again, and session-only changes (template, tuning, a deferred pin) never reach the file.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import type { AnchorRequest, ConfigureResult, PanelHandle, PanelSettings, Pinning, WorkspaceState } from '../index.js';
import { memoryWorkspaceStorage } from '../fakeHost.js';
import { cleanup } from './support/mount-harness.js';
import { pinRig, type PinRig, type PinRigOptions } from './support/pin-rig.js';
import { markerTemplate } from './support/workspace-row.js';

afterEach(() => cleanup());

type Store = ReturnType<typeof memoryWorkspaceStorage>;
type Done = Extract<ConfigureResult, { ok: true }>;
const quiet = { tuning: { saveQuietMs: 5 } };
const brief = (res: { ok: boolean; changed?: boolean; code?: string }): string => (res.ok ? (res.changed ? 'T' : 'F') : res.code!);
const wait = (): Promise<void> => act(async () => void (await new Promise((done) => setTimeout(done, 80))));
const ANON = [markerTemplate('m', { settings: { multiple: true } })];

/** One launch over `store`: the rig mounted, the restore settled and the first save quiet. */
async function launch(store: Store, o: PinRigOptions = {}): Promise<PinRig> {
  const r = await pinRig({ ...o, workspace: { ...o.workspace, storage: store, ...quiet }, ...(o.over === undefined ? {} : { over: o.over }) });
  await wait();
  return r;
}

/** Lets the last change save, then closes the launch. */
async function quit(r: PinRig): Promise<void> {
  await wait();
  r.m.unmount();
  cleanup();
}

const file = async (store: Store): Promise<WorkspaceState> => (await store.load())!;
/** The file's overrides by panel key. */
const overridesOf = async (store: Store): Promise<Record<string, unknown>> => Object.fromEntries((await file(store)).panels.map((p) => [p.key!, p.overrides]));
const ok = (res: ConfigureResult): Done => {
  assert.equal(res.ok, true, res.ok ? '' : `${res.code}: ${res.message}`);
  return res as Done;
};
const right = (priority: number): AnchorRequest => ({ panel: 'root', position: 'right', priority });
/** The anonymous instance of template m, wherever the launch put it. */
const anonymous = (r: PinRig): PanelHandle => r.ws.panels.list().find((h) => h.templateId === 'm')!;

test('rememberLayout true, false, true over three launches: the dragged and the resized panel keep their overrides and apply again', async () => {
  const store = memoryWorkspaceStorage();
  let r = await launch(store);
  r.turn(() => r.h.c!.move(-1, 'person'));
  r.turn(() => r.h.b!.setFormFactor('tablet', 'person'));
  assert.deepEqual([r.order().join(' '), r.entry('b').formFactor], ['root a c b', 'tablet']);
  await quit(r);
  const first = await overridesOf(store);
  assert.deepEqual(first, { a: { anchor: right(0) }, c: { anchor: right(1) }, b: { anchor: right(2), slots: 2 } });

  r = await launch(store);
  assert.deepEqual([r.order().join(' '), r.entry('b').formFactor], ['root a c b', 'tablet'], 'launch 2 applies them');
  for (const id of ['b', 'c']) assert.deepEqual({ ...ok(r.turn(() => r.h[id]!.configure({ rememberLayout: false }))) }, { ok: true, changed: true, shown: false, now: [], later: ['rememberLayout'], shadowed: [], notes: [] });
  r.turn(() => r.h.c!.move(1, 'person'));
  r.turn(() => r.h.b!.setFormFactor('phone', 'person'));
  assert.deepEqual([r.order().join(' '), r.entry('b').formFactor], ['root a b c', 'phone'], 'the session moves on');
  await wait();
  assert.deepEqual(await overridesOf(store), first, 'while rememberLayout is false nothing is recorded and the stored overrides ride through every save');
  for (const id of ['b', 'c']) ok(r.turn(() => r.h[id]!.configure({ rememberLayout: true })));
  r.turn(() => r.h.a!.move(1, 'person'));
  assert.equal(r.order().join(' '), 'root b a c');
  await quit(r);
  assert.deepEqual(await overridesOf(store), { b: { anchor: right(0), slots: 2 }, a: { anchor: right(1) }, c: { anchor: right(2) } }, 'true again records, and the resize the false stretch skipped never replaced the stored tablet');

  r = await launch(store);
  assert.deepEqual([r.order().join(' '), r.entry('b').formFactor], ['root b a c', 'tablet'], 'launch 3 applies what was kept');
});

test('resizable false after the person resized to tablet: the tier stays tablet in the session and, saved on an anonymous instance, in the next launch', async () => {
  const store = memoryWorkspaceStorage();
  let r = await launch(store, { extra: ANON });
  const declared = r.turn(() => r.h.b!.setFormFactor('tablet', 'person'));
  assert.equal(declared.ok, true);
  assert.deepEqual({ ...ok(r.turn(() => r.h.b!.configure({ resizable: false }))) }, { ok: true, changed: true, shown: false, now: ['resizable'], later: [], shadowed: [], notes: [] });
  assert.deepEqual([r.entry('b').formFactor, r.state('b').formFactor], ['tablet', 'tablet'], 'a declared panel: configure writes no tier');
  assert.deepEqual({ ...r.turn(() => r.h.b!.setFormFactor('phone', 'person')) }, { ok: false, code: 'not-resizable', message: "panel 'b' cannot be resized" });
  const x = r.turn(() => r.ws.addPanel('m'));
  await r.settle();
  r.turn(() => x.setFormFactor('tablet', 'person'));
  ok(r.turn(() => x.configure({ resizable: false })));
  assert.deepEqual([x.getState().formFactor, x.getState().settings.resizable], ['tablet', false]);
  await quit(r);

  r = await launch(store, { extra: ANON });
  const again = anonymous(r);
  assert.deepEqual([again.getState().formFactor, again.getState().settings.resizable, again.getSettings().source.resizable], ['tablet', false, 'instance'], 'permissions gate gestures, not restoring');
  assert.equal(r.turn(() => again.setFormFactor('phone', 'person')).ok, false);
  assert.deepEqual([r.entry('b').formFactor, r.state('b').settings.resizable], ['tablet', true], 'the declared panel keeps the person\'s tier from the file and the declaration\'s own permission');
});

test('formFactors narrowed to exclude the person\'s saved tier drops the override with a note, in the session and again at the next launch', async () => {
  const store = memoryWorkspaceStorage();
  let r = await launch(store, { extra: ANON });
  const x = r.turn(() => r.ws.addPanel('m'));
  await r.settle();
  r.turn(() => x.setFormFactor('tablet', 'person'));
  assert.deepEqual({ ...r.turn(() => x.configure({ formFactors: ['phone'] })) }, { ok: false, code: 'tier-not-allowed', message: `panel '${x.id}': the panel is at the tablet tier, which these settings no longer allow` }, 'control: the live tier cannot be excluded');
  r.turn(() => x.setFormFactor('phone'));
  const narrowed = ok(r.turn(() => x.configure({ formFactors: ['phone'] })));
  assert.deepEqual([...narrowed.notes], [{ code: 'override-dropped', key: 'slots', message: "user.slots: 2 is outside this panel's formFactors; dropped" }]);
  assert.equal(x.getState().formFactor, 'phone');
  await quit(r);
  assert.equal(JSON.stringify((await file(store)).panels.find((p) => p.view === 'm')!.overrides), '{"slots":2}', 'the file still holds what the person chose: configure never edits it');

  r = await launch(store, { extra: ANON });
  assert.equal(anonymous(r).getState().formFactor, 'phone');
  assert.deepEqual(r.m.notes.filter((n) => n.code === 'override-dropped').map((n) => [n.key, n.message]), [['slots', "user.slots: 2 is outside this panel's formFactors; dropped"]]);
});

test('persist saved to session: the live panel is untouched, rememberLayout true beside it is a settings-conflict, and a panel anchored to it is saved against the row without it', async () => {
  const store = memoryWorkspaceStorage();
  const settings = { c: { placeOnAdd: { after: 'b' } } } as Record<string, PanelSettings>;
  let r = await launch(store, { settings });
  assert.equal(r.order().join(' '), 'root a b c');
  assert.deepEqual(r.entry('c').anchor, { panel: r.entry('b').id, position: 'right', priority: 0 }, 'control: c hangs on b');
  const conflict = r.turn(() => r.h.b!.configure({ persist: 'session', rememberLayout: true }));
  assert.deepEqual({ ...conflict }, { ok: false, code: 'settings-conflict', message: "panel 'b': rememberLayout: the instance layer asked true, but C3 makes it false because of persist", setting: 'rememberLayout' });
  const anchor = r.entry('b').anchor;
  assert.deepEqual({ ...ok(r.turn(() => r.h.b!.configure({ persist: 'session' }))) }, { ok: true, changed: true, shown: false, now: [], later: ['persist'], shadowed: [], notes: [] });
  assert.deepEqual([r.entry('b').anchor === anchor, r.order().join(' '), r.live().join(' ')], [true, 'root a b c', 'root a b c'], 'the live panel did not move');
  r.turn(() => r.h.a!.move(1, 'person'));
  await quit(r);
  const saved = await file(store);
  assert.deepEqual(saved.panels.map((p) => p.key), ['a', 'c'], 'the session panel is not in the file');
  assert.deepEqual(saved.panels.map((p) => p.anchor), [right(1), right(2)], 'and c is anchored to the root by the row without b');
  r = await launch(store, { settings });
  assert.equal(r.order().join(' '), 'root a c b', 'launch 2: b is declared again, and nothing of the session came back from the file');
});

test('configure on an anonymous instance restores configured; the same patch on a declared panel does not, the declaration wins', async () => {
  const store = memoryWorkspaceStorage();
  const settings = { b: { title: 'Declared title' } };
  const patch = { title: 'Configured', listed: false, tuning: { slide: { durationSec: 0.3 } } };
  let r = await launch(store, { extra: ANON, settings });
  const x = r.turn(() => r.ws.addPanel('m'));
  await r.settle();
  assert.deepEqual({ ...ok(r.turn(() => x.configure(patch))) }, { ok: true, changed: true, shown: false, now: ['title', 'listed'], later: ['tuning.slide'], shadowed: [], notes: [] });
  ok(r.turn(() => r.h.b!.configure(patch)));
  assert.deepEqual([r.state('b').title, r.state('b').listed], ['Configured', false]);
  await quit(r);
  const saved = Object.fromEntries((await file(store)).panels.map((p) => [p.view, p]));
  assert.deepEqual([Object.keys(saved.b!).includes('instance'), Object.keys(saved.m!).includes('instance')], [false, true], 'the file holds an instance layer for the anonymous instance and none for the declared panel');

  r = await launch(store, { extra: ANON, settings });
  const back = anonymous(r).getState();
  assert.deepEqual([back.title, back.listed, back.settings.tuning.slide.durationSec], ['Configured', false, 0.3], 'the anonymous instance');
  assert.deepEqual([r.state('b').title, r.state('b').listed, r.state('b').settings.tuning.slide.durationSec], ['Declared title', true, 0.4], 'the declared panel');
});

test('configureTemplate and configureTuning are session only: nothing of them is in the file, and the next launch starts from the declarations', async () => {
  const store = memoryWorkspaceStorage();
  let r = await launch(store, { extra: ANON });
  ok(r.turn(() => r.ws.panels.configureTemplate('m', { maxInstances: 2 })));
  ok(r.turn(() => r.ws.panels.configureTuning({ hopFraction: 0.3, rowGap: 24, saveQuietMs: 7 })));
  r.turn(() => r.h.a!.move(1, 'person'));
  await quit(r);
  const text = JSON.stringify(await file(store));
  for (const trace of ['maxInstances', 'hopFraction', 'rowGap', 'saveQuietMs', 'tuning']) assert.equal(text.includes(trace), false, `the file has no ${trace}`);
  assert.equal(JSON.parse(text).panels.length > 0, true, 'control: the file was written');
  r = await launch(store, { extra: ANON });
  assert.deepEqual([r.ws.tuning.hopFraction, r.ws.tuning.rowGap, r.h.a!.getSettings().value.tuning.hopFraction], [0.5, 16, 0.5]);
  assert.equal(r.ws.panels.get('a')!.getSettings().value.maxInstances, 'unlimited');
});

test('the file\'s overrides are unchanged by any configure, whatever its class and whatever it does to the live panel', async () => {
  const store = memoryWorkspaceStorage();
  const settings = { b: { pinning: { pinned: { parkable: false }, unpinned: { parkable: true } } satisfies Pinning } };
  let r = await launch(store, { settings });
  r.turn(() => r.h.c!.move(-1, 'person'));
  r.turn(() => r.h.a!.setFormFactor('tablet', 'person'));
  r.turn(() => r.h.b!.pin('person'));
  await wait();
  const before = await overridesOf(store);
  assert.deepEqual(before, { a: { anchor: right(0), slots: 2 }, c: { anchor: right(1) }, b: { anchor: right(2), parkable: false } }, 'control: the person left an override on each panel');
  const patches: [string, Record<string, unknown>][] = [
    ['a', { closable: false, title: 'A' }],
    ['a', { formFactor: 'phone', formFactors: ['phone', 'tablet'] }],
    ['c', { scrollOnOpen: 'center', placeOnAdd: 'row-start', listed: false }],
    ['b', { parkable: true }],
    ['b', { pinning: { pinned: { parkable: false }, unpinned: { parkable: true } }, keepMounted: false }],
    ['c', { tuning: { slide: { durationSec: 0.2 } }, headerButtons: { x: false } }],
    ['a', { rememberLayout: false }],
    ['a', { rememberLayout: null }],
  ];
  for (const [id, patch] of patches) ok(r.turn(() => r.h[id]!.configure(patch as never)));
  await quit(r);
  assert.deepEqual(await overridesOf(store), before);
  r = await launch(store, { settings });
  assert.deepEqual([r.order().join(' '), r.entry('a').formFactor, r.facts('b').parkable], ['root a c b', 'tablet', false], 'and the next launch applies them all');
});

test('a configure of formFactor or parkable while the person\'s override is restored reports it shadowed', async () => {
  const store = memoryWorkspaceStorage();
  const settings = { b: { pinning: { pinned: { parkable: false }, unpinned: { parkable: true } } satisfies Pinning } };
  let r = await launch(store, { settings });
  r.turn(() => r.h.c!.setFormFactor('tablet', 'person'));
  r.turn(() => r.h.b!.pin('person'));
  await quit(r);
  r = await launch(store, { settings });
  assert.deepEqual([r.entry('c').formFactor, r.facts('b').parkable], ['tablet', false], 'control: both overrides came back');
  const tier = ok(r.turn(() => r.h.c!.configure({ formFactor: 'phone' })));
  assert.deepEqual([[...tier.now], [...tier.later], [...tier.shadowed]], [[], ['formFactor'], ['formFactor']]);
  const fixed = ok(r.turn(() => r.h.b!.configure({ parkable: true })));
  assert.deepEqual([[...fixed.now], [...fixed.later], [...fixed.shadowed]], [['parkable'], [], ['parkable']]);
  assert.deepEqual([r.entry('c').formFactor, r.facts('b').parkable, r.h.c!.getSettings().source.formFactor, r.h.b!.getSettings().source.parkable], ['tablet', false, 'user', 'user']);
});

test('a deferred pin is never in the file, and a configure of pinning keeps it out too', async () => {
  const store = memoryWorkspaceStorage();
  const ids = ['a', 'b', 'c'];
  const pinning: Pinning = { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } };
  const r = await launch(store, { ids, settings: Object.fromEntries(ids.map((id) => [id, { pinning, pinningWhenNotLive: 'apply-on-next-show' } as PanelSettings])) });
  r.turn(() => r.h.b!.hide());
  r.turn(() => r.h.b!.pin('person'));
  assert.deepEqual(r.state('b').deferredPin, { by: 'pin' });
  ok(r.turn(() => r.h.b!.configure({ pinning: { pinned: { placement: 'row-start' }, unpinned: { placement: 'after-fixed' } } })));
  assert.deepEqual(r.state('b').deferredPin, { by: 'pin' }, 'control: it is still waiting');
  r.turn(() => r.h.c!.move(-1, 'person'));
  await quit(r);
  const text = JSON.stringify(await file(store));
  assert.equal(text.includes('deferredPin'), false);
  assert.equal(text.includes('"by"'), false);
  assert.equal(JSON.parse(text).panels.length > 0, true, 'control: the file was written');
});

test('a Host-bag ask comes back through null in the session, the file keeps it merged in the instance layer and the person\'s overrides alone, and the next launch reads it as the instance layer\'s own', async () => {
  const store = memoryWorkspaceStorage();
  const extra = [markerTemplate('m', { settings: { multiple: true, title: 'Template title' } })];
  let r = await launch(store, { extra });
  act(() => void r.provided().create({ view: 'm', title: 'Host title' }));
  await r.settle();
  let x = anonymous(r);
  const read = (): [unknown, string | undefined] => [x.getSettings().value.title, x.getSettings().source.title];
  r.turn(() => x.setFormFactor('tablet', 'person'));
  await wait();
  const savedPanel = async () => (await file(store)).panels.find((p) => p.view === 'm')!;
  const before = JSON.stringify((await savedPanel()).overrides);
  assert.equal((await savedPanel()).overrides!.slots, 2, 'control: the person left an override');
  ok(r.turn(() => x.configure({ title: 'Configured' })));
  await wait();
  assert.deepEqual([read(), (await savedPanel()).instance], [['Configured', 'instance'], { title: 'Configured' }]);
  ok(r.turn(() => x.configure({ title: null })));
  await wait();
  assert.deepEqual([read(), (await savedPanel()).instance], [['Host title', 'host'], { title: 'Host title' }], 'the file still holds the ask');
  assert.equal(JSON.stringify((await savedPanel()).overrides), before, 'and the person\'s overrides are as they were');
  await quit(r);

  r = await launch(store, { extra });
  x = anonymous(r);
  assert.deepEqual(read(), ['Host title', 'instance'], 'a new launch has only the merged layer');
  ok(r.turn(() => x.configure({ title: 'Again' })));
  ok(r.turn(() => x.configure({ title: null })));
  assert.deepEqual(read(), ['Template title', 'template'], 'so null falls through to the template');
});

test('a panel resized to three slots is saved with its count and comes back that wide, its override and its tier following', async () => {
  const store = memoryWorkspaceStorage();
  let r = await launch(store);
  assert.equal(brief(r.turn(() => r.h.b!.setSlots(3, 'person'))), 'T');
  assert.deepEqual([r.entry('b').slots, r.entry('b').formFactor], [3, 'desktop']);
  await quit(r);
  const saved = (await file(store)).panels.find((p) => p.key === 'b')!;
  assert.deepEqual([saved.slots, saved.overrides?.slots], [3, 3], 'a count that is not its tier\'s own is written on the panel and as the override');

  r = await launch(store);
  assert.deepEqual([r.entry('b').slots, r.entry('b').formFactor], [3, 'desktop'], 'launch 2 restores the count');
  const tablet = await (async () => {
    r.turn(() => r.h.b!.setSlots(2, 'person'));
    await quit(r);
    return (await file(store)).panels.find((p) => p.key === 'b')!;
  })();
  assert.equal(tablet.slots, undefined, 'a count that is its tier\'s own is not written on the panel');
  assert.equal(tablet.overrides?.slots, 2);
});

test('a code resize is not an override: the file holds the count on the panel and no override', async () => {
  const store = memoryWorkspaceStorage();
  const r = await launch(store);
  assert.equal(brief(r.turn(() => r.h.b!.setSlots(3))), 'T');
  await quit(r);
  const saved = (await file(store)).panels.find((p) => p.key === 'b')!;
  assert.deepEqual([saved.slots, saved.overrides], [3, {}]);
});
