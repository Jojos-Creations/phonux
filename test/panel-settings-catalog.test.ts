/**
 * The catalog as data: the 72 names, who owns each, its class and doors, the exact defaults, the leaf-module rule, the
 * differential recorder, and the table in DESIGN.md that must equal the descriptors row for row.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { LIBRARY_PANEL_DEFAULTS, LIBRARY_TUNING_DEFAULTS, PANEL_SETTINGS_CATALOG, resolvePanelSettings } from '../index.js';
import type { CatalogName, ResolvedPanelSettings, SettingDescriptor } from '../index.js';
import { createDifferentialRecorder } from './support/differential.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string): string => {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  assert.ok(text.length > 0, `${rel} is empty, so a check on it would prove nothing`);
  return text;
};

/** The set of names, typed so that a name missing from or added to the CatalogName union fails the typecheck. */
const NAME_TABLE: Record<CatalogName, true> = {
  closable: true,
  parkable: true,
  draggable: true,
  crossable: true,
  placeable: true,
  resizable: true,
  slots: true,
  maxSlots: true,
  'tuning.shrinkOutOfView': true,
  'tuning.phoneFit': true,
  'tuning.phoneFitMin': true,
  'tuning.phoneFitMax': true,
  formFactors: true,
  clearable: true,
  hostCreatable: true,
  multiple: true,
  maxInstances: true,
  listed: true,
  startVisibility: true,
  hideStickiness: true,
  hideWhenLast: true,
  capacityReturn: true,
  returnPriority: true,
  overflow: true,
  evictionRank: true,
  evictionOrder: true,
  revealOnScroll: true,
  scrollOnOpen: true,
  scrollOnMove: true,
  scrollOnDrag: true,
  toggleWhenClosed: true,
  showWhenClosed: true,
  viewState: true,
  keepMounted: true,
  frame: true,
  placeOnAdd: true,
  placeOnShow: true,
  placeOnReturn: true,
  placeFallback: true,
  undoPlacement: true,
  layer: true,
  enterFrom: true,
  exitTo: true,
  closeExit: true,
  animated: true,
  formFactor: true,
  title: true,
  pinning: true,
  pinningWhenNotLive: true,
  headerButtons: true,
  persist: true,
  rememberLayout: true,
  restoreVisibility: true,
  afterClose: true,
  undoWindowMs: true,
  reportClose: true,
  snapshot: true,
  'tuning.rowGap': true,
  'tuning.dragToClose': true,
  'tuning.slide': true,
  'tuning.hopFraction': true,
  'tuning.edgeScroll': true,
  'tuning.saveQuietMs': true,
  'tuning.gestureLockMs': true,
  'tuning.gestureQuietMs': true,
  'tuning.resizeSettleSlides': true,
  'tuning.returnTieBreak': true,
  'tuning.dropTieBreak': true,
  'tuning.rowGesture': true,
  'tuning.initialScroll': true,
  'tuning.chrome': true,
  'tuning.maxLivePanels': true,
};
const NAMES = Object.keys(NAME_TABLE) as CatalogName[];
const DERIVED_KEYS = ['draggable', 'placeable', 'listed', 'clearable', 'slots', 'maxSlots'] as const;

/** The one assignment of every name to the entry that enforces it. */
const OWNER_TABLE: ReadonlyArray<readonly [string, readonly CatalogName[]]> = [
  ['phonux-engine-permission-settings', ['closable', 'parkable', 'draggable', 'crossable', 'placeable', 'resizable', 'formFactors', 'clearable', 'listed', 'formFactor', 'title', 'undoWindowMs', 'reportClose', 'snapshot']],
  ['phonux-engine-visibility-settings', ['startVisibility', 'hideStickiness', 'hideWhenLast', 'capacityReturn', 'returnPriority', 'evictionRank', 'evictionOrder', 'viewState', 'tuning.saveQuietMs', 'tuning.gestureLockMs', 'tuning.gestureQuietMs', 'tuning.returnTieBreak', 'tuning.dropTieBreak']],
  ['phonux-engine-placement-and-motion-settings', ['placeOnAdd', 'placeOnShow', 'placeOnReturn', 'placeFallback', 'undoPlacement', 'layer', 'enterFrom', 'exitTo', 'closeExit', 'animated']],
  ['phonux-engine-tuning-look-settings', ['tuning.rowGap', 'tuning.dragToClose', 'tuning.slide', 'tuning.hopFraction', 'tuning.chrome', 'tuning.resizeSettleSlides']],
  ['phonux-keep-mounted-render-path', ['keepMounted']],
  ['phonux-row-numbers-and-overflow', ['overflow']],
  ['phonux-row-scroll-gesture-and-requests', ['revealOnScroll', 'scrollOnOpen', 'scrollOnMove', 'tuning.rowGesture', 'tuning.initialScroll']],
  ['phonux-edge-scroll-while-dragging', ['scrollOnDrag', 'tuning.edgeScroll']],
  ['phonux-saved-overrides-and-template-paths', ['persist', 'rememberLayout', 'restoreVisibility', 'hostCreatable', 'multiple', 'maxInstances']],
  ['phonux-workspace-attach-and-snapshot', ['afterClose']],
  ['phonux-panel-handle-operations', ['toggleWhenClosed', 'showWhenClosed']],
  ['phonux-pin-and-reset', ['pinning', 'pinningWhenNotLive']],
  ['phonux-header-buttons', ['headerButtons']],
  ['phonux-max-live-panels', ['tuning.maxLivePanels']],
  ['phonux-slot-sizing-resizable-root-v3', ['slots', 'maxSlots']],
  ['phonux-shrink-whole-panels-v1', ['tuning.shrinkOutOfView']],
  ['phonux-default-frame-v3', ['frame']],
  ['phonux-fit-phone-to-screen-v3', ['tuning.phoneFit', 'tuning.phoneFitMin', 'tuning.phoneFitMax']],
];

/** Problems in a name-to-entry table: a name with no entry, a name given two entries, or a name outside the catalog. */
function ownerTableProblems(table: ReadonlyArray<readonly [string, readonly string[]]>): string[] {
  const seen = new Map<string, string>();
  const problems: string[] = [];
  for (const [id, names] of table) {
    for (const name of names) {
      if (!(name in NAME_TABLE)) problems.push(`${name} is not a catalog name`);
      const earlier = seen.get(name);
      if (earlier !== undefined) problems.push(`${name} is owned by both ${earlier} and ${id}`);
      seen.set(name, id);
    }
  }
  for (const name of NAMES) if (!seen.has(name)) problems.push(`${name} has no owner`);
  return problems;
}

const OWNER_OF = new Map<string, string>(OWNER_TABLE.flatMap(([id, names]) => names.map((n) => [n, id] as const)));

/** The scrolling defaults, spelled once. Nothing else in the test suite writes these values. */
const SCROLL_DEFAULTS = {
  scrollOnOpen: 'into-view',
  scrollOnMove: 'follow',
  revealOnScroll: 'edges',
  tuning: { edgeScroll: { zonePx: 48, maxPxPerSec: 900, reducedStepMs: 500 }, initialScroll: 'start' },
} as const;

const TEMPLATE_KEYS: readonly CatalogName[] = ['hostCreatable', 'multiple', 'maxInstances'];
const WORKSPACE_ONLY_KEYS: readonly CatalogName[] = ['tuning.rowGap', 'tuning.saveQuietMs', 'tuning.gestureLockMs', 'tuning.gestureQuietMs', 'tuning.resizeSettleSlides', 'tuning.returnTieBreak', 'tuning.dropTieBreak', 'tuning.rowGesture', 'tuning.initialScroll', 'tuning.maxLivePanels', 'tuning.chrome', 'tuning.shrinkOutOfView', 'tuning.phoneFit', 'tuning.phoneFitMin', 'tuning.phoneFitMax'];
const PER_PANEL_TUNING: readonly CatalogName[] = ['tuning.dragToClose', 'tuning.slide', 'tuning.hopFraction', 'tuning.edgeScroll'];
const expectedDoors = (name: CatalogName): readonly string[] => {
  if (TEMPLATE_KEYS.includes(name)) return ['template'];
  if (WORKSPACE_ONLY_KEYS.includes(name)) return ['tuning'];
  if (PER_PANEL_TUNING.includes(name)) return ['instance', 'tuning'];
  return ['instance'];
};

const descriptorOf = (name: string): SettingDescriptor => {
  const found = PANEL_SETTINGS_CATALOG.filter((d) => d.name === name);
  assert.equal(found.length, 1, `${name} must have exactly one descriptor`);
  return found[0] as SettingDescriptor;
};

// ---------------------------------------------------------------------------
// The table in DESIGN.md
// ---------------------------------------------------------------------------

interface DocRow {
  name: string;
  values: string;
  default: string;
  onConfigure: string;
  classWord: string;
}

function parseDocRows(doc: string): DocRow[] {
  const start = doc.indexOf('<!-- catalog:start -->');
  const end = doc.indexOf('<!-- catalog:end -->');
  assert.ok(start >= 0 && end > start, 'DESIGN.md must hold the catalog:start and catalog:end markers, in that order');
  const rows: DocRow[] = [];
  for (const line of doc.slice(start, end).split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.slice(1, line.lastIndexOf('|')).split('|').map((c) => c.trim());
    if (cells.length !== 4) throw new Error(`a catalog row must have four cells: ${line}`);
    const [name = '', values = '', def = '', onConfigure = ''] = cells;
    if (name === 'Setting' || /^-+$/.test(name)) continue;
    rows.push({ name: name.replace(/^`|`$/g, ''), values, default: def, onConfigure, classWord: /^[A-Z]+/.exec(onConfigure)?.[0] ?? '' });
  }
  return rows;
}

/** Everything wrong with a copy of DESIGN.md against the exported descriptors; empty when the table agrees. */
function docDriftProblems(doc: string): string[] {
  const problems: string[] = [];
  const rows = parseDocRows(doc);
  if (rows.length !== 72) problems.push(`the table has ${rows.length} rows, not 72`);
  const byName = new Map(rows.map((r) => [r.name, r]));
  if (byName.size !== rows.length) problems.push('a name appears in two rows');
  for (const d of PANEL_SETTINGS_CATALOG) {
    const row = byName.get(d.name);
    if (row === undefined) {
      problems.push(`${d.name} has no row`);
      continue;
    }
    if (row.values !== d.values) problems.push(`${d.name}: values differ`);
    if (row.default !== d.default) problems.push(`${d.name}: default differs`);
    if (row.classWord !== d.configure.cls) problems.push(`${d.name}: class word ${row.classWord} is not ${d.configure.cls}`);
  }
  for (const name of byName.keys()) if (!(name in NAME_TABLE)) problems.push(`${name} is not a catalog name`);
  return problems;
}

const DOC = read('DESIGN.md');

// ---------------------------------------------------------------------------
// Completeness
// ---------------------------------------------------------------------------

test('catalog: the name set is non-empty and has 72 names, one descriptor each, in no repeated order slot', () => {
  assert.ok(NAMES.length > 0);
  assert.equal(NAMES.length, 72, "the design's count is 72: a changed count must change the design");
  assert.equal(PANEL_SETTINGS_CATALOG.length, 72);
  assert.deepEqual([...PANEL_SETTINGS_CATALOG.map((d) => d.name)].sort(), [...NAMES].sort());
  assert.equal(new Set(PANEL_SETTINGS_CATALOG.map((d) => d.name)).size, 72);
});

test('catalog: the name set equals the keys of the two defaults objects plus the derived keys and the rows of the DESIGN.md table', () => {
  const fromDefaults = new Set<string>([
    ...Object.keys(LIBRARY_PANEL_DEFAULTS),
    ...Object.keys(LIBRARY_TUNING_DEFAULTS).map((leaf) => `tuning.${leaf}`),
    ...DERIVED_KEYS,
  ]);
  assert.deepEqual([...fromDefaults].sort(), [...NAMES].sort());
  assert.deepEqual(parseDocRows(DOC).map((r) => r.name).sort(), [...NAMES].sort());
  assert.equal(fromDefaults.size, 72);
});

test('catalog: PANEL_SETTINGS_CATALOG is frozen all the way down', () => {
  assert.ok(Object.isFrozen(PANEL_SETTINGS_CATALOG));
  for (const d of PANEL_SETTINGS_CATALOG) {
    assert.ok(Object.isFrozen(d) && Object.isFrozen(d.configure) && Object.isFrozen(d.configure.doors), `${d.name} is not frozen`);
  }
});

test('catalog: OWNER_ENTRY assigns each of the 72 names to exactly one of 17 ids', () => {
  assert.deepEqual(ownerTableProblems(OWNER_TABLE), []);
  assert.equal(OWNER_OF.size, 72);
  assert.equal(new Set(OWNER_OF.values()).size, 18);
  assert.deepEqual(OWNER_TABLE.map(([, names]) => names.length), [14, 13, 10, 6, 1, 1, 5, 2, 6, 1, 2, 2, 1, 1, 2, 1, 1, 3]);
});

test('catalog: a scratch owner table with one name moved to a second id, or dropped, fails', () => {
  const moved = OWNER_TABLE.map(([id, names]) => [id, id === 'phonux-header-buttons' ? [...names, 'closable'] : names] as const);
  assert.ok(ownerTableProblems(moved).some((p) => p.includes('closable is owned by both')));
  const dropped = OWNER_TABLE.map(([id, names]) => [id, names.filter((n) => n !== 'overflow')] as const);
  assert.ok(ownerTableProblems(dropped).some((p) => p.includes('overflow has no owner')));
  assert.deepEqual(ownerTableProblems(OWNER_TABLE), [], 'control: the real table has no problem, so the two probes above could have passed');
});

test('catalog: the classes are NOW 19, NEXT 45, STATE 5 and SCOPE 3, and STATE and SCOPE name the expected keys', () => {
  const by = (cls: string) => PANEL_SETTINGS_CATALOG.filter((d) => d.configure.cls === cls).map((d) => d.name);
  assert.equal(by('NOW').length, 19);
  assert.equal(by('NEXT').length, 45);
  assert.deepEqual(by('STATE').sort(), ['formFactors', 'keepMounted', 'maxSlots', 'parkable', 'viewState']);
  assert.deepEqual(by('SCOPE').sort(), ['hostCreatable', 'maxInstances', 'multiple']);
});

test('catalog: the doors are template for 3 names, tuning for 17, instance and tuning for 4 and instance for the other 50', () => {
  const by = (doors: string) => PANEL_SETTINGS_CATALOG.filter((d) => d.configure.doors.join(',') === doors).map((d) => d.name);
  assert.deepEqual(by('template').sort(), [...TEMPLATE_KEYS].sort());
  assert.deepEqual(by('tuning').sort(), [...WORKSPACE_ONLY_KEYS].sort());
  assert.deepEqual(by('instance,tuning').sort(), [...PER_PANEL_TUNING].sort());
  assert.equal(by('instance').length, 50);
});

test('catalog: only title, listed, layer, formFactor, slots, placeOnAdd and enterFrom are view-settable', () => {
  assert.deepEqual(PANEL_SETTINGS_CATALOG.filter((d) => d.viewSettable).map((d) => d.name).sort(), ['enterFrom', 'formFactor', 'layer', 'listed', 'placeOnAdd', 'slots', 'title']);
});

for (const name of NAMES) {
  test(`catalog row ${name}: owner, class, doors and scope agree with the table and the DESIGN.md row`, () => {
    const d = descriptorOf(name);
    assert.equal(d.ownerEntry, OWNER_OF.get(name), 'ownerEntry equals its OWNER_ENTRY row');
    assert.deepEqual([...d.configure.doors], expectedDoors(name));
    assert.ok(d.configure.doors.length > 0);
    const scope = { template: 'template', tuning: 'workspace', 'instance,tuning': 'panel or workspace', instance: 'instance' }[d.configure.doors.join(',')];
    assert.equal(d.scope, scope);
    assert.equal(d.group === 'tuning', name.startsWith('tuning.'));
    const row = parseDocRows(DOC).find((r) => r.name === name);
    assert.ok(row, `${name} has a row in DESIGN.md`);
    assert.equal(row.values, d.values);
    assert.equal(row.default, d.default);
    assert.equal(row.classWord, d.configure.cls);
    assert.ok(new RegExp(`^${d.configure.cls}[ .]`).test(row.onConfigure), 'the on_configure cell opens with the class word');
  });
}

// ---------------------------------------------------------------------------
// Docs drift
// ---------------------------------------------------------------------------

test('docs drift: DESIGN.md has exactly 72 rows between the markers and every name, values, default and class word matches', () => {
  assert.deepEqual(docDriftProblems(DOC), []);
  assert.equal(parseDocRows(DOC).length, 72);
});

test('docs drift: editing one default in a scratch copy of the doc is caught', () => {
  const edited = DOC.replace('| `returnPriority` | integer | 0 |', '| `returnPriority` | integer | 1 |');
  assert.notEqual(edited, DOC, 'the planted edit must change the text');
  assert.ok(docDriftProblems(edited).some((p) => p.startsWith('returnPriority: default differs')));
});

test('docs drift: changing one class word in a scratch copy of the doc is caught', () => {
  const edited = DOC.replace(/(\| `crossable` \|[^\n]*\| )NOW\./, '$1NEXT.');
  assert.notEqual(edited, DOC, 'the planted edit must change the text');
  assert.ok(docDriftProblems(edited).some((p) => p.startsWith('crossable: class word NEXT is not NOW')));
});

test('docs drift: a scratch copy with a row dropped, or a row added, fails the count', () => {
  const dropped = DOC.replace(/\| `snapshot` \|[^\n]*\n/, '');
  assert.ok(docDriftProblems(dropped).some((p) => p.includes('71 rows')));
  const added = DOC.replace('<!-- catalog:end -->', '| `extra` | x | y | NOW. z |\n<!-- catalog:end -->');
  assert.ok(docDriftProblems(added).some((p) => p.includes('73 rows')));
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

test('defaults: LIBRARY_TUNING_DEFAULTS deep-equals the exact object, with the scrolling members from SCROLL_DEFAULTS', () => {
  assert.deepEqual(LIBRARY_TUNING_DEFAULTS, {
    rowGap: 16,
    dragToClose: { distanceFraction: 0.25, minDistancePx: 80, flickMinDistancePx: 40, flickVelocity: 700, cancelVelocity: -300, directionLockPx: 8, restMs: 50, velocityWindowMs: 100, snapBack: { stiffness: 520, damping: 42 } },
    slide: { durationSec: 0.4, ease: [0.2, 0, 0, 1], closeExitSeconds: 0.18, closeExitEase: 'easeIn', glideEase: 'cubic-out' },
    hopFraction: 0.5,
    edgeScroll: SCROLL_DEFAULTS.tuning.edgeScroll,
    saveQuietMs: 500,
    gestureLockMs: 60,
    gestureQuietMs: 150,
    resizeSettleSlides: 1.25,
    returnTieBreak: 'latest-first',
    dropTieBreak: 'leftmost',
    rowGesture: 'step',
    initialScroll: SCROLL_DEFAULTS.tuning.initialScroll,
    chrome: { mode: 'always', fadeMs: 120, fadeEase: 'easeOut', slideMs: 140, slidePx: 8, graceMs: 250 },
    maxLivePanels: null,
    shrinkOutOfView: 'off',
    phoneFit: 'off',
    phoneFitMin: 0.82,
    phoneFitMax: 1.13,
  });
});

test('defaults: the slide and edgeScroll members are separate frozen objects, and the whole table is frozen', () => {
  const t = LIBRARY_TUNING_DEFAULTS;
  assert.ok(Object.isFrozen(t) && Object.isFrozen(t.slide) && Object.isFrozen(t.edgeScroll) && Object.isFrozen(t.slide.ease) && Object.isFrozen(t.dragToClose.snapBack));
  assert.notEqual(t.slide as object, t.edgeScroll as object);
  assert.ok(Object.isFrozen(LIBRARY_PANEL_DEFAULTS) && Object.isFrozen(LIBRARY_PANEL_DEFAULTS.formFactors) && Object.isFrozen(LIBRARY_PANEL_DEFAULTS.pinning.pinned));
});

test('defaults: the tuning defaults of one resolve are the library ones, and a resolve hands out frozen copies of the library members', () => {
  const { value } = resolvePanelSettings();
  assert.deepEqual(value.tuning, {
    dragToClose: LIBRARY_TUNING_DEFAULTS.dragToClose,
    slide: LIBRARY_TUNING_DEFAULTS.slide,
    hopFraction: LIBRARY_TUNING_DEFAULTS.hopFraction,
    edgeScroll: LIBRARY_TUNING_DEFAULTS.edgeScroll,
  });
  assert.ok(Object.isFrozen(value.tuning) && Object.isFrozen(value.tuning.slide));
});

/** Every key of ResolvedPanelSettings but title, as literals: a key missing here fails the typecheck. */
const RESOLVED_DEFAULTS: { [K in Exclude<keyof ResolvedPanelSettings, 'title'>]: unknown } = {
  closable: true,
  parkable: true,
  draggable: true,
  crossable: true,
  placeable: true,
  resizable: true,
  slots: 1,
  maxSlots: 64,
  formFactors: ['phone', 'tablet', 'desktop'],
  clearable: true,
  hostCreatable: true,
  multiple: false,
  maxInstances: 'unlimited',
  listed: true,
  startVisibility: 'live',
  hideStickiness: 'sticky',
  hideWhenLast: 'allow',
  capacityReturn: 'auto',
  returnPriority: 0,
  overflow: 'scroll',
  evictionRank: 0,
  evictionOrder: 'farthest',
  revealOnScroll: SCROLL_DEFAULTS.revealOnScroll,
  scrollOnOpen: SCROLL_DEFAULTS.scrollOnOpen,
  scrollOnMove: SCROLL_DEFAULTS.scrollOnMove,
  scrollOnDrag: 'edge',
  toggleWhenClosed: 'ignore',
  showWhenClosed: 'refuse',
  viewState: 'keep',
  keepMounted: false,
  frame: 'auto',
  placeOnAdd: 'row-end',
  placeOnShow: 'in-place',
  placeOnReturn: 'in-place',
  placeFallback: 'row-end',
  undoPlacement: 'old-slot',
  layer: 'base',
  enterFrom: 'auto',
  exitTo: 'auto',
  closeExit: 'down',
  animated: true,
  formFactor: 'phone',
  pinning: { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } },
  pinningWhenNotLive: 'place-only',
  headerButtons: {},
  persist: 'saved',
  rememberLayout: true,
  restoreVisibility: 'saved',
  afterClose: 'stay-closed',
  undoWindowMs: 10000,
  reportClose: true,
  snapshot: 'both',
  tuning: {
    dragToClose: { distanceFraction: 0.25, minDistancePx: 80, flickMinDistancePx: 40, flickVelocity: 700, cancelVelocity: -300, directionLockPx: 8, restMs: 50, velocityWindowMs: 100, snapBack: { stiffness: 520, damping: 42 } },
    slide: { durationSec: 0.4, ease: [0.2, 0, 0, 1], closeExitSeconds: 0.18, closeExitEase: 'easeIn', glideEase: 'cubic-out' },
    hopFraction: 0.5,
    edgeScroll: SCROLL_DEFAULTS.tuning.edgeScroll,
  },
};

test('defaults: resolving no layers gives every key of ResolvedPanelSettings its library default, as a table of literals', () => {
  const { value, source, conflicts, notes } = resolvePanelSettings();
  assert.deepEqual(value, RESOLVED_DEFAULTS);
  assert.deepEqual(Object.keys(value).sort(), Object.keys(RESOLVED_DEFAULTS).sort());
  assert.equal('title' in value, false, 'title has no default and is absent');
  assert.deepEqual(conflicts, []);
  assert.deepEqual(notes, []);
  assert.equal(Object.keys(RESOLVED_DEFAULTS).length, 53);
  for (const [key, layer] of Object.entries(source)) assert.equal(layer, (DERIVED_KEYS as readonly string[]).includes(key) ? 'derived' : 'library', `source of ${key}`);
});

test('defaults: every key LIBRARY_PANEL_DEFAULTS holds, except title, appears in the resolved value unchanged', () => {
  const { value } = resolvePanelSettings();
  for (const [key, expected] of Object.entries(LIBRARY_PANEL_DEFAULTS)) {
    if (key === 'title') continue;
    assert.deepEqual((value as unknown as Record<string, unknown>)[key], expected, key);
  }
});

test('defaults: the resolved value is deeply frozen and equal on a second resolve', () => {
  const a = resolvePanelSettings();
  const b = resolvePanelSettings();
  assert.deepEqual(a, b);
  assert.ok(Object.isFrozen(a.value) && Object.isFrozen(a.value.formFactors) && Object.isFrozen(a.value.pinning.pinned) && Object.isFrozen(a.value.headerButtons));
});

// ---------------------------------------------------------------------------
// Leaf modules
// ---------------------------------------------------------------------------

/** The specifiers of every import that loads code at runtime: plain imports, bare imports, re-exports and import(). */
function valueImports(source: string, fileName = 'x.ts'): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly = clause !== undefined && (clause.isTypeOnly || (clause.name === undefined && clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((e) => e.isTypeOnly)));
      if (!typeOnly) found.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
      found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      found.push(arg !== undefined && ts.isStringLiteral(arg) ? arg.text : '(dynamic)');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const LEAF_ALLOWED: Record<string, readonly string[]> = {
  'panelSettings.ts': ['./rowConstants.js', './panelManagerError.js'],
  'panelManagerError.ts': [],
  'rowConstants.ts': [],
};

test('leaf modules: panelSettings.ts value-imports only rowConstants and panelManagerError; the other two leaves import nothing at runtime', () => {
  for (const [file, allowed] of Object.entries(LEAF_ALLOWED)) {
    const found = valueImports(read(file), file);
    assert.deepEqual(found.filter((spec) => !allowed.includes(spec)), [], `${file} value-imports a module outside its leaf set`);
  }
  assert.deepEqual(valueImports(read('panelSettings.ts'), 'panelSettings.ts').sort(), ['./panelManagerError.js', './rowConstants.js'], 'both leaves are really imported, so the scan read the right file');
});

test('leaf modules: a planted source importing PanelRowSlot, or loading anything at runtime another way, is flagged', () => {
  assert.deepEqual(valueImports("import { PanelRowSlot } from './PanelRowSlot.js';"), ['./PanelRowSlot.js']);
  assert.deepEqual(valueImports("import './side-effect.js';"), ['./side-effect.js']);
  assert.deepEqual(valueImports("export { x } from './re-export.js';"), ['./re-export.js']);
  assert.deepEqual(valueImports("const m = await import('./lazy.js');"), ['./lazy.js']);
  assert.deepEqual(valueImports("import { a, type B } from './mixed.js';"), ['./mixed.js']);
  assert.deepEqual(valueImports("import type { A } from './a.js';\nimport { type B } from './b.js';\nexport type { C } from './c.js';"), [], 'type-only forms load nothing');
});

// ---------------------------------------------------------------------------
// Doors, descriptors only
// ---------------------------------------------------------------------------

const CALLS = ['configure', 'configureTemplate', 'configureTuning'] as const;
const DOOR_OF = { configure: 'instance', configureTemplate: 'template', configureTuning: 'tuning' } as const;
const KEY_CLASSES = { 'instance key': 'closable', 'template key': 'hostCreatable', 'workspace-only tuning key': 'tuning.rowGap', 'per-panel tuning leaf': 'tuning.slide' } as const;
/** Which call admits which class of key: written by hand, never derived from the descriptors. */
const ADMITS: Record<(typeof CALLS)[number], Record<keyof typeof KEY_CLASSES, boolean>> = {
  configure: { 'instance key': true, 'template key': false, 'workspace-only tuning key': false, 'per-panel tuning leaf': true },
  configureTemplate: { 'instance key': false, 'template key': true, 'workspace-only tuning key': false, 'per-panel tuning leaf': false },
  configureTuning: { 'instance key': false, 'template key': false, 'workspace-only tuning key': true, 'per-panel tuning leaf': true },
};

test('doors: every descriptor lists a non-empty set of instance, template or tuning, and the three calls by four key classes admit what the table says', () => {
  for (const d of PANEL_SETTINGS_CATALOG) {
    assert.ok(d.configure.doors.length > 0, d.name);
    for (const door of d.configure.doors) assert.ok(['instance', 'template', 'tuning'].includes(door), `${d.name}: ${door}`);
  }
  let executed = 0;
  for (const call of CALLS) {
    for (const [klass, name] of Object.entries(KEY_CLASSES)) {
      const admitted = descriptorOf(name).configure.doors.includes(DOOR_OF[call]);
      assert.equal(admitted, ADMITS[call][klass as keyof typeof KEY_CLASSES], `${call} x ${klass} (${name})`);
      executed += 1;
    }
  }
  assert.equal(executed, CALLS.length * Object.keys(KEY_CLASSES).length);
  assert.equal(executed, 12);
});

test('doors: every name of each key class is admitted by exactly the calls its class allows', () => {
  const classOf = (name: CatalogName): keyof typeof KEY_CLASSES => (TEMPLATE_KEYS.includes(name) ? 'template key' : WORKSPACE_ONLY_KEYS.includes(name) ? 'workspace-only tuning key' : PER_PANEL_TUNING.includes(name) ? 'per-panel tuning leaf' : 'instance key');
  let checked = 0;
  for (const d of PANEL_SETTINGS_CATALOG) {
    for (const call of CALLS) {
      assert.equal(d.configure.doors.includes(DOOR_OF[call]), ADMITS[call][classOf(d.name)], `${d.name} via ${call}`);
      checked += 1;
    }
  }
  assert.equal(checked, 72 * 3);
});

// ---------------------------------------------------------------------------
// The differential recorder
// ---------------------------------------------------------------------------

const SOME_NAME = 'closable';
const OTHER_NAME = 'parkable';

test('differential: a scenario that runs both values with different outputs passes and records the name', () => {
  const recorder = createDifferentialRecorder();
  recorder.differential(SOME_NAME, (run) => {
    assert.equal(run(true, () => 'on'), 'on');
    run(false, () => 'off');
  });
  assert.deepEqual(recorder.covered(), [SOME_NAME]);
});

test('differential: a planted no-op scenario that runs nothing fails', () => {
  const recorder = createDifferentialRecorder();
  assert.throws(() => recorder.differential(SOME_NAME, () => {}), /ran 0 value/);
  assert.deepEqual(recorder.covered(), []);
});

test('differential: a scenario that ran only one value fails', () => {
  const recorder = createDifferentialRecorder();
  assert.throws(() => recorder.differential(SOME_NAME, (run) => void run(true, () => 1)), /ran 1 value/);
  assert.deepEqual(recorder.covered(), []);
});

test('differential: a scenario whose two values give equal outputs fails', () => {
  const recorder = createDifferentialRecorder();
  assert.throws(
    () =>
      recorder.differential(SOME_NAME, (run) => {
        run(true, () => ({ same: 1 }));
        run(false, () => ({ same: 1 }));
      }),
    /equal outputs/,
  );
});

test('differential: two runs with the same value fail, and a name outside the catalog is refused', () => {
  const recorder = createDifferentialRecorder();
  assert.throws(
    () =>
      recorder.differential(SOME_NAME, (run) => {
        run(true, () => 1);
        run(true, () => 2);
      }),
    /same value/,
  );
  assert.throws(() => recorder.differential('notASetting', (run) => void run(1, () => 1)), /not a catalog name/);
});

test('differential: covered names accumulate sorted and a file can assert covered equals owned', () => {
  const recorder = createDifferentialRecorder();
  const owned = [SOME_NAME, OTHER_NAME];
  for (const name of owned) {
    recorder.differential(name, (run) => {
      run(true, () => name);
      run(false, () => `${name}-off`);
    });
  }
  assert.deepEqual(recorder.covered(), [...owned].sort());
  assert.notDeepEqual(recorder.covered(), [...owned, 'listed'].sort(), 'control: a missing name makes the sets differ');
});
