/**
 * Seeded random sequences of pin, unpin, deferred pins, resetLayout, drags of unrelated panels and the visibility
 * operations over random settings vectors and valid pinning definitions. After every step: no restricting setting is
 * bypassed (S3), the pinned read survives a drag of any other panel (S10), and show() still works. At a few steps a
 * pin then unpin from the reset row restores the row's permissions and listing (S10).
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import type { PanelResult, PanelSettings, Pinning, PinningWhenNotLive } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { brief } from './support/ops-rig.js';
import { pinRig } from './support/pin-rig.js';

afterEach(() => cleanup());

const SEQUENCES = 500;
const STEPS = 8;
const IDS = ['dock', 'a', 'b', 'p'] as const;

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

const DEFINITIONS: readonly (Pinning | undefined)[] = [
  undefined,
  { pinned: { parkable: false }, unpinned: { parkable: true } },
  { pinned: { placement: { after: 'dock' }, parkable: false }, unpinned: { placement: 'row-end', parkable: true } },
  { pinned: { placement: 'row-start' }, unpinned: { placement: 'after-fixed' } },
  { pinned: { placement: 'row-start', parkable: false }, unpinned: { placement: 'row-end', parkable: true } },
  { pinned: { placement: 'row-start', parkable: false }, unpinned: { placement: 'after-fixed', parkable: true } },
];
const WHEN: readonly PinningWhenNotLive[] = ['place-only', 'refuse', 'show', 'apply-on-next-show', { hidden: 'refuse', parked: 'place-only' }];

type Op = 'pin' | 'unpin' | 'pinPerson' | 'hide' | 'show' | 'close' | 'open' | 'move' | 'resetOne' | 'resetAll' | 'setSlots';
const OPS: readonly Op[] = ['pin', 'unpin', 'pinPerson', 'hide', 'show', 'close', 'open', 'move', 'resetOne', 'resetAll', 'setSlots'];

test('seeded random sequences keep S3 and S10 after every step', async () => {
  let sequences = 0;
  let steps = 0;
  let pins = 0;
  let deferred = 0;
  let restores = 0;
  for (let seed = 1; seed <= SEQUENCES; seed += 1) {
    const rand = prng(seed);
    const pick = <T,>(...values: T[]): T => values[Math.floor(rand() * values.length)]!;
    const settings: Record<string, PanelSettings> = {};
    const movable: Record<string, boolean> = {};
    const definitionOf: Record<string, Pinning | undefined> = {};
    for (const id of IDS) {
      const definition = id === 'dock' ? undefined : pick(...DEFINITIONS);
      definitionOf[id] = definition;
      movable[id] = pick(true, true, true, false);
      settings[id] = { overflow: 'scroll', ...(movable[id] ? {} : { movable: false }), pinningWhenNotLive: pick(...WHEN), ...(definition === undefined ? {} : { pinning: definition }) } as PanelSettings;
    }
    const r = await pinRig({ ids: IDS, width: pick(800, 1000, 4000), settings });
    const where = (step: number): string => `seed ${seed} step ${step}`;
    const reads = (): Record<string, boolean> => Object.fromEntries(IDS.map((id) => [id, r.state(id).pinned]));
    for (let step = 0; step < STEPS; step += 1) {
      const id = pick(...IDS);
      const op = pick(...OPS);
      const h = r.h[id]!;
      const before = r.state(id);
      const readsBefore = reads();
      const result: PanelResult = r.turn(() => {
        switch (op) {
          case 'pin': return h.pin();
          case 'unpin': return h.unpin();
          case 'pinPerson': return h.pin('person');
          case 'hide': return h.hide();
          case 'show': return h.show();
          case 'close': return h.close();
          case 'open': return h.open();
          case 'move': return h.move(pick(-1, 1));
          case 'resetOne': return r.ws.panels.resetLayout(id);
          case 'resetAll': return r.ws.panels.resetLayout('all');
          case 'setSlots': return h.setSlots(pick(1, 2) as 1 | 2);
        }
      });
      steps += 1;
      const keys = r.order();
      assert.equal(new Set(keys).size, keys.length, `${where(step)}: keys unique`);
      if (op === 'pin' || op === 'unpin' || op === 'pinPerson') pins += 1;
      if (result.ok && (result as { deferred?: boolean }).deferred === true) deferred += 1;
      // S3: movable limits a person's drag and drop only, so a pin with a placement is never refused for it.
      const definition = definitionOf[id];
      const half = definition === undefined ? { placement: 'x' } : op === 'unpin' ? definition.unpinned : definition.pinned;
      if ((op === 'pin' || op === 'unpin' || op === 'pinPerson') && before.status === 'live' && !movable[id] && 'placement' in half && (half as { placement?: unknown }).placement !== undefined) {
        assert.notEqual(brief(result), 'not-movable', `${where(step)}: ${op} on ${id}`);
      }
      // S3: a refusal changes no read.
      if (!result.ok && (op === 'pin' || op === 'unpin' || op === 'pinPerson')) assert.deepEqual(reads(), readsBefore, `${where(step)}: refused ${op} moved a read`);
      // S10: a drag of one panel leaves every other panel's read unchanged.
      if (op === 'move' && result.ok) {
        for (const other of IDS) if (other !== id) assert.equal(r.state(other).pinned, readsBefore[other], `${where(step)}: moving ${id} changed ${other}'s read`);
      }
      // A fixed pin reads fixed everywhere: not parkable, not listed, not movable.
      for (const other of IDS) {
        const f = r.facts(other);
        if (f.pinned && definitionOf[other]?.pinned.parkable === false) assert.deepEqual([f.parkable, f.listed, f.movable], [false, false, false], `${where(step)}: ${other} reads pinned with a fixed definition`);
      }
      // S3: show() always works on a panel that is not closed.
      if (step % 3 === 2) {
        const target = r.h[pick(...IDS)]!;
        const state = target.getState();
        const shown = r.turn(() => target.show());
        if (state.status === 'parked') assert.equal(brief(shown), 'T', `${where(step)}: show() brings a parked panel back`);
        if (state.status === 'live') assert.ok(shown.ok, `${where(step)}: show() on a live panel`);
      }
      // S10: from the reset row, pin then unpin restores permissions and listing, and a repeat gives the same row.
      if (step === STEPS - 1 && sequences % 5 === 0) {
        const probe = r.h.p!;
        r.turn(() => r.ws.panels.resetLayout('all'));
        for (const o of IDS) if (r.state(o).status === 'closed') r.turn(() => r.h[o]!.open());
        await advanceFrames(400);
        const start = r.facts('p');
        const first = r.turn(() => probe.pin());
        if (first.ok && !(first as { deferred?: boolean }).deferred && r.state('p').status === 'live') {
          assert.ok(r.turn(() => probe.unpin()).ok, `${where(step)}: a fixed pin can always be unpinned`);
          assert.deepEqual(r.facts('p'), start, `${where(step)}: permissions and listing restored`);
          r.turn(() => probe.pin());
          r.turn(() => probe.unpin());
          const row1 = r.order().join(' ');
          r.turn(() => probe.pin());
          r.turn(() => probe.unpin());
          assert.equal(r.order().join(' '), row1, `${where(step)}: a repeat gives the same row`);
          restores += 1;
        }
      }
      if (step % 4 === 3) await advanceFrames(400);
    }
    sequences += 1;
    cleanup();
  }
  console.log(`sequences run: ${sequences}`);
  assert.ok(sequences >= 500, `sequences run: ${sequences}`);
  assert.ok(pins > 400 && deferred > 5 && restores > 20, `the checks fired: ${pins} pins, ${deferred} deferred, ${restores} restores over ${steps} steps`);
});
