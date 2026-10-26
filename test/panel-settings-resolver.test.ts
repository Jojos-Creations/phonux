/**
 * The one resolver: its enumerations and ranges, the cascade, derived defaults, the coupling rules, the user layer,
 * lenient reading of saved layers, pin definitions, scope and view-settable conflicts, and a seeded property run.
 */

import { test, mock } from 'node:test';
import { ALL_SLOTS } from '../rowConstants.js';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { PANEL_SETTINGS_CATALOG, PanelManagerError } from '../index.js';
import { FIXED, LIBRARY_TUNING_DEFAULTS, checkTuningLeaf, resolvePanelSettings } from '../panelSettings.js';
import type { PanelSettingsLayers, ResolveOptions } from '../panelSettings.js';
import { mergePatch } from '../settingsPatch.js';
import type { CatalogName, HeaderButton, PanelSettings, PanelSettingsResolution, SettingConflict, SourceLayer } from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOURCE_WORDS: readonly SourceLayer[] = ['library', 'workspace', 'template', 'host', 'instance', 'user', 'derived', 'forced'];
const CATALOG_NAMES: ReadonlySet<string> = new Set(PANEL_SETTINGS_CATALOG.map((d) => d.name));
let _shapesChecked = 0;

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
  assert.ok(Object.isFrozen(res.value) && Object.isFrozen(res.value.headerButtons));
  _shapesChecked += 1;
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

// ---------------------------------------------------------------------------
// Enumerations and probes
// ---------------------------------------------------------------------------

/** Every enumerated value of every single-valued setting, written by hand. */
const ENUMERATED: Record<string, readonly unknown[]> = {
  closable: BOOL,
  parkable: BOOL,
  movable: BOOL,
  crossable: BOOL,
  resizable: BOOL,
  clearable: BOOL,
  listed: BOOL,
  hostCreatable: BOOL,
  hollowDot: BOOL,
  multiple: BOOL,
  maxInstances: ['unlimited', 1, 2, 50],
  startVisibility: ['live', 'parked'],
  hideStickiness: ['sticky', 'until-room'],
  capacityReturn: ['auto', 'manual'],
  overflow: ['scroll', 'park'],
  revealOnScroll: ['edges', 'any', 'never'],
  edgeHold: ['off', 'left', 'right', 'both'],
  scrollOnOpen: ['into-view', 'start', 'center', 'none'],
  scrollOnMove: ['follow', 'none'],
  toggleWhenClosed: ['ignore', 'reopen'],
  showWhenClosed: ['refuse', 'reopen'],
  placeOnAdd: PLACEMENTS,
  placeOnShow: ['in-place', ...PLACEMENTS],
  layer: ['base', 'raised'],
  enterFrom: ['auto', 'left', 'right', 'anchor', 'top', 'bottom', 'fade', 'expand'],
  exitTo: ['auto', 'left', 'right', 'top', 'bottom', 'fade', 'shrink'],
  slots: [1, 2, 3, 64],
  maxSlots: [1, 2, 3, 64],
  restoreVisibility: ['saved', 'live', 'parked'],
  afterClose: ['stay-closed', 'return-next-launch'],
  pinningWhenNotLive: ['place-only', 'refuse', 'show', 'apply-on-next-show', { parked: 'show' }, { hidden: 'refuse' }, { closed: 'apply-on-next-show' }, { parked: 'place-only', hidden: 'show', closed: 'refuse' }],
  title: ['', 'Notes'],
};

/** The names the enumeration table leaves to a test of their own. */
const ELSEWHERE: readonly CatalogName[] = ['headerButtons', 'pinning', 'tuning.defaultEnterFrom', 'tuning.defaultExitTo', 'tuning.shrinkUnfocused', 'tuning.rowGap', 'tuning.rowTop', 'tuning.phoneHeight', 'tuning.dragToClose', 'tuning.slide', 'tuning.hopFraction', 'tuning.edgeScroll', 'tuning.saveQuietMs', 'tuning.gestureLockMs', 'tuning.gestureQuietMs', 'tuning.resizeSettleSlides', 'tuning.returnTieBreak', 'tuning.dropTieBreak', 'tuning.rowGesture', 'tuning.initialScroll', 'tuning.maxLivePanels', 'tuning.chrome', 'tuning.phoneFit', 'tuning.phoneFitMin', 'tuning.phoneFitMax'];

type Probe = readonly [what: string, layers: PanelSettingsLayers, layer: string, key: string | undefined];
const PROBES: readonly Probe[] = [
  ['boolean given a string', { template: asSettings({ closable: 'yes' }) }, 'template', 'closable'],
  ['boolean given null', { template: asSettings({ parkable: null }) }, 'template', 'parkable'],
  ['number given a string', { template: asSettings({ maxSlots: '1' }) }, 'template', 'maxSlots'],
  ['number given NaN', { template: asSettings({ slots: Number.NaN }) }, 'template', 'slots'],
  ['title given a number', { template: asSettings({ title: 5 }) }, 'template', 'title'],
  ['pinning given a string', { template: asSettings({ pinning: 'row-start' }) }, 'template', 'pinning'],
  ['unknown member of overflow', { template: asSettings({ overflow: 'wrap' }) }, 'template', 'overflow'],
  ['slots given a string', { template: asSettings({ slots: '2' }) }, 'template', 'slots'],
  ['zero slots', { template: asSettings({ slots: 0 }) }, 'template', 'slots'],
  ['fractional maxSlots', { template: asSettings({ maxSlots: 1.5 }) }, 'template', 'maxSlots'],
  ['a removed key, formFactor', { template: asSettings({ formFactor: 'tablet' }) }, 'template', 'formFactor'],
  ['in-place in placeOnAdd', { template: asSettings({ placeOnAdd: 'in-place' }) }, 'template', 'placeOnAdd'],
  ['a placement object with two keys', { template: asSettings({ placeOnAdd: { before: 'a', after: 'b' } }) }, 'template', 'placeOnAdd'],
  ['a placement before nobody', { template: asSettings({ placeOnAdd: { before: '' } }) }, 'template', 'placeOnAdd'],
  ['an anchor placement without its panel', { template: asSettings({ placeOnAdd: { anchor: { position: 'left' } } }) }, 'template', 'placeOnAdd'],
  ['maxInstances zero', { template: asSettings({ maxInstances: 0 }) }, 'template', 'maxInstances'],
  ['maxInstances fractional', { template: asSettings({ maxInstances: 1.5 }) }, 'template', 'maxInstances'],
  ['maxInstances another word', { template: asSettings({ maxInstances: 'many' }) }, 'template', 'maxInstances'],
  ['unknown key at the template layer', { template: asSettings({ nope: 1 }) }, 'template', 'nope'],
  ['unknown key at the instance layer', { instance: asSettings({ nope: 1 }) }, 'instance', 'nope'],
  ['unknown key at the host layer', { host: asSettings({ nope: 1 }) }, 'host', 'nope'],
  ['unknown key at the workspace layer', { workspace: asSettings({ nope: 1 }) }, 'workspace', 'nope'],
  ["overflow 'maybe'", { template: asSettings({ overflow: 'maybe' }) }, 'template', 'overflow'],
  ["enterFrom 'diagonal'", { template: asSettings({ enterFrom: 'diagonal' }) }, 'template', 'enterFrom'],
  ["enterFrom 'shrink', an exit", { template: asSettings({ enterFrom: 'shrink' }) }, 'template', 'enterFrom'],
  ["exitTo 'expand', an entrance", { template: asSettings({ exitTo: 'expand' }) }, 'template', 'exitTo'],
  ["exitTo 'down'", { template: asSettings({ exitTo: 'down' }) }, 'template', 'exitTo'],
  ["scrollOnOpen 'middle'", { template: asSettings({ scrollOnOpen: 'middle' }) }, 'template', 'scrollOnOpen'],
  ["scrollOnMove 'sometimes'", { template: asSettings({ scrollOnMove: 'sometimes' }) }, 'template', 'scrollOnMove'],
  ['headerButtons given a number', { template: asSettings({ headerButtons: 5 }) }, 'template', 'headerButtons'],
  ['headerButtons given a list', { template: asSettings({ headerButtons: [slot('a')] }) }, 'template', 'headerButtons'],
  ['headerButtons holding a string for a slot', { template: asSettings({ headerButtons: { size: 'x' } }) }, 'template', 'headerButtons'],
  ['headerButtons holding true for a slot', { template: asSettings({ headerButtons: { size: true } }) }, 'template', 'headerButtons'],
  ["pinningWhenNotLive 'maybe'", { template: asSettings({ pinningWhenNotLive: 'maybe' }) }, 'template', 'pinningWhenNotLive'],
  ["pinningWhenNotLive closed: 'show'", { template: asSettings({ pinningWhenNotLive: { closed: 'show' } }) }, 'template', 'pinningWhenNotLive'],
  ['pinningWhenNotLive with an unknown status', { template: asSettings({ pinningWhenNotLive: { open: 'show' } }) }, 'template', 'pinningWhenNotLive'],
  ['tuning given a number', { instance: asSettings({ tuning: 5 }) }, 'instance', 'tuning'],
  ['a template layer carrying a tuning leaf', { template: asSettings({ tuning: { hopFraction: 0.7 } }) }, 'template', 'tuning'],
  ['a host layer carrying a tuning leaf', { host: asSettings({ tuning: { slide: { durationSec: 1 } } }) }, 'host', 'tuning'],
  ['an instance layer carrying a tuning leaf', { instance: asSettings({ tuning: { dragToClose: { minDistancePx: 100 } } }) }, 'instance', 'tuning'],
  ['a template layer that is not an object', { template: 5 as unknown as PanelSettings }, 'template', undefined],
  ['an instance layer that is a list', { instance: [] as unknown as PanelSettings }, 'instance', undefined],
];

test('enumerations: the enumeration table and its companions cover every one of the 57 catalog names exactly once', () => {
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
  assert.ok(valueCases >= 90 && PROBES.length >= 30, 'the tables are not empty');
});

test("enumerations: a probe's refusal names the layer and key in its message too", () => {
  const error = refuses({ template: asSettings({ overflow: 'maybe' }) }, 'template', 'overflow');
  assert.match(error.message, /template\.overflow/);
});

test('enumerations: the five enumerated tuning leaves accept every member', () => {
  const members: Record<string, readonly unknown[]> = {
    returnTieBreak: ['latest-first', 'earliest-first', 'row-order'],
    dropTieBreak: ['leftmost', 'rightmost'],
    rowGesture: ['step', 'off'],
    initialScroll: ['start', 'end', 'root', { panel: 'x' }],
    phoneHeight: ['fit', 'auto'],
  };
  let executed = 0;
  for (const [leaf, values] of Object.entries(members)) {
    for (const value of values) {
      assert.deepEqual(checkTuningLeaf(leaf as never, value), { accepted: value, problems: [] }, `${leaf} = ${JSON.stringify(value)}`);
      executed += 1;
    }
  }
  assert.equal(executed, 13);
  for (const [leaf, bad] of [['rowGesture', 'swipe'], ['initialScroll', 'middle'], ['initialScroll', { panel: '' }]] as const) assert.equal(checkTuningLeaf(leaf, bad).problems[0]?.key, `tuning.${leaf}`, leaf);
});

test('a panel resolves no tuning: the value holds none, and no layer may carry one', () => {
  const res = resolve();
  assert.equal('tuning' in res.value, false);
  assert.deepEqual(Object.keys(res.source).filter((k) => k.startsWith('tuning.')), []);
  for (const layer of ['workspace', 'template', 'host', 'instance'] as const) {
    for (const tuning of [{ hopFraction: 0.75 }, { dragToClose: { distanceFraction: 0.5 } }, { slide: { durationSec: 1 } }, { edgeScroll: { zonePx: 60 } }, { rowGap: 8 }, { nope: 1 }, 5]) {
      refuses({ [layer]: asSettings({ tuning }) }, layer, 'tuning');
    }
  }
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
  ['rowTop', 0, 'accept'],
  ['rowTop', 400, 'accept'],
  ['rowTop', 401, 'reject'],
  ['rowTop', null, 'accept'],
  ['rowTop', 0.5, 'reject'],
  ['phoneHeight', 'fit', 'accept'],
  ['phoneHeight', 'auto', 'accept'],
  ['phoneHeight', 'tall', 'reject'],
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
  ['slide.closeExitEase', 'easeIn', 'accept'],
  ['slide.closeExitEase', 'easeOut', 'accept'],
  ['slide.closeExitEase', 'easeInOut', 'accept'],
  ['slide.closeExitEase', 'linear', 'accept'],
  ['slide.closeExitEase', 'cubic-out', 'reject'],
  ['slide.closeExitEase', [0.4, 0, 1, 1], 'accept'],
  ['slide.closeExitEase', [1.01, 0, 1, 1], 'reject'],
  ['slide.closeExitEase', [0.4, 0, 1], 'reject'],
  ['slide.glideEase', 'cubic-out', 'accept'],
  ['slide.glideEase', 'linear', 'accept'],
  ['slide.glideEase', 'easeIn', 'reject'],
  ['slide.glideEase', [0, 0, 0.58, 1], 'accept'],
  ['slide.glideEase', [-0.01, 0, 0.58, 1], 'reject'],
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
  ['gestureQuietMs', 0, 'reject'],
  ['gestureQuietMs', 1, 'accept'],
  ['resizeSettleSlides', -0.1, 'reject'],
  ['resizeSettleSlides', 10.1, 'reject'],
  ['resizeSettleSlides', Number.NaN, 'reject'],
  ['resizeSettleSlides', Number.POSITIVE_INFINITY, 'reject'],
  ['resizeSettleSlides', 0, 'accept'],
  ['resizeSettleSlides', 10, 'accept'],
  ['maxLivePanels', 0, 'reject'],
  ['maxLivePanels', -1, 'reject'],
  ['maxLivePanels', 2.5, 'reject'],
  ['maxLivePanels', Number.NaN, 'reject'],
  ['maxLivePanels', 1, 'accept'],
  ['maxLivePanels', null, 'accept'],
  ['defaultEnterFrom', 'expand', 'accept'],
  ['defaultEnterFrom', 'fade', 'accept'],
  ['defaultEnterFrom', 'top', 'accept'],
  ['defaultEnterFrom', 'anchor', 'accept'],
  ['defaultEnterFrom', 'shrink', 'reject'],
  ['defaultEnterFrom', 'diagonal', 'reject'],
  ['defaultExitTo', 'shrink', 'accept'],
  ['defaultExitTo', 'bottom', 'accept'],
  ['defaultExitTo', 'auto', 'accept'],
  ['defaultExitTo', 'expand', 'reject'],
  ['defaultExitTo', 'anchor', 'reject'],
  ['defaultExitTo', 'down', 'reject'],
  ['shrinkUnfocused', true, 'accept'],
  ['shrinkUnfocused', false, 'accept'],
  ['shrinkUnfocused', 'on', 'reject'],
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

test('ranges: every (value, outcome) row is accepted or refused by the tuning leaf check, and the executed rows equal the table length', () => {
  let executed = 0;
  for (const [path, value, outcome] of RANGES) {
    const [leaf = '', member] = path.split('.');
    const checked = checkTuningLeaf(leaf as never, member === undefined ? value : { [member]: value });
    const where = `${path} = ${JSON.stringify(value)}`;
    if (outcome === 'reject') {
      assert.deepEqual(checked.problems.map((p) => p.key), [`tuning.${path}`], where);
      assert.equal(checked.accepted, undefined, where);
    } else {
      assert.deepEqual(checked.problems, [], where);
      assert.deepEqual(member === undefined ? checked.accepted : (checked.accepted as Record<string, unknown>)[member], value, where);
    }
    executed += 1;
  }
  assert.equal(executed, RANGES.length);
  assert.equal(RANGES.length, 105);
});

test('ranges: a refusal of a tuning member names the dotted key, and the numbers of the library defaults are inside their own ranges', () => {
  assert.equal(checkTuningLeaf('dragToClose', { cancelVelocity: 0 }).problems[0]?.key, 'tuning.dragToClose.cancelVelocity');
  assert.equal(checkTuningLeaf('slide', { ease: [2, 0, 0, 1] }).problems[0]?.key, 'tuning.slide.ease');
  assert.equal(checkTuningLeaf('dragToClose', { directionLockPx: 8 }).problems[0]?.problem, 'unknown tuning member', 'a dropped internal is no longer a member');
  assert.equal(checkTuningLeaf('chrome', { slideMs: 140 }).problems[0]?.problem, 'unknown tuning member', 'nor is a chrome pixel number');
  for (const leaf of Object.keys(LIBRARY_TUNING_DEFAULTS) as (keyof typeof LIBRARY_TUNING_DEFAULTS)[]) {
    assert.deepEqual(checkTuningLeaf(leaf, LIBRARY_TUNING_DEFAULTS[leaf]).problems, [], `the default of ${leaf}`);
  }
});

// ---------------------------------------------------------------------------
// The cascade
// ---------------------------------------------------------------------------

type CascadeRow = readonly [what: string, layers: PanelSettingsLayers, key: string, value: unknown, source: SourceLayer];
/** Eight rows, one per source word: the value asked at each layer and which layer wins. */
const CASCADE_ORDER: readonly CascadeRow[] = [
  ['no layer', {}, 'slots', 1, 'library'],
  ['workspace', { workspace: { slots: 2 } }, 'slots', 2, 'workspace'],
  ['template over workspace', { workspace: { slots: 2 }, template: { slots: 3 } }, 'slots', 3, 'template'],
  ['host over template', { workspace: { slots: 2 }, template: { slots: 3 }, host: { slots: 2 } }, 'slots', 2, 'host'],
  ['instance over host', { workspace: { slots: 2 }, template: { slots: 3 }, host: { slots: 2 }, instance: { slots: 3 } }, 'slots', 3, 'instance'],
  ['user over instance', { template: { slots: 3 }, instance: { slots: 3 }, user: { slots: 2 } }, 'slots', 2, 'user'],
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
      for (const [first, second] of [[2, 3], [3, 2]] as const) {
        const lowLayer = order[low] as (typeof order)[number];
        const highLayer = order[high] as (typeof order)[number];
        const res = resolve({ [lowLayer]: { slots: first }, [highLayer]: { slots: second } });
        assert.equal(res.value.slots, second, `${highLayer} over ${lowLayer}`);
        assert.equal(res.source.slots, highLayer);
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
  const absent = resolve({ template: { closable: false }, instance: asSettings({ tuning: undefined }) });
  assert.equal(absent.value.closable, false, 'an undefined tuning is not a tuning');
});

test('cascade: placeOnAdd, placeOnShow, pinning and pinningWhenNotLive are replaced whole', () => {
  const rows: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ['placeOnAdd', { before: 'a' }, { after: 'b' }],
    ['placeOnShow', { before: 'a' }, { anchor: { panel: 'b', position: 'right' } }],
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
  assert.equal(rows.length, 4);
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
    workspace: { scrollOnMove: 'none' },
    template: { layer: 'raised', closable: false },
    host: { title: 'From the view' },
    instance: { closable: true, revealOnScroll: 'never' },
    user: { slots: 2 },
  });
  assert.deepEqual(
    [res.source.scrollOnMove, res.source.layer, res.source.title, res.source.closable, res.source.revealOnScroll, res.source.slots, res.source.overflow],
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

const DERIVED = ['movable', 'listed', 'clearable'] as const;
const valueOf = (res: PanelSettingsResolution, key: string): unknown => (res.value as unknown as Record<string, unknown>)[key];

test('derived defaults: movable, listed and clearable follow parkable (and closable for clearable), sourced derived', () => {
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
  assert.equal(notClosable.value.movable, true, 'only clearable follows closable');
  assert.deepEqual(notClosable.conflicts, []);
});

test('derived defaults: a derived default is overridable at every layer and the override is never a conflict', () => {
  for (const layer of ['workspace', 'template', 'instance'] as const) {
    const res = resolve({ template: { parkable: false }, [layer]: { movable: true, listed: true, clearable: true } });
    for (const key of DERIVED) assert.equal(valueOf(res, key), true, `${layer}.${key}`);
    assert.deepEqual(res.conflicts, [], layer);
  }
  const off = resolve({ instance: { listed: false, movable: false } });
  assert.deepEqual([off.value.listed, off.value.movable, off.source.listed, off.source.movable], [false, false, 'instance', 'instance']);
});

type ForcedRow = readonly [key: string, asked: unknown, applied: unknown];
const C1_ROWS: readonly ForcedRow[] = [
  ['overflow', 'park', 'scroll'],
  ['startVisibility', 'parked', 'live'],
  ['restoreVisibility', 'parked', 'live'],
];

test('C1: a fixed column forces overflow, startVisibility and restoreVisibility, one conflict per ask', () => {
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

test('C1: a fixed column keeps the size settings its own template or instance asked for, and forces the workspace and library ones', () => {
  for (const layer of ['template', 'instance'] as const) {
    const res = resolve({ template: { parkable: false }, [layer]: asSettings({ resizable: true, maxSlots: 3, slots: 2 }) });
    assert.deepEqual([res.value.resizable, res.value.maxSlots, res.value.slots], [true, 3, 2], layer);
    assert.deepEqual(resolve({ template: { parkable: false }, [layer]: asSettings({ slots: 2 }) }).value.slots, 2, `${layer}: the slot count is part of the same group`);
    assert.deepEqual(resolve({ template: { parkable: false }, [layer]: asSettings({ resizable: true }) }).value.maxSlots, ALL_SLOTS, `${layer}: asking resizable alone leaves the rest at their defaults`);
    assert.deepEqual(res.conflicts.filter((c) => c.layer === layer && c.rule === 'C1'), [], `${layer}: no conflict for a size the panel itself asked`);
  }
  const workspace = resolve({ workspace: { resizable: true, maxSlots: 3 }, template: { parkable: false } });
  assert.deepEqual([workspace.value.resizable, workspace.value.maxSlots, workspace.value.slots], [false, 1, 1], 'the workspace default does not unlock a fixed column');
  assert.deepEqual(workspace.conflicts, [], 'and a workspace default collides with the rule silently');
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
  assert.deepEqual([silent.value.resizable, silent.value.maxSlots, silent.value.slots, silent.value.overflow, silent.value.startVisibility, silent.value.restoreVisibility], [false, 1, 1, 'scroll', 'live', 'live']);
  assert.deepEqual([silent.source.resizable, silent.source.maxSlots, silent.source.restoreVisibility], ['forced', 'forced', 'forced'], 'a value the library gave is forced without a conflict');
  const workspaceAsk = resolve({ workspace: { overflow: 'park' }, template: { parkable: false } });
  assert.deepEqual([workspaceAsk.value.overflow, workspaceAsk.conflicts], ['scroll', []]);
  const equalAsk = resolve({ template: { parkable: false, overflow: 'scroll', resizable: false } });
  assert.deepEqual(equalAsk.conflicts, []);
  assert.equal(equalAsk.source.overflow, 'template', 'asking what the rule gives is not a collision');
});

test('C1: every key a layer asked otherwise is listed, each at the layer that asked, host included', () => {
  const res = resolve({
    template: { parkable: false, overflow: 'park' },
    instance: { startVisibility: 'parked', restoreVisibility: 'parked' },
  });
  assert.deepEqual(
    res.conflicts.map((c) => `${c.layer}:${c.key}`).sort(),
    ['instance:restoreVisibility', 'instance:startVisibility', 'template:overflow'],
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

test('C4: slots above maxSlots become maxSlots; slots inside it stand', () => {
  const asked = resolve({ template: { maxSlots: 2, slots: 3 } });
  assert.equal(asked.value.slots, 2);
  assert.deepEqual(asked.conflicts.map((c) => [c.key, c.rule, c.forcedBy, c.asked, c.applied]), [['slots', 'C4', 'maxSlots', 3, 2]]);
  const inside = resolve({ template: { maxSlots: 3, slots: 2 } });
  assert.deepEqual([inside.value.slots, inside.source.slots, inside.conflicts], [2, 'template', []]);
});

test('C5: the root is never closable, parkable or clearable, is not movable until a layer says so, and a layer that asked otherwise has a conflict without forcedBy', () => {
  const bare = resolve({}, { root: true });
  assert.deepEqual([bare.value.closable, bare.value.parkable, bare.value.clearable, bare.value.movable, bare.value.listed], [false, false, false, false, false]);
  assert.deepEqual(bare.conflicts, [], 'a library collision is silent');
  assert.deepEqual([bare.source.closable, bare.source.parkable, bare.source.movable], ['forced', 'forced', 'derived'], 'movable follows the fixed column, so nothing was forced');
  const movable = resolve({ template: { movable: true } }, { root: true });
  assert.deepEqual([movable.value.movable, movable.source.movable, movable.conflicts], [true, 'template', []], 'a layer may make the root movable');
  const asked = resolve({ template: { closable: true, parkable: true, movable: true } }, { root: true });
  assert.deepEqual(asked.conflicts.map((c) => c.key).sort(), ['closable', 'parkable']);
  for (const c of asked.conflicts) {
    assert.equal(c.rule, 'C5', c.key);
    assert.equal('forcedBy' in c, false, `${c.key} has no forcedBy`);
    assert.equal(c.kind, 'forced');
    assert.equal(c.applied, false);
  }
  assert.equal(asked.value.movable, true);
  const notRoot = resolve({ template: { closable: true, parkable: true, movable: true } });
  assert.deepEqual(notRoot.conflicts, []);
  assert.deepEqual([notRoot.value.closable, notRoot.value.movable], [true, true]);
});

test('C5 feeds C1 and C2 for the root: a root asking overflow park or clearable true is also forced, naming parkable and closable', () => {
  const res = resolve({ template: { overflow: 'park', clearable: true } }, { root: true });
  assert.deepEqual(res.conflicts.map((c) => [c.key, c.rule, c.forcedBy]).sort(), [['clearable', 'C2', 'closable'], ['overflow', 'C1', 'parkable']]);
  assert.deepEqual([res.value.overflow, res.value.clearable, res.value.resizable, res.value.slots], ['scroll', false, false, 1]);
});

test('conflicts: one per kind of rule, each carrying key, layer, kind, asked, applied and message, plus rule and forcedBy when forced', () => {
  type Row = readonly [rule: string, layers: PanelSettingsLayers, options: ResolveOptions, key: string, forcedBy: string | undefined];
  const rows: readonly Row[] = [
    ['C1', { template: { parkable: false, overflow: 'park' } }, {}, 'overflow', 'parkable'],
    ['C2', { template: { closable: false, clearable: true } }, {}, 'clearable', 'closable'],
    ['C4', { template: { maxSlots: 1, slots: 2 } }, {}, 'slots', 'maxSlots'],
    ['C5', { template: { closable: true } }, { root: true }, 'closable', undefined],
  ];
  for (const [rule, layers, options, key, forcedBy] of rows) {
    const res = resolve(layers, options);
    assert.equal(res.conflicts.length, 1, rule);
    const [c] = res.conflicts as [SettingConflict];
    assert.deepEqual([c.key, c.layer, c.kind, c.rule, c.forcedBy], [key, 'template', 'forced', rule, forcedBy], rule);
    assert.equal('forcedBy' in c, forcedBy !== undefined, `${rule}: forcedBy is present only when a key forces it`);
    assert.ok(c.asked !== c.applied && typeof c.message === 'string' && c.message.length > 0, rule);
  }
  assert.equal(rows.length, 4);
});

test('park levers: capacityReturn on a panel whose overflow resolves to scroll yields park-lever-inert, and none when overflow is park', () => {
  const res = resolve({ template: { capacityReturn: 'manual' } });
  assert.deepEqual(res.notes.map((n) => [n.code, n.key]), [['park-lever-inert', 'capacityReturn']]);
  const parked = resolve({ template: { capacityReturn: 'manual', overflow: 'park' } });
  assert.deepEqual(parked.notes, []);
  assert.deepEqual(resolve().notes, [], 'a library lever is not a note');
  const forcedScroll = resolve({ template: { parkable: false, overflow: 'park', capacityReturn: 'manual' } });
  assert.deepEqual(forcedScroll.notes.map((n) => n.code), ['park-lever-inert'], 'overflow forced to scroll by C1 makes the lever inert');
});

// ---------------------------------------------------------------------------
// Scope: not-view-settable and wrong-scope
// ---------------------------------------------------------------------------

test('host layer: closable true, headerButtons, overflow and pinning are not-view-settable and change nothing', () => {
  const res = resolve({
    host: asSettings({ closable: true, headerButtons: { size: slot('Size') }, overflow: 'park', pinning: { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } } }),
  });
  assert.deepEqual(res.conflicts.map((c) => [c.key, c.layer, c.kind]).sort(), [
    ['closable', 'host', 'not-view-settable'],
    ['headerButtons', 'host', 'not-view-settable'],
    ['overflow', 'host', 'not-view-settable'],
    ['pinning', 'host', 'not-view-settable'],
  ]);
  assert.deepEqual([res.value.closable, res.value.overflow, res.value.headerButtons, res.source.closable, res.source.overflow], [true, 'scroll', {}, 'library', 'library']);
});

test('host layer: the keys a view may set are accepted: title, listed, layer, slots, placeOnAdd with an anchor and enterFrom anchor', () => {
  const host = { title: 'Mine', listed: false, layer: 'raised', slots: 2, placeOnAdd: { anchor: { panel: 'p', position: 'left' } }, enterFrom: 'anchor' } as const;
  const res = resolve({ host });
  assert.deepEqual(res.conflicts, []);
  assert.deepEqual([res.value.title, res.value.listed, res.value.layer, res.value.slots, res.value.placeOnAdd, res.value.enterFrom], ['Mine', false, 'raised', 2, { anchor: { panel: 'p', position: 'left' } }, 'anchor']);
  for (const key of Object.keys(host)) assert.equal(res.source[key], 'host', key);
});

test("host layer: placeOnAdd without an anchor and an enterFrom other than 'anchor' are not-view-settable", () => {
  for (const host of [{ placeOnAdd: 'row-end' }, { placeOnAdd: { before: 'a' } }, { enterFrom: 'left' }, { enterFrom: 'auto' }]) {
    const res = resolve({ host: asSettings(host) });
    assert.deepEqual(res.conflicts.map((c) => [c.kind, c.layer]), [['not-view-settable', 'host']], JSON.stringify(host));
    assert.deepEqual([res.value.placeOnAdd, res.value.enterFrom], ['row-end', 'auto'], 'the ask changed nothing');
  }
});

test('host layer: a tuning leaf is refused, not a not-view-settable conflict', () => {
  refuses({ host: { tuning: { hopFraction: 0.7 } } as never }, 'host', 'tuning');
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

const WORKSPACE_TUNING_ASKS: ReadonlyArray<readonly [leaf: string, value: unknown]> = [
  ['rowGap', 8],
  ['saveQuietMs', 100],
  ['gestureLockMs', 100],
  ['returnTieBreak', 'row-order'],
  ['dropTieBreak', 'rightmost'],
  ['rowGesture', 'off'],
  ['initialScroll', 'end'],
  ['chrome', { mode: 'hover-or-active' }],
  ['maxLivePanels', 3],
  ['dragToClose', { minDistancePx: 100 }],
  ['slide', { durationSec: 0.2 }],
  ['hopFraction', 0.3],
  ['edgeScroll', { zonePx: 30 }],
  ['rowTop', 200],
  ['phoneHeight', 'auto'],
];

test('scope: every tuning key throws at the workspace, template, host and instance layers alike', () => {
  let executed = 0;
  for (const [leaf, value] of WORKSPACE_TUNING_ASKS) {
    for (const layer of ['workspace', 'template', 'host', 'instance'] as const) {
      refuses({ [layer]: asSettings({ tuning: { [leaf]: value } }) }, layer, 'tuning');
      executed += 1;
    }
  }
  assert.equal(executed, 60);
});

test('scope: a wrong-scope ask beside valid keys leaves the valid keys applied', () => {
  const res = resolve({ instance: asSettings({ closable: false, multiple: true }) });
  assert.deepEqual([res.value.closable, res.conflicts.map((c) => c.key)], [false, ['multiple']]);
});

// ---------------------------------------------------------------------------
// The user layer
// ---------------------------------------------------------------------------

test('user layer: a slot count above maxSlots is held at maxSlots without a note, and one inside stands', () => {
  const res = resolve({ template: { maxSlots: 2 }, user: { slots: 3 } });
  assert.deepEqual([res.value.slots, res.source.slots, res.notes], [2, 'user', []]);
  const inside = resolve({ template: { maxSlots: 2 }, user: { slots: 2 } });
  assert.deepEqual([inside.value.slots, inside.source.slots, inside.notes], [2, 'user', []]);
});

test('user layer: a slot count on a resizable:false panel and an anchor on a panel that is not movable are not dropped', () => {
  const size = resolve({ instance: { resizable: false }, user: { slots: 2 } });
  assert.deepEqual([size.value.slots, size.value.resizable, size.source.slots, size.notes], [2, false, 'user', []]);
  const anchor = { panel: 'notes', position: 'left', priority: 2 } as const;
  const res = resolve({ instance: { movable: false }, user: { anchor } });
  assert.deepEqual(res.userAnchor, anchor);
  assert.deepEqual(res.notes, []);
  assert.deepEqual([res.value.movable], [false]);
  assert.equal('userAnchor' in resolve(), false, 'no user anchor, no userAnchor');
});

test('user layer: parkable false joins as the top layer, so C1 re-runs with source user and no conflict', () => {
  const res = resolve({ user: { parkable: false } });
  assert.deepEqual([res.value.parkable, res.source.parkable], [false, 'user']);
  assert.deepEqual([res.value.resizable, res.value.overflow, res.value.maxSlots], [false, 'scroll', 1]);
  assert.deepEqual([res.value.movable, res.value.listed, res.value.clearable], [false, false, false]);
  assert.deepEqual(res.conflicts, []);
  assert.deepEqual(res.notes, []);
  const kept = resolve({ user: { parkable: true } });
  assert.deepEqual([kept.value.parkable, kept.source.parkable], [true, 'user']);
});

test("user layer: a template's own ask that the user's fixed column forces is still a conflict of that template", () => {
  const res = resolve({ template: { overflow: 'park' }, user: { parkable: false } });
  assert.deepEqual(res.conflicts.map((c) => [c.layer, c.key, c.rule, c.forcedBy]), [['template', 'overflow', 'C1', 'parkable']]);
  assert.equal(res.value.overflow, 'scroll');
});

test('user layer: parkable false is dropped with a note when the resolved panel is more than one slot, and kept when the user slot count is one', () => {
  const wide = resolve({ template: { slots: 2 }, user: { parkable: false } });
  assert.deepEqual([wide.value.parkable, wide.source.parkable, wide.value.slots], [true, 'library', 2]);
  assert.deepEqual(wide.notes.map((n) => [n.code, n.key]), [['override-dropped', 'parkable']]);
  const userWide = resolve({ user: { slots: 2, parkable: false } });
  assert.deepEqual([userWide.value.parkable, userWide.value.slots], [true, 2]);
  assert.deepEqual(userWide.notes.map((n) => [n.code, n.key]), [['override-dropped', 'parkable']]);
  const one = resolve({ template: { slots: 2 }, user: { slots: 1, parkable: false } });
  assert.deepEqual([one.value.parkable, one.source.parkable, one.value.slots, one.source.slots, one.notes], [false, 'user', 1, 'user', []]);
});

test('user layer: only slots, anchor and parkable are accepted; anything else, or a wrong type, throws unless lenient', () => {
  refuses({ user: { closable: false } as never }, 'user', 'closable');
  refuses({ user: { formFactor: 'tablet' } as never }, 'user', 'formFactor');
  refuses({ user: { slots: 0 } as never }, 'user', 'slots');
  refuses({ user: { parkable: 'no' } as never }, 'user', 'parkable');
  refuses({ user: { anchor: { position: 'up' } } as never }, 'user', 'anchor');
  refuses({ user: 5 as never }, 'user', undefined);
});

// ---------------------------------------------------------------------------
// Lenient mode
// ---------------------------------------------------------------------------

const SAVED_INSTANCE = asSettings({ closable: false, bogus: 1, listed: 'yes', overflow: 'evictable', parkable: 'yes', tuning: { rowGap: 999, hopFraction: 0.7 } });
const SAVED_USER = { slots: 2, bogus: 1, parkable: 'yes', anchor: 5 } as unknown as PanelSettingsLayers['user'];

test('lenient: an instance and a user layer holding bad keys return the others intact with one invalid-saved-setting note per drop and never throw', () => {
  const res = resolve({ instance: SAVED_INSTANCE, user: SAVED_USER }, { lenient: true });
  assert.deepEqual([res.value.closable, res.value.slots, res.value.listed, res.value.overflow, res.value.parkable], [false, 2, true, 'scroll', true]);
  assert.ok(res.notes.every((n) => n.code === 'invalid-saved-setting'));
  const instanceNotes = res.notes.filter((n) => n.message.startsWith('instance.'));
  const userNotes = res.notes.filter((n) => n.message.startsWith('user.'));
  assert.deepEqual(instanceNotes.map((n) => n.key).sort(), ['bogus', 'listed', 'overflow', 'parkable', 'tuning']);
  assert.deepEqual(userNotes.map((n) => n.key).sort(), ['anchor', 'bogus', 'parkable']);
  assert.equal(res.notes.length, 8, 'one note per drop');
  assert.deepEqual(res.conflicts, []);
});

test('lenient: the same stack without lenient throws, naming the first bad key of the instance layer', () => {
  refuses({ instance: SAVED_INSTANCE, user: SAVED_USER }, 'instance', 'bogus');
  refuses({ instance: SAVED_INSTANCE, user: SAVED_USER }, 'instance', 'bogus', { lenient: false });
  refuses({ user: SAVED_USER }, 'user', 'bogus');
});

test('lenient: each kind of bad saved value is dropped alone: unknown key, wrong type, a saved tuning, a removed enum member, a non-boolean parkable', () => {
  const rows: ReadonlyArray<readonly [string, PanelSettings, string]> = [
    ['unknown key', asSettings({ gone: true }), 'gone'],
    ['wrong type', asSettings({ title: 5 }), 'title'],
    ['a saved tuning, whatever it holds', asSettings({ tuning: { rowGap: 8 } }), 'tuning'],
    ['removed enum member', asSettings({ overflow: 'evictable' }), 'overflow'],
    ['non-boolean parkable', asSettings({ parkable: 1 }), 'parkable'],
    ['a saved tuning that is no object', asSettings({ tuning: 5 }), 'tuning'],
  ];
  for (const [what, instance, key] of rows) {
    const res = resolve({ instance }, { lenient: true });
    assert.deepEqual(res.notes.map((n) => [n.code, n.key]), [['invalid-saved-setting', key]], what);
    assert.deepEqual(res.value, resolve().value, `${what}: nothing else changed`);
  }
});

test('removed settings: a layer that still names one is ignored, the panel keeps the fixed value, and development logs once per key', () => {
  const log = mock.method(console, 'error', () => undefined);
  try {
    const keys = Object.keys(FIXED);
    assert.equal(keys.length, 18);
    const asked = Object.fromEntries(keys.map((key) => [key, 'asked']));
    for (const layer of ['workspace', 'template', 'instance'] as const) {
      const res = resolve({ [layer]: asSettings(asked) });
      assert.deepEqual(res.value, resolve().value, `${layer}: nothing changed`);
      assert.deepEqual([res.conflicts, res.notes], [[], []], layer);
      for (const key of keys) assert.equal(key in res.value, false, `${layer}: ${key} is not a resolved setting`);
    }
    const headings = log.mock.calls.map((call) => String(call.arguments[0]));
    assert.equal(headings.length, keys.length, 'one message per key, not per layer');
    assert.ok(headings.every((text) => /^phonux: the \w+ setting '\w+' was removed/.test(text)));
  } finally {
    log.mock.restore();
  }
});

test('removed settings: a saved instance layer drops each with a note and keeps every other value', () => {
  const res = resolve({ instance: asSettings({ closable: false, keepMounted: true, snapshot: 'never' }) }, { lenient: true });
  assert.equal(res.value.closable, false);
  assert.deepEqual(res.notes.map((n) => [n.code, n.key, n.message]).sort(), [
    ['invalid-saved-setting', 'keepMounted', 'instance.keepMounted: a setting this version no longer has; dropped'],
    ['invalid-saved-setting', 'snapshot', 'instance.snapshot: a setting this version no longer has; dropped'],
  ]);
});

test('lenient: a layer that is not an object is dropped whole with one note; the workspace, template and host layers throw in both modes', () => {
  const res = resolve({ instance: 5 as unknown as PanelSettings, user: 'x' as never }, { lenient: true });
  assert.deepEqual(res.notes.map((n) => n.code), ['invalid-saved-setting', 'invalid-saved-setting']);
  for (const lenient of [false, true]) {
    refuses({ workspace: asSettings({ bogus: 1 }) }, 'workspace', 'bogus', { lenient });
    refuses({ template: asSettings({ bogus: 1 }) }, 'template', 'bogus', { lenient });
    refuses({ host: asSettings({ bogus: 1 }) }, 'host', 'bogus', { lenient });
    refuses({ template: asSettings({ overflow: 'evictable' }) }, 'template', 'overflow', { lenient });
    refuses({ workspace: asSettings({ tuning: { rowGap: 1 } }) }, 'workspace', 'tuning', { lenient });
    refuses({ template: asSettings({ tuning: { rowGap: 1 } }) }, 'template', 'tuning', { lenient });
  }
});

// ---------------------------------------------------------------------------
// Pin definitions
// ---------------------------------------------------------------------------

type PinRow = readonly [what: string, pinning: unknown, outcome: 'valid' | 'invalid'];
const PIN_TABLE: readonly PinRow[] = [
  ['the default', { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } }, 'valid'],
  ['the parkable pair alone', { pinned: { parkable: false }, unpinned: { parkable: true } }, 'valid'],
  ['the pair, pinned next to a dock, unpinned at the row end', { pinned: { placement: { after: 'dock' }, parkable: false }, unpinned: { placement: 'row-end', parkable: true } }, 'valid'],
  ['row-start with after-fixed', { pinned: { placement: 'row-start' }, unpinned: { placement: 'after-fixed' } }, 'valid'],
  ['the pair with row-start and row-end', { pinned: { placement: 'row-start', parkable: false }, unpinned: { placement: 'row-end', parkable: true } }, 'valid'],
  ['the pair the other way round', { pinned: { parkable: true }, unpinned: { parkable: false } }, 'valid'],
  ['empty halves', { pinned: {}, unpinned: {} }, 'valid'],
  ['an empty definition', {}, 'valid'],
  ['parkable in one half only', { pinned: { placement: 'row-start', parkable: false }, unpinned: { placement: 'row-end' } }, 'invalid'],
  ['parkable in the unpinned half only', { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end', parkable: true } }, 'invalid'],
  ['equal parkable values, both true', { pinned: { parkable: true }, unpinned: { parkable: true } }, 'invalid'],
  ['equal parkable values, both false', { pinned: { parkable: false }, unpinned: { parkable: false } }, 'invalid'],
  ['pinned row-end with unpinned row-start', { pinned: { placement: 'row-end' }, unpinned: { placement: 'row-start' } }, 'invalid'],
  ['parkable-start without the pair', { pinned: { placement: 'parkable-start' }, unpinned: { placement: 'row-end' } }, 'invalid'],
  ['parkable-end without the pair', { pinned: { placement: 'parkable-end' }, unpinned: { placement: 'row-start' } }, 'invalid'],
  ['in-place in the pinned half', { pinned: { placement: 'in-place' }, unpinned: { placement: 'row-end' } }, 'invalid'],
  ['in-place in the unpinned half', { pinned: { placement: 'row-start' }, unpinned: { placement: 'in-place' } }, 'invalid'],
  ['an unknown half key', { pinned: { placement: 'row-start', slot: 1 }, unpinned: { placement: 'row-end' } }, 'invalid'],
  ['an unknown key beside the halves', { pinned: {}, unpinned: {}, extra: {} }, 'invalid'],
  ['pinned filled and unpinned empty', { pinned: { placement: 'row-start' }, unpinned: {} }, 'invalid'],
  ['pinned empty and unpinned filled', { pinned: {}, unpinned: { placement: 'row-end' } }, 'invalid'],
];

test('pinning: a hand-written table of valid and invalid definitions; invalid ones throw invalid-settings naming layer and key; executed equals rows', () => {
  let executed = 0;
  for (const [what, pinning, outcome] of PIN_TABLE) {
    for (const layer of ['template', 'instance'] as const) {
      const layers: PanelSettingsLayers = { [layer]: asSettings({ pinning }) };
      if (outcome === 'valid') {
        const res = resolve(layers);
        assert.deepEqual(res.value.pinning, { pinned: {}, unpinned: {}, ...(pinning as object) }, `${what} at ${layer}`);
        assert.equal(res.source.pinning, layer);
      } else {
        refuses(layers, layer, 'pinning');
      }
    }
    executed += 1;
  }
  assert.equal(executed, PIN_TABLE.length);
  assert.equal(PIN_TABLE.filter((row) => row[2] === 'valid').length, 8);
  assert.equal(PIN_TABLE.filter((row) => row[2] === 'invalid').length, 13);
});

test('pinning: the default is the row-start and row-end pair, and a saved invalid pinning is dropped in lenient mode', () => {
  assert.deepEqual(resolve().value.pinning, { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } });
  assert.equal(resolve().source.pinning, 'library');
  const res = resolve({ instance: asSettings({ pinning: { pinned: { placement: 'row-end' }, unpinned: { placement: 'row-start' } } }) }, { lenient: true });
  assert.deepEqual(res.notes.map((n) => [n.code, n.key]), [['invalid-saved-setting', 'pinning']]);
  assert.deepEqual(res.value.pinning, resolve().value.pinning);
});

test('pinning: pin-unlists appears when a pinned half names parkable false and listed is unset, and not when listed is set', () => {
  const pinning = { pinned: { parkable: false }, unpinned: { parkable: true } } as const;
  const unset = resolve({ template: { pinning } });
  assert.deepEqual(unset.notes.map((n) => [n.code, n.key]), [['pin-unlists', 'pinning']]);
  for (const listed of [true, false]) {
    const set = resolve({ template: { pinning, listed } });
    assert.deepEqual(set.notes, [], `listed ${listed}`);
  }
  assert.deepEqual(resolve({ template: { pinning: { pinned: { parkable: true }, unpinned: { parkable: false } } } }).notes, []);
  assert.deepEqual(resolve().notes, []);
  assert.deepEqual(resolve({ template: { pinning: { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } } } }).notes, []);
});

// ---------------------------------------------------------------------------
// Property: seeded random layer stacks
// ---------------------------------------------------------------------------

type Rng = () => number;
type Loose = Record<string, unknown>;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const chance = (rng: Rng, p: number): boolean => rng() < p;
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** Keys a stack asks for more often, so the coupling rules fire in most stacks. */
const BOOSTED: Record<string, number> = { parkable: 0.3, closable: 0.25, maxSlots: 0.3, slots: 0.3, overflow: 0.3, clearable: 0.2, afterClose: 0.2, resizable: 0.2, startVisibility: 0.2, restoreVisibility: 0.2 };
const SKEWED_FALSE = new Set(['parkable', 'closable']);
const PIN_VALID = PIN_TABLE.filter((row) => row[2] === 'valid').map((row) => row[1]);
const SLOT_IDS = ['size', 'pin', 'menu'] as const;
const VIEW_KEYS = ['title', 'listed', 'layer', 'slots', 'placeOnAdd', 'enterFrom'];

function randomHeaderButtons(rng: Rng): Loose {
  const map: Loose = {};
  for (const id of SLOT_IDS) {
    if (!chance(rng, 0.4)) continue;
    map[id] = chance(rng, 0.25) ? false : slot(`${id}-${Math.floor(rng() * 3)}`, chance(rng, 0.5) ? { side: 'end', order: 2 } : {});
  }
  return map;
}

function randomLayer(rng: Rng, kind: 'workspace' | 'template' | 'host' | 'instance'): PanelSettings | undefined {
  if (chance(rng, kind === 'host' ? 0.5 : 0.2)) return undefined;
  const layer: Loose = {};
  for (const [key, values] of Object.entries(ENUMERATED)) {
    const p = kind === 'host' ? (VIEW_KEYS.includes(key) ? 0.35 : 0.04) : (BOOSTED[key] ?? 0.08);
    if (!chance(rng, p)) continue;
    layer[key] = SKEWED_FALSE.has(key) ? pick(rng, [false, false, true]) : pick(rng, values);
  }
  if (chance(rng, 0.15)) layer.pinning = pick(rng, PIN_VALID);
  if (chance(rng, 0.2)) layer.headerButtons = randomHeaderButtons(rng);
  return layer as PanelSettings;
}

function randomStack(rng: Rng): { layers: PanelSettingsLayers; options: ResolveOptions } {
  const layers: PanelSettingsLayers = {};
  for (const kind of ['workspace', 'template', 'host', 'instance'] as const) {
    const layer = randomLayer(rng, kind);
    if (layer !== undefined) layers[kind] = layer;
  }
  if (chance(rng, 0.5)) {
    const user: Loose = {};
    if (chance(rng, 0.5)) user.slots = pick(rng, [1, 2, 3, 64] as const);
    if (chance(rng, 0.4)) user.parkable = pick(rng, [false, false, true]);
    if (chance(rng, 0.3)) user.anchor = { panel: 'x', position: pick(rng, ['left', 'right'] as const) };
    layers.user = user as PanelSettingsLayers['user'];
  }
  return { layers, options: { root: chance(rng, 0.15) } };
}

const PIN_DOMAIN = PIN_VALID.map((p) => ({ pinned: {}, unpinned: {}, ...(p as object) }));
const NOTE_CODES = ['override-dropped', 'pin-unlists', 'park-lever-inert', 'resizable-capped'];

const coverage = { stacks: 0, roots: 0, withConflicts: 0, withNotes: 0, userParkableApplied: 0, userSlotsApplied: 0, rules: new Set<string>(), kinds: new Set<string>(), noteCodes: new Set<string>() };

function checkStack(layers: PanelSettingsLayers, options: ResolveOptions): void {
  const before = structuredCloneKeepingFunctions(layers);
  deepFreeze(layers);
  const res = resolve(layers, options);
  assert.deepEqual(resolvePanelSettings(layers, options), res, 'resolving the same layers twice gives equal results');
  assert.deepEqual(layers, before, 'the layers were not changed');
  const v = res.value as unknown as Loose;

  for (const [key, value] of Object.entries(v)) {
    if (key === 'headerButtons') assert.ok(Object.values(value as Loose).every((s) => typeof s === 'object' && s !== null && typeof (s as Loose).label === 'string'), 'headerButtons holds slots only');
    else if (key === 'pinning') assert.ok(PIN_DOMAIN.some((p) => isDeepStrictEqual(p, value)) || isDeepStrictEqual(value, { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } }), 'pinning in domain');
    else assert.ok((ENUMERATED[key] ?? []).some((member) => isDeepStrictEqual(member, value)), `${key} = ${JSON.stringify(value)} is in its domain`);
  }
  for (const key of Object.keys(v)) if (key !== 'headerButtons') assert.ok(key in res.source, `${key} has a source`);

  if (v.parkable === false) {
    const asked = (key: string): boolean => ['template', 'host', 'instance'].includes(res.source[key] as string);
    assert.deepEqual([v.overflow, v.startVisibility, v.restoreVisibility], ['scroll', 'live', 'live'], 'C1');
    const fixed: Loose = { resizable: false, slots: 1, maxSlots: 1 };
    const askedValue = (key: string): unknown => ['instance', 'host', 'template'].map((name) => (name === 'host' && !VIEW_KEYS.includes(key) ? undefined : (layers[name as 'instance'] as Loose | undefined)?.[key])).find((x) => x !== undefined);
    if (!Object.keys(fixed).some((key) => askedValue(key) !== undefined && !isDeepStrictEqual(askedValue(key), fixed[key]))) assert.deepEqual([v.resizable, v.slots, v.maxSlots], [false, 1, 1], 'C1 size');
  }
  if (v.closable === false) assert.equal(v.clearable, false, 'C2');
  assert.ok((v.slots as number) <= (v.maxSlots as number), 'C4');
  if (options.root === true) assert.deepEqual([v.closable, v.parkable, v.clearable], [false, false, false], 'C5');
  for (const key of ['movable', 'listed']) if (res.source[key] === 'derived') assert.equal(v[key], v.parkable, `${key} derived`);
  if (res.source.clearable === 'derived') assert.equal(v.clearable, v.parkable === true && v.closable === true, 'clearable derived');

  for (const [key, layerName] of [['parkable', 'user'], ['slots', 'user']] as const) if (res.source[key] === layerName) {
    const person = layers.user as Loose;
    assert.equal(v[key], key === 'slots' ? Math.min(person.slots as number, v.maxSlots as number) : person[key], `${key} from the user layer`);
    coverage[key === 'parkable' ? 'userParkableApplied' : 'userSlotsApplied'] += 1;
  }
  for (const layerName of ['workspace', 'template', 'host', 'instance'] as const) {
    const layer = layers[layerName] as Loose | undefined;
    if (layer === undefined) continue;
    for (const key of Object.keys(layer)) {
      if (res.source[key] === layerName && key !== 'headerButtons' && key !== 'pinning') assert.ok(isDeepStrictEqual(layer[key], v[key]), `${layerName}.${key} won, so its value stands`);
    }
  }
  const instance = layers.instance as Loose | undefined;
  if (instance !== undefined) {
    for (const key of Object.keys(instance)) {
      if (['hostCreatable', 'hollowDot', 'multiple', 'maxInstances', 'headerButtons', 'pinning'].includes(key)) continue;
      assert.ok(['instance', 'forced', 'user'].includes(res.source[key] as string), `an instance ask of ${key} is beaten only by a rule or the person: ${String(res.source[key])}`);
    }
  }

  const seen = new Set<string>();
  for (const c of res.conflicts) {
    const id = `${c.layer}|${c.key}|${c.kind}`;
    assert.ok(!seen.has(id), `a conflict is recorded once: ${id}`);
    seen.add(id);
    const layer = layers[c.layer] as Loose | undefined;
    assert.ok(layer !== undefined, `the ${c.layer} layer exists`);
    assert.ok(isDeepStrictEqual((layer as Loose)[c.key], c.asked), `${c.layer} asked ${c.key}`);
    assert.ok(isDeepStrictEqual(v[c.key], c.applied), `${c.key} applied`);
    if (c.kind === 'forced') assert.ok(!isDeepStrictEqual(c.asked, c.applied), 'a forced conflict changed something');
    coverage.kinds.add(c.kind);
    if (c.rule !== undefined) coverage.rules.add(c.rule);
  }
  for (const n of res.notes) {
    assert.ok(NOTE_CODES.includes(n.code), `note ${n.code}`);
    coverage.noteCodes.add(n.code);
  }
  coverage.stacks += 1;
  if (options.root === true) coverage.roots += 1;
  if (res.conflicts.length > 0) coverage.withConflicts += 1;
  if (res.notes.length > 0) coverage.withNotes += 1;
}

/** A deep copy that keeps functions by reference: header-button slots hold functions, which structuredClone refuses. */
function structuredCloneKeepingFunctions<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => structuredCloneKeepingFunctions(item as unknown)) as unknown as T;
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([k, inner]) => [k, structuredCloneKeepingFunctions(inner)])) as T;
  return value;
}

test('property: 1200 seeded random layer stacks resolve inside their domains, obey every coupling rule, are deterministic and leave frozen inputs alone', () => {
  const SEED = 20241005;
  const ITERATIONS = 1200;
  let iterations = 0;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const seed = SEED + i;
    const { layers, options } = randomStack(mulberry32(seed));
    try {
      checkStack(layers, options);
    } catch (error) {
      throw new Error(`property failed at seed ${seed} (iteration ${i}): ${error instanceof Error ? error.message : String(error)}\nlayers: ${JSON.stringify(layers)}\noptions: ${JSON.stringify(options)}`, { cause: error });
    }
    iterations += 1;
  }
  assert.ok(iterations >= 1000, `the property ran ${iterations} stacks`);
  assert.equal(iterations, ITERATIONS);
});

test('property: the generator exercised every rule, every conflict kind, the root, the user layer and the notes, so a pass was not an empty run', () => {
  assert.ok(coverage.stacks >= 1000, `${coverage.stacks} stacks were checked before this test`);
  assert.deepEqual([...coverage.rules].sort(), ['C1', 'C2', 'C4', 'C5']);
  assert.deepEqual([...coverage.kinds].sort(), ['forced', 'not-view-settable', 'wrong-scope']);
  assert.deepEqual([...coverage.noteCodes].sort(), ['override-dropped', 'park-lever-inert', 'pin-unlists', 'resizable-capped']);
  assert.ok(coverage.roots >= 100 && coverage.withConflicts >= 300 && coverage.withNotes >= 300, JSON.stringify({ ...coverage, rules: undefined, kinds: undefined, noteCodes: undefined }));
  assert.ok(coverage.userParkableApplied >= 20 && coverage.userSlotsApplied >= 100, JSON.stringify({ ...coverage, rules: undefined, kinds: undefined, noteCodes: undefined }));
});

test('property: a fixed stack holding every layer is not mutated, even deeply frozen, and resolves the same twice', () => {
  const layers: PanelSettingsLayers = deepFreeze({
    workspace: { scrollOnMove: 'none', hostCreatable: false },
    template: { parkable: false, overflow: 'park', headerButtons: { size: slot('Size') } },
    host: { title: 'T' },
    instance: { closable: false, headerButtons: { pin: slot('Pin') } },
    user: { slots: 1, anchor: { panel: 'x', position: 'left' } },
  }) as PanelSettingsLayers;
  const first = resolve(layers);
  assert.deepEqual(resolve(layers), first);
  assert.deepEqual(Object.keys(first.value.headerButtons).sort(), ['pin', 'size']);
});
