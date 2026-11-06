/**
 * The model's adapter against the arithmetic it replaces, over random rows: the same panels, holds, window, gap and rest through
 * legacyRowNumbers and computeRowNumbers must give equal numbers, field by field. Inputs are whole pixels: the two compute the same
 * sums in a different order, which is bit-equal for integers and not for fractions. With fractional inputs the two can differ in the
 * last bits, and a row within those bits of fitting the window may count as overflowing in one and not the other; the app's phone width,
 * gap and container are whole pixels, and a test below pins that fractions stay within a micropixel. Delete with legacyRowNumbers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import type { PanelSettings, PanelWindow } from '../index.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { appendPanel } from '../panelWindow.js';
import { computeRowNumbers, legacyRowNumbers, rowNumbersViaModel, rowNumberSources } from '../rowNumbers.js';

const SEED = Number(process.env.ROW_MODEL_SEED ?? 20261105);

const made = (id: string, layer: PanelSettings): PanelWindow => {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'row-numbers-model-view' }, id, 'root')[0]!;
  return applyTemplate(skeleton, resolvePanelSettings({ template: layer }).value, 'create');
};

interface Row {
  panels: { slots: number; hold: 'off' | 'left' | 'right' | 'both'; pinned: boolean; parks: boolean; live: boolean }[];
  scroll: boolean;
  first: 'off' | 'left' | 'right' | 'both';
  phone: number;
  gap: number;
  container: number;
  whole: boolean;
  rest: { lead: number; tail: number; head: number } | null;
}

const rowArb: fc.Arbitrary<Row> = fc.record({
  panels: fc.array(
    fc.record({
      slots: fc.integer({ min: 1, max: 3 }),
      hold: fc.oneof({ weight: 14, arbitrary: fc.constant('off' as const) }, { weight: 1, arbitrary: fc.constant('left' as const) }, { weight: 1, arbitrary: fc.constant('right' as const) }, { weight: 1, arbitrary: fc.constant('both' as const) }),
      pinned: fc.boolean(),
      parks: fc.boolean(),
      live: fc.integer({ min: 0, max: 5 }).map((n) => n > 0),
    }),
    { minLength: 2, maxLength: 9 },
  ),
  scroll: fc.integer({ min: 0, max: 9 }).map((n) => n > 0),
  first: fc.constantFrom('off' as const, 'left' as const, 'right' as const, 'both' as const),
  phone: fc.integer({ min: 300, max: 430 }),
  gap: fc.constantFrom(0, 8, 16, 24),
  container: fc.oneof({ weight: 1, arbitrary: fc.constant(0) }, { weight: 1, arbitrary: fc.integer({ min: 1, max: 420 }) }, { weight: 14, arbitrary: fc.integer({ min: 420, max: 1900 }) }),
  whole: fc.integer({ min: 0, max: 3 }).map((n) => n > 0),
  rest: fc.oneof({ weight: 3, arbitrary: fc.constant(null) }, { weight: 1, arbitrary: fc.record({ lead: fc.nat(2), tail: fc.nat(2), head: fc.nat(2) }) }),
});

// The first panel is the held one most often: a hold on any other panel is a case the model does not express.
function inputsOf(r: Row, distinct = r.panels.length) {
  const entries = r.panels.map((p, k) => {
    const entry = made(`p${k % distinct}`, { slots: p.slots, edgeHold: k === 0 ? r.first : p.hold, overflow: r.scroll && (k > 0 || p.parks || r.first !== 'off') ? 'scroll' : 'park', parkable: !p.pinned });
    return p.live || p.pinned ? entry : { ...entry, live: false };
  });
  return { entries, phoneWidth: r.phone, containerWidth: r.container, gap: r.gap, wholePanels: r.whole, rest: r.rest };
}

const kinds: Record<string, number> = {};
const seen = (k: string): void => { kinds[k] = (kinds[k] ?? 0) + 1; };

test('the adapter gives the numbers of the arithmetic it replaces, over random rows', () => {
  let rows = 0;
  fc.assert(
    fc.property(rowArb, (r) => {
      rows += 1;
      const input = inputsOf(r);
      assert.ok([r.phone, r.gap, r.container].every(Number.isInteger), 'whole-pixel inputs');
      const old = legacyRowNumbers(input);
      const now = computeRowNumbers(input);
      const viaModel = rowNumbersViaModel(input) !== null;
      seen(viaModel ? 'model' : 'fallback');
      if (viaModel) {
        seen(old.stuck.length > 0 ? 'model:both' : old.held.some((h) => h.side === 'right') ? 'model:right' : old.held.length > 0 ? 'model:held' : old.stops.length > 0 ? 'model:stepping' : 'model:other');
      } else {
        seen(r.container === 0 ? 'fallback:unmeasured' : old.stuck.length > 0 ? 'fallback:both' : old.held.some((h) => h.side === 'right') ? 'fallback:right' : r.rest !== null ? 'fallback:rest' : 'fallback:other');
      }
      assert.deepEqual(now, old);
    }),
    { seed: SEED, numRuns: Number(process.env.ROW_MODEL_RUNS ?? 1500) },
  );
  const thin = ['model:held', 'model:both', 'model:right', 'model:stepping', 'fallback:unmeasured', 'fallback:both', 'fallback:right', 'fallback:rest'].filter((k) => (kinds[k] ?? 0) < 20);
  assert.deepEqual(thin, [], `cases that ran fewer than 20 times: ${JSON.stringify(kinds)}`);
  assert.ok(rows >= Number(process.env.ROW_MODEL_RUNS ?? 1500), `ran ${rows} rows`);
  if (process.env.ROW_MODEL_COVERAGE !== undefined) console.log(JSON.stringify(kinds));
});

test('rows with repeated ids give the same numbers as the arithmetic they replace: a width is read by position, never by id', () => {
  const took: Record<string, number> = {};
  fc.assert(
    fc.property(rowArb, fc.integer({ min: 1, max: 3 }), (r, distinct) => {
      const input = inputsOf(r, distinct);
      const viaModel = rowNumbersViaModel(input) !== null;
      const dupes = new Set(input.entries.map((e) => e.id)).size < input.entries.length;
      if (viaModel && dupes) took.dupes = (took.dupes ?? 0) + 1;
      assert.deepEqual(computeRowNumbers(input), legacyRowNumbers(input));
    }),
    { seed: SEED, numRuns: Number(process.env.ROW_MODEL_RUNS ?? 1500) },
  );
  assert.ok((took.dupes ?? 0) >= 100, `rows with repeated ids that the model took: ${took.dupes ?? 0}`);
});

test('fractional pixels: the model and the older arithmetic agree to a micropixel on every number, away from the exact fit of the window', () => {
  let compared = 0;
  fc.assert(
    fc.property(rowArb, fc.double({ min: 0, max: 0.9, noNaN: true }), (r, frac) => {
      const input = { ...inputsOf(r), phoneWidth: r.phone + frac };
      const model = rowNumbersViaModel(input);
      if (model === null) return;
      const old = legacyRowNumbers(input);
      if (Math.abs(model.stripWidth - model.stripWindow) < 1e-6 || Math.abs(old.stripWidth - old.stripWindow) < 1e-6) return;
      const near = (a: unknown, b: unknown, path: string): void => {
        if (typeof a === 'number' && typeof b === 'number') assert.ok(Math.abs(a - b) < 1e-6, `${path}: ${a} against ${b}`);
        else if (Array.isArray(a) && Array.isArray(b)) {
          assert.equal(a.length, b.length, `${path} length`);
          a.forEach((x, k) => near(x, b[k], `${path}[${k}]`));
        } else if (a !== null && typeof a === 'object') for (const key of Object.keys(a)) near((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
        else assert.deepEqual(a, b, path);
      };
      near(model, old, 'numbers');
      compared += 1;
    }),
    { seed: SEED, numRuns: Number(process.env.ROW_MODEL_RUNS ?? 1500) },
  );
  assert.ok(compared >= 200, `rows compared: ${compared}`);
});

test('computeRowNumbers answers through the model: a stand-in for it is what comes back, and a row it declines goes to the older arithmetic', () => {
  const entries = [0, 1, 2, 3, 4, 5].map((k) => made(`p${k}`, { slots: 1, overflow: 'scroll', ...(k === 0 ? { edgeHold: 'both' as const } : {}) }));
  const input = { entries, phoneWidth: 390, containerWidth: 1000, gap: 16, wholePanels: true };
  const real = rowNumberSources.model;
  const marker = { ...legacyRowNumbers(input), endPad: -12345 };
  try {
    rowNumberSources.model = () => marker;
    assert.equal(computeRowNumbers(input), marker, 'the model answers first');
    rowNumberSources.model = () => null;
    assert.deepEqual(computeRowNumbers(input), legacyRowNumbers(input), 'a row the model declines gets the older arithmetic');
  } finally {
    rowNumberSources.model = real;
  }
  assert.notEqual(rowNumbersViaModel(input), null, 'control: this row is one the model takes');
});
