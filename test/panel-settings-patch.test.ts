/**
 * mergePatch: null deletes, undefined is ignored, headerButtons merges by slot, an equal patch returns the very same layer,
 * nothing is mutated, and 500 seeded patches agree with a hand-written reference. mergeTuningPatch does the same for the
 * workspace tuning, leaf by leaf and member by member.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { resolvePanelSettings } from '../panelSettings.js';
import { mergePatch, mergeTuningPatch } from '../settingsPatch.js';
import type { HeaderButton, PanelSettings, SettingsPatch, WorkspaceTuning } from '../index.js';

type Loose = Record<string, unknown>;
const asPatch = (x: unknown): SettingsPatch => x as SettingsPatch;
const asLayer = (x: unknown): PanelSettings => x as PanelSettings;
const slot = (label: string, extra: Partial<HeaderButton> = {}): HeaderButton => ({ icon: 'i', label, onClick: () => undefined, ...extra });

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** A deep copy that keeps functions by reference. */
function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => copy(item as unknown)) as unknown as T;
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([k, inner]) => [k, copy(inner)])) as T;
  return value;
}

test('mergePatch: null deletes a value from the layer and the result resolves, where a kept null would be refused', () => {
  const layer: PanelSettings = { closable: false, title: 'Mine', overflow: 'park' };
  const next = mergePatch(layer, { title: null, overflow: null });
  assert.deepEqual(next, { closable: false });
  assert.equal('title' in next, false, 'the key is gone, not set to null');
  assert.deepEqual(layer, { closable: false, title: 'Mine', overflow: 'park' }, 'the input is unchanged');
  assert.equal(resolvePanelSettings({ instance: next }).value.title, undefined);
  assert.equal(resolvePanelSettings({ instance: next }).value.overflow, 'scroll');
});

test('mergePatch: a value replaces the key, and placeOnAdd and pinningWhenNotLive are replaced whole', () => {
  const next = mergePatch({ placeOnAdd: { before: 'a' }, pinningWhenNotLive: { parked: 'show', hidden: 'refuse' } }, { placeOnAdd: { after: 'b' }, pinningWhenNotLive: { closed: 'refuse' } });
  assert.deepEqual(next, { placeOnAdd: { after: 'b' }, pinningWhenNotLive: { closed: 'refuse' } });
});

test('mergePatch: undefined never changes anything, and an empty patch, an undefined patch and an equal patch return the same layer object', () => {
  const layer: PanelSettings = { closable: false, placeOnAdd: { before: 'a' }, headerButtons: { size: false } };
  assert.equal(mergePatch(layer, {}), layer);
  assert.equal(mergePatch(layer, { closable: undefined, title: undefined }), layer);
  assert.equal(mergePatch(layer, { closable: false }), layer, 'an equal value');
  assert.equal(mergePatch(layer, { placeOnAdd: { before: 'a' } }), layer, 'an equal placement object');
  assert.equal(mergePatch(layer, { headerButtons: { size: false } }), layer, 'an equal header-button slot');
  assert.equal(mergePatch(layer, asPatch({ title: null })), layer, 'deleting a key the layer does not hold');
  assert.notEqual(mergePatch(layer, { closable: true }), layer, 'control: a real change returns a new object');
});

test('mergeTuningPatch: merges per leaf and per member, null deletes a leaf or a member, and an equal patch returns the same object', () => {
  const tuning: WorkspaceTuning = { dragToClose: { distanceFraction: 0.3 }, slide: { durationSec: 1 }, hopFraction: 0.6 };
  const merged = mergeTuningPatch(tuning, { dragToClose: { minDistancePx: 100 }, edgeScroll: { zonePx: 30 } });
  assert.deepEqual(merged, { dragToClose: { distanceFraction: 0.3, minDistancePx: 100 }, slide: { durationSec: 1 }, hopFraction: 0.6, edgeScroll: { zonePx: 30 } });
  assert.deepEqual(mergeTuningPatch(tuning, { hopFraction: null }), { dragToClose: { distanceFraction: 0.3 }, slide: { durationSec: 1 } });
  assert.deepEqual(mergeTuningPatch(tuning, { slide: null }), { dragToClose: { distanceFraction: 0.3 }, hopFraction: 0.6 });
  assert.deepEqual(mergeTuningPatch(tuning, { dragToClose: { distanceFraction: null } }), { dragToClose: {}, slide: { durationSec: 1 }, hopFraction: 0.6 });
  assert.deepEqual(mergeTuningPatch(undefined, { hopFraction: 0.5 }), { hopFraction: 0.5 });
  const empty = {};
  assert.equal(mergeTuningPatch(empty, {}), empty, 'an empty patch on an empty tuning adds nothing');
  assert.equal(mergeTuningPatch(tuning, { hopFraction: 0.6, dragToClose: { distanceFraction: 0.3 } }), tuning, 'an equal patch is the same object');
  assert.deepEqual(tuning, { dragToClose: { distanceFraction: 0.3 }, slide: { durationSec: 1 }, hopFraction: 0.6 }, 'the input is unchanged');
});

test('mergePatch: headerButtons merges per slot id, false hides a slot, and null deletes a slot', () => {
  const size = slot('Size');
  const pin = slot('Pin');
  const layer: PanelSettings = { headerButtons: { size } };
  assert.deepEqual(Object.keys(mergePatch(layer, { headerButtons: { pin } }).headerButtons ?? {}).sort(), ['pin', 'size']);
  assert.deepEqual(mergePatch(layer, { headerButtons: { size: false } }).headerButtons, { size: false });
  assert.deepEqual(mergePatch(layer, asPatch({ headerButtons: { size: null } })).headerButtons, {});
  const replaced = mergePatch(layer, { headerButtons: { size: slot('Resize') } }).headerButtons?.size;
  assert.equal((replaced as HeaderButton).label, 'Resize');
  assert.equal(mergePatch(layer, { headerButtons: { size } }), layer, 'the same slot object is no change');
  assert.deepEqual(mergePatch({ headerButtons: { size, pin } }, { headerButtons: null }), {});
});

test('mergePatch: frozen inputs are never mutated and the result shares no writable structure with a changed branch', () => {
  const layer = deepFreeze({ closable: false, headerButtons: { size: slot('Size') }, placeOnAdd: { before: 'a' } }) as PanelSettings;
  const patch = deepFreeze({ title: 'T', headerButtons: { pin: slot('Pin') } }) as SettingsPatch;
  const before = copy(layer);
  const next = mergePatch(layer, patch);
  assert.deepEqual(layer, before);
  assert.deepEqual(Object.keys(next.headerButtons ?? {}).sort(), ['pin', 'size']);
  assert.equal(Object.isFrozen(next.headerButtons), false, 'the changed branch is a new object');
});

// ---------------------------------------------------------------------------
// 500 seeded patches against a reference
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const chance = (rng: Rng, p: number): boolean => rng() < p;
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;

const FLAT_POOL: Record<string, readonly unknown[]> = {
  closable: [true, false],
  parkable: [true, false],
  draggable: [true, false],
  listed: [true, false],
  title: ['A', 'B'],
  overflow: ['scroll', 'park'],
  maxSlots: [1, 2, 64],
  slots: [1, 2, 3],
  placeOnAdd: ['row-end', { before: 'a' }, { after: 'b' }],
  pinningWhenNotLive: ['refuse', { parked: 'show' }, { closed: 'refuse' }],
  pinning: [{ pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } }, { pinned: { parkable: false }, unpinned: { parkable: true } }],
  layer: ['base', 'raised'],
};
const LEAF_POOL: Record<string, readonly unknown[]> = {
  dragToClose: [{ distanceFraction: 0.3 }, { minDistancePx: 120 }, { flickVelocity: 900, cancelVelocity: -100 }, { snapBack: { stiffness: 300, damping: 30 } }],
  slide: [{ durationSec: 0.2 }, { closeExitSeconds: 1 }, { ease: [0.3, 0, 0.7, 1] }],
  hopFraction: [0.3, 0.6],
  edgeScroll: [{ zonePx: 30 }, { maxPxPerSec: 1200 }],
};
const SLOT_IDS = ['size', 'pin', 'menu'] as const;
const SLOTS = [slot('A'), slot('B', { side: 'end' }), slot('C', { order: 4 })] as const;

function randomLayer(rng: Rng): Loose {
  const layer: Loose = {};
  for (const [key, values] of Object.entries(FLAT_POOL)) if (chance(rng, 0.2)) layer[key] = pick(rng, values);
  if (chance(rng, 0.4)) {
    const map: Loose = {};
    for (const id of SLOT_IDS) if (chance(rng, 0.5)) map[id] = chance(rng, 0.2) ? false : pick(rng, SLOTS);
    layer.headerButtons = map;
  }
  return layer;
}

function randomPatch(rng: Rng): Loose {
  const patch: Loose = {};
  for (const [key, values] of Object.entries(FLAT_POOL)) {
    if (!chance(rng, 0.2)) continue;
    patch[key] = chance(rng, 0.25) ? null : chance(rng, 0.1) ? undefined : pick(rng, values);
  }
  if (chance(rng, 0.05)) patch.headerButtons = null;
  else if (chance(rng, 0.5)) {
    const map: Loose = {};
    for (const id of SLOT_IDS) if (chance(rng, 0.5)) map[id] = chance(rng, 0.25) ? null : chance(rng, 0.2) ? false : pick(rng, SLOTS);
    patch.headerButtons = map;
  }
  return patch;
}

const isPlain = (v: unknown): v is Loose => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The meaning of a patch, written the long way: copy the layer, then apply each key of the patch in turn. */
function reference(layer: Loose, patch: Loose): Loose {
  const out = copy(layer);
  for (const [key, asked] of Object.entries(patch)) {
    if (asked === undefined) continue;
    if (asked === null) {
      delete out[key];
    } else if (key === 'headerButtons') {
      const map: Loose = { ...(isPlain(out.headerButtons) ? out.headerButtons : {}) };
      for (const [id, slotAsked] of Object.entries(asked as Loose)) {
        if (slotAsked === undefined) continue;
        if (slotAsked === null) delete map[id];
        else map[id] = slotAsked;
      }
      out.headerButtons = map;
    } else {
      out[key] = copy(asked);
    }
  }
  return out;
}

test('mergePatch: 500 seeded patches resolve equal to a hand-written reference, never mutate their inputs, and return the same layer when nothing changed', () => {
  const SEED = 77001;
  const ITERATIONS = 500;
  let iterations = 0;
  let unchanged = 0;
  let changed = 0;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const seed = SEED + i;
    const rng = mulberry32(seed);
    const layer = deepFreeze(randomLayer(rng));
    const patch = deepFreeze(randomPatch(rng));
    const where = `seed ${seed} (iteration ${i}): layer ${JSON.stringify(layer)}, patch ${JSON.stringify(patch, (_k, v: unknown) => (v === undefined ? '(undefined)' : v))}`;
    const before = copy(layer);
    const merged = mergePatch(asLayer(layer), asPatch(patch));
    assert.deepEqual(layer, before, `the layer was mutated, ${where}`);
    const expected = reference(layer, patch);
    assert.deepEqual(resolvePanelSettings({ instance: merged }), resolvePanelSettings({ instance: asLayer(expected) }), `merged layer resolves differently from the reference, ${where}`);
    if (merged === layer) {
      unchanged += 1;
      assert.deepEqual(resolvePanelSettings({ instance: asLayer(layer) }), resolvePanelSettings({ instance: asLayer(expected) }), `returned the same layer for a patch that changes the resolve, ${where}`);
    } else {
      changed += 1;
      assert.ok(!isDeepStrictEqual(merged, layer), `returned a new layer equal to the old one, ${where}`);
    }
    iterations += 1;
  }
  assert.equal(iterations, ITERATIONS);
  assert.ok(iterations >= 500);
  assert.ok(unchanged >= 5 && changed >= 300, `the generator made ${unchanged} unchanged and ${changed} changed patches`);
});

test('mergeTuningPatch: 300 seeded patches agree with a hand-written reference and never mutate their inputs', () => {
  for (let i = 0; i < 300; i += 1) {
    const rng = mulberry32(31000 + i);
    const base: Loose = {};
    for (const [leaf, values] of Object.entries(LEAF_POOL)) if (chance(rng, 0.5)) base[leaf] = pick(rng, values);
    const patch: Loose = {};
    for (const [leaf, values] of Object.entries(LEAF_POOL)) {
      if (!chance(rng, 0.4)) continue;
      const kind = rng();
      if (kind < 0.2) patch[leaf] = null;
      else if (kind < 0.3) patch[leaf] = undefined;
      else if (kind < 0.55 && typeof pick(rng, values) === 'object') patch[leaf] = { [pick(rng, ['distanceFraction', 'durationSec', 'zonePx', 'minDistancePx'])]: null };
      else patch[leaf] = pick(rng, values);
    }
    deepFreeze(base);
    deepFreeze(patch);
    const expected: Loose = copy(base);
    for (const [leaf, asked] of Object.entries(patch)) {
      if (asked === undefined) continue;
      if (asked === null) delete expected[leaf];
      else if (isPlain(asked)) {
        const existed = isPlain(expected[leaf]);
        const members: Loose = { ...(existed ? (expected[leaf] as Loose) : {}) };
        for (const [member, memberAsked] of Object.entries(asked)) {
          if (memberAsked === null) delete members[member];
          else if (memberAsked !== undefined) members[member] = memberAsked;
        }
        if (existed || Object.keys(members).length > 0) expected[leaf] = members;
      } else expected[leaf] = asked;
    }
    const merged = mergeTuningPatch(base as WorkspaceTuning, patch);
    assert.deepEqual(merged, expected, `seed ${31000 + i}`);
    if (isDeepStrictEqual(base, expected)) assert.equal(merged, base, `seed ${31000 + i}: nothing changed, so the same object`);
  }
});
