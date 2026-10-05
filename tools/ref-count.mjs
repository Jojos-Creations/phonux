#!/usr/bin/env node
// Counts the references to one identifier across the published source set.
//   node tools/ref-count.mjs IDENTIFIER [--exclude FILE]... [--min-files N] [--git-ref REF] [--list]
//   node tools/ref-count.mjs --self-test
// The set is the *.ts and *.tsx files at the repository root plus those directly in panels/, never test/, tools/ or
// dist/. A reference is an Identifier node that reads the name: a declaration name, an import or export specifier, a
// property name, a comment and a string are not. Prints 'scanned F files, R references'; exits non-zero when F is 0 or
// below --min-files, so a scan that covered too little can never read as a count of zero.
// --git-ref REF reads that commit's blobs instead of the working tree. --list prints each reference to stderr.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_EXTENSION = /\.(ts|tsx)$/;
const SOURCE_DIRS = ['', 'panels'];

// A name written where it is declared, imported, exported or used as a property key is not a use of the binding.
function isReference(id) {
  const parent = id.parent;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isQualifiedName(parent)) return parent.left === id;
  if (ts.isBindingElement(parent)) return parent.initializer === id;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
  if (parent.name === id || parent.propertyName === id) return false;
  return true;
}

export function referenceLines(text, fileName, identifier) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const lines = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === identifier && isReference(node)) {
      lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return lines;
}

function git(root, args) {
  const run = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(run.stderr || run.stdout || '').trim()}`);
  return run.stdout;
}

// [{ path, read() }] for each source file of the set, from the working tree or from a commit.
function sourceFiles(root, gitRef) {
  const files = [];
  for (const dir of SOURCE_DIRS) {
    if (gitRef) {
      const listing = git(root, ['ls-tree', gitRef, dir === '' ? '.' : `${dir}/`]).split('\n').filter(Boolean);
      for (const entry of listing) {
        const [meta, path] = entry.split('\t');
        if (meta.split(' ')[1] !== 'blob' || !SOURCE_EXTENSION.test(path)) continue;
        files.push({ path, read: () => git(root, ['show', `${gitRef}:${path}`]) });
      }
    } else {
      const absolute = join(root, dir);
      if (!existsSync(absolute)) continue;
      for (const name of readdirSync(absolute).sort()) {
        const full = join(absolute, name);
        if (!SOURCE_EXTENSION.test(name) || !statSync(full).isFile()) continue;
        files.push({ path: dir === '' ? name : `${dir}/${name}`, read: () => readFileSync(full, 'utf8') });
      }
    }
  }
  return files;
}

export function countReferences({ root, identifier, excludes = [], gitRef }) {
  const files = sourceFiles(root, gitRef).filter((f) => !excludes.some((e) => f.path === e || basename(f.path) === e));
  const references = [];
  for (const file of files) {
    for (const line of referenceLines(file.read(), file.path, identifier)) references.push(`${file.path}:${line}`);
  }
  return { scanned: files.length, references };
}

// ---- self-test -------------------------------------------------------------------------------------------------

function runTool(args) {
  const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: 'utf8' });
  return { status: run.status, out: (run.stdout ?? '').trim() };
}

function plantFixture(dir) {
  const files = {
    'declare.ts': 'export const GAP = 16;\n',
    'use.ts': [
      "import { GAP } from './declare';",
      'export { GAP };',
      '// GAP appears in this comment only',
      "const label = 'GAP';",
      'const bag = { GAP: 1 };',
      'const read = bag.GAP;',
      'export const total = GAP + GAP;',
      'void label; void read;',
      '',
    ].join('\n'),
    // Out of the set: below panels/, in test/, tools/ and dist/.
    'panels/deep/inner.ts': 'export const x = GAP;\n',
    'test/t.ts': 'export const x = GAP;\n',
    'tools/x.ts': 'export const x = GAP;\n',
    'dist/d.ts': 'export const x = GAP;\n',
  };
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
}

function selfTest() {
  const results = [];
  const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} (${detail})`);
  };
  const scratch = mkdtempSync(join(tmpdir(), 'phonux-refcount-'));
  try {
    plantFixture(scratch);
    let r = runTool(['GAP', '--root', scratch]);
    check('one declaration, one import, one export specifier, one comment, a string, two property names and two uses print 2', r.status === 0 && r.out === 'scanned 2 files, 2 references', `exit ${r.status}, '${r.out}'`);
    r = runTool(['GAP', '--root', scratch, '--min-files', '99']);
    check('--min-files 99 on the fixture exits non-zero', r.status !== 0, `exit ${r.status}, '${r.out}'`);
    r = runTool(['GAP', '--root', scratch, '--exclude', 'use.ts']);
    check('--exclude removes a file from the set', r.status === 0 && r.out === 'scanned 1 files, 0 references', `exit ${r.status}, '${r.out}'`);
    r = runTool(['NOPE', '--root', scratch]);
    check('an identifier nothing uses prints 0 references over the same files', r.status === 0 && r.out === 'scanned 2 files, 0 references', `exit ${r.status}, '${r.out}'`);
    const empty = mkdtempSync(join(tmpdir(), 'phonux-refcount-empty-'));
    r = runTool(['GAP', '--root', empty]);
    rmSync(empty, { recursive: true, force: true });
    check('a set of zero files exits non-zero', r.status !== 0, `exit ${r.status}, '${r.out}'`);

    // --git-ref must read the commit, not the working tree.
    const gitRun = (...args) => spawnSync('git', ['-C', scratch, '-c', 'user.name=selftest', '-c', 'user.email=selftest@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
    const initialised = gitRun('init', '-q').status === 0;
    gitRun('add', '-A');
    const committed = gitRun('commit', '-q', '-m', 'fixture').status === 0;
    writeFileSync(join(scratch, 'use.ts'), 'export const none = 1;\n');
    r = runTool(['GAP', '--root', scratch, '--git-ref', 'HEAD']);
    check('--git-ref counts the committed blobs whatever the working tree holds', initialised && committed && r.status === 0 && r.out === 'scanned 2 files, 2 references', `exit ${r.status}, '${r.out}'`);
    r = runTool(['GAP', '--root', scratch]);
    check('control: the same working tree without --git-ref counts the edited file', r.status === 0 && r.out === 'scanned 2 files, 0 references', `exit ${r.status}, '${r.out}'`);
    r = runTool(['GAP', '--root', scratch, '--git-ref', 'no-such-ref']);
    check('an unknown ref exits non-zero', r.status !== 0, `exit ${r.status}, '${r.out}'`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const passed = results.filter(Boolean).length;
  console.log(`self-test: ${passed}/${results.length}`);
  return results.length > 0 && passed === results.length;
}

function main(argv) {
  if (argv[0] === '--self-test') return selfTest() ? 0 : 1;
  let identifier;
  let root = REPO_ROOT;
  let gitRef;
  let minFiles = 1;
  let list = false;
  const excludes = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--exclude') excludes.push(argv[++i]);
    else if (arg === '--min-files') minFiles = Number(argv[++i]);
    else if (arg === '--git-ref') gitRef = argv[++i];
    else if (arg === '--root') root = resolve(argv[++i] ?? '');
    else if (arg === '--list') list = true;
    else if (!identifier && !arg.startsWith('--')) identifier = arg;
    else {
      console.error(`ref-count: unexpected argument ${arg}`);
      return 2;
    }
  }
  if (!identifier || excludes.includes(undefined) || !Number.isInteger(minFiles) || minFiles < 0 || (gitRef === undefined && argv.includes('--git-ref'))) {
    console.error('usage: node tools/ref-count.mjs IDENTIFIER [--exclude FILE]... [--min-files N] [--git-ref REF] [--list]');
    return 2;
  }
  let result;
  try {
    result = countReferences({ root, identifier, excludes, gitRef });
  } catch (error) {
    console.error(`ref-count: ${error.message}`);
    return 1;
  }
  if (list) for (const reference of result.references) console.error(reference);
  console.log(`scanned ${result.scanned} files, ${result.references.length} references`);
  if (result.scanned === 0 || result.scanned < minFiles) {
    console.error(`ref-count: ${result.scanned} files scanned, fewer than the ${Math.max(1, minFiles)} required: this count proves nothing`);
    return 1;
  }
  return 0;
}

// Compared through realpath: argv[1] can keep a symlinked spelling (/var against /private/var) that import.meta.url resolves.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
