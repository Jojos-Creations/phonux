#!/usr/bin/env node
// Regenerates test/fixtures/compat-0.1.0 from the published phonux@0.1.0 tarball:
//   exports.json   the value and type names of both entry points, and removedSince010 (see below)
//   corpus.json    inputs and outputs of the pure functions listed in REPLAYED, over seeded random rows
//   manifest.json  sha256 of every tarball file and whether pkg/ stores it
//   pkg/           the tarball's .js, .d.ts and package.json files, byte for byte
// The tarball is fetched into a scratch directory and its integrity must equal the registry's, else this exits
// non-zero saying it proved nothing: offline, a missing version and a different tarball all look the same to a
// reader of a green run. Running it twice must leave `git status --porcelain test/fixtures` empty.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deepStrictEqual } from 'node:assert';
import ts from 'typescript';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(REPO_ROOT, 'test', 'fixtures', 'compat-0.1.0');
const SPEC = 'phonux@0.1.0';
const ROOT_ID = 'root';
const SEED = 0x5eed0010;
const CASES_PER_FUNCTION = 14;

// Pure functions replayed against current code, each from the file that defines it. effectiveMaxPanels is absent on
// purpose: its signature is meant to change.
const REPLAYED = [
  ['computeRowOrder', 'panelRowOrder'],
  ['deriveAnchorsFromOrder', 'panelRowOrder'],
  ['appendPanel', 'panelWindow'],
  ['reanchorPanel', 'panelWindow'],
  ['closePanel', 'panelWindow'],
  ['movePanel', 'panelWindow'],
  ['setFormFactor', 'panelWindow'],
  ['restorePanel', 'panelWindow'],
  ['reorderStepsForOffset', 'panelWindow'],
  ['computeRowLayout', 'panelRowLayout'],
  ['computeMaxLiveWidth', 'panelRowLayout'],
  ['panelWidthOf', 'panelTiers'],
  ['projectWorkspaceState', 'workspaceState'],
  ['hydrateWorkspaceState', 'workspaceState'],
];

// Thrown, not process.exit, so main's finally block still removes the scratch directory.
function fail(message) {
  throw new Error(message);
}

function proveNothing(why) {
  fail(`${why}. Nothing was written: a corpus not checked against the published tarball proves nothing.`);
}

function sha(algorithm, bytes, encoding) {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function npm(args, cwd) {
  return spawnSync('npm', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// ---- the tarball -----------------------------------------------------------------------------------------------

function fetchTarball(scratch) {
  const view = npm(['view', SPEC, 'dist.integrity'], scratch);
  const registryIntegrity = (view.stdout ?? '').trim();
  if (view.status !== 0 || !registryIntegrity.startsWith('sha512-')) {
    proveNothing(`npm view ${SPEC} dist.integrity failed (exit ${view.status}): ${(view.stderr ?? '').trim().split('\n')[0] || 'no output'}`);
  }
  const pack = npm(['pack', SPEC, '--pack-destination', scratch, '--json'], scratch);
  let filename;
  try {
    filename = JSON.parse(pack.stdout)[0].filename;
  } catch {
    proveNothing(`npm pack ${SPEC} failed (exit ${pack.status}): ${(pack.stderr ?? '').trim().split('\n')[0] || 'no output'}`);
  }
  const tarball = join(scratch, filename);
  const localIntegrity = `sha512-${sha('sha512', readFileSync(tarball), 'base64')}`;
  if (localIntegrity !== registryIntegrity) {
    proveNothing(`the tarball's integrity ${localIntegrity} is not the registry's ${registryIntegrity}`);
  }
  const extracted = join(scratch, 'extracted');
  mkdirSync(extracted);
  const tar = spawnSync('tar', ['-xzf', tarball, '-C', extracted], { encoding: 'utf8' });
  if (tar.status !== 0) fail(`tar could not unpack the tarball: ${tar.stderr}`);
  return { integrity: registryIntegrity, packageDir: join(extracted, 'package') };
}

function listFiles(dir, prefix = '') {
  const found = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...listFiles(full, `${prefix}${name}/`));
    else found.push(`${prefix}${name}`);
  }
  return found;
}

// Only what a consumer's compiler or loader reads. Markdown stays out: the commit hook would lint or rewrite it.
const isStored = (path) => path === 'package.json' || path.endsWith('.js') || path.endsWith('.d.ts');

// ---- exports ---------------------------------------------------------------------------------------------------

const COMPILER_OPTIONS = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  types: [],
};

// Value exports are what Object.keys of the built module lists; anything left over is a type. A class is a value.
function entryExports(rootFile) {
  const program = ts.createProgram([rootFile], COMPILER_OPTIONS);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(rootFile);
  const moduleSymbol = source && checker.getSymbolAtLocation(source);
  if (!moduleSymbol) fail(`${rootFile} is not a module the compiler can read`);
  const unresolved = program.getSemanticDiagnostics(source).filter((d) => [2305, 2307, 2724, 2694].includes(d.code));
  if (unresolved.length > 0) fail(`${rootFile} has unresolved exports: ${ts.flattenDiagnosticMessageText(unresolved[0].messageText, ' ')}`);
  const values = [];
  const types = [];
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    (target.flags & ts.SymbolFlags.Value ? values : types).push(symbol.getName());
  }
  return { values: values.sort(), types: types.sort() };
}

function removedBetween(oldNames, currentNames) {
  const current = new Set(currentNames);
  return oldNames.filter((n) => !current.has(n)).sort();
}

// The backtick-quoted names of the release section's Removed bullets: the first and the third, the two that name exports.
function changelogRemovedNames() {
  const lines = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8').split('\n');
  const unreleased = lines.findIndex((l) => /^## (Unreleased|0\.2\.0-rc\.1)\s*$/.test(l));
  const removedAt = lines.findIndex((l, i) => i > unreleased && /^### Removed\s*$/.test(l));
  if (unreleased < 0 || removedAt < 0) fail('CHANGELOG.md has no Unreleased / Removed section');
  const bullets = [];
  for (let i = removedAt + 1; i < lines.length && !/^#{1,3} /.test(lines[i]); i += 1) {
    if (/^- /.test(lines[i])) bullets.push([]);
    if (bullets.length > 0) bullets[bullets.length - 1].push(lines[i]);
  }
  if (bullets.length < 3) fail(`CHANGELOG.md's Removed section has ${bullets.length} bullets, not the 3 this reads`);
  const text = [bullets[0], bullets[2]].map((b) => b.join('\n')).join('\n');
  return new Set([...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
}

// ---- corpus ----------------------------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// JSON cannot carry these numbers; the replacer here and the reviver in the test agree on this spelling.
const encodeNumber = (_key, value) => (value === Infinity ? { $: 'Infinity' } : value === -Infinity ? { $: '-Infinity' } : Number.isNaN(value) ? { $: 'NaN' } : value);
const decodeNumber = (_key, value) => (value && typeof value === 'object' && '$' in value ? { Infinity, '-Infinity': -Infinity, NaN }[value.$] ?? value : value);
const toJson = (value) => JSON.stringify(value, encodeNumber);
const fromJson = (text) => JSON.parse(text, decodeNumber);

function makeRandom(seed) {
  const next = mulberry32(seed);
  const int = (n) => Math.floor(next() * n);
  const pick = (list) => list[int(list.length)];
  const chance = (p) => next() < p;
  return { int, pick, chance };
}

const SIZE = { phone: { formFactor: 'phone', width: 390, height: 700 }, tablet: { formFactor: 'tablet', width: 768, height: 'fill' }, desktop: { formFactor: 'desktop', width: 1200, height: 'fill' } };
const HISTORY = { id: ROOT_ID, url: '', title: 'History', live: true, locked: true, view: 'history', collapsible: false, listed: false, layer: 'raised', anchoredEnter: true, formFactor: 'phone', size: SIZE.phone };

function randomAnchor(r, id, ids) {
  const others = ids.filter((x) => x !== id);
  const panel = r.pick([ROOT_ID, ROOT_ID, ROOT_ID, ...(others.length > 0 ? [r.pick(others)] : []), 'ghost']);
  return { panel, position: r.pick(['left', 'right']), priority: r.int(4) - (r.chance(0.1) ? 1 : 0) };
}

function randomPanel(r, id, ids) {
  const permanent = r.chance(0.12);
  const formFactor = permanent ? 'phone' : r.pick(['phone', 'phone', 'tablet', 'desktop']);
  return {
    id,
    url: `https://${id}.example`,
    ...(r.chance(0.6) ? { title: `Panel ${id}` } : {}),
    ...(r.chance(0.25) ? { hostData: { tag: id } } : {}),
    live: permanent ? true : r.chance(0.75),
    locked: false,
    view: r.pick(['web', 'web', 'notes', 'history']),
    collapsible: !permanent,
    listed: permanent ? false : r.chance(0.85),
    ...(r.chance(0.25) ? { params: { n: r.int(9) } } : {}),
    ...(r.chance(0.8) ? { anchor: randomAnchor(r, id, ids) } : {}),
    ...(r.chance(0.5) ? { layer: r.pick(['base', 'raised']) } : {}),
    ...(r.chance(0.3) ? { anchoredEnter: r.chance(0.5) } : {}),
    formFactor,
    size: SIZE[formFactor],
  };
}

function randomRow(r) {
  const count = r.int(6);
  const ids = Array.from({ length: count }, (_, i) => `p${i + 1}`);
  const row = ids.map((id) => randomPanel(r, id, [...ids, ROOT_ID]));
  // One row in ten has no root at all, which the order functions must still answer.
  if (!r.chance(0.1)) row.splice(r.int(row.length + 1), 0, structuredClone(HISTORY));
  return row;
}

const randomId = (r, row) => (row.length > 0 && r.chance(0.85) ? r.pick(row).id : 'ghost');
const randomRequest = (r, row) => ({
  ...(r.chance(0.5) ? { panel: r.pick([ROOT_ID, randomId(r, row)]) } : {}),
  position: r.pick(['left', 'right']),
  ...(r.chance(0.5) ? { priority: r.int(4) - 1 } : {}),
});
const WIDTHS = [300, 390, 768, 1200];
const randomWidths = (r, max) => Array.from({ length: r.int(max + 1) }, () => r.pick(WIDTHS));

function randomInfo(r, row) {
  return {
    url: 'about:blank',
    ...(r.chance(0.4) ? { view: r.pick(['web', 'notes']) } : {}),
    ...(r.chance(0.5) ? { title: 'Opened' } : {}),
    ...(r.chance(0.3) ? { params: { n: r.int(9) } } : {}),
    ...(r.chance(0.3) ? { hostData: { tag: 'opened' } } : {}),
    ...(r.chance(0.3) ? { listed: r.chance(0.5) } : {}),
    ...(r.chance(0.5) ? { anchor: randomRequest(r, row) } : {}),
    ...(r.chance(0.3) ? { layer: r.pick(['base', 'raised']) } : {}),
    ...(r.chance(0.3) ? { anchoredEnter: r.chance(0.5) } : {}),
    ...(r.chance(0.2) ? { permanent: r.chance(0.5) } : {}),
    ...(r.chance(0.4) ? { formFactor: r.pick(['phone', 'tablet', 'desktop']) } : {}),
  };
}

function randomLayoutInput(r) {
  return { containerWidth: r.pick([0, 800, 1250, 1600, 2400, 500 + r.int(2500)]), phoneWidth: r.pick([320, 390, 430]), gap: r.pick([8, 16]), fixedItemCount: r.int(4) };
}

function randomSavedState(r, project) {
  const row = randomRow(r);
  if (r.chance(0.7)) return project(row, ROOT_ID);
  // A hand-made file: dangling anchors, a self-anchor, a parked permanent column.
  const ids = ['a', 'b', 'c'];
  return {
    version: 1,
    panels: ids.slice(0, 1 + r.int(3)).map((id, i) => ({
      id,
      view: r.pick(['web', 'notes']),
      url: `https://${id}.example`,
      ...(r.chance(0.5) ? { title: id.toUpperCase() } : {}),
      live: r.chance(0.7),
      anchor: { panel: r.pick([ROOT_ID, id, ids[(i + 1) % ids.length], 'gone']), position: r.pick(['left', 'right']), priority: r.int(3) },
      ...(r.chance(0.3) ? { permanent: true } : {}),
      ...(r.chance(0.4) ? { formFactor: r.pick(['phone', 'tablet', 'desktop']) } : {}),
    })),
  };
}

const freshCounter = (from) => {
  let n = from;
  return () => String(n++);
};

// Argument builders per function, in REPLAYED order. The hydrate case spells its id source as {$: 'fresh', from}.
function buildInputs(r, project) {
  return {
    computeRowOrder: () => [randomRow(r), ROOT_ID],
    deriveAnchorsFromOrder: () => [randomRow(r), ROOT_ID],
    appendPanel: () => {
      const row = randomRow(r);
      return [row, randomInfo(r, row), `n${r.int(5)}`, ROOT_ID];
    },
    reanchorPanel: () => {
      const row = randomRow(r);
      return [row, randomId(r, row), randomRequest(r, row), ROOT_ID];
    },
    closePanel: () => {
      const row = randomRow(r);
      return [row, randomId(r, row), ROOT_ID];
    },
    movePanel: () => {
      const row = randomRow(r);
      return [row, randomId(r, row), r.pick(['left', 'right']), ROOT_ID];
    },
    setFormFactor: () => {
      const row = randomRow(r);
      return [row, randomId(r, row), r.pick(['phone', 'tablet', 'desktop'])];
    },
    restorePanel: () => {
      const row = randomRow(r);
      const panel = randomPanel(r, r.chance(0.2) && row.length > 0 ? r.pick(row).id : 'back', [ROOT_ID]);
      return [row, panel, r.int(row.length + 4) - 1, ROOT_ID];
    },
    reorderStepsForOffset: () => [r.int(3000) - 1500, { left: randomWidths(r, 4), right: randomWidths(r, 4) }, r.pick([8, 16])],
    computeRowLayout: () => [{ ...randomLayoutInput(r), liveWidths: randomWidths(r, 5) }],
    computeMaxLiveWidth: () => [randomLayoutInput(r)],
    panelWidthOf: () => {
      const p = randomPanel(r, 'w', [ROOT_ID]);
      return [r.chance(0.2) ? {} : { formFactor: p.formFactor, size: p.size }, r.pick([320, 390, 430]), r.pick([Infinity, 500, 800, 390, 1200])];
    },
    projectWorkspaceState: () => [randomRow(r), ROOT_ID],
    hydrateWorkspaceState: () => [randomSavedState(r, project), { $: 'fresh', from: r.pick([1, 100]) }, ROOT_ID],
  };
}

async function loadVendored(stage) {
  const modules = new Map();
  const table = {};
  for (const [name, file] of REPLAYED) {
    if (!modules.has(file)) modules.set(file, await import(pathToFileURL(join(stage, 'pkg', `${file}.js`)).href));
    const fn = modules.get(file)[name];
    if (typeof fn !== 'function') fail(`pkg/${file}.js does not export ${name}`);
    table[name] = fn;
  }
  return table;
}

// The hydrate case's id source is a counter, which JSON cannot hold.
function callVendored(table, name, args) {
  const real = structuredClone(args).map((a) => (a && typeof a === 'object' && a.$ === 'fresh' ? freshCounter(a.from) : a));
  return table[name](...real);
}

async function buildCorpus(stage) {
  const table = await loadVendored(stage);
  const r = makeRandom(SEED);
  const inputs = buildInputs(r, (row, rootId) => table.projectWorkspaceState(structuredClone(row), rootId));
  const cases = [];
  for (const [name] of REPLAYED) {
    for (let i = 0; i < CASES_PER_FUNCTION; i += 1) {
      const args = inputs[name]();
      const out = callVendored(table, name, args);
      if (out === undefined) fail(`${name} returned undefined for case ${i}: a corpus line must hold an output`);
      const record = { fn: name, args, out };
      // A value JSON cannot hold (an explicit undefined, a function) would make the replay compare something other than what ran.
      try {
        deepStrictEqual(fromJson(toJson(record)), record);
      } catch {
        fail(`${name} case ${i} does not survive a JSON round trip`);
      }
      cases.push(record);
    }
  }
  return cases;
}

// ---- writing ---------------------------------------------------------------------------------------------------

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'phonux-compat-'));
  try {
    const { integrity, packageDir } = fetchTarball(scratch);
    const paths = listFiles(packageDir);

    // Built beside a link to node_modules, so the vendored code and its types resolve react and mui as they do in the
    // repository, then swapped in whole: a run that fails part way leaves the committed fixtures as they were.
    const stage = join(scratch, 'stage');
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(scratch, 'node_modules'));
    mkdirSync(join(stage, 'pkg'), { recursive: true });
    const files = paths.map((path) => {
      const bytes = readFileSync(join(packageDir, path));
      const stored = isStored(path);
      if (stored) {
        mkdirSync(dirname(join(stage, 'pkg', path)), { recursive: true });
        cpSync(join(packageDir, path), join(stage, 'pkg', path));
      }
      return { path, sha256: sha('sha256', bytes, 'hex'), stored };
    });
    writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify({ package: 'phonux', version: '0.1.0', integrity, files }, null, 2)}\n`);

    const root = entryExports(join(stage, 'pkg', 'index.d.ts'));
    const testing = entryExports(join(stage, 'pkg', 'fakeHost.d.ts'));
    const currentRoot = entryExports(join(REPO_ROOT, 'index.ts'));
    const currentTesting = entryExports(join(REPO_ROOT, 'fakeHost.ts'));
    const removedSince010 = {
      root: { values: removedBetween(root.values, currentRoot.values), types: removedBetween(root.types, currentRoot.types) },
      testing: { values: removedBetween(testing.values, currentTesting.values), types: removedBetween(testing.types, currentTesting.types) },
    };
    const allRemoved = [...removedSince010.root.values, ...removedSince010.root.types, ...removedSince010.testing.values, ...removedSince010.testing.types];
    const documented = changelogRemovedNames();
    const undocumented = allRemoved.filter((name) => !documented.has(name));
    if (undocumented.length > 0) fail(`CHANGELOG.md's Removed bullets do not name: ${undocumented.join(', ')}`);
    writeFileSync(join(stage, 'exports.json'), `${JSON.stringify({ root, testing, removedSince010 }, null, 2)}\n`);

    const cases = await buildCorpus(stage);
    const replayed = REPLAYED.map(([name]) => name);
    const body = cases.map((c) => `    ${toJson(c)}`).join(',\n');
    writeFileSync(
      join(stage, 'corpus.json'),
      `{\n  "version": "0.1.0",\n  "seed": ${SEED},\n  "encoding": "{\\"$\\":\\"Infinity\\"}, {\\"$\\":\\"-Infinity\\"} and {\\"$\\":\\"NaN\\"} stand for those numbers; {\\"$\\":\\"fresh\\",\\"from\\":N} stands for an id source counting up from N",\n  "replayed": ${JSON.stringify(replayed)},\n  "cases": [\n${body}\n  ]\n}\n`,
    );

    // Deleted first, so a file the tarball no longer holds cannot linger as evidence of a run that did not happen.
    rmSync(OUT, { recursive: true, force: true });
    cpSync(stage, OUT, { recursive: true });

    // The effect, not the exit code: every stored file is there and hashes as the manifest says.
    const stored = files.filter((f) => f.stored);
    for (const f of stored) {
      const onDisk = join(OUT, 'pkg', f.path);
      if (!existsSync(onDisk) || sha('sha256', readFileSync(onDisk), 'hex') !== f.sha256) fail(`pkg/${f.path} is missing or differs from the tarball`);
    }
    const written = listFiles(OUT).length;
    if (written !== stored.length + 3) fail(`${written} files written, expected ${stored.length} stored plus exports.json, corpus.json and manifest.json`);
    console.log(
      `compat corpus: tarball integrity matches the registry; ${stored.length} of ${files.length} files stored; ` +
        `values root=${root.values.length} testing=${testing.values.length}; removed ${allRemoved.length} ` +
        `(${removedSince010.root.values.length} root values, ${removedSince010.root.types.length} root types, ${removedSince010.testing.values.length} testing value, ${removedSince010.testing.types.length} testing type); ` +
        `${cases.length} corpus cases over ${replayed.length} functions; wrote ${relative(REPO_ROOT, OUT)}`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(`gen-compat-corpus: ${error.message}`);
  process.exitCode = 1;
}
