/**
 * Property tests over what a host hands back from disk or a patch: arbitrary JSON, and JSON built around the key names
 * that reach the prototype chain. Every property also checks that no run changed Object.prototype.
 * Reproduce a failure with FUZZ_SEED=<seed from the failure>; FUZZ_RUNS raises the run count.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { mergePatch, mergeTuningPatch, type SettingsPatch } from '../settingsPatch.js';
import { resolvePanelSettings, type PanelSettings } from '../panelSettings.js';
import { PanelManagerError } from '../panelManagerError.js';
import { reconcileWorkspace } from '../workspacePlan.js';
import { hydrateWorkspaceState, isWorkspaceState, projectWorkspaceState, type WorkspaceState } from '../workspaceState.js';

const SEED = Number(process.env.FUZZ_SEED ?? 20261126);
const RUNS = Number(process.env.FUZZ_RUNS ?? 300);
const params = { seed: SEED, numRuns: RUNS };

const HOSTILE_KEYS = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf'];
const protoNames = Object.getOwnPropertyNames(Object.prototype).sort();

/** Fails the property when a run added to or removed from Object.prototype, or planted a key on every object. */
function assertPrototypeIntact(): void {
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), protoNames);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(({} as Record<string, unknown>).isAdmin, undefined);
}

/** Rebuilds `value` through JSON text so a `__proto__` key is an own data property, as JSON.parse of a file makes it. */
const asParsed = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const keyArb = fc.oneof({ weight: 3, arbitrary: fc.constantFrom(...HOSTILE_KEYS) }, { weight: 2, arbitrary: fc.string({ maxLength: 8 }) });
const leafArb = fc.oneof(fc.constant(null), fc.boolean(), fc.double({ noNaN: true, noDefaultInfinity: true }), fc.integer(), fc.string({ maxLength: 12 }));
const POLLUTION = { polluted: true, isAdmin: true };

/** JSON of any shape whose object keys lean toward the prototype names, with a prototype-poisoning payload often on offer. */
const hostileJson: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  node: fc.oneof(
    { weight: 4, arbitrary: leafArb },
    { weight: 1, arbitrary: fc.constant(POLLUTION) },
    { weight: 2, arbitrary: fc.array(tie('node'), { maxLength: 3 }) },
    { weight: 3, arbitrary: fc.array(fc.tuple(keyArb, tie('node')), { maxLength: 4 }).map((pairs) => Object.fromEntries(pairs.map(([k, v]) => [k, v]))) },
  ),
})).node.map(asParsed);

/** Plain fast-check JSON, for breadth beyond the hostile shape. */
const anyJson = fc.json().map((s) => JSON.parse(s) as unknown);

const poisonedObject = fc.constantFrom(...HOSTILE_KEYS).map((k) => JSON.parse(`{"${k}":{"polluted":true,"isAdmin":true}}`) as unknown);

// ---------------------------------------------------------------------------------------------------------------------
// Workspace state
// ---------------------------------------------------------------------------------------------------------------------

const uidArb = fc.array(fc.constantFrom(...'0123456789abcdef'), { minLength: 32, maxLength: 32 }).map((c) => `u_${c.join('')}`);
const anchorArb = fc.record({ panel: fc.oneof(fc.constant('root'), keyArb, uidArb), position: fc.constantFrom('left', 'right'), priority: fc.integer({ min: -5, max: 5 }) });

/** A saved entry that passes the guard, with extra keys (hostile names among them) the guard says it accepts. */
const entryArb = fc
  .record(
    {
      view: fc.constantFrom('a', 'b', '__proto__', 'constructor'),
      live: fc.boolean(),
      anchor: anchorArb,
      uid: uidArb,
      url: fc.string({ maxLength: 6 }),
      title: fc.string({ maxLength: 6 }),
      key: keyArb,
      slots: fc.integer({ min: 1, max: 3 }),
      permanent: fc.boolean(),
      params: hostileJson,
      instance: hostileJson,
      overrides: hostileJson,
      applied: hostileJson,
      closable: fc.constantFrom(false, true, null),
      openedBy: keyArb,
      extra: hostileJson,
    },
    { requiredKeys: ['view', 'live', 'anchor'] },
  )
  .map(asParsed);

const stateArb: fc.Arbitrary<unknown> = fc
  .record(
    {
      version: fc.constant(1),
      panels: fc.array(entryArb, { maxLength: 5 }),
      dismissed: fc.oneof(fc.array(keyArb, { maxLength: 4 }), hostileJson),
      root: keyArb,
      rootSlots: fc.integer({ min: 1, max: 3 }),
      scroll: fc.oneof(fc.record({ panel: keyArb, offset: fc.integer({ min: -3, max: 3 }) }), hostileJson),
    },
    { requiredKeys: ['version', 'panels'] },
  )
  .map(asParsed);

/** A file that passes the guard except that some member of some entry is any JSON at all. */
const mangledStateArb: fc.Arbitrary<unknown> = fc
  .tuple(
    stateArb,
    fc.array(fc.tuple(fc.nat(), fc.constantFrom('view', 'live', 'anchor', 'anchor', 'anchor', 'slots', 'uid', 'title', 'url', 'layer', 'id', 'permanent', 'listed'), hostileJson), { minLength: 1, maxLength: 3 }),
  )
  .map(([state, edits]) => {
    const copy = asParsed(state) as { panels?: Record<string, unknown>[] };
    for (const [at, field, value] of edits) {
      const entry = Array.isArray(copy.panels) && copy.panels.length > 0 ? copy.panels[at % copy.panels.length] : undefined;
      if (entry !== undefined && entry !== null && typeof entry === 'object') entry[field] = value;
    }
    return asParsed(copy);
  });

const fileArb = fc.oneof({ weight: 3, arbitrary: stateArb }, { weight: 2, arbitrary: mangledStateArb }, { weight: 2, arbitrary: hostileJson }, { weight: 1, arbitrary: anyJson }, { weight: 1, arbitrary: poisonedObject });

/** Own `__proto__` or `constructor` keys anywhere in `value`, outside the members a file holds opaque for its host. */
function hostileKeyPaths(value: unknown, path = '', out: string[] = []): string[] {
  if (typeof value !== 'object' || value === null) return out;
  if (!Array.isArray(value)) {
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === '__proto__' || key === 'constructor') out.push(`${path}.${key}`);
    }
  }
  for (const key of Object.keys(value)) {
    if (key === 'params') continue;
    hostileKeyPaths((value as Record<string, unknown>)[key], `${path}.${key}`, out);
  }
  return out;
}

const counter = (): (() => string) => {
  let n = 0;
  return () => `p${++n}`;
};
const uidCounter = (): (() => string) => {
  let n = 0;
  return () => `u_${String(++n).padStart(32, '0')}`;
};

const reconcile = (saved: unknown) =>
  reconcileWorkspace({ saved, templates: [], declared: undefined, rootId: 'root', current: [], freshId: counter(), newUid: uidCounter() });

test('isWorkspaceState: any JSON in, a boolean out, never a throw', () => {
  fc.assert(
    fc.property(fileArb, (file) => {
      assert.equal(typeof isWorkspaceState(file), 'boolean');
      assertPrototypeIntact();
    }),
    params,
  );
});

test('generator control: the entry arbitrary reaches the accepting branch and the hostile keys', () => {
  let accepted = 0;
  let hostile = 0;
  fc.assert(
    fc.property(fileArb, (file) => {
      if (isWorkspaceState(file)) accepted += 1;
      if (JSON.stringify(file).includes('"__proto__"')) hostile += 1;
    }),
    { ...params, numRuns: 300 },
  );
  assert.ok(accepted > 30, `only ${accepted} of 300 files passed the guard`);
  assert.ok(hostile > 30, `only ${hostile} of 300 files held a __proto__ key`);
});

test('reconcileWorkspace: any saved file restores or is ignored, never throws, never leaves an own __proto__ or constructor key', () => {
  fc.assert(
    fc.property(fileArb, (file) => {
      const restored = reconcile(file);
      assert.deepEqual(hostileKeyPaths(restored), []);
      assertPrototypeIntact();
    }),
    params,
  );
});

test('reconcileWorkspace with a template and a declaration: a hostile file still restores without throwing or polluting', () => {
  fc.assert(
    fc.property(fileArb, (file) => {
      const restored = reconcileWorkspace({
        saved: file,
        templates: [{ id: 'a', settings: { closable: true } } as never],
        declared: [{ id: 'k', templateId: 'a' }],
        workspaceDefaults: {},
        rootId: 'root',
        current: [],
        freshId: counter(),
        newUid: uidCounter(),
      });
      assert.deepEqual(hostileKeyPaths(restored), []);
      assertPrototypeIntact();
    }),
    params,
  );
});

test('hydrateWorkspaceState: any file the guard accepts hydrates without throwing', () => {
  fc.assert(
    fc.property(stateArb, (file) => {
      fc.pre(isWorkspaceState(file));
      const panels = hydrateWorkspaceState(file as WorkspaceState, counter(), 'root');
      assert.deepEqual(hostileKeyPaths(panels), []);
      assertPrototypeIntact();
    }),
    params,
  );
});

const wellFormedArb = fc
  .array(
    fc.record(
      { view: fc.constantFrom('a', 'b'), live: fc.boolean(), anchor: anchorArb, slots: fc.integer({ min: 2, max: 3 }), title: fc.string({ maxLength: 6 }), permanent: fc.constant(true) },
      { requiredKeys: ['view', 'live', 'anchor'] },
    ),
    { maxLength: 5 },
  )
  .map((entries) => ({ version: 1, panels: entries.map((e, k) => ({ ...e, uid: `u_${String(k + 1).padStart(32, '0')}`, anchor: { ...e.anchor, panel: k === 0 || e.anchor.panel === 'root' ? 'root' : `u_${String(k).padStart(32, '0')}` } })) }) as unknown);

test('save then load is stable: projecting a hydrated file twice gives the same file', () => {
  fc.assert(
    fc.property(wellFormedArb, (file) => {
      assert.ok(isWorkspaceState(file));
      const once = projectWorkspaceState(hydrateWorkspaceState(file, counter(), 'root'), 'root');
      assert.equal(once.panels.length, (file as WorkspaceState).panels.length, 'control: every saved panel came back');
      const loaded = asParsed(once) as WorkspaceState;
      assert.ok(isWorkspaceState(loaded));
      const twice = projectWorkspaceState(hydrateWorkspaceState(loaded, counter(), 'root'), 'root');
      assert.deepEqual(asParsed(twice), loaded);
      assertPrototypeIntact();
    }),
    params,
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// Settings patches
// ---------------------------------------------------------------------------------------------------------------------

const KNOWN_KEYS = ['closable', 'parkable', 'movable', 'listed', 'slots', 'maxSlots', 'title', 'layer', 'sticky', 'edgeHold', 'headerButtons', 'placeOnAdd', 'enterFrom'];
const settingsKey = fc.oneof({ weight: 3, arbitrary: fc.constantFrom(...KNOWN_KEYS) }, { weight: 2, arbitrary: keyArb });
const layerLike: fc.Arbitrary<Record<string, unknown>> = fc
  .array(fc.tuple(settingsKey, fc.oneof(hostileJson, fc.boolean(), fc.integer({ min: 0, max: 4 }), fc.constantFrom('base', 'raised', 'start', 'end', 'off', 'left'), fc.constant(null), fc.constant(undefined))), { maxLength: 6 })
  .map((pairs) => Object.fromEntries(pairs.map(([k, v]) => [k, v])));
/** Layer objects built as JSON.parse makes them, with the hostile keys as own data properties. */
const hostileLayer: fc.Arbitrary<Record<string, unknown>> = layerLike.map((o) => {
  const parsed = asParsed(o) as Record<string, unknown>;
  return parsed;
});
const hostilePatch = fc.oneof(hostileLayer, layerLike, poisonedObject as fc.Arbitrary<Record<string, unknown>>);
const snapshot = (v: unknown): string => JSON.stringify(v, (_k, x) => (x === undefined ? '\u0000undefined' : x));

test('mergePatch: arbitrary patch on arbitrary layer never throws, never pollutes, never changes its inputs', () => {
  fc.assert(
    fc.property(hostileLayer, hostilePatch, (layer, patch) => {
      const before = [snapshot(layer), snapshot(patch)];
      const next = mergePatch(layer as PanelSettings, patch as SettingsPatch);
      assert.deepEqual([snapshot(layer), snapshot(patch)], before);
      assert.equal(Object.getPrototypeOf(next), Object.getPrototypeOf(layer));
      assertPrototypeIntact();
    }),
    params,
  );
});

test('mergePatch: an empty patch returns the very same layer', () => {
  fc.assert(
    fc.property(hostileLayer, (layer) => {
      assert.equal(mergePatch(layer as PanelSettings, {}), layer);
    }),
    params,
  );
});

test('mergePatch then lenient resolve: an arbitrary instance layer never throws and never pollutes', () => {
  fc.assert(
    fc.property(hostileLayer, hostilePatch, (layer, patch) => {
      const next = mergePatch(layer as PanelSettings, patch as SettingsPatch);
      const resolved = resolvePanelSettings({ instance: next }, { lenient: true });
      assert.ok(Object.isFrozen(resolved.value));
      assertPrototypeIntact();
    }),
    params,
  );
});

test('resolvePanelSettings: a strict resolve of arbitrary layers throws only PanelManagerError and never pollutes', () => {
  fc.assert(
    fc.property(hostileLayer, hostileLayer, hostileLayer, (workspace, template, instance) => {
      try {
        resolvePanelSettings({ workspace, template, instance } as never);
      } catch (error) {
        assert.ok(error instanceof PanelManagerError, `threw ${String(error)}`);
      }
      assertPrototypeIntact();
    }),
    params,
  );
});

/** Settings a strict resolve accepts, each value valid for its key. */
const validSetting: fc.Arbitrary<[string, unknown]> = fc.oneof(
  fc.tuple(fc.constantFrom('closable', 'parkable', 'movable', 'listed', 'resizable'), fc.boolean()),
  fc.tuple(fc.constant('slots'), fc.integer({ min: 1, max: 3 })),
  fc.tuple(fc.constant('title'), fc.string({ maxLength: 8 })),
  fc.tuple(fc.constant('layer'), fc.constantFrom('base', 'raised')),
  fc.tuple(fc.constant('sticky'), fc.constantFrom('off', 'start', 'end')),
  fc.tuple(fc.constant('edgeHold'), fc.constantFrom('off', 'left', 'right', 'both')),
  fc.tuple(fc.constant('scrollOnOpen'), fc.constantFrom('into-view', 'start', 'center', 'none')),
);
const validLayer = fc.array(validSetting, { maxLength: 5 }).map((pairs) => Object.fromEntries(pairs) as PanelSettings);
/** A patch of valid values, with `null` deleting a key. */
const validPatch = fc
  .array(fc.oneof(validSetting, fc.tuple(fc.constantFrom(...KNOWN_KEYS), fc.constant(null))), { maxLength: 5 })
  .map((pairs) => Object.fromEntries(pairs) as SettingsPatch);

test('mergePatch: a valid patch on a valid layer gives a layer the strict resolver still accepts', () => {
  fc.assert(
    fc.property(validLayer, validPatch, (layer, patch) => {
      resolvePanelSettings({ instance: layer });
      const next = mergePatch(layer, patch);
      resolvePanelSettings({ instance: next });
      assert.equal(mergePatch(next, patch), next, 'applying the same patch twice changes nothing more');
    }),
    params,
  );
});

test('mergeTuningPatch: arbitrary patch on arbitrary tuning never throws or pollutes, and an empty patch changes nothing', () => {
  fc.assert(
    fc.property(fc.option(hostileLayer, { nil: undefined }), hostilePatch, (current, patch) => {
      const before = snapshot(current);
      mergeTuningPatch(current as never, patch);
      assert.equal(snapshot(current), before);
      if (current !== undefined) assert.equal(mergeTuningPatch(current as never, {}), current);
      assertPrototypeIntact();
    }),
    params,
  );
});
