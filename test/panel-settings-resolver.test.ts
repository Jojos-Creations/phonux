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

// ---------------------------------------------------------------------------
// The cascade
// ---------------------------------------------------------------------------

type CascadeRow = readonly [what: string, layers: PanelSettingsLayers, key: string, value: unknown, source: SourceLayer];
/** Eight rows, one per source word: the value asked at each layer and which layer wins. */
const CASCADE_ORDER: readonly CascadeRow[] = [
  ['no layer', {}, 'formFactor', 'phone', 'library'],
  ['workspace', { workspace: { formFactor: 'tablet' } }, 'formFactor', 'tablet', 'workspace'],
  ['template over workspace', { workspace: { formFactor: 'tablet' }, template: { formFactor: 'desktop' } }, 'formFactor', 'desktop', 'template'],
  ['host over template', { workspace: { formFactor: 'tablet' }, template: { formFactor: 'desktop' }, host: { formFactor: 'tablet' } }, 'formFactor', 'tablet', 'host'],
  ['instance over host', { workspace: { formFactor: 'tablet' }, template: { formFactor: 'desktop' }, host: { formFactor: 'tablet' }, instance: { formFactor: 'desktop' } }, 'formFactor', 'desktop', 'instance'],
  ['user over instance', { template: { formFactor: 'desktop' }, instance: { formFactor: 'desktop' }, user: { formFactor: 'tablet' } }, 'formFactor', 'tablet', 'user'],
  ['derived from parkable', { template: { parkable: false } }, 'listed', false, 'derived'],
  ['forced by a rule', { template: { parkable: false } }, 'resizable', false, 'forced'],
];

test('cascade: a table of eight, the value asked at each layer and its winner, names every source word once', () => {
  let executed = 0;
  for (const [what, layers, key, value, source] of CASCADE_ORDER) {
    const res = resolve(layers);
    assert.deepEqual((res.value as unknown as Record<string, unknown>)[key], value, what);
    assert.equal(res.source[key], source, what);
    executed += 1;
  }
  assert.equal(executed, 8);
  assert.deepEqual(CASCADE_ORDER.map((row) => row[4]).sort(), [...SOURCE_WORDS].sort());
});

test('cascade: a later layer wins at every pair of layers, whichever way the values are ordered', () => {
  const order = ['workspace', 'template', 'host', 'instance'] as const;
  let executed = 0;
  for (let low = 0; low < order.length; low += 1) {
    for (let high = low + 1; high < order.length; high += 1) {
      for (const [first, second] of [['tablet', 'desktop'], ['desktop', 'tablet']] as const) {
        const lowLayer = order[low] as (typeof order)[number];
        const highLayer = order[high] as (typeof order)[number];
        const res = resolve({ [lowLayer]: { formFactor: first }, [highLayer]: { formFactor: second } });
        assert.equal(res.value.formFactor, second, `${highLayer} over ${lowLayer}`);
        assert.equal(res.source.formFactor, highLayer);
        executed += 1;
      }
    }
  }
  assert.equal(executed, 12);
});

test('cascade: undefined never overrides, at any layer', () => {
  const kept = resolve({ template: { closable: false }, instance: asSettings({ closable: undefined }) });
  assert.equal(kept.value.closable, false);
  assert.equal(kept.source.closable, 'template');
  const library = resolve({ template: asSettings({ closable: undefined }) });
  assert.equal(library.value.closable, true);
  assert.equal(library.source.closable, 'library');
  const tuned = resolve({ template: { tuning: { hopFraction: 0.7 } }, instance: asSettings({ tuning: { hopFraction: undefined } }) });
  assert.equal(tuned.value.tuning.hopFraction, 0.7);
});

test('cascade: placeOnAdd, placeOnShow, placeOnReturn, undoPlacement, formFactors, pinning and pinningWhenNotLive are replaced whole', () => {
  const rows: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ['placeOnAdd', { before: 'a' }, { after: 'b' }],
    ['placeOnShow', { before: 'a' }, { anchor: { panel: 'b', position: 'right' } }],
    ['placeOnReturn', 'row-end', { after: 'c' }],
    ['undoPlacement', 'old-slot', { before: 'a' }],
    ['formFactors', ['tablet', 'desktop'], ['phone']],
    ['pinning', { pinned: { placement: 'row-start', parkable: true }, unpinned: { placement: 'row-end', parkable: false } }, { pinned: { placement: 'row-start' }, unpinned: { placement: 'after-fixed' } }],
    ['pinningWhenNotLive', { parked: 'show', hidden: 'refuse' }, { closed: 'refuse' }],
  ];
  for (const [key, lower, higher] of rows) {
    const res = resolve({ template: asSettings({ [key]: lower }), instance: asSettings({ [key]: higher }) });
    assert.deepEqual((res.value as unknown as Record<string, unknown>)[key], higher, key);
    assert.equal(res.source[key], 'instance', key);
    const alone = resolve({ template: asSettings({ [key]: lower }) });
    assert.deepEqual((alone.value as unknown as Record<string, unknown>)[key], lower, `${key}: the lower layer alone`);
  }
  assert.equal(rows.length, 7);
});

test('cascade: tuning merges per leaf and per member, and the source names the winner of each leaf', () => {
  const res = resolve({
    template: { tuning: { dragToClose: { distanceFraction: 0.3 }, slide: { durationSec: 0.5 }, hopFraction: 0.6 } },
    instance: { tuning: { dragToClose: { minDistancePx: 100 }, edgeScroll: { zonePx: 40 } } },
  });
  assert.deepEqual({ ...res.value.tuning.dragToClose }, { distanceFraction: 0.3, minDistancePx: 100, flickMinDistancePx: 40, flickVelocity: 700, cancelVelocity: -300, directionLockPx: 8, snapBack: { stiffness: 520, damping: 42 } });
  assert.equal(res.value.tuning.slide.durationSec, 0.5);
  assert.equal(res.value.tuning.hopFraction, 0.6);
  assert.equal(res.value.tuning.edgeScroll.zonePx, 40);
  assert.deepEqual([res.source['tuning.dragToClose'], res.source['tuning.slide'], res.source['tuning.hopFraction'], res.source['tuning.edgeScroll']], ['instance', 'template', 'template', 'instance']);
});

test('cascade: headerButtons merges per slot id; an instance false removes only that id; a later slot replaces the earlier whole', () => {
  const size = slot('Size', { side: 'start', order: 3 });
  const pin = slot('Pin');
  const both = resolve({ template: { headerButtons: { size } }, instance: { headerButtons: { pin } } });
  assert.deepEqual(Object.keys(both.value.headerButtons).sort(), ['pin', 'size']);
  assert.equal(both.value.headerButtons.size?.label, 'Size');
  assert.equal(both.value.headerButtons.pin?.label, 'Pin');
  assert.equal(both.source.headerButtons, 'instance');

  const removed = resolve({ template: { headerButtons: { size, pin } }, instance: { headerButtons: { pin: false } } });
  assert.deepEqual(Object.keys(removed.value.headerButtons), ['size']);

  const replaced = resolve({ template: { headerButtons: { size } }, instance: { headerButtons: { size: slot('Resize') } } });
  assert.equal(replaced.value.headerButtons.size?.label, 'Resize');
  assert.equal(replaced.value.headerButtons.size?.side, undefined, 'the earlier slot is replaced whole, not merged field by field');
  assert.equal(replaced.value.headerButtons.size?.order, undefined);

  const untouched = resolve({ template: { headerButtons: { size } }, instance: { headerButtons: {} } });
  assert.equal(untouched.source.headerButtons, 'template', 'an empty map names no winner');
  assert.equal(resolve().source.headerButtons, 'library');
  assert.ok(Object.isFrozen(both.value.headerButtons.size), 'a resolved slot is frozen');
});

test('cascade: the source map names the winner of each key, from every layer at once', () => {
  const res = resolve({
    workspace: { animated: false },
    template: { layer: 'raised', closable: false },
    host: { title: 'From the view' },
    instance: { closable: true, evictionRank: 4 },
    user: { formFactor: 'tablet' },
  });
  assert.deepEqual(
    [res.source.animated, res.source.layer, res.source.title, res.source.closable, res.source.evictionRank, res.source.formFactor, res.source.overflow],
    ['workspace', 'template', 'host', 'instance', 'instance', 'user', 'library'],
  );
});

test('cascade: instance wins over host, and null in a patch restores the host ask, then the template, then the library', () => {
  const host = { title: 'From the view' };
  const instance = { title: 'Mine' };
  const both = resolve({ host, instance });
  assert.equal(both.value.title, 'Mine');
  assert.equal(both.source.title, 'instance');
  const cleared = mergePatch(instance, { title: null });
  const restored = resolve({ host, instance: cleared });
  assert.equal(restored.value.title, 'From the view');
  assert.equal(restored.source.title, 'host');
  const next = resolve({ template: { title: 'Template' }, instance: cleared });
  assert.equal(next.value.title, 'Template');
  assert.equal(next.source.title, 'template');
  const bottom = resolve({ instance: cleared });
  assert.equal(bottom.value.title, undefined);
  assert.equal('title' in bottom.source, false, 'a title nobody set has no source');
});

test('cascade: a tuning key in the workspace defaults throws; the three template-scope keys are accepted there and in a template', () => {
  refuses({ workspace: asSettings({ tuning: { rowGap: 8 } }) }, 'workspace', 'tuning');
  refuses({ workspace: asSettings({ tuning: { hopFraction: 0.5 } }) }, 'workspace', 'tuning', { lenient: true });
  const asked = { hostCreatable: false, multiple: true, maxInstances: 3 } as const;
  for (const layer of ['workspace', 'template'] as const) {
    const res = resolve({ [layer]: asked });
    assert.deepEqual([res.value.hostCreatable, res.value.multiple, res.value.maxInstances], [false, true, 3], layer);
    assert.deepEqual([res.source.hostCreatable, res.source.multiple, res.source.maxInstances], [layer, layer, layer]);
    assert.deepEqual(res.conflicts, [], layer);
  }
});

// ---------------------------------------------------------------------------
// Derived defaults and the coupling rules
// ---------------------------------------------------------------------------

const DERIVED = ['draggable', 'placeable', 'listed', 'clearable'] as const;
const valueOf = (res: PanelSettingsResolution, key: string): unknown => (res.value as unknown as Record<string, unknown>)[key];

test('derived defaults: draggable, placeable, listed and clearable follow parkable (and closable for clearable), sourced derived', () => {
  const normal = resolve();
  for (const key of DERIVED) {
    assert.equal(valueOf(normal, key), true, key);
    assert.equal(normal.source[key], 'derived', key);
  }
  const fixed = resolve({ template: { parkable: false } });
  for (const key of DERIVED) {
    assert.equal(valueOf(fixed, key), false, key);
    assert.equal(fixed.source[key], 'derived', key);
  }
  const notClosable = resolve({ template: { closable: false } });
  assert.equal(notClosable.value.clearable, false);
  assert.equal(notClosable.source.clearable, 'derived');
  assert.equal(notClosable.value.draggable, true, 'only clearable follows closable');
  assert.deepEqual(notClosable.conflicts, []);
});

test('derived defaults: a derived default is overridable at every layer and the override is never a conflict', () => {
  for (const layer of ['workspace', 'template', 'instance'] as const) {
    const res = resolve({ template: { parkable: false }, [layer]: { draggable: true, placeable: true, listed: true, clearable: true } });
    for (const key of DERIVED) assert.equal(valueOf(res, key), true, `${layer}.${key}`);
    assert.deepEqual(res.conflicts, [], layer);
  }
  const off = resolve({ instance: { listed: false, draggable: false } });
  assert.deepEqual([off.value.listed, off.value.draggable, off.source.listed, off.source.draggable], [false, false, 'instance', 'instance']);
});

type ForcedRow = readonly [key: string, asked: unknown, applied: unknown];
const C1_ROWS: readonly ForcedRow[] = [
  ['resizable', true, false],
  ['formFactors', ['tablet', 'desktop'], ['phone']],
  ['formFactor', 'tablet', 'phone'],
  ['overflow', 'park', 'scroll'],
  ['startVisibility', 'parked', 'live'],
  ['restoreVisibility', 'parked', 'live'],
  ['keepMounted', true, false],
];

test('C1: a fixed column forces resizable, formFactors, formFactor, overflow, startVisibility, restoreVisibility and keepMounted, one conflict per ask', () => {
  for (const layer of ['template', 'instance'] as const) {
    for (const [key, asked, applied] of C1_ROWS) {
      const layers: PanelSettingsLayers = layer === 'template' ? { template: asSettings({ parkable: false, [key]: asked }) } : { template: { parkable: false }, instance: asSettings({ [key]: asked }) };
      const res = resolve(layers);
      assert.deepEqual(valueOf(res, key), applied, `${layer}.${key}`);
      assert.equal(res.source[key], 'forced', `${layer}.${key}`);
      assert.equal(res.conflicts.length, 1, `${layer}.${key}`);
      const [c] = res.conflicts as [SettingConflict];
      assert.deepEqual({ key: c.key, layer: c.layer, kind: c.kind, asked: c.asked, applied: c.applied, rule: c.rule, forcedBy: c.forcedBy }, { key, layer, kind: 'forced', asked, applied, rule: 'C1', forcedBy: 'parkable' });
    }
  }
});

test('C1: without the trigger the same asks stand, and a library or workspace collision with the rule is silent', () => {
  for (const parkable of [true, undefined]) {
    for (const [key, asked] of C1_ROWS) {
      const res = resolve({ template: asSettings({ parkable, [key]: asked }) });
      assert.deepEqual(valueOf(res, key), asked, key);
      assert.deepEqual(res.conflicts, [], key);
    }
  }
  const silent = resolve({ template: { parkable: false } });
  assert.deepEqual(silent.conflicts, []);
  assert.deepEqual([silent.value.resizable, silent.value.formFactors, silent.value.formFactor, silent.value.overflow, silent.value.startVisibility, silent.value.restoreVisibility, silent.value.keepMounted], [false, ['phone'], 'phone', 'scroll', 'live', 'live', false]);
  assert.deepEqual([silent.source.resizable, silent.source.formFactors, silent.source.restoreVisibility], ['forced', 'forced', 'forced'], 'a value the library gave is forced without a conflict');
  const workspaceAsk = resolve({ workspace: { overflow: 'park', keepMounted: true }, template: { parkable: false } });
  assert.deepEqual([workspaceAsk.value.overflow, workspaceAsk.value.keepMounted, workspaceAsk.conflicts], ['scroll', false, []]);
  const equalAsk = resolve({ template: { parkable: false, overflow: 'scroll', resizable: false } });
  assert.deepEqual(equalAsk.conflicts, []);
  assert.equal(equalAsk.source.overflow, 'template', 'asking what the rule gives is not a collision');
});

test('C1: every key a layer asked otherwise is listed, each at the layer that asked, host included', () => {
  const res = resolve({
    template: { parkable: false, overflow: 'park', keepMounted: true },
    host: { formFactor: 'desktop' },
    instance: { resizable: true, startVisibility: 'parked', restoreVisibility: 'parked', formFactors: ['desktop'] },
  });
  assert.deepEqual(
    res.conflicts.map((c) => `${c.layer}:${c.key}`).sort(),
    ['host:formFactor', 'instance:formFactors', 'instance:resizable', 'instance:restoreVisibility', 'instance:startVisibility', 'template:keepMounted', 'template:overflow'],
  );
  assert.ok(res.conflicts.every((c) => c.kind === 'forced' && c.rule === 'C1' && c.forcedBy === 'parkable'));
});

test('C2: closable false forces clearable false, naming closable, and only when clearable was asked true', () => {
  const asked = resolve({ template: { closable: false, clearable: true } });
  assert.equal(asked.value.clearable, false);
  assert.deepEqual(asked.conflicts.map((c) => [c.key, c.rule, c.forcedBy, c.asked, c.applied]), [['clearable', 'C2', 'closable', true, false]]);
  assert.deepEqual(resolve({ template: { closable: false, clearable: false } }).conflicts, []);
  assert.deepEqual(resolve({ template: { closable: true, clearable: true } }).conflicts, []);
  assert.equal(resolve({ template: { closable: true, clearable: true } }).value.clearable, true);
});

test('C3: a session panel forces rememberLayout false and afterClose return-next-launch, naming persist', () => {
  const asked = resolve({ template: { persist: 'session', rememberLayout: true, afterClose: 'stay-closed' } });
  assert.deepEqual([asked.value.rememberLayout, asked.value.afterClose], [false, 'return-next-launch']);
  assert.deepEqual(asked.conflicts.map((c) => [c.key, c.rule, c.forcedBy]).sort(), [['afterClose', 'C3', 'persist'], ['rememberLayout', 'C3', 'persist']]);
  const bare = resolve({ template: { persist: 'session' } });
  assert.deepEqual([bare.value.rememberLayout, bare.value.afterClose, bare.conflicts], [false, 'return-next-launch', []]);
  const saved = resolve({ template: { persist: 'saved', rememberLayout: true, afterClose: 'stay-closed' } });
  assert.deepEqual([saved.value.rememberLayout, saved.value.afterClose, saved.conflicts], [true, 'stay-closed', []]);
});

test('C4: a formFactor outside formFactors becomes the first allowed tier; one inside stands', () => {
  const asked = resolve({ template: { formFactors: ['tablet', 'desktop'], formFactor: 'phone' } });
  assert.equal(asked.value.formFactor, 'tablet');
  assert.deepEqual(asked.conflicts.map((c) => [c.key, c.rule, c.forcedBy, c.asked, c.applied]), [['formFactor', 'C4', 'formFactors', 'phone', 'tablet']]);
  const library = resolve({ template: { formFactors: ['desktop'] } });
  assert.deepEqual([library.value.formFactor, library.source.formFactor, library.conflicts], ['desktop', 'forced', []]);
  const inside = resolve({ template: { formFactors: ['phone', 'tablet'], formFactor: 'tablet' } });
  assert.deepEqual([inside.value.formFactor, inside.source.formFactor, inside.conflicts], ['tablet', 'template', []]);
});

test('C5: the root is never closable, parkable, clearable, draggable or placeable, and a layer that asked otherwise has a conflict without forcedBy', () => {
  const bare = resolve({}, { root: true });
  assert.deepEqual([bare.value.closable, bare.value.parkable, bare.value.clearable, bare.value.draggable, bare.value.placeable, bare.value.listed], [false, false, false, false, false, false]);
  assert.deepEqual(bare.conflicts, [], 'a library collision is silent');
  assert.deepEqual([bare.source.closable, bare.source.parkable, bare.source.draggable], ['forced', 'forced', 'derived'], 'draggable was already false from the fixed column, so nothing was forced');
  const asked = resolve({ template: { closable: true, parkable: true, draggable: true, placeable: true } }, { root: true });
  assert.deepEqual(asked.conflicts.map((c) => c.key).sort(), ['closable', 'draggable', 'parkable', 'placeable']);
  for (const c of asked.conflicts) {
    assert.equal(c.rule, 'C5', c.key);
    assert.equal('forcedBy' in c, false, `${c.key} has no forcedBy`);
    assert.equal(c.kind, 'forced');
    assert.equal(c.applied, false);
  }
  const notRoot = resolve({ template: { closable: true, parkable: true, draggable: true, placeable: true } });
  assert.deepEqual(notRoot.conflicts, []);
  assert.deepEqual([notRoot.value.closable, notRoot.value.draggable], [true, true]);
});

test('C5 feeds C1 and C2 for the root: a root asking overflow park or clearable true is also forced, naming parkable and closable', () => {
  const res = resolve({ template: { overflow: 'park', clearable: true } }, { root: true });
  assert.deepEqual(res.conflicts.map((c) => [c.key, c.rule, c.forcedBy]).sort(), [['clearable', 'C2', 'closable'], ['overflow', 'C1', 'parkable']]);
  assert.deepEqual([res.value.overflow, res.value.clearable, res.value.resizable, res.value.formFactor], ['scroll', false, false, 'phone']);
});

test('C6: reset-on-park forces keepMounted false with one conflict naming both keys; keep leaves keepMounted alone', () => {
  const res = resolve({ template: { viewState: 'reset-on-park', keepMounted: true } });
  assert.equal(res.value.keepMounted, false);
  assert.equal(res.conflicts.length, 1);
  const [c] = res.conflicts as [SettingConflict];
  assert.deepEqual([c.key, c.rule, c.forcedBy, c.asked, c.applied], ['keepMounted', 'C6', 'viewState', true, false]);
  assert.ok(c.message.includes('keepMounted') && c.message.includes('viewState'), 'the message names both keys');
  const keep = resolve({ template: { viewState: 'keep', keepMounted: true } });
  assert.deepEqual([keep.value.keepMounted, keep.conflicts], [true, []]);
  const library = resolve({ template: { viewState: 'reset-on-park' } });
  assert.deepEqual([library.value.keepMounted, library.conflicts], [false, []]);
});

test('C1 and C6 together record one conflict for keepMounted: the first rule makes the value and the second finds nothing to change', () => {
  const res = resolve({ template: { parkable: false, viewState: 'reset-on-park', keepMounted: true } });
  assert.deepEqual(res.conflicts.map((c) => [c.key, c.rule]), [['keepMounted', 'C1']]);
});

test('conflicts: one per kind of rule, each carrying key, layer, kind, asked, applied and message, plus rule and forcedBy when forced', () => {
  type Row = readonly [rule: string, layers: PanelSettingsLayers, options: ResolveOptions, key: string, forcedBy: string | undefined];
  const rows: readonly Row[] = [
    ['C1', { template: { parkable: false, overflow: 'park' } }, {}, 'overflow', 'parkable'],
    ['C2', { template: { closable: false, clearable: true } }, {}, 'clearable', 'closable'],
    ['C3', { template: { persist: 'session', rememberLayout: true } }, {}, 'rememberLayout', 'persist'],
    ['C4', { template: { formFactors: ['tablet'], formFactor: 'phone' } }, {}, 'formFactor', 'formFactors'],
    ['C5', { template: { closable: true } }, { root: true }, 'closable', undefined],
    ['C6', { template: { viewState: 'reset-on-park', keepMounted: true } }, {}, 'keepMounted', 'viewState'],
  ];
  for (const [rule, layers, options, key, forcedBy] of rows) {
    const res = resolve(layers, options);
    assert.equal(res.conflicts.length, 1, rule);
    const [c] = res.conflicts as [SettingConflict];
    assert.deepEqual([c.key, c.layer, c.kind, c.rule, c.forcedBy], [key, 'template', 'forced', rule, forcedBy], rule);
    assert.equal('forcedBy' in c, forcedBy !== undefined, `${rule}: forcedBy is present only when a key forces it`);
    assert.ok(c.asked !== c.applied && typeof c.message === 'string' && c.message.length > 0, rule);
  }
  assert.equal(rows.length, 6);
});

test('park levers: a lever on a panel whose overflow resolves to scroll yields park-lever-inert once per key, and none when overflow is park', () => {
  for (const [key, value] of [['capacityReturn', 'manual'], ['returnPriority', 3], ['evictionRank', 2], ['evictionOrder', 'nearest']] as const) {
    const res = resolve({ template: asSettings({ [key]: value }) });
    assert.deepEqual(res.notes.map((n) => [n.code, n.key]), [['park-lever-inert', key]], key);
    const parked = resolve({ template: asSettings({ [key]: value, overflow: 'park' }) });
    assert.deepEqual(parked.notes, [], `${key} with overflow park`);
  }
  const all = resolve({ template: { capacityReturn: 'manual', returnPriority: 3, evictionRank: 2, evictionOrder: 'nearest' } });
  assert.deepEqual(all.notes.map((n) => n.key).sort(), ['capacityReturn', 'evictionOrder', 'evictionRank', 'returnPriority']);
  assert.deepEqual(resolve().notes, [], 'a library lever is not a note');
  const forcedScroll = resolve({ template: { parkable: false, overflow: 'park', evictionRank: 1 } });
  assert.deepEqual(forcedScroll.notes.map((n) => n.code), ['park-lever-inert'], 'overflow forced to scroll by C1 makes the lever inert');
});

// ---------------------------------------------------------------------------
// Scope: not-view-settable and wrong-scope
// ---------------------------------------------------------------------------

test('host layer: closable false, keepMounted true, headerButtons, overflow and pinning are not-view-settable and change nothing', () => {
  const res = resolve({
    host: asSettings({ closable: false, keepMounted: true, headerButtons: { size: slot('Size') }, overflow: 'park', pinning: { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } } }),
  });
  assert.deepEqual(res.conflicts.map((c) => [c.key, c.layer, c.kind]).sort(), [
    ['closable', 'host', 'not-view-settable'],
    ['headerButtons', 'host', 'not-view-settable'],
    ['keepMounted', 'host', 'not-view-settable'],
    ['overflow', 'host', 'not-view-settable'],
    ['pinning', 'host', 'not-view-settable'],
  ]);
  assert.deepEqual([res.value.closable, res.value.keepMounted, res.value.overflow, res.value.headerButtons, res.source.closable, res.source.overflow], [true, false, 'scroll', {}, 'library', 'library']);
  const closable = res.conflicts.find((c) => c.key === 'closable') as SettingConflict;
  assert.deepEqual([closable.asked, closable.applied], [false, true]);
});

test('host layer: the keys a view may set are accepted: title, listed, layer, formFactor, placeOnAdd with an anchor and enterFrom anchor', () => {
  const host = { title: 'Mine', listed: false, layer: 'raised', formFactor: 'tablet', placeOnAdd: { anchor: { panel: 'p', position: 'left' } }, enterFrom: 'anchor' } as const;
  const res = resolve({ host });
  assert.deepEqual(res.conflicts, []);
  assert.deepEqual([res.value.title, res.value.listed, res.value.layer, res.value.formFactor, res.value.placeOnAdd, res.value.enterFrom], ['Mine', false, 'raised', 'tablet', { anchor: { panel: 'p', position: 'left' } }, 'anchor']);
  for (const key of Object.keys(host)) assert.equal(res.source[key], 'host', key);
});

test("host layer: placeOnAdd without an anchor and an enterFrom other than 'anchor' are not-view-settable", () => {
  for (const host of [{ placeOnAdd: 'row-end' }, { placeOnAdd: { before: 'a' } }, { enterFrom: 'left' }, { enterFrom: 'auto' }]) {
    const res = resolve({ host: asSettings(host) });
    assert.deepEqual(res.conflicts.map((c) => [c.kind, c.layer]), [['not-view-settable', 'host']], JSON.stringify(host));
    assert.deepEqual([res.value.placeOnAdd, res.value.enterFrom], ['row-end', 'auto'], 'the ask changed nothing');
  }
});

test('host layer: a per-panel tuning leaf is not-view-settable too', () => {
  const res = resolve({ host: { tuning: { hopFraction: 0.7 } } });
  assert.deepEqual(res.conflicts.map((c) => [c.key, c.kind, c.asked, c.applied]), [['tuning.hopFraction', 'not-view-settable', 0.7, 0.5]]);
  assert.equal(res.value.tuning.hopFraction, 0.5);
});

test('scope: template keys at the instance or host layer are wrong-scope and apply nothing, template and workspace asks standing', () => {
  const asks = { hostCreatable: false, multiple: true, maxInstances: 3 } as const;
  let executed = 0;
  for (const layer of ['instance', 'host'] as const) {
    for (const [key, asked] of Object.entries(asks)) {
      const res = resolve({ template: { multiple: false }, [layer]: asSettings({ [key]: asked }) });
      assert.deepEqual(res.conflicts.map((c) => [c.key, c.layer, c.kind, c.asked]), [[key, layer, 'wrong-scope', asked]], `${layer}.${key}`);
      assert.deepEqual([res.value.hostCreatable, res.value.multiple, res.value.maxInstances], [true, false, 'unlimited']);
      executed += 1;
    }
  }
  assert.equal(executed, 6);
  const applied = resolve({ template: { multiple: true }, instance: { multiple: false } }).conflicts[0] as SettingConflict;
  assert.equal(applied.applied, true, 'the conflict reports the value that stands');
});

const WORKSPACE_ONLY_ASKS: ReadonlyArray<readonly [leaf: string, value: unknown]> = [
  ['rowGap', 8],
  ['saveQuietMs', 100],
  ['gestureLockMs', 100],
  ['returnTieBreak', 'row-order'],
  ['dropTieBreak', 'rightmost'],
  ['rowGesture', 'free'],
  ['initialScroll', 'end'],
];

test('scope: the seven workspace-only tuning keys are wrong-scope at the instance or host layer and throw at the template layer', () => {
  let executed = 0;
  for (const [leaf, value] of WORKSPACE_ONLY_ASKS) {
    const tuning = { [leaf]: value };
    for (const layer of ['instance', 'host'] as const) {
      const res = resolve({ [layer]: asSettings({ tuning }) });
      assert.deepEqual(res.conflicts.map((c) => [c.key, c.layer, c.kind, c.asked]), [[`tuning.${leaf}`, layer, 'wrong-scope', value]], `${layer}.${leaf}`);
      executed += 1;
    }
    refuses({ template: asSettings({ tuning }) }, 'template', `tuning.${leaf}`);
    executed += 1;
  }
  assert.equal(executed, 21);
  assert.equal(WORKSPACE_ONLY_ASKS.length, 7);
});

test('scope: a wrong-scope ask beside valid keys leaves the valid keys applied', () => {
  const res = resolve({ instance: asSettings({ closable: false, tuning: { rowGap: 4, hopFraction: 0.8 } }) });
  assert.deepEqual([res.value.closable, res.value.tuning.hopFraction, res.conflicts.map((c) => c.key)], [false, 0.8, ['tuning.rowGap']]);
});
