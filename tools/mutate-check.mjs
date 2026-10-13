#!/usr/bin/env node
// Proves tests can fail: applies each mutant to a scratch copy of the tree and demands the named tests go red.
//   node tools/mutate-check.mjs SPEC.json --planned N
//   node tools/mutate-check.mjs --self-test
// SPEC is { tests: [files], mutants: [{ name, file, find, replace, expectRed: [test-name substrings] }] }.
// Prints 'APPLIED=a PLANNED=p RED=r' last and exits 0 only when a == p == r == N and every expectRed name failed.
// A mutant whose find is absent, repeated, or only in a comment is not applied: it proves nothing, so it fails the run.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const SKIPPED_ENTRIES = new Set(['node_modules', '.git', 'dist', 'api-extractor-temp']);

// The comments of a TypeScript source, as [start, end) ranges; a Markdown file has none, so every match in it counts. Located by parsing: a `//` inside a string or JSX text
// is not a comment, and a JSDoc node nested in a comment is part of that comment.
export function commentRanges(text, fileName) {
  if (fileName.endsWith('.md')) return [];
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found = new Map();
  const jsxText = [];
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      jsxText.push([node.pos, node.end]);
      return;
    }
    for (const c of ts.getLeadingCommentRanges(text, node.pos) ?? []) found.set(c.pos, c.end);
    for (const c of ts.getTrailingCommentRanges(text, node.end) ?? []) found.set(c.pos, c.end);
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  const ranges = [...found].filter(([pos]) => !jsxText.some(([from, to]) => pos >= from && pos < to)).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [pos, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && pos < last[1]) continue;
    merged.push([pos, end]);
  }
  return merged;
}

// Every offset where `find` starts, split by whether the match touches a comment. Overlapping matches both count.
export function locate(text, fileName, find) {
  const comments = commentRanges(text, fileName);
  const outside = [];
  let inComment = 0;
  for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + 1)) {
    const end = at + find.length;
    if (comments.some(([from, to]) => at < to && end > from)) inComment += 1;
    else outside.push(at);
  }
  return { outside, inComment };
}

// Failed test names from a spec-reporter log. A file that failed to load shows as its path and is not a test name.
export function failedTestNames(log) {
  const names = new Set();
  for (const line of log.split('\n')) {
    const match = /^\s*✖ (.+?) \(\d+(?:\.\d+)?ms\)\s*$/.exec(line);
    if (!match) continue;
    const name = match[1];
    if (/\.tsx?$/.test(name) && name.includes('/')) continue;
    names.add(name);
  }
  return [...names];
}

export function testCountOf(log) {
  let n = null;
  for (const line of log.split('\n')) {
    const match = /^ℹ tests (\d+)$/.exec(line);
    if (match) n = Number(match[1]);
  }
  return n;
}

// A fresh copy each time, deleted first, so a stale tree can never stand in for this one. node_modules is linked.
function freshTree(root, scratch, label) {
  const tree = join(scratch, label);
  rmSync(tree, { recursive: true, force: true });
  cpSync(root, tree, {
    recursive: true,
    filter: (source) => !SKIPPED_ENTRIES.has(basename(source)) && !source.endsWith('.tgz'),
  });
  if (existsSync(join(root, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(tree, 'node_modules'));
  return tree;
}

function runTests(tree, tests) {
  const run = spawnSync(process.execPath, ['tools/run-tests.mjs', ...tests], { cwd: tree, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024 });
  const log = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  return { status: run.status, log, count: testCountOf(log), failed: failedTestNames(log) };
}

function validateSpec(spec) {
  const problems = [];
  if (!Array.isArray(spec.tests) || spec.tests.length === 0 || !spec.tests.every((t) => typeof t === 'string' && t.length > 0)) {
    problems.push('tests must be a non-empty array of file paths');
  }
  if (!Array.isArray(spec.mutants) || spec.mutants.length === 0) {
    problems.push('mutants must be a non-empty array');
    return problems;
  }
  spec.mutants.forEach((m, i) => {
    const label = `mutants[${i}]`;
    if (typeof m.name !== 'string' || m.name.length === 0) problems.push(`${label}: name is required`);
    if (typeof m.file !== 'string' || m.file.length === 0 || isAbsolute(m.file) || m.file.split('/').includes('..')) problems.push(`${label}: file must be a path inside the repository`);
    else if (!/\.(ts|tsx|mts|cts|md)$/.test(m.file)) problems.push(`${label}: only TypeScript and Markdown files can be mutated`);
    if (typeof m.find !== 'string' || m.find.length === 0) problems.push(`${label}: find is required`);
    if (typeof m.replace !== 'string') problems.push(`${label}: replace is required`);
    else if (m.replace === m.find) problems.push(`${label}: replace equals find, so nothing would change`);
    if (!Array.isArray(m.expectRed) || m.expectRed.length === 0 || !m.expectRed.every((s) => typeof s === 'string' && s.length > 0)) {
      problems.push(`${label}: expectRed must name at least one test-name substring`);
    }
  });
  return problems;
}

export function mutateCheck({ specPath, planned, root = REPO_ROOT, log = console.log }) {
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const problems = validateSpec(spec);
  if (problems.length > 0) {
    for (const p of problems) log(`mutate-check: spec problem: ${p}`);
    return { ok: false, applied: 0, planned: Array.isArray(spec.mutants) ? spec.mutants.length : 0, red: 0 };
  }
  const scratch = mkdtempSync(join(tmpdir(), 'phonux-mutate-'));
  try {
    const base = runTests(freshTree(root, scratch, 'base'), spec.tests);
    if (base.status !== 0 || base.count === null || base.count === 0) {
      log(`mutate-check: the unmutated tree is not green (exit ${base.status}, ${base.count ?? 'no'} tests): mutants prove nothing against it`);
      log(base.log.split('\n').slice(-25).join('\n'));
      return { ok: false, applied: 0, planned: spec.mutants.length, red: 0 };
    }
    log(`unmutated tree: green, ${base.count} tests`);

    let applied = 0;
    let red = 0;
    let allNamed = true;
    for (const [i, m] of spec.mutants.entries()) {
      const tree = freshTree(root, scratch, `mutant-${i}`);
      const file = join(tree, m.file);
      if (!existsSync(file)) {
        log(`NOT APPLIED ${m.name}: ${m.file} does not exist`);
        continue;
      }
      const text = readFileSync(file, 'utf8');
      const { outside, inComment } = locate(text, m.file, m.find);
      if (outside.length !== 1) {
        log(`NOT APPLIED ${m.name}: find occurs ${outside.length} times outside a comment (${inComment} inside one); it must occur exactly once`);
        continue;
      }
      writeFileSync(file, text.slice(0, outside[0]) + m.replace + text.slice(outside[0] + m.find.length));
      applied += 1;
      const result = runTests(tree, spec.tests);
      const isRed = result.status !== 0;
      const missing = m.expectRed.filter((want) => !result.failed.some((name) => name.includes(want)));
      if (isRed) red += 1;
      if (missing.length > 0) allNamed = false;
      log(`${isRed ? 'RED  ' : 'GREEN'} ${m.name}: ${result.failed.length} test(s) failed${missing.length > 0 ? `; expected failures not seen: ${missing.map((s) => `'${s}'`).join(', ')}` : ''}`);
    }
    const ok = applied === spec.mutants.length && spec.mutants.length === planned && red === applied && allNamed;
    log(`APPLIED=${applied} PLANNED=${spec.mutants.length} RED=${red}`);
    if (spec.mutants.length !== planned) log(`mutate-check: --planned ${planned} does not match the ${spec.mutants.length} mutants in the spec`);
    return { ok, applied, planned: spec.mutants.length, red };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ---- self-test -------------------------------------------------------------------------------------------------

const PLANTED_SOURCE = 'export const value = (): number => 1; // value is 1\n';
const PLANTED_TEST = [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { value } from '../planted.js';",
  "test('planted: value is one', () => {",
  '  assert.equal(value(), 1);',
  '});',
  '',
].join('\n');
const PLANTED_RED_TEST = PLANTED_TEST.replace('value(), 1', 'value(), 2');

function plantProject(dir, { test = PLANTED_TEST, source = PLANTED_SOURCE } = {}) {
  mkdirSync(join(dir, 'tools'), { recursive: true });
  mkdirSync(join(dir, 'test'), { recursive: true });
  for (const name of ['run-tests.mjs', 'late-registration-scan.mjs', 'test-stream.mjs', 'file-presence-reporter.mjs', 'flush-stdout-before-exit.mjs']) {
    cpSync(join(REPO_ROOT, 'tools', name), join(dir, 'tools', name));
  }
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(join(dir, 'planted.ts'), source);
  writeFileSync(join(dir, 'test', 'planted.test.ts'), test);
}

function selfTest() {
  const results = [];
  const scratch = mkdtempSync(join(tmpdir(), 'phonux-mutate-selftest-'));
  const selfPath = fileURLToPath(import.meta.url);
  try {
    const attempt = (name, { project, mutants, planned, wantExit, wantLine }) => {
      const dir = join(scratch, `case-${results.length}`);
      plantProject(dir, project);
      const specPath = join(dir, 'spec.json');
      writeFileSync(specPath, JSON.stringify({ tests: ['test/planted.test.ts'], mutants }));
      const run = spawnSync(process.execPath, [selfPath, specPath, '--planned', String(planned), '--root', dir], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS });
      const lines = (run.stdout ?? '').trim().split('\n');
      const lastLine = lines[lines.length - 1] ?? '';
      const exitOk = wantExit === 0 ? run.status === 0 : run.status !== 0 && run.status !== null;
      const lineOk = wantLine === undefined || lastLine === wantLine;
      results.push(exitOk && lineOk);
      console.log(`${exitOk && lineOk ? 'ok  ' : 'FAIL'} ${name} (exit ${run.status}, last line '${lastLine}')`);
    };
    const turnsRed = { name: 'one', file: 'planted.ts', find: '=> 1;', replace: '=> 2;', expectRed: ['planted: value is one'] };

    attempt('a mutant that turns the planted test red prints APPLIED=1 PLANNED=1 RED=1 and exits 0', { mutants: [turnsRed], planned: 1, wantExit: 0, wantLine: 'APPLIED=1 PLANNED=1 RED=1' });
    attempt('a mutant whose find occurs twice is not applied and the run exits non-zero', {
      project: { source: 'export const value = (): number => 1;\nexport const again = (): number => 1;\n' },
      mutants: [{ ...turnsRed, find: '(): number =>', replace: '(): number => 0 +' }],
      planned: 1,
      wantExit: 1,
      wantLine: 'APPLIED=0 PLANNED=1 RED=0',
    });
    attempt('a mutant whose find occurs only inside a comment is not applied and the run exits non-zero', {
      mutants: [{ ...turnsRed, find: 'value is 1', replace: 'value is 2' }],
      planned: 1,
      wantExit: 1,
      wantLine: 'APPLIED=0 PLANNED=1 RED=0',
    });
    attempt('an unmutated tree that is already red exits non-zero', { project: { test: PLANTED_RED_TEST }, mutants: [turnsRed], planned: 1, wantExit: 1 });
    attempt('a mutant that goes red but not on the named test exits non-zero', {
      mutants: [{ ...turnsRed, expectRed: ['a test that does not exist'] }],
      planned: 1,
      wantExit: 1,
      wantLine: 'APPLIED=1 PLANNED=1 RED=1',
    });
    attempt('a mutant the planted test never reads stays green, so the run exits non-zero', {
      project: { source: `${PLANTED_SOURCE}export const unused = 5;\n` },
      mutants: [{ ...turnsRed, find: '= 5;', replace: '= 6;' }],
      planned: 1,
      wantExit: 1,
      wantLine: 'APPLIED=1 PLANNED=1 RED=0',
    });
    attempt('a --planned that differs from the spec exits non-zero', { mutants: [turnsRed], planned: 2, wantExit: 1 });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const passed = results.filter(Boolean).length;
  console.log(`self-test: ${passed}/${results.length}`);
  return results.length > 0 && passed === results.length;
}

function main(argv) {
  if (argv[0] === '--self-test') return selfTest() ? 0 : 1;
  let specPath;
  let planned;
  let root = REPO_ROOT;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--planned') planned = Number(argv[++i]);
    else if (argv[i] === '--root') root = resolve(argv[++i] ?? '');
    else if (!specPath) specPath = resolve(argv[i]);
    else {
      console.error(`mutate-check: unexpected argument ${argv[i]}`);
      return 2;
    }
  }
  if (!specPath || !Number.isInteger(planned) || planned < 1) {
    console.error('usage: node tools/mutate-check.mjs SPEC.json --planned N | --self-test');
    return 2;
  }
  return mutateCheck({ specPath, planned, root }).ok ? 0 : 1;
}

// Compared through realpath: argv[1] can keep a symlinked spelling (/var against /private/var) that import.meta.url resolves.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
