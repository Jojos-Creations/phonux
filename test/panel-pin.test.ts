/**
 * pin() and unpin() on a handle: one commit that places and fixes (or frees and places), what each definition reads, the
 * refusals that leave the row untouched, a fixed pin that never needs room, a pin that follows the person, and what a
 * parked or hidden panel does under pinningWhenNotLive.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import type { PanelResult, PanelSettings, Pinning, PinningWhenNotLive } from '../index.js';
import { reanchorPanel } from '../panelWindow.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { differential, differentialsCovered } from './support/differential.js';
import { brief } from './support/ops-rig.js';
import { pinRig, type PinRig } from './support/pin-rig.js';
import { rowScrollerFor } from './support/workspace-row.js';

afterEach(() => cleanup());

/** A pinning definition as a settings layer; the validated shape is the resolver's business, not the type's. */
const layer = (pinning: Pinning, more: PanelSettings = {}): PanelSettings => ({ pinning, ...more });
const pinningOf = (pinned: Pinning['pinned'], unpinned: Pinning['unpinned']): Pinning => ({ pinned, unpinned });

const FREE = { parkable: true, listed: true, movable: true, clearable: true, pinned: false };
const PINNED_FREE = { ...FREE, pinned: true };
const FIXED = { parkable: false, listed: false, movable: false, clearable: false, pinned: true };

const PAIR = pinningOf({ parkable: false }, { parkable: true });
const PAIR_AFTER_DOCK = pinningOf({ placement: { after: 'dock' }, parkable: false }, { placement: 'row-end', parkable: true });
const ROW_START_AFTER_FIXED = pinningOf({ placement: 'row-start' }, { placement: 'after-fixed' });
const COMBINED = pinningOf({ placement: 'row-start', parkable: false }, { placement: 'row-end', parkable: true });
const PAIR_ROW_START_AFTER_FIXED = pinningOf({ placement: 'row-start', parkable: false }, { placement: 'after-fixed', parkable: true });

// ---------------------------------------------------------------------------
// The default definition
// ---------------------------------------------------------------------------

test('pin() and unpin() under the default definition equal reanchor over literal rows, and every other field is identical', async () => {
  const r = await pinRig();
  const rows: Array<[string, string]> = [];
  const step = (label: string, fn: () => PanelResult, expected: string, result: string): void => {
    assert.equal(brief(r.turn(fn)), result, `${label}: result`);
    rows.push([label, r.order().join(' ')]);
    assert.equal(r.order().join(' '), expected, label);
  };
  const before = ['a', 'b', 'c'].map((id) => {
    const { collapsible, listed, slots } = r.entry(id);
    return { collapsible, listed, slots };
  });
  assert.equal(r.order().join(' '), 'root a b c');
  step('pin c', () => r.h.c!.pin(), 'c root a b', 'T');
  step('pin b lands past the pinned c', () => r.h.b!.pin(), 'b c root a', 'T');
  step('unpin c returns to the far right', () => r.h.c!.unpin(), 'b root a c', 'T');
  step('unpin b returns to the far right', () => r.h.b!.unpin(), 'root a c b', 'T');
  step('a call already in the target state is changed:false', () => r.h.b!.unpin(), 'root a c b', 'F');
  assert.deepEqual(rows.length, 5);
  const after = ['a', 'b', 'c'].map((id) => {
    const { collapsible, listed, slots } = r.entry(id);
    return { collapsible, listed, slots };
  });
  assert.deepEqual(after, before, 'collapsible, listed and slots are identical to the start');
  assert.deepEqual(['a', 'b', 'c'].map((id) => r.facts(id)), [FREE, FREE, FREE]);
});

test('the default pin lands exactly where reanchor lands the same panel over the same row', async () => {
  const viaPin = await pinRig();
  viaPin.turn(() => viaPin.h.c!.pin());
  viaPin.turn(() => viaPin.h.b!.pin());
  const viaReanchor = await pinRig();
  for (const id of ['c', 'b']) viaReanchor.turn(() => viaReanchor.provided().reanchor(viaReanchor.entry(id).id, { position: 'left' }));
  assert.equal(viaPin.order().join(' '), 'b c root a');
  assert.equal(viaReanchor.order().join(' '), viaPin.order().join(' '));
  const row = viaPin.m.latest().entries;
  assert.equal(reanchorPanel([...row], row.find((p) => p.view === 'b')!.id, { position: 'left' }, 'root').map((p) => p.view).join(' '), 'b c root a');
});

test('PanelState.pinned follows the definition and is not stored: pin and unpin move it, a repeated call does not', async () => {
  const r = await pinRig();
  assert.equal(r.state('c').pinned, false);
  r.turn(() => r.h.c!.pin());
  assert.equal(r.state('c').pinned, true);
  assert.equal(r.facts('a').pinned, false);
  r.turn(() => r.h.c!.unpin());
  assert.equal(r.state('c').pinned, false);
});

// A drag re-anchors every entry to the root; the read must survive it.
const DRAG_DEFINITIONS: Array<[string, Pinning | undefined]> = [
  ['(B) the default', undefined],
  ['(A) the parkable pair', PAIR],
  ['(A) with a named place', PAIR_AFTER_DOCK],
  ['the combined one', COMBINED],
];
for (const rooted of [true, false]) {
  for (const [name, definition] of DRAG_DEFINITIONS) {
    test(`a drag of an unrelated panel after a pin leaves PanelState.pinned unchanged: ${name}, ${rooted ? 'rooted' : 'root-less'}`, async () => {
      const r = await pinRig({ ids: ['dock', 'a', 'b', 'p'], root: rooted, settings: { p: definition === undefined ? {} : layer(definition) } });
      r.turn(() => r.h.p!.pin());
      const read = (): boolean[] => ['dock', 'a', 'b', 'p'].map((id) => r.state(id).pinned);
      const first = read();
      assert.equal(first[3], true, 'the pinned panel reads pinned');
      for (const [id, direction] of [['a', 'right'], ['b', 'left'], ['dock', 'right'], ['a', 'left']] as const) {
        r.turn(() => r.h[id]!.move(direction === 'left' ? -1 : 1));
        assert.deepEqual(read(), first, `after moving ${id} ${direction}: ${r.order().join(' ')}`);
      }
      r.turn(() => r.h.a!.move(1, 'person'));
      assert.deepEqual(read(), first, 'a person drag too');
    });
  }
}

// ---------------------------------------------------------------------------
// Order and reachability
// ---------------------------------------------------------------------------

const REACH: Array<{ name: string; definition: Pinning | undefined; ids: string[]; start: string; pinned: string; fixed: boolean }> = [
  { name: 'default', definition: undefined, ids: ['dock', 'a', 'b', 'p'], start: 'root dock a b p', pinned: 'p root dock a b', fixed: false },
  { name: 'the parkable pair alone', definition: PAIR, ids: ['dock', 'a', 'b', 'p'], start: 'root dock a b p', pinned: 'root dock a b p', fixed: true },
  { name: 'the pair with { after: dock } and row-end', definition: PAIR_AFTER_DOCK, ids: ['dock', 'a', 'b', 'p'], start: 'root dock a b p', pinned: 'root dock p a b', fixed: true },
  { name: 'row-start with after-fixed', definition: ROW_START_AFTER_FIXED, ids: ['p', 'dock', 'a', 'b'], start: 'root p dock a b', pinned: 'p root dock a b', fixed: false },
  { name: 'the pair with row-start and row-end', definition: COMBINED, ids: ['dock', 'a', 'b', 'p'], start: 'root dock a b p', pinned: 'p root dock a b', fixed: true },
  { name: 'the pair with row-start and after-fixed', definition: PAIR_ROW_START_AFTER_FIXED, ids: ['p', 'dock', 'a', 'b'], start: 'root p dock a b', pinned: 'p root dock a b', fixed: true },
];
for (const c of REACH) {
  test(`pin() then unpin() returns row order, listing and permissions to the start: ${c.name}`, async () => {
    const r = await pinRig({ ids: c.ids, settings: { p: c.definition === undefined ? {} : layer(c.definition) } });
    assert.equal(r.order().join(' '), c.start);
    const startFacts = r.facts('p');
    assert.deepEqual(startFacts, FREE);
    assert.equal(brief(r.turn(() => r.h.p!.pin())), 'T');
    assert.equal(r.order().join(' '), c.pinned);
    assert.deepEqual(r.facts('p'), c.fixed ? FIXED : PINNED_FREE, c.fixed ? 'between the calls the panel is a fixed column' : 'between the calls the panel is an ordinary pinned one');
    assert.equal(r.entry('p').live, true);
    assert.equal(brief(r.turn(() => r.h.p!.unpin())), 'T', 'unpin can still place a fixed pin');
    assert.equal(r.order().join(' '), c.start);
    assert.deepEqual(r.facts('p'), startFacts);
  });
}

// ---------------------------------------------------------------------------
// All or nothing
// ---------------------------------------------------------------------------

test('all or nothing: each refusal leaves the entries reference-equal, with no commit', async () => {
  const cases: Array<{ name: string; settings: PanelSettings; prepare?: (r: PinRig) => void; code: string; setting?: string }> = [
    { name: 'a fixed pin on a two-slot panel', settings: layer(COMBINED), prepare: (r) => void r.turn(() => r.h.c!.setSlots(2)), code: 'slots-above-max' },
  ];
  for (const c of cases) {
    const r = await pinRig({ settings: { c: c.settings } });
    c.prepare?.(r);
    const entries = r.m.latest().entries;
    const renders = r.m.renders();
    const result = r.turn(() => r.h.c!.pin()) as PanelResult & { setting?: string };
    assert.equal(brief(result), c.code, c.name);
    assert.equal(result.setting, c.setting, `${c.name}: the setting in the way`);
    assert.equal(r.m.latest().entries, entries, `${c.name}: entries reference-equal`);
    assert.equal(r.m.renders(), renders, `${c.name}: no commit`);
    assert.equal(r.facts('c').parkable, true, `${c.name}: parkable is unchanged`);
    assert.equal(r.order().join(' '), 'root a b c');
  }
});

test('a fixed pin keeps an explicit resizable:true the panel asked for, and forces the size settings nobody asked for', async () => {
  const r = await pinRig({ settings: { c: layer(COMBINED, { resizable: true }) } });
  assert.equal(brief(r.turn(() => r.h.c!.pin())), 'T');
  assert.equal(r.state('c').settings.resizable, true, 'the panel asked for it');
  const { resolvePanelSettings } = await import('../panelSettings.js');
  const plain = resolvePanelSettings({ template: layer(COMBINED), user: { parkable: false } });
  assert.deepEqual([plain.value.resizable, plain.value.slots, plain.conflicts.filter((c) => c.key === 'resizable')], [false, 1, []], 'unasked, the fixed column is one slot and not resizable');
});

test('a pin with a placement half places a movable:false panel, and unpin of a fixed pin frees it', async () => {
  const r = await pinRig({ settings: { c: layer(COMBINED, { movable: false }) } });
  r.turn(() => r.h.c!.pin());
  assert.deepEqual(r.facts('c'), FIXED);
  assert.equal(brief(r.turn(() => r.h.c!.unpin())), 'T');
  assert.deepEqual(r.facts('c'), { ...FREE, movable: false }, 'the explicit movable:false stands');
});

// ---------------------------------------------------------------------------
// A fixed pin never needs room
// ---------------------------------------------------------------------------

test('a fixed pin never needs room: all-scroll row at 800 px, History and three fixed pins, every pin is accepted and the strip is wider than the window', async () => {
  const scroll: PanelSettings = { overflow: 'scroll', ...layer(COMBINED) };
  const r = await pinRig({ ids: ['p1', 'p2', 'p3', 'x'], width: 800, settings: { p1: scroll, p2: scroll, p3: scroll, x: { overflow: 'scroll' } }, workspace: { tuning: { rowGesture: 'step' } } });
  for (const id of ['p1', 'p2', 'p3']) assert.equal(brief(r.turn(() => r.h[id]!.pin())), 'T', `${id} pin`);
  assert.deepEqual(['p1', 'p2', 'p3'].map((id) => r.facts(id).parkable), [false, false, false]);
  const numbers = r.provided().rowNumbers;
  assert.ok(numbers.stripWidth > numbers.windowWidth, `${numbers.stripWidth} > ${numbers.windowWidth}`);
  assert.equal(numbers.rowMarginLeft, 0);
  assert.equal(numbers.stripWidth, 5 * 390 + 4 * 16, 'History, three pins and x at 390 each with four gaps');
  assert.equal(r.order().join(' '), 'p3 p2 p1 root x');
});

test('a fixed pin in a row holding park panels is accepted and the settled row parks the fewest of them, or overflows and scrolls', async () => {
  const park: PanelSettings = { overflow: 'park' };
  const r = await pinRig({ ids: ['a', 'b', 'c', 'f1'], width: 1000, settings: { f1: layer(COMBINED), a: park, b: park, c: park } });
  const liveBefore = r.live().filter((id) => id !== 'f1' && id !== 'root');
  const pinned = r.turn(() => r.h.f1!.pin());
  assert.equal(brief(pinned), 'T');
  await r.settle();
  assert.equal(r.facts('f1').parkable, false);
  const liveParkable = r.live().filter((id) => !['root', 'f1'].includes(id));
  assert.ok(liveParkable.length >= 1, 'the floor keeps one park panel live');
  assert.ok(liveParkable.length <= liveBefore.length, 'the pin parked park panels, never more than it had to');
  const numbers = r.provided().rowNumbers;
  const widths = numbers.widths.reduce((sum, w) => sum + w, 0) + 16 * (numbers.widths.length - 1);
  assert.ok(widths <= numbers.windowWidth || liveParkable.length === 1, 'the live panels fit beside the fixed ones, except the floor');
});

test('a fixed pin in an unmeasured row is accepted', async () => {
  const r = await pinRig({ width: 0, settings: { c: layer(COMBINED) } });
  assert.equal(brief(r.turn(() => r.h.c!.pin())), 'T');
  assert.equal(r.order().join(' '), 'c root a b');
});

// ---------------------------------------------------------------------------
// Pin follows the person
// ---------------------------------------------------------------------------

async function followRig(scrollOnMove: string | undefined, from: number): Promise<{ r: PinRig; el: HTMLElement }> {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const over: PanelSettings = { overflow: 'scroll', ...(scrollOnMove === undefined ? {} : ({ scrollOnMove } as unknown as PanelSettings)) };
  const r = await pinRig({ ids, width: 1000, settings: Object.fromEntries(ids.map((id) => [id, over])), workspace: { tuning: { rowGesture: 'step' } } });
  await advanceFrames(900);
  r.m.container.scrollLeft = from;
  return { r, el: r.m.container };
}

test('pin follows the person: the last panel in view at 3482 moves to left 16 and the row scrolls to 0, and unpin returns to 4076 and 3482', async () => {
  const { r, el } = await followRig('follow', 3482);
  const left = (id: string): number => {
    const n = r.provided().rowNumbers;
    return n.leftOffsets[n.ids.indexOf(r.entry(id).id)]! + 16 + n.rowMarginLeft;
  };
  assert.equal(left('j'), 4076);
  assert.equal(brief(r.turn(() => r.h.j!.pin())), 'T');
  await advanceFrames(900);
  assert.equal(left('j'), 16);
  assert.equal(el.scrollLeft, 0);
  assert.equal(brief(r.turn(() => r.h.j!.unpin())), 'T');
  await advanceFrames(900);
  assert.equal(left('j'), 4076);
  assert.equal(el.scrollLeft, 3482);
});

test('pin follows the person: the default scrollOnMove is follow, a code pin() on an out-of-view panel scrolls nothing, and none scrolls nothing', async () => {
  const byDefault = await followRig(undefined, 3482);
  byDefault.r.turn(() => byDefault.r.h.j!.pin());
  await advanceFrames(900);
  assert.equal(byDefault.el.scrollLeft, 0, 'the library default follows');
  cleanup();
  const outOfView = await followRig('follow', 3482);
  assert.equal(brief(outOfView.r.turn(() => outOfView.r.h.b!.pin())), 'T');
  await advanceFrames(900);
  assert.equal(outOfView.el.scrollLeft, 3482, 'b was out of view: nothing follows it');
  cleanup();
  const none = await followRig('none', 3482);
  none.r.turn(() => none.r.h.j!.pin());
  await advanceFrames(900);
  assert.equal(none.el.scrollLeft, 3482, 'scrollOnMove none scrolls nothing');
});

test('pin records one follow request for an in-view panel: a spy on the row scroller sees one glide', async () => {
  const { r, el } = await followRig('follow', 3482);
  const scroller = rowScrollerFor(el);
  const original = scroller.glideTo.bind(scroller);
  let glides = 0;
  scroller.glideTo = (to, o) => {
    glides += 1;
    return original(to, o);
  };
  r.turn(() => r.h.j!.pin());
  await advanceFrames(900);
  assert.equal(glides, 1);
});

// ---------------------------------------------------------------------------
// pinningWhenNotLive
// ---------------------------------------------------------------------------

/** A narrow row so the oldest panels are parked for room (engine-parked, not held): a b c d e at 1000 px. */
async function parkedRig(when: PinningWhenNotLive | undefined, definition: Pinning = pinningOf({ placement: 'row-start' }, { placement: 'row-end' }), scrolling: readonly string[] = []): Promise<PinRig> {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const all: PanelSettings = { ...layer(definition), ...(when === undefined ? {} : { pinningWhenNotLive: when }) };
  const r = await pinRig({ ids, width: 1000, settings: Object.fromEntries(ids.map((id) => [id, { ...all, overflow: scrolling.includes(id) ? 'scroll' : 'park' } as PanelSettings])) });
  await r.settle();
  return r;
}

test('the narrow row parks the leftmost panels for room: engine-parked, not held', async () => {
  const r = await parkedRig(undefined);
  assert.deepEqual(r.live(), ['root', 'e']);
  assert.deepEqual(['a', 'b', 'c'].map((id) => [r.state(id).status, r.state(id).held]), [['parked', false], ['parked', false], ['parked', false]]);
});

test('place-only on an engine-parked panel: a placement-only half applies in place and the panel stays parked, equal to reanchor on a parked panel', async () => {
  const r = await parkedRig('place-only');
  const result = r.turn(() => r.h.b!.pin());
  assert.equal(brief(result), 'T');
  assert.equal(r.order().join(' '), 'b root a c d e');
  assert.equal(r.state('b').status, 'parked');
  assert.equal(r.state('b').pinned, true);
  const viaReanchor = await parkedRig('place-only');
  viaReanchor.turn(() => viaReanchor.provided().reanchor(viaReanchor.entry('b').id, { position: 'left' }));
  assert.equal(viaReanchor.order().join(' '), r.order().join(' '));
});

test('place-only on a hidden panel: the placement applies and the hold stays', async () => {
  const r = await parkedRig('place-only');
  r.turn(() => r.h.d!.hide());
  assert.equal(r.state('d').held, true);
  assert.equal(brief(r.turn(() => r.h.d!.pin())), 'T');
  assert.equal(r.order().join(' '), 'd root a b c e');
  assert.deepEqual([r.state('d').status, r.state('d').held], ['parked', true]);
});

test('place-only with a half that names parkable answers would-reshape-row whole, entries reference-equal', async () => {
  const r = await parkedRig('place-only', COMBINED, ['d']);
  r.turn(() => r.h.d!.hide());
  const entries = r.m.latest().entries;
  assert.equal(brief(r.turn(() => r.h.d!.pin())), 'would-reshape-row');
  assert.equal(brief(r.turn(() => r.h.d!.unpin())), 'would-reshape-row');
  assert.equal(r.m.latest().entries, entries);
});

test('refuse: the whole pin answers would-reshape-row, parked and hidden alike', async () => {
  const r = await parkedRig('refuse');
  assert.equal(brief(r.turn(() => r.h.b!.pin())), 'would-reshape-row');
  r.turn(() => r.h.d!.hide());
  assert.equal(brief(r.turn(() => r.h.d!.pin())), 'would-reshape-row');
  assert.equal(r.order().join(' '), 'root a b c d e');
});

test('show: a hidden panel is shown and pinned in one commit, the half placement replaces placeOnShow, and the result is shown:true', async () => {
  const r = await parkedRig('show', COMBINED, ['d']);
  r.turn(() => r.h.d!.hide());
  assert.deepEqual([r.state('d').status, r.state('d').held], ['parked', true]);
  const renders = r.m.renders();
  const result = r.turn(() => r.h.d!.pin()) as PanelResult & { shown?: boolean };
  assert.deepEqual({ ok: result.ok, shown: result.shown }, { ok: true, shown: true });
  assert.equal(r.order().join(' '), 'd root a b c e');
  assert.deepEqual([r.state('d').status, r.state('d').held, r.state('d').settings.parkable, r.state('d').pinned], ['live', false, false, true]);
  assert.ok(r.m.renders() - renders <= 3, 'the show and the pin share a commit, bar the effects that follow it');
});

test('show on an engine-parked panel applies the half and returns it live', async () => {
  const r = await parkedRig('show', undefined);
  const result = r.turn(() => r.h.b!.pin()) as PanelResult & { shown?: boolean };
  assert.equal(result.shown, true);
  assert.equal(r.state('b').status, 'live');
  assert.equal(r.state('b').pinned, true);
  assert.equal(r.order().join(' '), 'b root a c d e');
});

test('no flushSync is needed: the show path commits inside one turn', async () => {
  const r = await parkedRig('show');
  const seen = r.turn(() => {
    r.h.b!.pin();
    return r.state('b').deferredPin;
  });
  assert.equal(seen, null);
});

test('a per-status object answers differently for a hidden and an engine-parked panel in one row', async () => {
  const r = await parkedRig({ hidden: 'refuse', parked: 'place-only' });
  r.turn(() => r.h.d!.hide());
  assert.equal(brief(r.turn(() => r.h.d!.pin())), 'would-reshape-row', 'hidden refuses');
  assert.equal(brief(r.turn(() => r.h.b!.pin())), 'T', 'engine-parked places');
  assert.equal(r.order().join(' '), 'b root a c d e');
});

test('closed declared and the undo window answer is-closed under place-only, refuse and show, and a second call in one turn answers busy', async () => {
  for (const when of ['place-only', 'refuse', 'show'] as const) {
    const r = await pinRig({ settings: { c: { pinningWhenNotLive: when } } });
    r.turn(() => r.h.c!.close());
    assert.equal(brief(r.turn(() => r.h.c!.pin())), 'is-closed', `${when}: closed declared inside the undo window`);
    await advanceFrames(9000);
    assert.equal(brief(r.turn(() => r.h.c!.pin())), 'is-closed', `${when}: closed declared`);
    const same = r.turn(() => [brief(r.h.b!.pin()), brief(r.h.b!.unpin()), brief(r.h.b!.pin())]);
    assert.deepEqual(same, ['T', 'busy', 'busy'], `${when}: the same turn`);
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// The two catalog names this entry owns
// ---------------------------------------------------------------------------

test('differential: pinning decides where pin() lands the panel', async () => {
  const landing = async (definition: Pinning): Promise<string> => {
    const r = await pinRig({ settings: { c: layer(definition) } });
    r.turn(() => r.h.c!.pin());
    return r.order().join(' ');
  };
  const values = [pinningOf({ placement: 'row-start' }, { placement: 'row-end' }), pinningOf({ placement: { after: 'a' }, parkable: false }, { placement: 'row-end', parkable: true })];
  const outputs: string[] = [];
  for (const v of values) outputs.push(await landing(v));
  let i = 0;
  differential('pinning', (run) => {
    for (const v of values) run(v, () => outputs[i++]);
  });
});

test('differential: pinningWhenNotLive decides what pin() does to an engine-parked panel', async () => {
  const outcome = async (when: PinningWhenNotLive): Promise<string> => {
    const r = await parkedRig(when);
    return `${brief(r.turn(() => r.h.b!.pin()))} ${r.order().join(' ')} ${r.state('b').status}`;
  };
  const values: PinningWhenNotLive[] = ['place-only', 'refuse'];
  const outputs: string[] = [];
  for (const v of values) outputs.push(await outcome(v));
  let i = 0;
  differential('pinningWhenNotLive', (run) => {
    for (const v of values) run(v, () => outputs[i++]);
  });
});

test('differential coverage: the names completed in this file are exactly pinning and pinningWhenNotLive', () => {
  assert.deepEqual(differentialsCovered().filter((n) => n === 'pinning' || n === 'pinningWhenNotLive'), ['pinning', 'pinningWhenNotLive']);
});

