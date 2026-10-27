/**
 * What a 0.1.0 consumer relied on, against the vendored 0.1.0 tarball in test/fixtures/compat-0.1.0 (made by
 * tools/gen-compat-corpus.mjs): which names the entry points exported, and what the pure functions answered over
 * seeded random rows. The current export count is computed here and never written as a literal, so a release that
 * only adds exports needs nothing from this file. Values the barrel hides are imported from their defining files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as index from '../index.js';
import * as fakeHost from '../fakeHost.js';
import { computeRowOrder, deriveAnchorsFromOrder } from '../panelRowOrder.js';
import * as panelWindow from '../panelWindow.js';
import { appendPanel, closePanel, movePanel, reanchorPanel, reorderStepsForOffset, restorePanel } from '../panelWindow.js';
import { computeMaxLiveWidth, computeRowLayout } from '../panelRowLayout.js';
import { panelWidthOf } from '../panelTiers.js';
import { ALL_SLOTS } from '../rowConstants.js';
import { hydrateWorkspaceState, projectWorkspaceState } from '../workspaceState.js';

type Names = { values: string[]; types: string[] };
type ExportsFixture = { root: Names; testing: Names; removedSince010: { root: Names; testing: Names } };
type CorpusCase = { fn: string; args: unknown[]; out: unknown };
type Corpus = { replayed: string[]; cases: CorpusCase[] };

const decodeNumber = (_key: string, value: unknown): unknown => {
  if (value && typeof value === 'object' && '$' in value) {
    const spelled: Record<string, number> = { Infinity, '-Infinity': -Infinity, NaN };
    return spelled[String((value as { $: unknown }).$)] ?? value;
  }
  return value;
};

const fixturePath = (name: string): string => fileURLToPath(new URL(`./fixtures/compat-0.1.0/${name}`, import.meta.url));
const readText = (path: string): string => {
  const text = readFileSync(path, 'utf8');
  assert.ok(text.length > 0, `${path} is empty, so a check over it would prove nothing`);
  return text;
};
const exportsFixture = (): ExportsFixture => JSON.parse(readText(fixturePath('exports.json'))) as ExportsFixture;

/** Fixture names the current list no longer holds, sorted. A pure function: the controls below feed it synthetic lists. */
export function compareExports(fixtureNames: readonly string[], currentNames: readonly string[]): { missing: string[] } {
  const current = new Set(currentNames);
  return { missing: fixtureNames.filter((name) => !current.has(name)).sort() };
}

/** Type names are erased at runtime, so the checker lists them: every export that is not also a value. */
function typeExportsOf(program: ts.Program, entry: string): string[] {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  const moduleSymbol = source && checker.getSymbolAtLocation(source);
  assert.ok(moduleSymbol, `${entry} is not a module the compiler can read`);
  return checker
    .getExportsOfModule(moduleSymbol)
    .filter((symbol) => {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      return !(target.flags & ts.SymbolFlags.Value);
    })
    .map((symbol) => symbol.getName())
    .sort();
}

let currentMemo: { root: Names; testing: Names } | undefined;
/** The names the barrels export now: values from the loaded modules, types from the compiler. */
function currentExports(): { root: Names; testing: Names } {
  if (currentMemo) return currentMemo;
  const rootEntry = fileURLToPath(new URL('../index.ts', import.meta.url));
  const testingEntry = fileURLToPath(new URL('../fakeHost.ts', import.meta.url));
  const program = ts.createProgram([rootEntry, testingEntry], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  });
  currentMemo = {
    root: { values: Object.keys(index).sort(), types: typeExportsOf(program, rootEntry) },
    testing: { values: Object.keys(fakeHost).sort(), types: typeExportsOf(program, testingEntry) },
  };
  return currentMemo;
}

/** The four missing lists against `removed`, true when each equals the matching removedSince010 list exactly. */
function missingMatchesRemoved(fixture: ExportsFixture, current: { root: Names; testing: Names }): boolean {
  const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((name, i) => name === [...b].sort()[i]);
  const removed = fixture.removedSince010;
  return (
    same(compareExports(fixture.root.values, current.root.values).missing, removed.root.values) &&
    same(compareExports(fixture.root.types, current.root.types).missing, removed.root.types) &&
    same(compareExports(fixture.testing.values, current.testing.values).missing, removed.testing.values) &&
    same(compareExports(fixture.testing.types, current.testing.types).missing, removed.testing.types)
  );
}

/**
 * The backtick-quoted names of the Removed lists: the first set is every bullet under Unreleased's Removed list and the
 * first top-level bullet of the 0.2.0-rc.1 Removed list; the second is that list's third top-level bullet. One set per group.
 */
function changelogRemovedBullets(): [Set<string>, Set<string>] {
  const lines = readText(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url))).split('\n');
  const removedBullets = (from: number): string[][] => {
    const removedAt = lines.findIndex((line, i) => i > from && /^### Removed\s*$/.test(line));
    const bullets: string[][] = [];
    for (let i = removedAt + 1; removedAt >= 0 && i < lines.length && !/^#{1,3} /.test(lines[i] ?? ''); i += 1) {
      if (/^- /.test(lines[i] ?? '')) bullets.push([]);
      bullets[bullets.length - 1]?.push(lines[i] ?? '');
    }
    return bullets;
  };
  const unreleased = lines.findIndex((line) => /^## (Unreleased|0\.2\.0-rc\.6)\s*$/.test(line));
  const release = lines.findIndex((line) => /^## 0\.2\.0-rc\.1\s*$/.test(line));
  const unreleasedBullets = removedBullets(unreleased);
  const releaseBullets = removedBullets(release);
  assert.ok(unreleased >= 0 && release >= 0, 'CHANGELOG.md has an Unreleased section and a 0.2.0-rc.1 section');
  assert.ok(releaseBullets.length >= 3, 'the 0.2.0-rc.1 Removed list has at least its three bullets');
  // A name after `->` is the replacement the bullet points to, not a name it removes.
  const names = (bullet: string[] | undefined): Set<string> => new Set([...(bullet ?? []).join('\n').matchAll(/(->\s*)?`([^`]+)`/g)].filter((m) => m[1] === undefined).map((m) => m[2] ?? ''));
  const aliases = new Set([...names(releaseBullets[0]), ...unreleasedBullets.flatMap((bullet) => [...names(bullet)])]);
  return [aliases, names(releaseBullets[2])];
}

/** The backtick-quoted names of every Breaking list from the Unreleased section down through 0.2.0-rc.3. */
function changelogBreakingNames(): Set<string> {
  const lines = readText(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url))).split('\n');
  const unreleased = lines.findIndex((line) => /^## (Unreleased|0\.2\.0-rc\.6)\s*$/.test(line));
  const rc3 = lines.findIndex((line) => /^## 0\.2\.0-rc\.3\s*$/.test(line));
  assert.ok(unreleased >= 0 && rc3 >= unreleased, 'CHANGELOG.md has an Unreleased section and a 0.2.0-rc.3 section');
  const end = lines.findIndex((line, i) => i > rc3 && /^## /.test(line));
  const names = new Set<string>();
  let inBreaking = false;
  for (let i = unreleased; i < (end < 0 ? lines.length : end); i += 1) {
    const line = lines[i] ?? '';
    if (/^#{1,3} /.test(line)) inBreaking = /^### Breaking\s*$/.test(line);
    if (inBreaking) for (const m of line.matchAll(/`([^`]+)`/g)) names.add(m[1] ?? '');
  }
  assert.ok(names.size > 0, 'a Breaking list names something');
  return names;
}

test('compat-0.1.0 fixture: 66 root values and 2 testing values in 0.1.0, 49 names since removed (30 root values, 15 root types, 1 testing value, 3 testing types)', () => {
  const fixture = exportsFixture();
  assert.equal(fixture.root.values.length, 66);
  assert.equal(fixture.testing.values.length, 2);
  const removed = fixture.removedSince010;
  assert.equal(removed.root.values.length, 30);
  assert.equal(removed.root.types.length, 15);
  assert.equal(removed.testing.values.length, 1);
  assert.equal(removed.testing.types.length, 3);
  assert.equal(removed.root.values.length + removed.root.types.length + removed.testing.values.length + removed.testing.types.length, 49);
  assert.ok(removed.root.values.every((name) => fixture.root.values.includes(name)), 'every removed root value was a 0.1.0 root value');
  assert.ok(removed.root.types.every((name) => fixture.root.types.includes(name)), 'every removed root type was a 0.1.0 root type');
  assert.ok(removed.testing.values.every((name) => fixture.testing.values.includes(name)), 'every removed testing value was a 0.1.0 testing value');
  assert.ok(removed.testing.types.every((name) => fixture.testing.types.includes(name)), 'every removed testing type was a 0.1.0 testing type');
});

test('compat-0.1.0 current exports: the value list is Object.keys of each barrel, and holds at least the 43 root values the base exported', () => {
  const current = currentExports();
  assert.equal(current.root.values.length, Object.keys(index).length);
  assert.equal(current.testing.values.length, Object.keys(fakeHost).length);
  assert.ok(current.root.values.length >= 43, `the root barrel exports ${current.root.values.length} values; releases only add to the 43 of the base`);
  assert.ok(current.root.types.length > 0 && current.testing.types.length > 0, 'the compiler listed type exports for both entry points');
});

test('compat-0.1.0 removal: the 0.1.0 names the barrels no longer export are exactly removedSince010, and the CHANGELOG Removed and Breaking bullets name each one', () => {
  const fixture = exportsFixture();
  assert.ok(missingMatchesRemoved(fixture, currentExports()), 'fixture names missing now differ from removedSince010');
  const [aliases, hidden] = changelogRemovedBullets();
  const removed = [...fixture.removedSince010.root.values, ...fixture.removedSince010.root.types, ...fixture.removedSince010.testing.values, ...fixture.removedSince010.testing.types];
  const breaking = changelogBreakingNames();
  for (const name of removed) {
    const named = [aliases, hidden, breaking].filter((set) => set.has(name)).length;
    assert.equal(named, 1, `${name} is named by exactly one of the first and third Removed bullets and the Breaking list`);
  }
});

test('compat-0.1.0 controls: compareExports sees a missing Panel, and a longer current list changes nothing', () => {
  const fixture = exportsFixture();
  const current = currentExports();
  assert.ok(missingMatchesRemoved(fixture, current), 'control baseline: the real lists match');
  const withoutPanel = { ...current, root: { ...current.root, values: current.root.values.filter((name) => name !== 'Panel') } };
  assert.ok(current.root.values.includes('Panel'), 'Panel is exported now');
  assert.ok(compareExports(fixture.root.values, withoutPanel.root.values).missing.includes('Panel'), 'a list without Panel reports it missing');
  assert.ok(!missingMatchesRemoved(fixture, withoutPanel), 'so the removal check goes red for it');
  const invented = Array.from({ length: 19 }, (_, i) => `invented${i}`);
  const longer = { ...current, root: { ...current.root, values: [...current.root.values, ...invented] } };
  assert.ok(longer.root.values.length >= 43 && longer.root.values.length === current.root.values.length + 19, 'the synthetic list is longer than the real one');
  assert.ok(missingMatchesRemoved(fixture, longer), 'additions leave missing unchanged, so the removal check stays green');
});

/** The corpus functions by name, each taken from the file that defines it: three of them are hidden from the barrel. */
const call =
  <A extends unknown[]>(fn: (...args: A) => unknown) =>
  (args: unknown[]): unknown =>
    fn(...(args as A));
const counter = (from: number): (() => string) => {
  let n = from;
  return () => String(n++);
};
const REPLAY: Record<string, (args: unknown[]) => unknown> = {
  computeRowOrder: call(computeRowOrder),
  deriveAnchorsFromOrder: call(deriveAnchorsFromOrder),
  appendPanel: call(appendPanel),
  reanchorPanel: call(reanchorPanel),
  closePanel: call(closePanel),
  movePanel: call(movePanel),
  restorePanel: call(restorePanel),
  reorderStepsForOffset: call(reorderStepsForOffset),
  computeRowLayout: call(computeRowLayout),
  computeMaxLiveWidth: call(computeMaxLiveWidth),
  panelWidthOf: call(panelWidthOf),
  projectWorkspaceState: call(projectWorkspaceState),
  hydrateWorkspaceState: ([state, fresh, rootId]) => hydrateWorkspaceState(state as never, counter((fresh as { from: number }).from), rootId as string),
};

// 0.1.0 panels had no uid; the one field this library adds is stripped so the rest still has to match exactly.
function withoutUid(output: unknown): unknown {
  if (!Array.isArray(output)) return output;
  return output.map((p) => {
    if (typeof p !== 'object' || p === null || !('uid' in p)) return p;
    const { uid: _uid, ...rest } = p as Record<string, unknown>;
    return rest;
  });
}

/** What a 0.1.0 tier stood for: width is a slot count now, and the tier word is gone. */
const TIER_SLOTS: Readonly<Record<string, number>> = { phone: 1, tablet: 2, desktop: ALL_SLOTS };

/** `value` with every panel-shaped object's tier read as its slot count and the rest is copied as it is. */
function tiersAsSlots(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(tiersAsSlots);
  if (typeof value !== 'object' || value === null) return value;
  const { formFactor, size: _size, ...rest } = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, held] of Object.entries(rest)) out[key] = tiersAsSlots(held);
  if (typeof formFactor !== 'string' || !(formFactor in TIER_SLOTS)) return 'size' in (value as object) || 'formFactor' in (value as object) ? { ...out, ...('size' in (value as object) ? { size: (value as { size: unknown }).size } : {}) } : out;
  const slots = typeof out.slots === 'number' ? out.slots : TIER_SLOTS[formFactor]!;
  return { ...out, slots };
}

/** `value` without the `locked` field 0.1.0 panels carried: the closable setting replaced it, so nothing writes or reads it any more. */
function withoutLocked(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutLocked);
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, held] of Object.entries(value)) if (key !== 'locked') out[key] = withoutLocked(held);
  return out;
}

/** A saved entry (projectWorkspaceState's output) with its tier read as slots, which are written only above one, and without the counter id this library no longer saves. */
function savedTiersAsSlots(output: unknown): unknown {
  const state = output as { panels?: Record<string, unknown>[] } & Record<string, unknown>;
  if (!Array.isArray(state.panels)) return output;
  return {
    ...state,
    panels: state.panels.map(({ formFactor, id: _id, ...rest }) => {
      const slots = typeof formFactor === 'string' ? TIER_SLOTS[formFactor] : undefined;
      return slots === undefined || slots === 1 ? rest : { ...rest, slots };
    }),
  };
}

/** Functions 0.1.0 had that no longer exist: tiers were removed for slots, so there is nothing left to answer. */
const GONE_SINCE_0_1_0 = ['setFormFactor'];

test('compat-0.1.0 corpus: the pure functions give the vendored 0.1.0 outputs on every seeded input once tiers are read as slots, and no panel they return carries a key property', () => {
  const corpus = JSON.parse(readText(fixturePath('corpus.json')), decodeNumber) as Corpus;
  assert.deepEqual(Object.keys(REPLAY).sort(), corpus.replayed.filter((name) => !GONE_SINCE_0_1_0.includes(name)).sort(), 'this test replays exactly the functions the generator lists that still exist');
  for (const name of GONE_SINCE_0_1_0) assert.ok(!(name in panelWindow), `${name} is gone`);
  let replayed = 0;
  let keyChecked = 0;
  let widened = 0;
  for (const c of corpus.cases) {
    if (GONE_SINCE_0_1_0.includes(c.fn)) continue;
    const replay = REPLAY[c.fn];
    assert.ok(replay, `the corpus names ${c.fn}, which this test does not replay`);
    // A saved file keeps its tiers on purpose: reading them is what hydrateWorkspaceState must still do.
    const args = c.fn === 'hydrateWorkspaceState' ? structuredClone(c.args) : (withoutLocked(tiersAsSlots(structuredClone(c.args))) as unknown[]);
    if (c.fn === 'panelWidthOf' && (args[0] as { slots?: number }).slots !== undefined && (args[0] as { slots: number }).slots > 1) {
      // A wider panel is that many phone widths now, not the stored tier width: slot-sizing.test.ts holds that rule.
      widened += 1;
      continue;
    }
    if (c.fn === 'movePanel' && args[1] === args[3]) {
      // 0.1.0 never moved the root; the pure function now does, and a person's drag is limited by the root's `movable` setting, which is off unless a layer sets it.
      widened += 1;
      continue;
    }
    const actual = withoutUid(replay(args));
    const expected = withoutLocked(c.fn === 'projectWorkspaceState' ? savedTiersAsSlots(c.out) : c.fn === 'panelWidthOf' ? c.out : tiersAsSlots(c.out));
    assert.deepStrictEqual(actual, expected, `${c.fn} case ${replayed} no longer answers as 0.1.0 did`);
    if (['appendPanel', 'restorePanel', 'hydrateWorkspaceState'].includes(c.fn)) {
      for (const output of [expected, actual]) {
        assert.ok(Array.isArray(output), `${c.fn} returns a panel array`);
        for (const panel of output as object[]) {
          assert.ok(!Object.hasOwn(panel, 'key'), `${c.fn} returned a panel with a key property`);
          keyChecked += 1;
        }
      }
    }
    replayed += 1;
  }
  assert.ok(replayed > 0 && replayed + widened + corpus.cases.filter((c) => GONE_SINCE_0_1_0.includes(c.fn)).length === corpus.cases.length, `replayed ${replayed} of ${corpus.cases.length} corpus cases`);
  for (const name of Object.keys(REPLAY)) assert.ok(corpus.cases.some((c) => c.fn === name), `the corpus holds a case for ${name}`);
  assert.ok(keyChecked > 0, 'the key check looked at at least one panel');
});

const HIDDEN_VALUES = [
  'OverlayProvider', 'OverlayStore', 'PanelRowSlot', 'shouldCloseOnRelease', 'computeRowOrder',
  'deriveAnchorsFromOrder', 'summarisePanel', 'computeMaxLiveWidth', 'CaptureRegistryContext', 'vendorLabelForUsbVendorId', 'PhoneDetectPrompt',
];

/** Hidden value names a source takes from the index module, by named import or through a namespace import. */
function hiddenNamesTakenFromIndex(sourceText: string): string[] {
  const source = ts.createSourceFile('inspected.ts', sourceText, ts.ScriptTarget.Latest, true);
  const taken: string[] = [];
  const namespaces = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!/(^|\/)index(\.js|\.ts)?$/.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (HIDDEN_VALUES.includes(imported)) taken.push(imported);
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text) && HIDDEN_VALUES.includes(node.name.text)) taken.push(node.name.text);
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text) && ts.isStringLiteralLike(node.argumentExpression) && HIDDEN_VALUES.includes(node.argumentExpression.text)) {
      taken.push(node.argumentExpression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return taken;
}

test('compat-0.1.0 imports: this file takes none of the ten hidden values from the index module, and never imports the barrel test', () => {
  const own = readText(fileURLToPath(import.meta.url));
  assert.deepEqual(hiddenNamesTakenFromIndex(own), []);
  assert.doesNotMatch(own.split('\n').filter((line) => /^import /.test(line)).join('\n'), /phonux-barrel/, 'importing the barrel test would register its tests a second time');
  assert.deepEqual(hiddenNamesTakenFromIndex("import { computeRowOrder } from '../index.js';"), ['computeRowOrder'], 'control: a named import is reported');
  assert.deepEqual(hiddenNamesTakenFromIndex("import * as barrel from '../index.js';\nvoid barrel.summarisePanel;\nvoid barrel['PanelRowSlot'];"), ['summarisePanel', 'PanelRowSlot'], 'control: a namespace use is reported');
  assert.deepEqual(hiddenNamesTakenFromIndex("import { computeRowOrder } from '../panelRowOrder.js';"), [], 'control: the defining file is not reported');
});
