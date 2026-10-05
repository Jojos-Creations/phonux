/**
 * The one resolver: its enumerations and ranges, the cascade, derived defaults, the coupling rules, the user layer,
 * lenient reading of saved layers, pin definitions, scope and view-settable conflicts, and a seeded property run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PANEL_SETTINGS_CATALOG, PanelManagerError, mergePatch, resolvePanelSettings } from '../index.js';
import type { CatalogName, HeaderButton, PanelSettings, PanelSettingsLayers, PanelSettingsResolution, ResolveOptions, SettingConflict, SourceLayer } from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOURCE_WORDS: readonly SourceLayer[] = ['library', 'workspace', 'template', 'host', 'instance', 'user', 'derived', 'forced'];
const CATALOG_NAMES: ReadonlySet<string> = new Set(PANEL_SETTINGS_CATALOG.map((d) => d.name));
let shapesChecked = 0;

/** What every resolve output must look like, whatever the test is about. */
function assertShape(res: PanelSettingsResolution): void {
  for (const [key, word] of Object.entries(res.source)) {
    assert.ok(CATALOG_NAMES.has(key), `source key ${key} is not a catalog name`);
    assert.ok(SOURCE_WORDS.includes(word), `source of ${key} is ${String(word)}, not one of the eight words`);
  }
  for (const c of res.conflicts) {
    for (const field of ['key', 'layer', 'kind', 'asked', 'applied', 'message'] as const) assert.ok(field in c, `a conflict lacks ${field}`);
    assert.ok(CATALOG_NAMES.has(c.key), `conflict key ${c.key} is not a catalog name`);
    assert.ok(['template', 'host', 'instance'].includes(c.layer), `conflict layer ${c.layer}`);
    assert.ok(['forced', 'wrong-scope', 'not-view-settable'].includes(c.kind), `conflict kind ${c.kind}`);
    assert.ok(typeof c.message === 'string' && c.message.includes(c.key), 'the message names the key');
    if (c.kind === 'forced') {
      assert.ok(c.rule !== undefined && /^C[1-6]$/.test(c.rule), 'a forced conflict carries its rule');
      assert.ok(c.forcedBy === undefined || typeof c.forcedBy === 'string');
    } else {
      assert.equal(c.rule, undefined, 'only a forced conflict carries a rule');
      assert.equal(c.forcedBy, undefined, 'only a forced conflict carries forcedBy');
    }
  }
  for (const n of res.notes) assert.ok(typeof n.code === 'string' && n.code.length > 0 && typeof n.message === 'string' && n.message.length > 0);
  assert.ok(Object.isFrozen(res.value) && Object.isFrozen(res.value.tuning) && Object.isFrozen(res.value.headerButtons));
  shapesChecked += 1;
}

/** Every resolve in this file goes through here, so the shape of every output is checked and not only the ones a test reads. */
function resolve(layers: PanelSettingsLayers = {}, options: ResolveOptions = {}): PanelSettingsResolution {
  const res = resolvePanelSettings(layers, options);
  assertShape(res);
  return res;
}

/** The error a resolve must throw: invalid-settings naming the layer and the key. */
function refuses(layers: PanelSettingsLayers, layer: string, key: string | undefined, options: ResolveOptions = {}): PanelManagerError {
  try {
    resolvePanelSettings(layers, options);
  } catch (error) {
    assert.ok(error instanceof PanelManagerError, `expected a PanelManagerError, got ${String(error)}`);
    assert.equal(error.code, 'invalid-settings');
    assert.equal(error.layer, layer);
    assert.equal(error.key, key);
    return error;
  }
  return assert.fail(`expected invalid-settings at ${layer}.${String(key)}, but the resolve returned`);
}

const asSettings = (x: unknown): PanelSettings => x as PanelSettings;
const slot = (label: string, extra: Partial<HeaderButton> = {}): HeaderButton => ({ icon: 'i', label, onClick: () => undefined, ...extra });
const BOOL = [true, false] as const;
const WORDS = ['row-start', 'row-end', 'parkable-start', 'parkable-end', 'after-fixed', 'order'] as const;
const OBJECT_PLACEMENTS = [{ before: 'a' }, { after: 'a' }, { anchor: { panel: 'a', position: 'left' } }] as const;
const PLACEMENTS = [...WORDS, ...OBJECT_PLACEMENTS] as const;
const TIERS = ['phone', 'tablet', 'desktop'] as const;
const SUBSETS = [['phone'], ['tablet'], ['desktop'], ['phone', 'tablet'], ['phone', 'desktop'], ['tablet', 'desktop'], ['phone', 'tablet', 'desktop']] as const;

// ---------------------------------------------------------------------------
// Enumerations and probes
// ---------------------------------------------------------------------------

/** Every enumerated value of every single-valued setting, written by hand. */
const ENUMERATED: Record<string, readonly unknown[]> = {
  closable: BOOL,
  parkable: BOOL,
  draggable: BOOL,
  crossable: BOOL,
  placeable: BOOL,
  resizable: BOOL,
  clearable: BOOL,
  listed: BOOL,
  keepMounted: BOOL,
  animated: BOOL,
  rememberLayout: BOOL,
  reportClose: BOOL,
  hostCreatable: BOOL,
  multiple: BOOL,
  formFactors: SUBSETS,
  maxInstances: ['unlimited', 1, 2, 50],
  startVisibility: ['live', 'parked'],
  hideStickiness: ['sticky', 'until-room'],
  hideWhenLast: ['allow', 'refuse'],
  capacityReturn: ['auto', 'manual'],
  returnPriority: [-3, 0, 7],
  overflow: ['scroll', 'park'],
  evictionRank: [-2, 0, 5],
  evictionOrder: ['farthest', 'nearest', 'leftmost', 'rightmost'],
  revealOnScroll: ['edges', 'any', 'never'],
  scrollOnOpen: ['into-view', 'start', 'center', 'none'],
  scrollOnMove: ['follow', 'none'],
  scrollOnDrag: ['edge', 'none'],
  toggleWhenClosed: ['ignore', 'reopen'],
  showWhenClosed: ['refuse', 'reopen'],
  viewState: ['keep', 'reset-on-park'],
  placeOnAdd: PLACEMENTS,
  placeOnShow: ['in-place', ...PLACEMENTS],
  placeOnReturn: ['in-place', ...PLACEMENTS],
  placeFallback: ['row-start', 'row-end', 'parkable-start', 'parkable-end', 'after-fixed'],
  undoPlacement: ['old-slot', ...PLACEMENTS],
  layer: ['base', 'raised'],
  enterFrom: ['auto', 'left', 'right', 'anchor'],
  exitTo: ['auto', 'left', 'right'],
  closeExit: ['down', 'left', 'right'],
  formFactor: TIERS,
  persist: ['saved', 'session'],
  restoreVisibility: ['saved', 'live', 'parked'],
  afterClose: ['stay-closed', 'return-next-launch'],
  undoWindowMs: [0, 1, 10000],
  snapshot: ['both', 'park', 'close', 'never'],
  pinningWhenNotLive: ['place-only', 'refuse', 'show', 'apply-on-next-show', { parked: 'show' }, { hidden: 'refuse' }, { closed: 'apply-on-next-show' }, { parked: 'place-only', hidden: 'show', closed: 'refuse' }],
  title: ['', 'Notes'],
};

/** The names the enumeration table leaves to a test of their own. */
const ELSEWHERE: readonly CatalogName[] = ['headerButtons', 'pinning', 'tuning.rowGap', 'tuning.dragToClose', 'tuning.slide', 'tuning.hopFraction', 'tuning.edgeScroll', 'tuning.saveQuietMs', 'tuning.gestureLockMs', 'tuning.returnTieBreak', 'tuning.dropTieBreak', 'tuning.rowGesture', 'tuning.initialScroll'];

type Probe = readonly [what: string, layers: PanelSettingsLayers, layer: string, key: string | undefined];
const PROBES: readonly Probe[] = [
  ['boolean given a string', { template: asSettings({ closable: 'yes' }) }, 'template', 'closable'],
  ['boolean given null', { template: asSettings({ parkable: null }) }, 'template', 'parkable'],
  ['list given a string', { template: asSettings({ formFactors: 'phone' }) }, 'template', 'formFactors'],
  ['number given a string', { template: asSettings({ returnPriority: '1' }) }, 'template', 'returnPriority'],
  ['number given NaN', { template: asSettings({ returnPriority: Number.NaN }) }, 'template', 'returnPriority'],
  ['title given a number', { template: asSettings({ title: 5 }) }, 'template', 'title'],
  ['pinning given a string', { template: asSettings({ pinning: 'row-start' }) }, 'template', 'pinning'],
  ['unknown member of overflow', { template: asSettings({ overflow: 'wrap' }) }, 'template', 'overflow'],
  ['unknown tier', { template: asSettings({ formFactor: 'watch' }) }, 'template', 'formFactor'],
  ['unknown tier in formFactors', { template: asSettings({ formFactors: ['phone', 'watch'] }) }, 'template', 'formFactors'],
  ['empty formFactors', { template: asSettings({ formFactors: [] }) }, 'template', 'formFactors'],
  ['in-place in placeOnAdd', { template: asSettings({ placeOnAdd: 'in-place' }) }, 'template', 'placeOnAdd'],
  ['in-place in placeFallback', { template: asSettings({ placeFallback: 'in-place' }) }, 'template', 'placeFallback'],
  ['in-place in undoPlacement', { template: asSettings({ undoPlacement: 'in-place' }) }, 'template', 'undoPlacement'],
  ['a placement object with two keys', { template: asSettings({ placeOnAdd: { before: 'a', after: 'b' } }) }, 'template', 'placeOnAdd'],
  ['a placement before nobody', { template: asSettings({ placeOnAdd: { before: '' } }) }, 'template', 'placeOnAdd'],
  ['an anchor placement without its panel', { template: asSettings({ placeOnAdd: { anchor: { position: 'left' } } }) }, 'template', 'placeOnAdd'],
  ['fractional evictionRank', { template: asSettings({ evictionRank: 1.5 }) }, 'template', 'evictionRank'],
  ['fractional returnPriority', { template: asSettings({ returnPriority: 0.5 }) }, 'template', 'returnPriority'],
  ['fractional undoWindowMs', { template: asSettings({ undoWindowMs: 1.5 }) }, 'template', 'undoWindowMs'],
  ['negative undoWindowMs', { template: asSettings({ undoWindowMs: -1 }) }, 'template', 'undoWindowMs'],
  ['maxInstances zero', { template: asSettings({ maxInstances: 0 }) }, 'template', 'maxInstances'],
  ['maxInstances fractional', { template: asSettings({ maxInstances: 1.5 }) }, 'template', 'maxInstances'],
  ['maxInstances another word', { template: asSettings({ maxInstances: 'many' }) }, 'template', 'maxInstances'],
  ['unknown key at the template layer', { template: asSettings({ nope: 1 }) }, 'template', 'nope'],
  ['unknown key at the instance layer', { instance: asSettings({ nope: 1 }) }, 'instance', 'nope'],
  ['unknown key at the host layer', { host: asSettings({ nope: 1 }) }, 'host', 'nope'],
  ['unknown key at the workspace layer', { workspace: asSettings({ nope: 1 }) }, 'workspace', 'nope'],
  ["overflow 'maybe'", { template: asSettings({ overflow: 'maybe' }) }, 'template', 'overflow'],
  ["scrollOnOpen 'middle'", { template: asSettings({ scrollOnOpen: 'middle' }) }, 'template', 'scrollOnOpen'],
  ["scrollOnMove 'sometimes'", { template: asSettings({ scrollOnMove: 'sometimes' }) }, 'template', 'scrollOnMove'],
  ["scrollOnDrag 'always'", { template: asSettings({ scrollOnDrag: 'always' }) }, 'template', 'scrollOnDrag'],
  ['headerButtons given a number', { template: asSettings({ headerButtons: 5 }) }, 'template', 'headerButtons'],
  ['headerButtons given a list', { template: asSettings({ headerButtons: [slot('a')] }) }, 'template', 'headerButtons'],
  ['headerButtons holding a string for a slot', { template: asSettings({ headerButtons: { size: 'x' } }) }, 'template', 'headerButtons'],
  ['headerButtons holding true for a slot', { template: asSettings({ headerButtons: { size: true } }) }, 'template', 'headerButtons'],
  ["pinningWhenNotLive 'maybe'", { template: asSettings({ pinningWhenNotLive: 'maybe' }) }, 'template', 'pinningWhenNotLive'],
  ["pinningWhenNotLive closed: 'show'", { template: asSettings({ pinningWhenNotLive: { closed: 'show' } }) }, 'template', 'pinningWhenNotLive'],
  ['pinningWhenNotLive with an unknown status', { template: asSettings({ pinningWhenNotLive: { open: 'show' } }) }, 'template', 'pinningWhenNotLive'],
  ['tuning given a number', { instance: asSettings({ tuning: 5 }) }, 'instance', 'tuning'],
  ['an unknown tuning key', { instance: asSettings({ tuning: { wobble: 1 } }) }, 'instance', 'tuning.wobble'],
  ['an unknown tuning member', { instance: asSettings({ tuning: { dragToClose: { nope: 1 } } }) }, 'instance', 'tuning.dragToClose.nope'],
  ['a tuning leaf of the wrong type', { instance: asSettings({ tuning: { slide: 5 } }) }, 'instance', 'tuning.slide'],
  ["rowGesture 'swipe'", { instance: asSettings({ tuning: { rowGesture: 'swipe' } }) }, 'instance', 'tuning.rowGesture'],
  ["initialScroll 'middle'", { instance: asSettings({ tuning: { initialScroll: 'middle' } }) }, 'instance', 'tuning.initialScroll'],
  ["initialScroll { panel: '' }", { instance: asSettings({ tuning: { initialScroll: { panel: '' } } }) }, 'instance', 'tuning.initialScroll'],
  ['a template layer that is not an object', { template: 5 as unknown as PanelSettings }, 'template', undefined],
  ['an instance layer that is a list', { instance: [] as unknown as PanelSettings }, 'instance', undefined],
];

test('enumerations: the enumeration table and its companions cover every one of the 61 catalog names exactly once', () => {
  const covered = [...Object.keys(ENUMERATED), ...ELSEWHERE];
  assert.equal(new Set(covered).size, covered.length, 'a name is listed twice');
  assert.deepEqual([...covered].sort(), [...CATALOG_NAMES].sort());
});

test('enumerations: every enumerated value resolves to itself from the template layer, sourced template, and every probe throws invalid-settings naming layer and key', () => {
  let executed = 0;
  let valueCases = 0;
  for (const [key, values] of Object.entries(ENUMERATED)) {
    for (const value of values) {
      const res = resolve({ template: asSettings({ [key]: value }) });
      assert.deepEqual((res.value as unknown as Record<string, unknown>)[key], value, `${key} = ${JSON.stringify(value)}`);
      assert.equal(res.source[key], 'template', `${key} source`);
      assert.deepEqual(res.conflicts, [], `${key} = ${JSON.stringify(value)} records no conflict`);
      executed += 1;
      valueCases += 1;
    }
  }
  for (const [what, layers, layer, key] of PROBES) {
    refuses(layers, layer, key);
    assert.ok(what.length > 0);
    executed += 1;
  }
  const expected = Object.values(ENUMERATED).reduce((sum, values) => sum + values.length, 0) + PROBES.length;
  assert.equal(executed, expected);
  assert.equal(valueCases, expected - PROBES.length);
  assert.ok(valueCases >= 150 && PROBES.length >= 40, 'the tables are not empty');
});

test("enumerations: a probe's refusal names the layer and key in its message too, and a valid initialScroll { panel: 'x' } is accepted", () => {
  const error = refuses({ template: asSettings({ overflow: 'maybe' }) }, 'template', 'overflow');
  assert.match(error.message, /template\.overflow/);
  const ok = resolve({ instance: asSettings({ tuning: { initialScroll: { panel: 'x' } } }) });
  assert.deepEqual(ok.conflicts.map((c) => [c.key, c.kind, c.asked]), [['tuning.initialScroll', 'wrong-scope', { panel: 'x' }]]);
});

test('enumerations: the four workspace-only enumerated tuning leaves accept every member at the instance layer as a wrong-scope conflict that applies nothing', () => {
  const members: Record<string, readonly unknown[]> = {
    returnTieBreak: ['latest-first', 'earliest-first', 'row-order'],
    dropTieBreak: ['leftmost', 'rightmost'],
    rowGesture: ['step', 'free', 'off'],
    initialScroll: ['start', 'end', 'root', { panel: 'x' }],
  };
  let executed = 0;
  for (const [leaf, values] of Object.entries(members)) {
    for (const value of values) {
      const res = resolve({ instance: asSettings({ tuning: { [leaf]: value } }) });
      assert.equal(res.conflicts.length, 1);
      const [c] = res.conflicts as [SettingConflict];
      assert.deepEqual([c.key, c.layer, c.kind, c.asked], [`tuning.${leaf}`, 'instance', 'wrong-scope', value]);
      assert.equal(res.source[`tuning.${leaf}`], undefined, 'a workspace-only leaf has no source entry in a panel resolve');
      executed += 1;
    }
  }
  assert.equal(executed, 12);
});

test('enumerations: the per-panel tuning leaves resolve from the template layer, merged member by member over the library numbers', () => {
  const res = resolve({
    template: {
      tuning: { dragToClose: { distanceFraction: 0.5 }, slide: { durationSec: 1, ease: [0.1, 0, 0.9, 1] }, hopFraction: 0.75, edgeScroll: { zonePx: 60 } },
    },
  });
  assert.equal(res.value.tuning.dragToClose.distanceFraction, 0.5);
  assert.equal(res.value.tuning.dragToClose.minDistancePx, 80, 'a member not named keeps the library number');
  assert.deepEqual([...res.value.tuning.slide.ease], [0.1, 0, 0.9, 1]);
  assert.equal(res.value.tuning.slide.closeExitSeconds, 0.18);
  assert.equal(res.value.tuning.hopFraction, 0.75);
  assert.deepEqual({ ...res.value.tuning.edgeScroll }, { zonePx: 60, maxPxPerSec: 900, reducedStepMs: 500 });
  for (const leaf of ['dragToClose', 'slide', 'hopFraction', 'edgeScroll']) assert.equal(res.source[`tuning.${leaf}`], 'template', leaf);
});

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

type RangeRow = readonly [path: string, value: unknown, outcome: 'accept' | 'reject'];
const RANGES: readonly RangeRow[] = [
  ['rowGap', -1, 'reject'],
  ['rowGap', 0, 'accept'],
  ['rowGap', 200, 'accept'],
  ['rowGap', 201, 'reject'],
  ['rowGap', 0.5, 'reject'],
  ['dragToClose.distanceFraction', 0.04, 'reject'],
  ['dragToClose.distanceFraction', 0.05, 'accept'],
  ['dragToClose.distanceFraction', 1, 'accept'],
  ['dragToClose.distanceFraction', 1.01, 'reject'],
  ['dragToClose.minDistancePx', 7, 'reject'],
  ['dragToClose.minDistancePx', 8, 'accept'],
  ['dragToClose.flickMinDistancePx', 7, 'reject'],
  ['dragToClose.flickMinDistancePx', 8, 'accept'],
  ['dragToClose.flickVelocity', 99, 'reject'],
  ['dragToClose.flickVelocity', 100, 'accept'],
  ['dragToClose.cancelVelocity', 0, 'reject'],
  ['dragToClose.cancelVelocity', -49, 'reject'],
  ['dragToClose.cancelVelocity', -50, 'accept'],
  ['dragToClose.directionLockPx', 1, 'reject'],
  ['dragToClose.directionLockPx', 2, 'accept'],
  ['dragToClose.directionLockPx', 64, 'accept'],
  ['dragToClose.directionLockPx', 65, 'reject'],
  ['dragToClose.snapBack', { stiffness: 49, damping: 42 }, 'reject'],
  ['dragToClose.snapBack', { stiffness: 50, damping: 42 }, 'accept'],
  ['dragToClose.snapBack', { stiffness: 2000, damping: 42 }, 'accept'],
  ['dragToClose.snapBack', { stiffness: 2001, damping: 42 }, 'reject'],
  ['dragToClose.snapBack', { stiffness: 520, damping: 4 }, 'reject'],
  ['dragToClose.snapBack', { stiffness: 520, damping: 5 }, 'accept'],
  ['dragToClose.snapBack', { stiffness: 520, damping: 200 }, 'accept'],
  ['dragToClose.snapBack', { stiffness: 520, damping: 201 }, 'reject'],
  ['hopFraction', 0, 'reject'],
  ['hopFraction', 0.01, 'accept'],
  ['hopFraction', 1, 'accept'],
  ['hopFraction', 1.5, 'reject'],
  ['slide.durationSec', -0.1, 'reject'],
  ['slide.durationSec', 0, 'accept'],
  ['slide.durationSec', 10, 'accept'],
  ['slide.durationSec', 11, 'reject'],
  ['slide.closeExitSeconds', 5, 'accept'],
  ['slide.closeExitSeconds', 6, 'reject'],
  ['slide.closeExitSeconds', -1, 'reject'],
  ['slide.ease', [0.2, 0, 1], 'reject'],
  ['slide.ease', [-0.01, 0, 0.5, 1], 'reject'],
  ['slide.ease', [0, 0, 0.5, 1], 'accept'],
  ['slide.ease', [1, 0, 0.5, 1], 'accept'],
  ['slide.ease', [1.01, 0, 0.5, 1], 'reject'],
  ['slide.ease', [0.2, 0, -0.01, 1], 'reject'],
  ['slide.ease', [0.2, 0, 0, 1], 'accept'],
  ['slide.ease', [0.2, 0, 1, 1], 'accept'],
  ['slide.ease', [0.2, 0, 1.01, 1], 'reject'],
  ['slide.ease', [0.2, -5, 0.5, 5], 'accept'],
  ['saveQuietMs', -1, 'reject'],
  ['saveQuietMs', 0, 'accept'],
  ['gestureLockMs', -1, 'reject'],
  ['gestureLockMs', 0, 'accept'],
  ['edgeScroll.zonePx', 7, 'reject'],
  ['edgeScroll.zonePx', 8, 'accept'],
  ['edgeScroll.zonePx', 200, 'accept'],
  ['edgeScroll.zonePx', 201, 'reject'],
  ['edgeScroll.maxPxPerSec', 99, 'reject'],
  ['edgeScroll.maxPxPerSec', 100, 'accept'],
  ['edgeScroll.maxPxPerSec', 5000, 'accept'],
  ['edgeScroll.maxPxPerSec', 5001, 'reject'],
  ['edgeScroll.reducedStepMs', 99, 'reject'],
  ['edgeScroll.reducedStepMs', 100, 'accept'],
  ['edgeScroll.reducedStepMs', 5000, 'accept'],
  ['edgeScroll.reducedStepMs', 5001, 'reject'],
];

const WORKSPACE_ONLY_NUMBERS = ['rowGap', 'saveQuietMs', 'gestureLockMs'];

test('ranges: every (value, outcome) row is accepted or refused at the instance layer, and the executed rows equal the table length', () => {
  let executed = 0;
  for (const [path, value, outcome] of RANGES) {
    const [leaf = '', member] = path.split('.');
    const tuning = member === undefined ? { [leaf]: value } : { [leaf]: { [member]: value } };
    const layers: PanelSettingsLayers = { instance: asSettings({ tuning }) };
    const where = `${path} = ${JSON.stringify(value)}`;
    if (outcome === 'reject') {
      refuses(layers, 'instance', `tuning.${path}`);
    } else {
      const res = resolve(layers);
      if (WORKSPACE_ONLY_NUMBERS.includes(path)) {
        assert.deepEqual(res.conflicts.map((c) => [c.key, c.kind]), [[`tuning.${path}`, 'wrong-scope']], where);
      } else {
        assert.deepEqual(res.conflicts, [], where);
        const applied = member === undefined ? (res.value.tuning as unknown as Record<string, unknown>)[leaf] : ((res.value.tuning as unknown as Record<string, Record<string, unknown>>)[leaf] as Record<string, unknown>)[member];
        assert.deepEqual(applied, value, where);
        assert.equal(res.source[`tuning.${leaf}`], 'instance', where);
      }
    }
    executed += 1;
  }
  assert.equal(executed, RANGES.length);
  assert.equal(RANGES.length, 67);
});

test('ranges: a refusal of a tuning member names the dotted key, and the numbers of the library defaults are inside their own ranges', () => {
  refuses({ instance: asSettings({ tuning: { dragToClose: { cancelVelocity: 0 } } }) }, 'instance', 'tuning.dragToClose.cancelVelocity');
  refuses({ instance: asSettings({ tuning: { slide: { ease: [2, 0, 0, 1] } } }) }, 'instance', 'tuning.slide.ease');
  const defaults = resolve().value.tuning;
  const echoed = resolve({ instance: { tuning: { dragToClose: { ...defaults.dragToClose }, slide: { ...defaults.slide }, hopFraction: defaults.hopFraction, edgeScroll: { ...defaults.edgeScroll } } } });
  assert.deepEqual(echoed.value.tuning, defaults);
});
