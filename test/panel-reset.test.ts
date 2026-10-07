/**
 * resetLayout on the manager: one panel or all, what it clears and re-places, what each status answers, what the file
 * holds afterwards and that it is busy while any panel is in flight.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import type { PanelSettings, Pinning } from '../index.js';
import { createWorkspace } from '../index.js';
import { memoryWorkspaceStorage } from '../fakeHost.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { brief } from './support/ops-rig.js';
import { pinRig, type PinRig } from './support/pin-rig.js';
import { markerTemplate } from './support/workspace-row.js';

afterEach(() => cleanup());

const quiet = { tuning: { saveQuietMs: 5 } };
const wait = (): Promise<void> => act(async () => void (await new Promise((done) => setTimeout(done, 80))));
const reset = (r: PinRig, target: string) => r.turn(() => r.ws.panels.resetLayout(target));
const FIX: Pinning = { pinned: { placement: 'row-start', parkable: false }, unpinned: { placement: 'row-end', parkable: true } };
const park: PanelSettings = { overflow: 'park' };

// ---------------------------------------------------------------------------
// Literal rows
// ---------------------------------------------------------------------------

test('(a) declared A B C with placeOnAdd row-end, dragged to [C A B]: resetLayout(all) gives [A B C] and every override is empty', async () => {
  const r = await pinRig();
  r.turn(() => r.h.c!.move('left', 'person'));
  r.turn(() => r.h.c!.move('left', 'person'));
  assert.equal(r.order().join(' '), 'root c a b');
  const result = reset(r, 'all');
  assert.deepEqual(result, { ok: true, changed: true, panels: ['a', 'b', 'c'], parked: [], returned: [] });
  assert.equal(r.order().join(' '), 'root a b c');
  assert.deepEqual(['a', 'b', 'c'].map((id) => r.entry(id).overrides), [{}, {}, {}]);
});

test('(b) one id re-places only that panel and clears only its overrides', async () => {
  const r = await pinRig();
  r.turn(() => r.h.c!.move('left', 'person'));
  r.turn(() => r.h.a!.move('right', 'person'));
  const others = ['a', 'b'].map((id) => JSON.stringify(r.entry(id).overrides));
  const result = reset(r, 'c');
  assert.deepEqual([result.ok, result.ok && result.changed, result.ok ? (result as { panels?: string[] }).panels : undefined], [true, true, ['c']]);
  assert.equal(r.order().at(-1), 'c', 'c is back at the far right');
  assert.deepEqual(r.entry('c').overrides, {});
  assert.deepEqual(['a', 'b'].map((id) => JSON.stringify(r.entry(id).overrides)), others, 'the others keep what the person set');
});

test('(c) a tablet panel the person resized returns to its default tier', async () => {
  const r = await pinRig({ width: 4000 });
  r.turn(() => r.h.b!.setFormFactor('tablet', 'person'));
  assert.equal(r.entry('b').formFactor, 'tablet');
  reset(r, 'b');
  assert.equal(r.entry('b').formFactor, 'phone');
  assert.deepEqual(r.entry('b').overrides, {});
});

test('(c) a tier that no longer fits parks the fewest park panels and the result lists them', async () => {
  const ids = ['a', 'b', 'c', 'd'];
  const r = await pinRig({ ids, width: 1300, settings: Object.fromEntries(ids.map((id) => [id, { ...park, formFactor: id === 'c' ? 'tablet' : 'phone' } as PanelSettings])) });
  await r.settle();
  r.turn(() => r.h.c!.show());
  await r.settle();
  r.turn(() => r.h.c!.setFormFactor('phone', 'person'));
  await r.settle();
  r.turn(() => r.h.b!.show());
  await r.settle();
  assert.deepEqual(r.live(), ['root', 'b', 'c']);
  assert.deepEqual(reset(r, 'c'), { ok: true, changed: true, panels: ['c'], parked: ['b'], returned: [] });
  await r.settle();
  assert.deepEqual(r.live(), ['root', 'c']);
  assert.equal(r.entry('c').formFactor, 'tablet');
});

test('(c) a freed slot returns a stacked panel and the result lists it', async () => {
  const ids = ['a', 'b', 'c', 'd'];
  const r = await pinRig({ ids, width: 1300, settings: Object.fromEntries(ids.map((id) => [id, park])) });
  await r.settle();
  r.turn(() => r.h.d!.setFormFactor('tablet', 'person'));
  await r.settle();
  assert.deepEqual(r.live(), ['root', 'd']);
  assert.deepEqual(reset(r, 'd'), { ok: true, changed: true, panels: ['d'], parked: [], returned: ['c'] });
  await r.settle();
  assert.deepEqual(r.live(), ['root', 'c', 'd']);
});

test('(c) a scrolling row parks none when a tier grows', async () => {
  const ids = ['a', 'b', 'c', 'd'];
  const r = await pinRig({ ids, width: 1300, settings: Object.fromEntries(ids.map((id) => [id, { overflow: 'scroll', formFactor: id === 'c' ? 'tablet' : 'phone' } as PanelSettings])) });
  await r.settle();
  r.turn(() => r.h.c!.setFormFactor('phone', 'person'));
  const live = r.live();
  const result = reset(r, 'c') as { parked?: string[] };
  await r.settle();
  assert.deepEqual(result.parked, []);
  assert.deepEqual([...r.live()].sort(), [...live].sort());
});

test('(d) a person-pinned fixed column becomes parkable again and its overrides are {} in the file', async () => {
  const store = memoryWorkspaceStorage();
  const r = await pinRig({ settings: { c: { pinning: FIX } }, workspace: { storage: store }, over: quiet });
  r.turn(() => r.h.c!.pin('person'));
  await wait();
  assert.equal(r.facts('c').parkable, false);
  assert.equal(JSON.stringify((await store.load())!.panels).includes('"parkable":false'), true, 'positive control: the pin was saved');
  reset(r, 'c');
  await wait();
  assert.deepEqual(r.facts('c'), { parkable: true, listed: true, placeable: true, draggable: true, clearable: true, pinned: false });
  assert.deepEqual((await store.load())!.panels.at(-1)!.overrides, {}, 'c is last in the row again, with nothing left of its pin');
  assert.equal(r.order().join(' '), 'root a b c');
});

test('(e) parked and hidden panels are re-placed and stay parked or held', async () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const r = await pinRig({ ids, width: 1000, settings: Object.fromEntries(ids.map((id) => [id, park])) });
  await r.settle();
  r.turn(() => r.h.d!.hide());
  r.turn(() => r.h.b!.place('row-end', 'person'));
  r.turn(() => r.h.d!.place('row-start', 'person'));
  assert.equal(r.order().join(' '), 'd root a c e b');
  const before = [r.state('b').status, r.state('d').status, r.state('d').held];
  assert.deepEqual(before, ['parked', 'parked', true]);
  const result = reset(r, 'all') as { ok: boolean; changed?: boolean };
  assert.deepEqual([result.ok, result.changed], [true, true]);
  assert.equal(r.order().join(' '), 'root a b c d e');
  assert.deepEqual([r.state('b').status, r.state('d').status, r.state('d').held], before);
});

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

test('closed declared clears the overrides so open() places by default; an undo-window record is marked reset', async () => {
  const r = await pinRig();
  r.turn(() => r.h.c!.move('left', 'person'));
  r.turn(() => r.h.c!.close());
  await advanceFrames(9000);
  assert.equal(r.state('c').status, 'closed');
  assert.deepEqual(reset(r, 'c'), { ok: true, changed: true, panels: ['c'] });
  r.turn(() => r.h.c!.open());
  await r.settle();
  assert.equal(r.order().join(' '), 'root a b c', 'open() lands by placeOnAdd, not where the person left it');
  assert.deepEqual(r.entry('c').overrides, {});
  r.turn(() => r.h.a!.close());
  const inWindow = reset(r, 'a');
  assert.deepEqual([inWindow.ok, inWindow.ok && inWindow.changed], [true, true]);
  r.turn(() => r.provided().undoClose());
  await r.settle();
  assert.equal(r.order().join(' '), 'root b c a', 'undo lands the reset record by default, at the far right');
});

test('an anonymous open panel resets; the root answers changed:false; an unknown id is refused', async () => {
  const r = await pinRig({ ids: ['a'] });
  act(() => void r.provided().create({ title: 'anon' }));
  const id = r.provided().entries.find((p) => p.title === 'anon')!.id;
  assert.equal(r.ws.panels.resetLayout(id).ok, true);
  assert.deepEqual(reset(r, 'root'), { ok: true, changed: false });
  assert.equal(brief(reset(r, 'nope')), 'unknown-panel');
});

test('before the workspace is attached every call is refused', () => {
  const ws = createWorkspace({ templates: [markerTemplate('x')] });
  ws.addPanel('x');
  assert.equal(brief(ws.panels.resetLayout('all')), 'not-attached');
  assert.equal(brief(ws.panels.resetLayout('x')), 'not-attached');
});

test('a stored deferredPin is cleared by resetLayout, for an open and a closed panel', async () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const r = await pinRig({ ids, width: 1000, settings: Object.fromEntries(ids.map((id) => [id, { ...park, pinning: { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } }, pinningWhenNotLive: 'apply-on-next-show' } as PanelSettings])) });
  await r.settle();
  r.turn(() => r.h.b!.pin());
  r.turn(() => r.h.e!.close());
  await advanceFrames(9000);
  r.turn(() => r.h.e!.pin());
  assert.deepEqual([r.state('b').deferredPin, r.state('e').deferredPin], [{ by: 'pin' }, { by: 'pin' }]);
  const result = reset(r, 'all');
  assert.equal(result.ok, true);
  assert.deepEqual([r.state('b').deferredPin, r.state('e').deferredPin], [null, null]);
  r.turn(() => r.h.e!.open());
  await r.settle();
  assert.equal(r.state('e').pinned, false, 'the cleared deferral does not apply');
});

// ---------------------------------------------------------------------------
// Repeats, the file and busy
// ---------------------------------------------------------------------------

test('a second call is changed:false, and a call that only clears a stored non-empty override is changed:true', async () => {
  const r = await pinRig();
  r.turn(() => r.h.c!.move('left', 'person'));
  r.turn(() => r.h.c!.move('right', 'person'));
  assert.equal(r.order().join(' '), 'root a b c', 'the row is back where it started');
  assert.notDeepEqual(r.entry('c').overrides, {}, 'but the person\'s move is recorded');
  const first = reset(r, 'all');
  assert.deepEqual(first.ok && first.changed, true, 'clearing the stored overrides alone counts');
  const second = reset(r, 'all');
  assert.deepEqual(second.ok && second.changed, false);
});

test('the file holds overrides {} and applied.placeOnAdd for every named entry, and a second launch keeps the reset row', async () => {
  const store = memoryWorkspaceStorage();
  const r = await pinRig({ workspace: { storage: store }, over: quiet });
  r.turn(() => r.h.c!.move('left', 'person'));
  r.turn(() => r.h.c!.move('left', 'person'));
  reset(r, 'all');
  await wait();
  const saved = (await store.load())!.panels;
  assert.deepEqual(saved.map((p) => p.overrides), [{}, {}, {}]);
  assert.ok(saved.every((p) => (p as { applied?: { placeOnAdd?: unknown } }).applied?.placeOnAdd !== undefined), 'applied.placeOnAdd on every entry');
  r.m.unmount();
  cleanup();
  const second = await pinRig({ workspace: { storage: store }, over: quiet });
  await wait();
  assert.equal(second.order().join(' '), 'root a b c');
});

test('busy: resetLayout is refused in a turn where any panel holds a token, and a panel operation after it is busy', async () => {
  const r = await pinRig();
  assert.deepEqual(r.turn(() => [brief(r.h.a!.hide()), brief(reset(r, 'all')), brief(reset(r, 'b'))]), ['T', 'busy', 'busy']);
  const other = await pinRig();
  assert.deepEqual(other.turn(() => [brief(reset(other, 'a')), brief(other.h.a!.hide())]), ['T', 'busy']);
});

test('all is rejected as a template id and as an instance id', () => {
  assert.throws(() => createWorkspace({ templates: [markerTemplate('all')] }), /'all' is reserved/);
  const ws = createWorkspace({ templates: [markerTemplate('x', { settings: { multiple: true } })] });
  assert.throws(() => ws.addPanel('x', { id: 'all' }), /'all' is reserved/);
});

// ---------------------------------------------------------------------------
// Scroll
// ---------------------------------------------------------------------------

test('resetLayout(id) of an in-view panel follows its scrollOnMove and resetLayout(all) scrolls nothing', async () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const make = async (): Promise<PinRig> => {
    const r = await pinRig({ ids, width: 1000, settings: Object.fromEntries(ids.map((id) => [id, { overflow: 'scroll', scrollOnMove: 'follow' } as unknown as PanelSettings])) });
    await r.settle();
    return r;
  };
  const one = await make();
  one.turn(() => one.h.j!.move('left', 'person'));
  await one.settle();
  one.m.container.scrollLeft = 3482;
  reset(one, 'j');
  await one.settle();
  assert.equal(one.order().at(-1), 'j');
  assert.ok(one.m.container.scrollLeft >= 3482, 'j went back to the end and the row followed it');
  cleanup();
  const all = await make();
  all.turn(() => all.h.j!.move('left', 'person'));
  await all.settle();
  all.m.container.scrollLeft = 1200;
  reset(all, 'all');
  await all.settle();
  assert.equal(all.m.container.scrollLeft, 1200);
});
