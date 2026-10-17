/**
 * Seeded random sequences of handle operations over random settings vectors. After every step: ids and keys are unique,
 * no restricting setting was bypassed, a refusal touched nothing, a second operation on a panel the first one changed
 * is busy, and show() does what the panel's settings say.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import type { PanelHandle, PanelResult, PanelSettings } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { brief, rig, type Rig } from './support/ops-rig.js';

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

type Op = 'show' | 'hide' | 'toggleVisibility' | 'close' | 'open' | 'move' | 'place' | 'setSlots' | 'scrollTo';
const OPS: readonly Op[] = ['show', 'hide', 'toggleVisibility', 'close', 'open', 'move', 'place', 'setSlots', 'scrollTo'];

function settingsVector(rand: () => number): PanelSettings {
  const pick = <T,>(...values: T[]): T => values[Math.floor(rand() * values.length)]!;
  return {
    closable: pick(true, true, false),
    parkable: pick(true, true, false),
    draggable: pick(true, true, false),
    crossable: pick(true, true, false),
    placeable: pick(true, true, false),
    resizable: pick(true, true, false),
    maxSlots: pick(64, 1, 2),
    hideStickiness: pick('sticky', 'until-room'),
    showWhenClosed: pick('refuse', 'reopen'),
    toggleWhenClosed: pick('ignore', 'reopen'),
  } as PanelSettings;
}

function run(h: PanelHandle, op: Op, rand: () => number): PanelResult {
  switch (op) {
    case 'show': return h.show();
    case 'hide': return h.hide();
    case 'toggleVisibility': return h.toggleVisibility();
    case 'close': return h.close();
    case 'open': return h.open();
    case 'move': return h.move(rand() < 0.5 ? -1 : 1);
    case 'place': return h.place((['row-start', 'row-end', 'after-fixed'] as const)[Math.floor(rand() * 3)]!);
    case 'setSlots': return h.setSlots(1 + Math.floor(rand() * 3));
    case 'scrollTo': return h.scrollTo();
  }
}

/** The refusal the panel's own settings force for `op` on a live or parked panel, or undefined when they allow it. */
function forced(h: PanelHandle, op: Op): string | undefined {
  const s = h.getState().settings;
  if (op === 'close') return s.closable ? undefined : 'not-closable';
  if (op === 'hide') return s.parkable ? undefined : 'not-parkable';
  if (op === 'move') return s.draggable ? undefined : 'not-draggable';
  if (op === 'place') return s.placeable ? undefined : 'not-placeable';
  if (op === 'setSlots') return s.resizable ? undefined : 'not-resizable';
  return undefined;
}

const keysOf = (r: Rig): string[] => r.ws.panels.getSnapshot().panels.map((p) => p.id);

test('seeded random sequences over random settings vectors keep every guarantee of the manager', async () => {
  let sequences = 0;
  let steps = 0;
  let refusalsChecked = 0;
  let busyChecked = 0;
  for (let seed = 1; seed <= SEQUENCES; seed += 1) {
    const rand = prng(seed);
    const settings: Record<string, PanelSettings> = {};
    for (const id of IDS) settings[id] = settingsVector(rand);
    const r = await rig({ ids: IDS, settings, width: 1000 });
    const where = (): string => `seed ${seed}`;
    for (let step = 0; step < STEPS; step += 1) {
      const first = IDS[Math.floor(rand() * IDS.length)]!;
      const op = OPS[Math.floor(rand() * OPS.length)]!;
      const h = r.h[first]!;
      const before = h.getState();
      const entries = r.m!.latest().entries;
      const renders = r.m!.renders();
      const twin = rand() < 0.3;
      const second = twin ? first : IDS[Math.floor(rand() * IDS.length)]!;
      const op2 = OPS[Math.floor(rand() * OPS.length)]!;
      const answers = r.turn(() => {
        const one = run(h, op, rand);
        return twin ? [one, run(r.h[second]!, op2, rand)] : [one];
      });
      steps += 1;
      const [one, two] = answers as [PanelResult, PanelResult | undefined];
      // S1: ids and keys stay unique.
      const keys = keysOf(r);
      assert.equal(new Set(keys).size, keys.length, `${where()} step ${step}: keys unique`);
      const ids = r.m!.latest().entries.map((p) => p.id);
      assert.equal(new Set(ids).size, ids.length, `${where()} step ${step}: ids unique`);
      // S2/S3: a restricting setting is never bypassed.
      if (before.status === 'live' || before.status === 'parked') {
        const force = op === 'move' && before.status === 'parked' ? 'not-live' : forced(h, op);
        if (force !== undefined) assert.equal(brief(one), force, `${where()} step ${step}: ${op} on ${first} must give ${force}`);
      }
      // A refusal leaves the list reference-equal with no commit (a single-call turn only).
      if (!twin && !one.ok) {
        assert.equal(r.m!.latest().entries, entries, `${where()} step ${step}: refused ${op} (${brief(one)}) changed entries`);
        assert.equal(r.m!.renders(), renders, `${where()} step ${step}: refused ${op} committed`);
        refusalsChecked += 1;
      }
      // S5: a second operation on a panel the first one changed is busy; scrollTo is never busy.
      if (twin && two !== undefined && one.ok && one.changed && op !== 'scrollTo' && op2 !== 'scrollTo' && (before.status === 'live' || before.status === 'parked') && !(before.status === 'parked' && op2 === 'move')) {
        // A parked panel answers not-live to a move whatever else is in flight.
        assert.equal(brief(two), 'busy', `${where()} step ${step}: ${op} then ${op2} on ${first}`);
        busyChecked += 1;
      }
      if (twin && two !== undefined && op2 === 'scrollTo') assert.notEqual(brief(two), 'busy', `${where()}: scrollTo is never busy`);
      // S3: show() always works as the settings say.
      if (step % 3 === 2) {
        const target = r.h[IDS[Math.floor(rand() * IDS.length)]!]!;
        const state = target.getState();
        const shown = r.turn(() => target.show());
        if (state.status === 'parked') assert.equal(brief(shown), 'T', `${where()}: show() brings a parked panel back`);
        if (state.status === 'live') assert.ok(shown.ok, `${where()}: show() on a live panel is accepted`);
        if (state.status === 'closed') {
          const reopen = state.settings.showWhenClosed === 'reopen';
          assert.ok(shown.ok ? reopen : ['is-closed', 'instance-limit'].includes(shown.code), `${where()}: show() on a closed panel follows showWhenClosed`);
        }
      }
      if (step % 4 === 3) await advanceFrames(400);
    }
    sequences += 1;
    cleanup();
  }
  console.log(`sequences run: ${sequences}`);
  assert.ok(sequences >= 500, `sequences run: ${sequences}`);
  assert.ok(refusalsChecked > 50 && busyChecked > 20, `the checks fired: ${refusalsChecked} refusals, ${busyChecked} busy rows over ${steps} steps`);
});
