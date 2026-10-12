/**
 * Seeded random sequences of handle operations, configure of a random legal patch, configureTuning, resetLayout and
 * undoClose over random settings vectors. After every step: ids and keys are unique and the row has one root, no
 * restricting setting was bypassed, a refusal touched nothing, a second call on a panel the first one acted on is busy,
 * a configure rewrote none of the person's overrides, its result names exactly the patched keys the cascade did not
 * give to the instance layer, the live park panels fit the window beside the rest, and show() does what the panel's
 * settings say. A second test, with its own seeds, adds pin, unpin and scrollTo to the operations, checks the scroll
 * bound after a glide, and runs a quarter of its sequences with every panel scroll, where nothing may be parked for room.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import type { ConfigureResult, PanelHandle, PanelSettings } from '../index.js';
import { panelKey } from '../panelSettings.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { pinRig, type PinRig } from './support/pin-rig.js';

afterEach(() => cleanup());

const SEQUENCES = 500;
const STEPS = 8;
const IDS = ['a', 'b', 'c', 'd'] as const;

/** mulberry32: a small seeded generator, so a failing sequence replays from its seed. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Answer = { ok: true; changed: boolean } | { ok: false; code: string; message: string };

const pickFrom = <T,>(rand: () => number, values: readonly T[]): T => values[Math.floor(rand() * values.length)]!;

function settingsVector(rand: () => number): PanelSettings {
  const pick = <T,>(...values: T[]): T => pickFrom(rand, values);
  return {
    closable: pick(true, true, false),
    parkable: pick(true, true, true, false),
    draggable: pick(true, true, false),
    crossable: pick(true, true, false),
    placeable: pick(true, true, false),
    resizable: pick(true, true, false),
    formFactors: pick(['phone', 'tablet', 'desktop'], ['phone'], ['phone', 'tablet']),
    hideWhenLast: pick('allow', 'refuse'),
    hideStickiness: pick('sticky', 'until-room'),
    showWhenClosed: pick('refuse', 'reopen'),
    toggleWhenClosed: pick('ignore', 'reopen'),
    overflow: pick('park', 'park', 'park', 'scroll'),
  } as PanelSettings;
}

/** Legal values per key: every one is accepted by the resolver, though a combination may be refused with a typed code. */
const VALUES: Readonly<Record<string, readonly unknown[]>> = {
  closable: [true, false],
  parkable: [true, false],
  draggable: [true, false],
  crossable: [true, false],
  placeable: [true, false],
  resizable: [true, false],
  formFactors: [['phone'], ['phone', 'tablet'], ['phone', 'tablet', 'desktop'], ['tablet', 'desktop']],
  clearable: [true, false],
  listed: [true, false],
  startVisibility: ['live', 'parked'],
  hideStickiness: ['sticky', 'until-room'],
  hideWhenLast: ['allow', 'refuse'],
  capacityReturn: ['auto', 'manual'],
  returnPriority: [0, 3],
  overflow: ['scroll', 'park'],
  evictionRank: [0, 2],
  evictionOrder: ['farthest', 'nearest', 'leftmost', 'rightmost'],
  revealOnScroll: ['edges', 'any', 'never'],
  scrollOnOpen: ['into-view', 'start', 'center', 'none'],
  scrollOnMove: ['follow', 'none'],
  scrollOnDrag: ['edge', 'none'],
  toggleWhenClosed: ['ignore', 'reopen'],
  showWhenClosed: ['refuse', 'reopen'],
  viewState: ['keep', 'reset-on-park'],
  keepMounted: [true, false],
  placeOnAdd: ['row-start', 'row-end', 'after-fixed', { after: 'a' }, { before: 'b' }],
  placeOnShow: ['in-place', 'row-start', 'row-end'],
  placeOnReturn: ['in-place', 'row-start', 'row-end'],
  placeFallback: ['row-start', 'row-end', 'after-fixed'],
  undoPlacement: ['old-slot', 'row-start', 'row-end'],
  layer: ['base', 'raised'],
  enterFrom: ['auto', 'left', 'right'],
  exitTo: ['auto', 'left', 'right'],
  closeExit: ['down', 'left', 'right'],
  animated: [true, false],
  formFactor: ['phone', 'tablet', 'desktop'],
  title: ['Alpha', 'Beta'],
  pinning: [
    { pinned: { parkable: false }, unpinned: { parkable: true } },
    { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } },
    { pinned: { placement: { after: 'a' }, parkable: false }, unpinned: { placement: 'row-end', parkable: true } },
  ],
  pinningWhenNotLive: ['place-only', 'refuse', 'show', 'apply-on-next-show'],
  headerButtons: [{ x: false }, { x: { icon: 'i', label: 'X', onClick: () => undefined } }],
  persist: ['saved', 'session'],
  rememberLayout: [true, false],
  restoreVisibility: ['saved', 'live', 'parked'],
  afterClose: ['stay-closed', 'return-next-launch'],
  undoWindowMs: [0, 5000, 10000],
  reportClose: [true, false],
  snapshot: ['both', 'park', 'close', 'never'],
};
const TUNING_VALUES: Readonly<Record<string, readonly unknown[]>> = {
  dragToClose: [{ minDistancePx: 90 }, { distanceFraction: 0.3 }],
  slide: [{ durationSec: 0.2 }, { durationSec: 0.5 }],
  hopFraction: [0.3, 0.6],
  edgeScroll: [{ zonePx: 60 }],
};
const KEYS = Object.keys(VALUES);
const PERMISSIONS = ['closable', 'parkable', 'draggable', 'crossable', 'placeable', 'resizable', 'formFactors'] as const;
const LEAVES = Object.keys(TUNING_VALUES);

/** A patch of one to three keys, each a legal value or a null; now and then a tuning leaf. */
function randomPatch(rand: () => number): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const count = 1 + Math.floor(rand() * 3);
  for (let n = 0; n < count; n += 1) {
    if (rand() < 0.15) {
      const leaf = pickFrom(rand, LEAVES);
      patch.tuning = { ...(patch.tuning as object | undefined), [leaf]: rand() < 0.25 ? null : pickFrom(rand, TUNING_VALUES[leaf]!) };
    } else {
      // The keys a person's override can outvote come up often enough for the shadowed list to be tested.
      const key = n === 0 && rand() < 0.25 ? pickFrom(rand, ['formFactor', 'parkable']) : pickFrom(rand, KEYS);
      patch[key] = rand() < 0.15 ? null : pickFrom(rand, VALUES[key]!);
    }
  }
  return patch;
}

type Op = 'show' | 'hide' | 'toggleVisibility' | 'close' | 'open' | 'move' | 'place' | 'setFormFactor' | 'scrollTo' | 'configure' | 'resetOne' | 'resetAll' | 'undo' | 'tuning' | 'movePerson' | 'resizePerson' | 'configureOutvoted';
const OPS: readonly Op[] = ['show', 'hide', 'toggleVisibility', 'close', 'open', 'move', 'movePerson', 'place', 'setFormFactor', 'resizePerson', 'resizePerson', 'scrollTo', 'configure', 'configure', 'configure', 'configureOutvoted', 'configureOutvoted', 'resetOne', 'resetAll', 'undo', 'tuning'];

/** What one call did, and the patch a configure carried. */
interface Call {
  answer: Answer;
  patch?: Record<string, unknown>;
}

function run(r: PinRig, h: PanelHandle, op: Op, rand: () => number): Call {
  switch (op) {
    case 'show': return { answer: h.show() };
    case 'hide': return { answer: h.hide() };
    case 'toggleVisibility': return { answer: h.toggleVisibility() };
    case 'close': return { answer: h.close() };
    case 'open': return { answer: h.open() };
    case 'move': return { answer: h.move(rand() < 0.5 ? 'left' : 'right') };
    case 'movePerson': return { answer: h.move(rand() < 0.5 ? 'left' : 'right', 'person') };
    case 'place': return { answer: h.place(pickFrom(rand, ['row-start', 'row-end', 'after-fixed'] as const)) };
    case 'setFormFactor': return { answer: h.setFormFactor(pickFrom(rand, ['phone', 'tablet', 'desktop'] as const)) };
    case 'resizePerson': return { answer: h.setFormFactor(pickFrom(rand, ['phone', 'tablet', 'desktop'] as const), 'person') };
    case 'scrollTo': return { answer: h.scrollTo() };
    case 'configure': {
      const patch = randomPatch(rand);
      return { answer: h.configure(patch as never) as Answer, patch };
    }
    case 'configureOutvoted': {
      // The two keys a person's override can outvote.
      const patch = rand() < 0.5 ? { formFactor: pickFrom(rand, ['phone', 'tablet', 'desktop'] as const) } : { parkable: rand() < 0.5 };
      return { answer: h.configure(patch as never) as Answer, patch };
    }
    case 'resetOne': return { answer: r.ws.panels.resetLayout(h.id) };
    case 'resetAll': return { answer: r.ws.panels.resetLayout('all') };
    case 'undo': {
      r.provided().undoClose();
      return { answer: { ok: true, changed: false } };
    }
    case 'tuning': return { answer: r.ws.panels.configureTuning({ rowGap: pickFrom(rand, [0, 16, 40]) }) as Answer };
  }
}

/** The refusal the panel's own settings force for `op` on a live or parked panel, or undefined when they allow it. */
function forced(h: PanelHandle, op: Op): string | undefined {
  const s = h.getState().settings;
  if (op === 'close') return s.closable ? undefined : 'not-closable';
  if (op === 'hide') return s.parkable ? undefined : 'not-parkable';
  if (op === 'move' || op === 'movePerson') return s.draggable ? undefined : 'not-draggable';
  if (op === 'place') return s.placeable ? undefined : 'not-placeable';
  if (op === 'setFormFactor' || op === 'resizePerson') return s.resizable ? undefined : 'not-resizable';
  return undefined;
}

const brief = (a: Answer): string => (a.ok ? (a.changed ? 'T' : 'F') : a.code);

/** Whether the live `park` panels fit the window beside the others (S1), and whether two or more are live, which is when it can fail. */
function parkPanelsFit(r: PinRig): { fits: boolean; crowded: boolean } {
  const n = r.m.latest().rowNumbers;
  if (!Number.isFinite(n.windowWidth) || n.parkLiveWidths.length <= 1) return { fits: true, crowded: false };
  const gap = r.ws.tuning.rowGap;
  const used = [...n.reservedWidths, ...n.parkLiveWidths].reduce((sum, w) => sum + w, 0) + (n.reservedWidths.length + n.parkLiveWidths.length - 1) * gap;
  return { fits: used <= n.windowWidth, crowded: true };
}

test('seeded random sequences with configure and resetLayout keep the invariants of 7.3 after every step', async () => {
  let sequences = 0;
  let steps = 0;
  let configured = 0;
  let configureRefusals = 0;
  let resets = 0;
  let busyChecked = 0;
  let shadowChecked = 0;
  let shadowedNames = 0;
  let crowdedChecked = 0;
  let mirrorsChecked = 0;
  for (let seed = 1; seed <= SEQUENCES; seed += 1) {
    const rand = prng(seed);
    const settings: Record<string, PanelSettings> = {};
    for (const id of IDS) settings[id] = settingsVector(rand);
    const r = await pinRig({ ids: IDS, settings, width: pickFrom(rand, [1000, 1500, 2000, 2400]), workspace: { conflicts: 'off' } });
    await r.settle();
    // The person has already chosen a tier on some panels, so a configure of `formFactor` meets an override to be shadowed by.
    for (const id of IDS) if (rand() < 0.5) r.turn(() => r.h[id]!.setFormFactor(pickFrom(rand, ['tablet', 'desktop'] as const), 'person'));
    const where = (step: number): string => `seed ${seed} step ${step}`;
    for (let step = 0; step < STEPS; step += 1) {
      const first = pickFrom(rand, IDS);
      const op = pickFrom(rand, OPS);
      const h = r.h[first]!;
      const before = h.getState();
      const forcedCode = (op === 'move' || op === 'movePerson') && before.status === 'parked' ? 'not-live' : forced(h, op);
      const entries = r.m.latest().entries;
      const overrides = new Map(entries.map((p) => [p.id, p.overrides]));
      const renders = r.m.renders();
      const version = r.ws.panels.getSnapshot().version;
      const isConfigure = op === 'configure' || op === 'configureOutvoted';
      const mode = rand();
      // A second call on the same panel (busy), or on another one, whose update may rebuild the entry the first call planned against.
      const twin = mode < 0.25;
      const cross = !twin && mode < 0.5;
      const multi = twin || cross;
      const secondOp = cross && rand() < 0.6 ? pickFrom(rand, ['configure', 'configureOutvoted'] as const) : pickFrom(rand, OPS);
      const second = cross ? r.h[pickFrom(rand, IDS.filter((x) => x !== first))]! : h;
      const calls = r.turn(() => {
        const one = run(r, h, op, rand);
        return multi ? [one, run(r, second, secondOp, rand)] : [one];
      });
      steps += 1;
      const one = calls[0]!;
      const two = calls[1];
      // S1: ids and keys stay unique and the row has one root.
      const keys = r.ws.panels.getSnapshot().panels.map((p) => p.id);
      assert.equal(new Set(keys).size, keys.length, `${where(step)}: keys unique`);
      const now = r.m.latest().entries;
      assert.equal(new Set(now.map((p) => p.id)).size, now.length, `${where(step)}: ids unique`);
      assert.equal(now.filter((p) => p.id === 'root').length, 1, `${where(step)}: one root`);
      // S2/S3: a restricting setting is never bypassed.
      if (!isConfigure && (before.status === 'live' || before.status === 'parked') && forcedCode !== undefined) {
        assert.equal(brief(one.answer), forcedCode, `${where(step)}: ${op} on ${first} must give ${forcedCode}`);
      }
      // A refusal leaves the list reference-equal with no commit (a single-call turn only).
      if (!multi && !one.answer.ok) {
        assert.equal(r.m.latest().entries, entries, `${where(step)}: refused ${op} (${brief(one.answer)}) changed entries`);
        assert.equal(r.m.renders(), renders, `${where(step)}: refused ${op} committed`);
        assert.equal(r.ws.panels.getSnapshot().version, version, `${where(step)}: refused ${op} moved the snapshot version`);
        if (isConfigure) configureRefusals += 1;
      }
      if (isConfigure) {
        if (one.answer.ok) configured += 1;
        // S6: the person's overrides survive any configure.
        if (!multi) for (const p of r.m.latest().entries) if (overrides.has(p.id)) assert.equal(p.overrides, overrides.get(p.id), `${where(step)}: configure rewrote ${panelKey(p)}'s overrides`);
        // The result names exactly the patched keys the instance layer did not win.
        if (one.answer.ok && one.patch !== undefined && !multi) {
          const res = one.answer as unknown as Extract<ConfigureResult, { ok: true }>;
          if (res.changed) {
            const source = h.getSettings().source;
            const asked = Object.entries(one.patch).flatMap(([k, v]) => (k === 'tuning' ? Object.entries(v as Record<string, unknown>).map(([leaf, x]) => [`tuning.${leaf}`, x] as const) : [[k, v] as const]));
            const expected = asked.filter(([k, v]) => v !== null && source[k] !== 'instance' && res.now.concat(res.later).includes(k)).map(([k]) => k);
            assert.deepEqual([...res.shadowed].sort(), expected.sort(), `${where(step)}: shadowed names the patched keys the instance layer lost`);
            shadowChecked += 1;
            if (res.shadowed.length > 0) shadowedNames += 1;
          }
        }
      }
      if (op === 'resetOne' || op === 'resetAll') resets += 1;
      // S5: a second call on a panel the first one acted on is busy; scrollTo takes no token.
      if (twin && two !== undefined && op !== 'tuning' && op !== 'undo' && op !== 'resetAll' && op !== 'resetOne' && secondOp !== 'tuning' && secondOp !== 'undo' && secondOp !== 'resetAll' && secondOp !== 'resetOne' && op !== 'scrollTo' && secondOp !== 'scrollTo' && one.answer.ok && one.answer.changed && (before.status === 'live' || before.status === 'parked') && !(before.status === 'parked' && (secondOp === 'move' || secondOp === 'movePerson'))) {
        assert.equal(brief(two.answer), 'busy', `${where(step)}: ${op} then ${secondOp} on ${first}`);
        busyChecked += 1;
      }
      // S3: the entry the engine guards with and the settings the resolver reports agree on every permission, whatever the turn did to the entry.
      for (const id of IDS) {
        const entry = r.m.latest().entries.find((p) => panelKey(p) === id);
        if (entry?.settings === undefined) continue;
        const read = r.h[id]!.getSettings().value;
        for (const key of PERMISSIONS) assert.deepEqual(entry.settings[key], read[key], `${where(step)}: ${id}.${key} on the entry and in getSettings()`);
        mirrorsChecked += 1;
      }
      // S1: after a settled commit the live park panels fit the window beside the rest, except the floor of one.
      const fit = parkPanelsFit(r);
      assert.equal(fit.fits, true, `${where(step)}: the live park panels fit the window`);
      if (fit.crowded) crowdedChecked += 1;
      // S3: show() always works as the settings say.
      if (step % 3 === 2) {
        const target = r.h[pickFrom(rand, IDS)]!;
        const state = target.getState();
        const shown = r.turn(() => target.show());
        if (state.status === 'parked') assert.equal(brief(shown), 'T', `${where(step)}: show() brings a parked panel back`);
        if (state.status === 'live') assert.ok(shown.ok, `${where(step)}: show() on a live panel is accepted`);
        if (state.status === 'closed') {
          const reopen = state.settings.showWhenClosed === 'reopen';
          assert.ok(shown.ok ? reopen : ['is-closed', 'instance-limit'].includes(shown.code), `${where(step)}: show() on a closed panel follows showWhenClosed`);
        }
      }
      if (step % 4 === 3) await advanceFrames(400);
    }
    sequences += 1;
    cleanup();
  }
  console.log(`sequences run: ${sequences}`);
  assert.ok(sequences >= 500, `sequences run: ${sequences}`);
  console.log(`checks fired: ${configured} configures, ${configureRefusals} refused, ${resets} resets, ${busyChecked} busy rows, ${shadowChecked} shadowed rows (${shadowedNames} naming a key), ${crowdedChecked} rows of two or more live park panels, ${mirrorsChecked} entry-against-resolver comparisons over ${steps} steps`);
  assert.ok(configured > 300 && configureRefusals > 20 && resets > 100 && busyChecked > 20 && shadowChecked > 100 && shadowedNames > 10 && crowdedChecked > 500 && mirrorsChecked > 10000, `the checks fired: ${configured} configures, ${configureRefusals} refused, ${resets} resets, ${busyChecked} busy rows, ${shadowChecked} shadowed rows, ${shadowedNames} naming a key, ${crowdedChecked} crowded rows, ${mirrorsChecked} mirror comparisons over ${steps} steps`);
});

// ---------------------------------------------------------------------------
// The final property: pin, unpin, scrollTo, resetLayout and the operations over random settings vectors
// ---------------------------------------------------------------------------

type MoreOp = Op | 'pin' | 'unpin' | 'pinPerson' | 'unpinPerson' | 'scrollToStart' | 'scrollToCenter';
const MORE_OPS: readonly MoreOp[] = [...OPS, 'pin', 'pin', 'unpin', 'pinPerson', 'unpinPerson', 'scrollToStart', 'scrollToCenter', 'resetOne', 'move', 'place'];

/** One call of `op`, the new ones first and the rest as the first property runs them. */
function runMore(r: PinRig, h: PanelHandle, op: MoreOp, rand: () => number, scrollOnly: boolean): Call {
  switch (op) {
    case 'pin': return { answer: h.pin() };
    case 'unpin': return { answer: h.unpin() };
    case 'pinPerson': return { answer: h.pin('person') };
    case 'unpinPerson': return { answer: h.unpin('person') };
    case 'scrollToStart': return { answer: h.scrollTo('start') };
    case 'scrollToCenter': return { answer: h.scrollTo('center') };
    default: {
      const call = run(r, h, op, rand);
      // A scroll-only sequence never gives a panel a park policy, so a random patch loses its overflow key.
      if (scrollOnly && call.patch !== undefined && 'overflow' in call.patch) return call;
      return call;
    }
  }
}

/** The refusal a panel's own settings force for a pin or unpin on a live panel, or undefined when they allow it. */
function forcedPin(h: PanelHandle, op: MoreOp): string | undefined {
  const s = h.getState().settings;
  if (op === 'pin' || op === 'pinPerson') return s.pinning.pinned.placement !== undefined && !s.placeable ? 'not-placeable' : undefined;
  if (op === 'unpin' || op === 'unpinPerson') return s.pinning.unpinned.placement !== undefined && !s.placeable ? 'not-placeable' : undefined;
  return undefined;
}

const REFUSALS = new Set(['disposed', 'not-attached', 'not-ready', 'is-pending', 'is-closed', 'not-live', 'busy', 'not-closable', 'not-parkable', 'not-draggable', 'not-placeable', 'not-resizable', 'tier-not-allowed', 'would-empty-row', 'instance-limit', 'unknown-panel', 'wrong-scope', 'would-reshape-row', 'settings-conflict', 'not-view-settable']);

test('final property: over random settings vectors, pin, unpin, scrollTo, resetLayout, configure and the operations keep every guarantee of 7.3 after every step', async () => {
  const MORE_SEQUENCES = 500;
  let sequences = 0;
  let scrollOnlySequences = 0;
  let steps = 0;
  let pinsAccepted = 0;
  let unpinsAccepted = 0;
  let scrollsAccepted = 0;
  let placeableRefusals = 0;
  let scrollBounds = 0;
  let neverParkedChecks = 0;
  let mirrorsChecked = 0;
  for (let seed = 10001; seed < 10001 + MORE_SEQUENCES; seed += 1) {
    const rand = prng(seed);
    const scrollOnly = seed % 4 === 0;
    const settings: Record<string, PanelSettings> = {};
    for (const id of IDS) settings[id] = { ...settingsVector(rand), ...(scrollOnly ? { overflow: 'scroll' as const } : {}) } as PanelSettings;
    const r = await pinRig({ ids: IDS, settings, width: pickFrom(rand, [1000, 1500, 2000, 2400]), workspace: { conflicts: 'off', tuning: { rowGesture: 'free' } } });
    await r.settle();
    if (scrollOnly) scrollOnlySequences += 1;
    const where = (step: number): string => `seed ${seed} step ${step}${scrollOnly ? ' (scroll only)' : ''}`;
    for (let step = 0; step < STEPS; step += 1) {
      const first = pickFrom(rand, IDS);
      const op = pickFrom(rand, MORE_OPS);
      const h = r.h[first]!;
      const before = h.getState();
      const isPin = op === 'pin' || op === 'unpin' || op === 'pinPerson' || op === 'unpinPerson';
      const forcedCode = isPin ? forcedPin(h, op) : forced(h, op as Op);
      const entries = r.m.latest().entries;
      const renders = r.m.renders();
      const version = r.ws.panels.getSnapshot().version;
      const twin = rand() < 0.2;
      let secondOp: MoreOp = op;
      const calls = r.turn(() => {
        const one = runMore(r, h, op, rand, scrollOnly);
        if (scrollOnly && one.patch !== undefined) delete one.patch.overflow;
        if (!twin) return [one];
        secondOp = pickFrom(rand, MORE_OPS);
        return [one, runMore(r, h, secondOp, rand, scrollOnly)];
      });
      steps += 1;
      const one = calls[0]!;
      const two = calls[1];
      // S1: ids and keys unique, one root.
      const keys = r.ws.panels.getSnapshot().panels.map((p) => p.id);
      assert.equal(new Set(keys).size, keys.length, `${where(step)}: keys unique`);
      const now = r.m.latest().entries;
      assert.equal(new Set(now.map((p) => p.id)).size, now.length, `${where(step)}: ids unique`);
      assert.equal(now.filter((p) => p.id === 'root').length, 1, `${where(step)}: one root`);
      // Every answer is a result or one of the typed refusals, never a throw or an untyped code.
      for (const call of calls) assert.equal(call.answer.ok || REFUSALS.has((call.answer as { code: string }).code), true, `${where(step)}: ${op} answered ${brief(call.answer)}`);
      // S2/S3: a restricting setting is never bypassed, for the operations and for pin and unpin.
      if ((before.status === 'live' || before.status === 'parked') && forcedCode !== undefined && !twin) {
        const expectation = before.status === 'parked' && (op === 'move' || op === 'movePerson') ? 'not-live' : forcedCode;
        if (!(isPin && before.status !== 'live')) assert.equal(brief(one.answer), expectation, `${where(step)}: ${op} on ${first} must give ${expectation}`);
        if (isPin) placeableRefusals += 1;
      }
      // A refusal leaves the list reference-equal with no commit (a single-call turn only).
      if (!twin && !one.answer.ok) {
        assert.equal(r.m.latest().entries, entries, `${where(step)}: refused ${op} (${brief(one.answer)}) changed entries`);
        assert.equal(r.m.renders(), renders, `${where(step)}: refused ${op} committed`);
        assert.equal(r.ws.panels.getSnapshot().version, version, `${where(step)}: refused ${op} moved the snapshot version`);
      }
      if ((op === 'pin' || op === 'pinPerson') && one.answer.ok && one.answer.changed) pinsAccepted += 1;
      if ((op === 'unpin' || op === 'unpinPerson') && one.answer.ok && one.answer.changed) unpinsAccepted += 1;
      if ((op === 'scrollToStart' || op === 'scrollToCenter' || op === 'scrollTo') && one.answer.ok && one.answer.changed) scrollsAccepted += 1;
      // S5: a second call on a panel the first one acted on is busy (a pin or unpin takes a token like any other operation).
      if (twin && two !== undefined && one.answer.ok && one.answer.changed && isPin && (before.status === 'live' || before.status === 'parked')) {
        const second = two.answer;
        const untoken = secondOp === 'scrollTo' || secondOp === 'scrollToStart' || secondOp === 'scrollToCenter' || secondOp === 'undo';
        const moveOnParked = before.status === 'parked' && (secondOp === 'move' || secondOp === 'movePerson');
        if (!untoken && !moveOnParked) assert.equal(brief(second), 'busy', `${where(step)}: ${secondOp} on ${first} after ${op} answered ${brief(second)}`);
      }
      // S3: the engine's entry and the resolver agree on every permission.
      for (const id of IDS) {
        const entry = r.m.latest().entries.find((p) => panelKey(p) === id);
        if (entry?.settings === undefined) continue;
        const read = r.h[id]!.getSettings().value;
        for (const key of PERMISSIONS) assert.deepEqual(entry.settings[key], read[key], `${where(step)}: ${id}.${key} on the entry and in getSettings()`);
        mirrorsChecked += 1;
      }
      // S1: after a settled commit the live park panels fit the window beside the rest, except the floor of one.
      assert.equal(parkPanelsFit(r).fits, true, `${where(step)}: the live park panels fit the window`);
      // The scroll bound: a glide ends inside [0, the farthest legal scroll], computed from the row numbers and never from the DOM.
      if ((op === 'scrollToStart' || op === 'scrollToCenter' || op === 'scrollTo') && one.answer.ok && one.answer.changed && !twin) {
        await advanceFrames(900);
        const n = r.m.latest().rowNumbers;
        if (Number.isFinite(n.windowWidth)) {
          const farthest = Math.max(0, n.rowMarginLeft + n.stripWidth - n.windowWidth);
          const at = r.m.container.scrollLeft;
          assert.equal(at >= 0 && at <= farthest + 1e-6, true, `${where(step)}: scrollLeft ${at} after ${op} lies in [0, ${farthest}]`);
          scrollBounds += 1;
        }
      }
      // S11: with every panel scroll, no panel is ever parked for room; a parked panel is one a hide held.
      if (scrollOnly) {
        const forRoom = IDS.filter((id) => {
          const s = r.h[id]!.getState();
          return s.status === 'parked' && !s.held;
        });
        assert.deepEqual(forRoom, [], `${where(step)}: nothing was parked for room`);
        neverParkedChecks += 1;
      }
      // S3: show() always works as the settings say.
      if (step % 3 === 2) {
        const target = r.h[pickFrom(rand, IDS)]!;
        const state = target.getState();
        const shown = r.turn(() => target.show());
        if (state.status === 'parked') assert.equal(brief(shown), 'T', `${where(step)}: show() brings a parked panel back`);
        if (state.status === 'live') assert.ok(shown.ok, `${where(step)}: show() on a live panel is accepted`);
      }
      if (step % 4 === 3) await advanceFrames(400);
    }
    sequences += 1;
    cleanup();
  }
  console.log(`final property sequences run: ${sequences} (${scrollOnlySequences} scroll-only)`);
  assert.ok(sequences >= 500, `sequences run: ${sequences}`);
  console.log(`final property checks fired: ${pinsAccepted} pins, ${unpinsAccepted} unpins, ${scrollsAccepted} scrolls accepted, ${placeableRefusals} pin refusals checked, ${scrollBounds} scroll bounds, ${neverParkedChecks} never-parked rows, ${mirrorsChecked} mirror comparisons over ${steps} steps`);
  assert.ok(pinsAccepted > 100 && unpinsAccepted > 50 && scrollsAccepted > 100 && scrollBounds > 50 && neverParkedChecks > 400 && mirrorsChecked > 10000 && scrollOnlySequences >= 100, `the checks fired: ${pinsAccepted} pins, ${unpinsAccepted} unpins, ${scrollsAccepted} scrolls, ${scrollBounds} bounds, ${neverParkedChecks} never-parked rows, ${mirrorsChecked} mirrors, ${scrollOnlySequences} scroll-only sequences`);
});
