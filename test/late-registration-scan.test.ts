// Fixture text is built from string rows, one per line, so no fixture line starts with `test(` at column 0:
// the suite-count greps count exactly the root tests of a file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Violation = { kind: string; line: number; column: number; text: string; detail: string };
type ScanResult = {
  file: string;
  importsNodeTest: boolean;
  registrations: number;
  moduleLevelAwaits: number;
  violations: Violation[];
};
type LateScan = { scanned: number; sites: number; results: ScanResult[]; violations: (Violation & { file: string })[] };
type ScanExports = {
  scanSource(file: string, text: string): ScanResult;
  scanLateRegistrations(absPaths: string[]): LateScan;
  lateScanFailed(scan: { scanned: number; sites: number; violations: unknown[] }): boolean;
  formatLateScan(scan: { repoRoot: string; scanned: number; sites: number; violations: (Violation & { file: string })[] }): string[];
};

// tools/ is outside every tsconfig, so the .mjs ships no types; the typed cast is the stand-in.
const { formatLateScan, lateScanFailed, scanLateRegistrations, scanSource } = (await import(
  new URL('../tools/late-registration-scan.mjs', import.meta.url).href
)) as ScanExports;
const { CHILD_BASE_FLAGS } = (await import(new URL('../tools/run-tests.mjs', import.meta.url).href)) as {
  CHILD_BASE_FLAGS: string[];
};

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST_DIR = join(REPO_ROOT, 'test');
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const ALL = "import { test, it, describe, suite, before, after, beforeEach, afterEach } from 'node:test';";
const TEST_ONLY = "import { test } from 'node:test';";

const rows = (...r: string[]) => `${r.join('\n')}\n`;
const scan = (...r: string[]) => scanSource('fixture.ts', rows(...r));
const spots = (r: ScanResult) => r.violations.map((v) => `${v.kind}@${v.line}:${v.column}`);

test('a registration after an await that follows another registration is reported at its own line and column, for every registrar', () => {
  const late = [
    "test('b', () => {});",
    "it('b', () => {});",
    "describe('s', () => { it('x', () => {}); });",
    "suite('s', () => {});",
    "test.skip('b');",
    "test.todo('b');",
    "test.only('b', () => {});",
    "test.describe('s', () => {});",
  ];
  for (const row of late) {
    const r = scan(ALL, "test('a', () => {});", 'await new Promise((r) => setTimeout(r, 5));', row);
    assert.deepEqual(spots(r), ['after-await@4:1'], row);
    assert.match(r.violations[0]!.detail, /after the await at line 3/, row);
  }
});

test('a hook registered after an await is reported at the hook call', () => {
  for (const hook of ['before', 'after', 'beforeEach', 'afterEach']) {
    const r = scan(ALL, "test('a', () => {});", 'await 0;', `${hook}(() => {});`);
    assert.deepEqual(spots(r), ['after-await@4:1'], hook);
  }
  // A hook on its own arms nothing: the first test after the await still has no known test to outlive.
  assert.deepEqual(spots(scan(ALL, 'before(() => {});', 'await 0;', "test('a', () => {});")), []);
});

test('control flow decides whether an await can precede a registration', () => {
  const flagged = (label: string, r: ScanResult, expected: string[]) => assert.deepEqual(spots(r), expected, label);
  flagged('await in the registration arguments', scan(TEST_ONLY, "test('a', () => {});", "test(await Promise.resolve('b'), () => {});"), ['after-await@3:1']);
  flagged('await test() then test()', scan(TEST_ONLY, "await test('a', () => {});", "test('b', () => {});"), ['after-await@3:1']);
  flagged('await in one if branch reaches the code after the if', scan(TEST_ONLY, "test('a', () => {});", 'if (process.argv.length > 99) { await 0; }', "test('b', () => {});"), ['after-await@4:1']);
  flagged('await in try reaches catch', scan(TEST_ONLY, "test('a', () => {});", "try { await 0; } catch { test('b', () => {}); }"), ['after-await@3:26']);
  flagged('loop-carried: the await follows the registration in the same body', scan(TEST_ONLY, 'for (let i = 0; i < 2; i++) {', "  test('t' + i, () => {});", '  await 0;', '}'), ['after-await@3:3']);
  flagged('for await awaits every iteration', scan(TEST_ONLY, "test('a', () => {});", 'async function* g() { yield 1; }', "for await (const x of g()) { test('t' + x, () => {}); }"), ['after-await@4:30']);
  flagged('await using', scan(TEST_ONLY, "test('a', () => {});", 'await using r = { async [Symbol.asyncDispose]() {} };', "test('b', () => {});", 'void r;'), ['after-await@4:1']);

  flagged('an await in a branch that throws does not flow out', scan(TEST_ONLY, "test('a', () => {});", "if (process.argv.length > 99) { await 0; throw new Error('x'); }", "test('b', () => {});"), []);
  flagged('the two arms of an if are separate paths', scan(TEST_ONLY, "test('a', () => {});", "if (process.argv.length > 99) { await 0; } else { test('b', () => {}); }"), []);
});

test('a throw carries the await it follows into the catch block, the finally block and the code after the try', () => {
  type Shape = { at: string; rows: (awaits: boolean) => string[] };
  const first = "test('a', () => {});";
  const wait = (awaits: boolean) => (awaits ? 'await x();' : 'x();');
  const shapes: Record<string, Shape> = {
    'A1 catch block': {
      at: 'after-await@9:3',
      rows: (a) => ['try {', '  if (c) {', `    ${wait(a)}`, "    throw new Error('e');", '  }', '} catch {', "  test('late', () => {});", '}'],
    },
    'A2 code after an empty catch': {
      at: 'after-await@9:1',
      rows: (a) => ['try {', '  if (c) {', `    ${wait(a)}`, "    throw new Error('e');", '  }', '} catch {}', "test('late', () => {});"],
    },
    'A3 finally block': {
      at: 'after-await@9:3',
      rows: (a) => ['try {', '  if (c) {', `    ${wait(a)}`, "    throw new Error('e');", '  }', '} finally {', "  test('late', () => {});", '}'],
    },
    'C1 loop in the try': {
      at: 'after-await@11:3',
      rows: (a) => ['try {', '  for (const i of l) {', '    if (c) {', `      ${wait(a)}`, "      throw new Error('e');", '    }', '  }', '} catch {', "  test('late', () => {});", '}'],
    },
    'C3 nested try with a finally': {
      at: 'after-await@13:3',
      rows: (a) => ['try {', '  try {', '    if (c) {', `      ${wait(a)}`, "      throw new Error('e');", '    }', '  } finally {', '    cleanup();', '  }', '} catch {', "  test('late', () => {});", '}'],
    },
    'try with a finally inside the throwing branch': {
      at: 'after-await@13:3',
      rows: (a) => ['try {', '  if (c) {', '    try {', `      ${wait(a)}`, "      throw new Error('e');", '    } finally {', '      cleanup();', '    }', '  }', '} catch {', "  test('late', () => {});", '}'],
    },
    'C5 then branch of an if with an else': {
      at: 'after-await@11:3',
      rows: (a) => ['try {', '  if (c) {', `    ${wait(a)}`, "    throw new Error('e');", '  } else {', '    y();', '  }', '} catch {', "  test('late', () => {});", '}'],
    },
    'C9 throw expression with await': {
      at: 'after-await@8:3',
      rows: (a) => ['try {', '  if (c) {', `    throw ${a ? 'await ' : ''}x();`, '  }', '} catch {', "  test('late', () => {});", '}'],
    },
    'throw from a catch block reaches the finally block': {
      at: 'after-await@11:3',
      rows: (a) => ['try {', '  x();', '} catch {', '  if (c) {', `    ${wait(a)}`, "    throw new Error('e');", '  }', '} finally {', "  test('late', () => {});", '}'],
    },
    'throw from a catch block reaches an outer catch block': {
      at: 'after-await@13:3',
      rows: (a) => ['try {', '  try {', '    x();', '  } catch {', '    if (c) {', `      ${wait(a)}`, "      throw new Error('e');", '    }', '  }', '} catch {', "  test('late', () => {});", '}'],
    },
    'switch case that awaits then throws (the base also reports after-await@10:3)': {
      at: 'after-await@10:3',
      rows: (a) => ['try {', '  switch (c) {', '    case 1:', `      ${wait(a)}`, "      throw new Error('e');", '  }', '} catch {', "  test('late', () => {});", '}'],
    },
    'switch case whose throw sits in an if (the base scans it clean)': {
      at: 'after-await@13:3',
      rows: (a) => ['try {', '  switch (c) {', '    case 1:', '      if (d) {', `        ${wait(a)}`, "        throw new Error('e');", '      }', '      break;', '  }', '} catch {', "  test('late', () => {});", '}'],
    },
  };
  for (const [label, { at, rows: build }] of Object.entries(shapes)) {
    const late = scan(TEST_ONLY, first, ...build(true));
    assert.deepEqual(spots(late), [at], label);
    assert.match(late.violations[0]!.detail, /after the await at line \d+/, label);
    assert.deepEqual(spots(scan(TEST_ONLY, first, ...build(false))), [], `${label}: no await before the throw`);
    assert.deepEqual(spots(scan(TEST_ONLY, ...build(true))), [], `${label}: the await sits before the first registration`);
  }

  // The throw comes before the await, but the await still ends the try block normally, so the catch block is late either way.
  const throwFirst = scan(TEST_ONLY, first, 'try {', '  if (c) { throw 1; }', '  await x();', '} catch {', "  test('late', () => {});", '}');
  assert.deepEqual(spots(throwFirst), ['after-await@7:3']);

  // A registration made in the throwing branch is carried too, so an await in the catch block makes the next registration late.
  const carried = scan(TEST_ONLY, 'try {', '  if (c) {', "    test('b', () => {});", "    throw new Error('e');", '  }', '} catch {', '  await x();', "  test('late', () => {});", '}');
  assert.deepEqual(spots(carried), ['after-await@9:3']);
  assert.deepEqual(spots(scan(TEST_ONLY, 'try {', '  if (c) {', "    test('b', () => {});", "    throw new Error('e');", '  }', '} catch {', '  x();', "  test('late', () => {});", '}')), []);
});

test('a registration inside any function other than a describe or suite callback is reported as inside-function', () => {
  const shapes: Record<string, string[]> = {
    setTimeout: ["setTimeout(() => test('a', () => {}), 5);"],
    'promise then': ["Promise.resolve().then(() => { test('a', () => {}); });"],
    'async IIFE': ["await (async () => { await 0; test('a', () => {}); })();"],
    'helper declaration': ["function reg(n: string) { test(n, () => {}); }", "reg('a');"],
    forEach: ["['a', 'b'].forEach((n) => test(n, () => {}));"],
    'test body': ["test('a', async () => { await 0; test('b', () => {}); });"],
    'hook body': ["before(() => { test('a', () => {}); });"],
  };
  for (const [label, body] of Object.entries(shapes)) {
    const r = scan(ALL, ...body);
    assert.ok(r.violations.length >= 1 && r.violations.every((v) => v.kind === 'inside-function'), `${label}: ${spots(r).join(' ')}`);
  }
});

test('a subtest registered from a nested function is reported as detached-subtest at the t.test column', () => {
  const r = scan(TEST_ONLY, "test('p', (t) => {", "  setTimeout(() => t.test('c', () => {}), 10);", '});');
  assert.deepEqual(spots(r), ['detached-subtest@3:20']);

  const others: Record<string, string[]> = {
    'promise then': ["test('p', (t) => { Promise.resolve().then(() => t.test('c', () => {})); });"],
    'map callback': ["test('p', async (t) => { await Promise.all([1, 2].map(async (i) => t.test('c' + i, () => {}))); });"],
    'context hook from a timer': ["test('p', (t) => { setTimeout(() => t.after(() => {}), 10); });"],
    'parameterless subtest callback': ["test('p', async (t) => { await t.test('c', () => { t.test('d', () => {}); }); });"],
    'outer context from a subtest callback': ["test('p', async (t) => { await t.test('c', async (t2) => { await t.test('d', () => {}); void t2; }); });"],
  };
  for (const [label, body] of Object.entries(others)) {
    const found = scan(TEST_ONLY, ...body);
    assert.ok(found.violations.some((v) => v.kind === 'detached-subtest'), `${label}: ${spots(found).join(' ')}`);
  }
});

test('a computed context member and a named callback are scanned like the inline form, and a callback the scan cannot resolve is refused', () => {
  const body = (opener: string, close: string) => [opener, '  setTimeout(() => {', "    t.test('s', () => {});", '  }, 1);', close];
  const detached: Record<string, string[]> = {
    'computed member from a timer': [TEST_ONLY, "test('p', (t) => {", '  setTimeout(() => {', "    t[k]('s', () => {});", '  }, 1);', '});'],
    'computed member in a map callback': [TEST_ONLY, "test('p', (t) => {", "  [1].map(() => t[k]('s', () => {}));", '});'],
    'computed hook from a timer': [TEST_ONLY, "test('p', (t) => {", '  setTimeout(() => t[k](() => {}), 1);', '});'],
    'named function declaration': [TEST_ONLY, ...body('function body(t) {', '}'), "test('a', body);"],
    'named const arrow': [TEST_ONLY, ...body('const body = (t) => {', '};'), "test('a', body);"],
    'named const function expression': [TEST_ONLY, ...body('const body = function (t) {', '};'), "test('a', body);"],
    'named declaration used before it is declared': [TEST_ONLY, "test('a', body);", ...body('function body(t) {', '}')],
    'named body behind a type assertion': [TEST_ONLY, ...body('const body = (t) => {', '};'), "test('a', body as never);"],
    'named body given to it': [ALL, ...body('function body(t) {', '}'), "it('a', body);"],
    'parenthesised inline callback': [TEST_ONLY, "test('p', ((t) => {", "  setTimeout(() => t.test('c', () => {}), 1);", '}));'],
    'named body given to a skipped test': [TEST_ONLY, ...body('function body(t) {', '}'), "test.skip('a', body);"],
  };
  const atTestCall: Record<string, string> = {
    'computed member from a timer': 'detached-subtest@4:5',
    'computed member in a map callback': 'detached-subtest@3:17',
    'computed hook from a timer': 'detached-subtest@3:20',
    'named function declaration': 'detached-subtest@4:5',
    'named const arrow': 'detached-subtest@4:5',
    'named const function expression': 'detached-subtest@4:5',
    'named declaration used before it is declared': 'detached-subtest@5:5',
    'named body behind a type assertion': 'detached-subtest@4:5',
    'named body given to it': 'detached-subtest@4:5',
    'parenthesised inline callback': 'detached-subtest@3:20',
    'named body given to a skipped test': 'detached-subtest@4:5',
  };
  for (const [label, rowsOf] of Object.entries(detached)) assert.deepEqual(spots(scan(...rowsOf)), [atTestCall[label]!], label);

  const clean: Record<string, string[]> = {
    'direct awaited computed member': [TEST_ONLY, "test('p', async (t) => {", "  await t[k]('s', () => {});", '});'],
    'direct awaited computed member with its own nested subtest': [TEST_ONLY, "test('p', async (t) => {", "  await t[k]('s', async (t2) => { await t2[k]('u', () => {}); });", '});'],
    'named body awaiting its subtests directly': [TEST_ONLY, 'async function body(t) {', "  await t.test('s', () => {});", "  await t[k]('u', () => {});", '}', "test('a', body);"],
    'identifier name with an inline callback': [TEST_ONLY, "const name = 'a';", 'test(name, () => {});'],
    'name only, options only, and an explicit undefined': [TEST_ONLY, "test('a');", "test('b', { todo: true });", "test('c', undefined);"],
    'named describe body': [ALL, 'function body() {', "  it('a', () => {});", '}', "describe('s', body);"],
    'overloaded function declaration as a describe body': [ALL, 'function body(): void;', 'function body() {', "  it('a', () => {});", '}', "describe('s', body);"],
    'named async describe body awaiting between its tests': [ALL, 'const body = async () => {', "  it('a', () => {});", '  await 0;', "  it('b', () => {});", '};', "describe('s', body);"],
    'named suite callback that registers itself again': [ALL, "const body = () => describe('s', body);", "describe('s', body);"],
    'mutually recursive named suite callbacks': [ALL, "function a() { describe('s', b); }", "function b() { describe('s', a); }", "describe('s', a);"],
    'imported callbacks given to hooks': [ALL, "import { cleanup, helpers } from './h.js';", 'afterEach(cleanup);', 'before(helpers.setup);', 'after(make());'],
  };
  for (const [label, rowsOf] of Object.entries(clean)) assert.deepEqual(spots(scan(...rowsOf)), [], label);
  assert.equal(scan(...clean['named describe body']!).registrations, 2);

  // A function that is also referenced as a plain value, or exported, could run from anywhere, so it is no suite callback.
  assert.deepEqual(spots(scan(ALL, 'function body() {', "  it('a', () => {});", '}', "describe('s', body);", 'setTimeout(body, 1);')), ['inside-function@3:3']);
  assert.deepEqual(spots(scan(ALL, 'export function body() {', "  it('a', () => {});", '}', "describe('s', body);")), ['inside-function@3:3']);

  const unresolved: Record<string, [string[], string, RegExp]> = {
    import: [[TEST_ONLY, "import imported from './h.js';", "test('a', imported);"], 'unresolved-callback@3:11', /is an import/],
    'named import': [[ALL, "import { imported } from './h.js';", "describe('s', imported);"], 'unresolved-callback@3:15', /is an import/],
    parameter: [[ALL, "describe('s', (cb) => {", "  it('x', cb);", '});'], 'unresolved-callback@3:11', /is a parameter/],
    'call result': [[TEST_ONLY, 'const make = () => () => {};', "test('a', make());"], 'unresolved-callback@3:11', /is a call result/],
    'member access': [[TEST_ONLY, 'const helpers = { body() {} };', "test('a', helpers.body);"], 'unresolved-callback@3:11', /is a member access/],
    'element access': [[TEST_ONLY, 'const helpers = { body() {} };', "test('a', helpers['body']);"], 'unresolved-callback@3:11', /is a member access/],
    'let binding': [[TEST_ONLY, 'let body = () => {};', "test('a', body);"], 'unresolved-callback@3:11', /not a function declaration or a const/],
    'const initialised with a call': [[TEST_ONLY, 'const body = wrap(() => {});', "test('a', body);"], 'unresolved-callback@3:11', /not a function declaration or a const/],
    'two declarations with a body': [[TEST_ONLY, 'function body() {}', 'function body() {}', "test('a', body);"], 'unresolved-callback@4:11', /not a function declaration or a const/],
    'a name this file does not declare': [[TEST_ONLY, "test('a', missing);"], 'unresolved-callback@2:11', /name this file does not declare/],
    'suite alias': [[ALL, "suite('s', imported);"], 'unresolved-callback@2:12', /callback/],
  };
  for (const [label, [rowsOf, at, why]] of Object.entries(unresolved)) {
    const r = scan(...rowsOf);
    assert.deepEqual(spots(r), [at], label);
    assert.match(r.violations[0]!.detail, why, label);
  }
});

test('awaited subtests after awaits inside a test body, and nested subtests, scan clean', () => {
  const r = scan(
    TEST_ONLY,
    "test('p', async (t) => {",
    '  await 0;',
    "  await t.test('a', async (t2) => { await 0; await t2.test('b', () => {}); await 0; await t2.test('c', () => {}); });",
    '  await 0;',
    "  await t.test('d', () => {});",
    "  t.skip('just marks the running test');",
    "  await Promise.resolve().then(() => { t.skip('not a registration'); t.todo('not one either'); });",
    "  t.mock.fn();",
    '});',
  );
  assert.deepEqual(spots(r), []);
  assert.equal(r.registrations, 1);
});

test('import forms: aliases, default, namespace and string access resolve; same-named locals do not', () => {
  const flagged: Record<string, string[]> = {
    alias: ["import { test as t } from 'node:test';", "t('a', () => {});", 'await 0;', "t('b', () => {});"],
    default: ["import nodeTest from 'node:test';", "nodeTest('a', () => {});", 'await 0;', "nodeTest.describe('s', () => {});"],
    'default as': ["import { default as nt } from 'node:test';", "nt('a', () => {});", 'await 0;', "nt.skip('b');"],
    namespace: ["import * as nt from 'node:test';", "nt.test('a', () => {});", 'await 0;', "nt.test('b', () => {});"],
    'namespace default': ["import * as nt from 'node:test';", "nt.default('a', () => {});", 'await 0;', "nt.default('b', () => {});"],
    'namespace describe.skip': ["import * as nt from 'node:test';", "nt.test('a', () => {});", 'await 0;', "nt.describe.skip('s', () => {});"],
    'string element access': ["import test from 'node:test';", "test('a', () => {});", 'await 0;', "test['skip']('b');"],
    'parenthesised and non-null': ["import { test } from 'node:test';", "test('a', () => {});", 'await 0;', "(test!)('b', () => {});"],
  };
  for (const [label, body] of Object.entries(flagged)) {
    const r = scan(...body);
    assert.deepEqual(r.violations.map((v) => v.kind), ['after-await'], `${label}: ${spots(r).join(' ')}`);
  }

  const shadowed = scan(
    ALL,
    "test('a', async () => { const before = await 1; const after = await 2; void [before, after]; });",
    "test('b', () => { const after = { stop() {} }; after.stop(); });",
    "function run(test: (n: string) => void) { test('x'); }",
    'void run;',
    'await 0;',
  );
  assert.deepEqual(spots(shadowed), []);
  assert.equal(shadowed.registrations, 2);
});

test('a registrar reached through a computed member counts as a registration, so it is reported after an await', () => {
  const late: Record<string, string[]> = {
    'default import': ["import test from 'node:test';", "test('a', () => {});", 'await 0;', "const k = 'skip';", "test[k]('b', () => {});"],
    'named import': [TEST_ONLY, "test('a', () => {});", 'await 0;', "const k = 'skip';", "test[k]('b', () => {});"],
    'namespace import': ["import * as nt from 'node:test';", "nt.test('a', () => {});", 'await 0;', "const k = 'skip';", "nt[k]('b', () => {});"],
    'computed member after a literal one': [TEST_ONLY, "test('a', () => {});", 'await 0;', "const k = 'skip';", "test.describe[k]('b', () => {});"],
  };
  for (const [label, body] of Object.entries(late)) {
    const r = scan(...body);
    assert.deepEqual(spots(r), ['after-await@5:1'], label);
    assert.equal(r.registrations, 2, label);
  }

  const early = scan(TEST_ONLY, "const k = 'skip';", "test('a', () => {});", "test[k]('b', () => {});");
  assert.deepEqual(spots(early), []);
  assert.equal(early.registrations, 2);
});

test('node:test reached by anything but a static import, or a registrar used as a value, is reported instead of passing', () => {
  const cases: [string, string[], string][] = [
    ['require', ["const { test } = require('node:test');", "test('a', () => {});"], 'unresolved-import'],
    ['dynamic import', ["const { test } = await import('node:test');", "test('a', () => {});"], 'unresolved-import'],
    ['re-export', ["export { test } from 'node:test';"], 'unresolved-import'],
    ['alias const', [TEST_ONLY, 'const t = test;', "t('a', () => {});"], 'escaped-binding'],
    ['passed as a value', [TEST_ONLY, '[1].forEach(test);'], 'escaped-binding'],
    ['exported', [TEST_ONLY, 'export { test };'], 'escaped-binding'],
    ['syntax error', [TEST_ONLY, "test('a', () => {"], 'syntax'],
  ];
  for (const [label, body, kind] of cases) {
    const r = scan(...body);
    assert.ok(r.violations.some((v) => v.kind === kind), `${label}: ${spots(r).join(' ')}`);
  }
});

test('a node:test type imported without the type keyword is not a registrar read as a value', () => {
  const r = scan("import { test, TestContext } from 'node:test';", "test('a', (t: TestContext) => { void t; });");
  assert.deepEqual(spots(r), []);
  assert.equal(r.registrations, 1);
  assert.ok(spots(scan("import { test, TestContext } from 'node:test';", 'const c = TestContext;', "test('a', () => { void c; });")).includes('escaped-binding@2:11'));
});

test('awaits before the first registration, inside test bodies and suite callbacks, and after the last registration scan clean', () => {
  const clean: Record<string, string[]> = {
    'await before the first registration': [TEST_ONLY, "const os = await import('node:os');", "test('a', () => { void os; });", "test('b', () => {});"],
    'hook then await then the first test': [ALL, 'before(() => {});', 'await 0;', "test('a', () => {});"],
    'await after the last registration': [TEST_ONLY, "test('a', () => {});", 'await 0;'],
    'awaits in a test body': [TEST_ONLY, "test('a', async () => { await 0; await 0; });", "test('b', async () => { await 0; });"],
    'async describe with awaits between its it calls': [ALL, "test('r', () => {});", "describe('s', async () => { it('a', () => {}); await 0; it('b', () => {}); await 0; it('c', () => {}); });"],
    'nested async describe': [ALL, "describe('s', async () => { await 0; describe('t', async () => { it('a', () => {}); await 0; it('b', () => {}); }); });"],
    'default-import hook and suite members': ["import test from 'node:test';", 'test.before(() => {});', 'await 0;', "test.describe('s', () => { test.it('x', () => {}); });"],
    'mock only': ["import { test, mock } from 'node:test';", "test('a', () => {});", 'await 0;', 'const f = mock.fn();', "mock.method(console, 'log');", 'void f;'],
    'default export mock member': ["import test from 'node:test';", "test('a', () => {});", 'await 0;', 'test.mock.fn();'],
    'synchronous loop and branches': [TEST_ONLY, "for (const n of ['a', 'b']) { test(n, () => {}); }", "if (process.argv.length > 99) { test('c', () => {}); } else { test('d', () => {}); }"],
    'lookalikes in strings, comments and properties': [TEST_ONLY, "test('a', () => {});", 'await 0;', "const s = \"test('x', () => {})\";", "// test('y', () => {});", "const o = { test(n: string) { return n; } };", "o.test('z');", 'void s;'],
  };
  for (const [label, body] of Object.entries(clean)) assert.deepEqual(spots(scan(...body)), [], label);
});

test('real test files scan clean until an await and a registration are appended at a known line', () => {
  const text = readFileSync(join(TEST_DIR, 'panel-window.test.ts'), 'utf8');
  const before = scanSource('test/panel-window.test.ts', text);
  assert.deepEqual(spots(before), []);
  assert.ok(before.registrations >= 3, `panel-window.test.ts registrations: ${before.registrations}`);

  const appendedAt = text.split('\n').length + 1;
  const mutated = scanSource('test/panel-window.test.ts', `${text}\nawait new Promise((r) => setTimeout(r, 10));\ntest('late', () => {});\n`);
  assert.deepEqual(spots(mutated), [`after-await@${appendedAt + 1}:1`]);
  assert.equal(mutated.registrations, before.registrations + 1);
});

test('every file under test/ is scanned: each test file registers something and none registers late', () => {
  const files = (readdirSync(TEST_DIR, { recursive: true }) as string[]).filter((n) => n.endsWith('.ts')).map((n) => join(TEST_DIR, n));
  const scanned = scanLateRegistrations(files);
  assert.equal(scanned.scanned, files.length);
  assert.ok(files.length > 0);

  const testFiles = scanned.results.filter((r) => r.file.endsWith('.test.ts'));
  const listed = readdirSync(TEST_DIR).filter((n) => n.endsWith('.test.ts'));
  assert.equal(testFiles.length, listed.length);
  for (const r of testFiles) {
    assert.ok(r.importsNodeTest, `${r.file} does not import node:test`);
    assert.ok(r.registrations > 0, `${r.file} registers nothing: the scan read it as empty`);
  }
  for (const r of scanned.results.filter((x) => !x.file.endsWith('.test.ts'))) {
    assert.equal(r.registrations, 0, `${r.file} is a helper that registers tests, which the per-file scan cannot follow`);
  }
  assert.deepEqual(formatLateScan({ repoRoot: REPO_ROOT, ...scanned }).slice(1), []);
  // This file awaits the scan import before its first registration: a live case proving module-level awaits are seen at all.
  const guard = scanned.results.find((r) => r.file.endsWith('late-registration-scan.test.ts'));
  assert.ok(guard && guard.moduleLevelAwaits >= 1 && guard.violations.length === 0);
});

test('lateScanFailed fails on a violation or on zero files, and the site count moves only with real registrations', () => {
  const clean = { scanned: 2, sites: 5, violations: [] };
  const one = { scanned: 1, sites: 2, violations: [{ file: '/r/a.test.ts', kind: 'after-await', line: 4, column: 1, text: "test('b')", detail: 'd' }] };
  assert.equal(lateScanFailed(clean), false);
  assert.equal(lateScanFailed(one), true);
  assert.equal(lateScanFailed({ scanned: 0, sites: 0, violations: [] }), true);

  assert.equal(scanLateRegistrations([]).scanned, 0);
  assert.deepEqual(formatLateScan({ repoRoot: '/r', scanned: 0, sites: 0, violations: [] }), [
    'late-registration scan: 0 file(s), 0 registration site(s), 0 violation(s).',
    'late-registration scan: no file was scanned: this run proved nothing.',
  ]);
  assert.deepEqual(formatLateScan({ repoRoot: '/r', ...one }), [
    'late-registration scan: 1 file(s), 2 registration site(s), 1 violation(s).',
    "  a.test.ts:4:1: after-await: d  [test('b')]",
  ]);

  assert.equal(scan(TEST_ONLY, 'for (const n of [1, 2]) {', "  test('t' + n, () => {});", '  await 0;', '}').violations.length, 1);
  assert.equal(scan(TEST_ONLY, "test('a', () => {});", 'await 0;', "const s = 'test(1)';", 'void s;').violations.length, 0);
  assert.equal(scan(TEST_ONLY, 'for (const n of [1, 2]) {', "  test('t' + n, () => {});", '}').registrations, 1);
});

test('oracle: under --test-force-exit the drop shapes lose their late registration and the safe shapes lose none', () => {
  assert.ok(CHILD_BASE_FLAGS.includes('--test-force-exit'), 'the wrappers no longer pass --test-force-exit: retire the late-registration scan');

  const dir = mkdtempSync(join(tmpdir(), 'late-registration-oracle-'));
  try {
    type Fixture = { id: string; body: string[]; ran: string[]; drops: boolean };
    const fixtures: Fixture[] = [
      { id: 's1-await-before-first', drops: false, ran: ['x', 'y'], body: ['await sleep(150);', "test('x', () => mark('x'));", "test('y', () => mark('y'));"] },
      { id: 's2-hook-then-await', drops: false, ran: ['hook', 'x'], body: ["before(() => mark('hook'));", 'await sleep(150);', "test('x', () => mark('x'));"] },
      { id: 's3-async-describe', drops: false, ran: ['x', 'y'], body: ["describe('s', async () => {", "  it('x', () => mark('x'));", '  await sleep(150);', "  it('y', () => mark('y'));", '});'] },
      { id: 's4-subtests-after-await', drops: false, ran: ['x', 'y'], body: ["test('p', async (t) => {", '  await sleep(150);', "  await t.test('x', () => mark('x'));", '  await sleep(150);', "  await t.test('y', () => mark('y'));", '});'] },
      { id: 'd1-test-after-await', drops: true, ran: ['x'], body: ["test('x', () => mark('x'));", 'await sleep(150);', "test('y', () => mark('y'));"] },
      { id: 'd2-hook-after-await', drops: true, ran: ['x'], body: ["test('x', () => mark('x'));", 'await sleep(150);', "after(() => mark('hook'));"] },
      { id: 'd3-describe-after-await', drops: true, ran: ['x'], body: ["test('x', () => mark('x'));", 'await sleep(150);', "describe('s', () => { it('y', () => mark('y')); });"] },
      { id: 'd4-timer', drops: true, ran: ['x'], body: ["test('x', () => mark('x'));", "setTimeout(() => test('y', () => mark('y')), 150);"] },
      { id: 'd5-loop-await-each', drops: true, ran: ['x'], body: ["for (const id of ['x', 'y']) {", '  await sleep(150);', '  test(id, () => mark(id));', '}'] },
      { id: 'd6-subtest-from-timer', drops: true, ran: ['p'], body: ["test('p', (t) => {", "  mark('p');", "  setTimeout(() => t.test('c', () => mark('c')), 150);", '});'] },
      { id: 'd7-throw-from-awaiting-branch', drops: true, ran: ['x'], body: ["test('x', () => mark('x'));", 'const c = true;', 'try {', '  if (c) {', '    await sleep(150);', "    throw new Error('e');", '  }', '} catch {', "  test('y', () => mark('y'));", '}'] },
      { id: 'd8-computed-subtest-from-timer', drops: true, ran: ['p'], body: ["test('p', (t) => {", "  mark('p');", "  const k = 'test';", "  setTimeout(() => t[k]('c', () => mark('c')), 150);", '});'] },
      { id: 'd9-named-body-timer-subtest', drops: true, ran: ['p'], body: ['function body(t) {', "  mark('p');", "  setTimeout(() => t.test('c', () => mark('c')), 150);", '}', "test('p', body);"] },
    ];
    const files = fixtures.map((f) => {
      const marks = join(dir, `${f.id}.marks`);
      const head = [
        "import { appendFileSync } from 'node:fs';",
        "import { test, describe, it, before, after } from 'node:test';",
        `const mark = (id) => appendFileSync(${JSON.stringify(marks)}, id + '\\n');`,
        'const sleep = (ms) => new Promise((r) => setTimeout(r, ms));',
      ];
      const file = join(dir, `${f.id}.mjs`);
      writeFileSync(file, rows(...head, ...f.body));
      return { ...f, file, marks };
    });

    // A child that inherits these skips every file, which the marker assertions below would show as an empty run.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_TEST_WORKER_ID;
    const child = spawnSync(TSX_BIN, ['--test', ...CHILD_BASE_FLAGS, '--test-reporter=spec', `--test-reporter-destination=${join(dir, 'spec.log')}`, ...files.map((f) => f.file)], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
    });
    assert.equal(child.status, 0, `oracle child: ${child.stdout}${child.stderr}`);

    for (const f of files) {
      let ran: string[] = [];
      try {
        ran = readFileSync(f.marks, 'utf8').split('\n').filter(Boolean).sort();
      } catch {
        // No marker file: nothing ran, which the comparison below reports.
      }
      assert.deepEqual(ran, [...f.ran].sort(), `${f.id}: the child ran ${JSON.stringify(ran)}`);
      const flagged = scanSource(f.file, readFileSync(f.file, 'utf8')).violations.length > 0;
      assert.equal(flagged, f.drops, `${f.id}: scan verdict ${flagged ? 'flagged' : 'clean'}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
