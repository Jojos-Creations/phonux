/**
 * Properties of the library's own source that no compiler sees. Each test reads a file by path and asserts it found
 * the thing it checks, so a renamed file or a moved declaration fails the test instead of turning it into a pass.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { stripComments } from './support/boundary-scan.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function read(rel: string): string {
  const source = readFileSync(join(ROOT, rel), 'utf8');
  assert.ok(source.length > 0, `${rel} is empty, so the check below would prove nothing`);
  return source;
}

test('source: `.view ===` and `.view !==` appear in none of PanelRow.tsx, viewRegistry.tsx and templateView.tsx -- a view is resolved through resolveViewIn(templateOf, p.view), never compared', () => {
  for (const file of ['PanelRow.tsx', 'viewRegistry.tsx', 'templateView.tsx']) {
    assert.doesNotMatch(read(file), /\.view\s*===|\.view\s*!==/, `${file} must select a component by resolving \`view\`, never by comparing it`);
  }
  assert.match(read('PanelRow.tsx'), /resolveViewIn\(/, 'PanelRow.tsx does not call resolveViewIn(: the invariant above is checking the wrong file');
});

test('source: `collapsible` is not an accepted key of CreatePanelOptions -- `permanent` is the only public door to a permanent column', () => {
  const src = read('hostApi.tsx');
  const bagStart = src.indexOf('export interface CreatePanelOptions');
  assert.ok(bagStart >= 0, 'CreatePanelOptions interface not found in hostApi.tsx');
  const braceOpen = src.indexOf('{', bagStart);
  assert.ok(braceOpen >= 0, 'CreatePanelOptions has no opening brace');
  // Brace counting, not a search for the first closing line: a field type that spans lines would truncate the region early.
  let depth = 0;
  let bagEnd = -1;
  for (let i = braceOpen; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) {
      bagEnd = i;
      break;
    }
  }
  assert.ok(bagEnd >= 0, 'CreatePanelOptions interface body never closes');
  const bag = src.slice(bagStart, bagEnd);
  assert.doesNotMatch(bag, /^\s*collapsible\s*[?:]/m, 'CreatePanelOptions must never accept a raw `collapsible` key');
  assert.match(bag, /permanent\?:\s*boolean/, 'permanent is the one named door to collapsible:false');
});

test("source: PanelRow's zIndex and enterDirection do not read `collapsible` -- both are driven by `layer` and `anchoredEnter` alone", () => {
  const lines = read('PanelRow.tsx').split('\n');
  const zIndexLine = lines.find((l) => l.includes('zIndex={'));
  const enterLine = lines.find((l) => l.includes('enterDirection={'));
  assert.ok(zIndexLine && !zIndexLine.includes('collapsible'), `zIndex must not read collapsible: ${zIndexLine}`);
  assert.ok(enterLine && !enterLine.includes('collapsible'), `enterDirection must not read collapsible: ${enterLine}`);
  assert.ok(zIndexLine.includes('layer'), 'zIndex must read layer');
  assert.ok(enterLine.includes('anchoredEnter'), 'enterDirection must read anchoredEnter');
  assert.ok(enterLine.includes('enterFrom'), 'enterDirection must read enterFrom');
});

test('source: PanelRowSlot has one motion element, the slot, which owns exit, and the size box is not a layout animation', () => {
  const source = stripComments(read('PanelRowSlot.tsx'), 'PanelRowSlot.tsx');
  const openings = [...source.matchAll(/<motion\.div\b[\s\S]*?>\s*\n/g)].map((m) => m[0]);
  assert.equal(openings.length, 1, 'one motion element: the slot');
  assert.match(openings[0]!, /\bexit=\{/, 'it owns exit');
  assert.doesNotMatch(source, /\blayout=|layoutDependency/, "no layout animation: the size box's scale starts in the commit, on the slot's clock");
});

const usesMemo = (source: string): boolean => /\buse(Memo|Callback)\s*\(/.test(stripComments(source, "x.ts"));

test('source: provider hooks under panels/ are memo-free and are exactly the expected set -- their handlers close over this render, so a memo hands views stale closures', () => {
  assert.equal(usesMemo('const v = useMemo(() => 1, []);'), true, 'the matcher must find a planted useMemo');
  assert.equal(usesMemo('// useMemo( is only named in a comment'), false);
  const providers = readdirSync(join(ROOT, 'panels')).filter((f) => /^useProvide.*\.tsx?$/.test(f)).sort();
  assert.deepEqual(providers, ['useProvidePanels.ts'], 'the provider scan found a different set than the one this test was written against');
  assert.deepEqual(providers.filter((f) => usesMemo(read(`panels/${f}`))), []);
});

// ---------------------------------------------------------------------------
// Who writes an entry's mirror fields, and who reads `.collapsible`
// ---------------------------------------------------------------------------

type Site = { fn: string; key: string; line: number };

/** The nearest named function around `node`: a declaration, or a function or arrow assigned to a const. */
function enclosingFunction(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) return n.name.text;
    if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
  }
  return '<module>';
}

const propertyName = (name: ts.PropertyName): string | undefined => (ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined);

/** Every assignment `x.key = ...` and every object-literal member named in `keys`, with the function it sits in. */
function writesOf(source: string, file: string, keys: readonly string[]): Site[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: Site[] = [];
  const at = (node: ts.Node, key: string): void => void found.push({ fn: enclosingFunction(node), key, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = node.left;
      if (ts.isPropertyAccessExpression(left) && keys.includes(left.name.text)) at(node, left.name.text);
      if (ts.isElementAccessExpression(left) && ts.isStringLiteral(left.argumentExpression) && keys.includes(left.argumentExpression.text)) at(node, left.argumentExpression.text);
    }
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name !== undefined && keys.includes(name)) at(node, name);
    }
    if (ts.isShorthandPropertyAssignment(node) && keys.includes(node.name.text)) at(node, node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Every read of a `.collapsible` property (or a destructured `collapsible`), with the function it sits in. */
function collapsibleReads(source: string, file: string): Site[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: Site[] = [];
  const visit = (node: ts.Node): void => {
    const isRead =
      (ts.isPropertyAccessExpression(node) && node.name.text === 'collapsible' && !(ts.isBinaryExpression(node.parent) && node.parent.left === node && node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken)) ||
      (ts.isBindingElement(node) && ts.isIdentifier(node.name) && (node.propertyName ?? node.name).getText(sf) === 'collapsible');
    if (isRead) found.push({ fn: enclosingFunction(node), key: 'collapsible', line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const ENTRY_FILES = ['panelWindow.ts', 'panelRowEntry.ts', ...readdirSync(join(ROOT, 'panels')).filter((f) => /[.]tsx?$/.test(f)).sort().map((f) => `panels/${f}`)];
const sitesOf = (sites: Site[]): string[] => sites.map((s) => `${s.fn}:${s.key}`).sort();

test("source: `collapsible` is written only by applyTemplate, plus the 0.1.0 literals in appendPanel and createHistoryPanel; `key` is written by applyTemplate alone", () => {
  assert.ok(ENTRY_FILES.length >= 7, 'the scan list is short: panels/ was not read');
  const outside: string[] = [];
  for (const file of ENTRY_FILES) {
    for (const site of writesOf(read(file), file, ['collapsible', 'key'])) outside.push(`${file} ${site.fn}:${site.key}`);
  }
  assert.deepEqual(
    outside.sort(),
    [
      'panelWindow.ts appendPanel:collapsible',
      'panelWindow.ts createHistoryPanel:collapsible',
      // A template registered after the restore names the entries that were built without it, so lateRegister gives each its key.
      'panels/useProvidePanels.ts lateRegister:key',
    ],
    'a writer of collapsible or key outside the allowed functions',
  );
  const settingsFile = writesOf(read('panelSettings.ts'), 'panelSettings.ts', ['collapsible']);
  assert.deepEqual(sitesOf(settingsFile), ['applyTemplate:collapsible', 'applyTemplate:collapsible'], 'panelSettings.ts writes them in applyTemplate and nowhere else, once per mode');
});

/** The `key` member written inside applyTemplate, and whether it sits in the reconfigure branch. */
function keyWritesInApplyTemplate(source: string): { total: number; inReconfigure: number } {
  const sf = ts.createSourceFile('panelSettings.ts', source, ts.ScriptTarget.Latest, true);
  let total = 0;
  let inReconfigure = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'applyTemplate') {
      const walk = (inner: ts.Node, reconfigure: boolean): void => {
        if (ts.isIfStatement(inner) && inner.expression.getText(sf).includes("'reconfigure'")) {
          walk(inner.thenStatement, true);
          if (inner.elseStatement) walk(inner.elseStatement, reconfigure);
          return;
        }
        if ((ts.isPropertyAssignment(inner) && propertyName(inner.name) === 'key') || (ts.isShorthandPropertyAssignment(inner) && inner.name.text === 'key')) {
          total += 1;
          if (reconfigure) inReconfigure += 1;
        }
        ts.forEachChild(inner, (child) => walk(child, reconfigure));
      };
      walk(node, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { total, inReconfigure };
}

test("source: applyTemplate writes `key` once, outside its reconfigure branch, and appendPanel writes none", () => {
  assert.deepEqual(keyWritesInApplyTemplate(read('panelSettings.ts')), { total: 1, inReconfigure: 0 });
  assert.deepEqual(writesOf(read('panelWindow.ts'), 'panelWindow.ts', ['key']), [], 'panelWindow.ts has no key write, appendPanel included');
});

test('source: a planted extra writer of collapsible or key in a scratch copy of panelWindow.ts is found, and a planted key write in the reconfigure branch is too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'phonux-invariants-'));
  try {
    const copy = join(dir, 'panelWindow.ts');
    writeFileSync(copy, `${read('panelWindow.ts')}\nexport function plantedWriter(p: PanelWindow): PanelWindow {\n  const q = { ...p, key: 'k' };\n  q.collapsible = false;\n  return q;\n}\n`);
    const planted = sitesOf(writesOf(readFileSync(copy, 'utf8'), copy, ['collapsible', 'key']));
    assert.deepEqual(planted.filter((s) => s.startsWith('plantedWriter')), ['plantedWriter:collapsible', 'plantedWriter:key'], 'the scan sees both planted writes');
    const reconfigureWrite = read('panelSettings.ts').replace("listed: resolved.listed,\n      layer", "listed: resolved.listed,\n      key: entry.id,\n      layer");
    assert.notEqual(reconfigureWrite, read('panelSettings.ts'), 'the plant found its place');
    assert.deepEqual(keyWritesInApplyTemplate(reconfigureWrite), { total: 2, inReconfigure: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The members of the object literal `applyTemplate` returns in its 'reconfigure' branch and in its 'create' branch. A
 * spread of a name reads `...name`, and a member inside a conditional spread reads `?name`.
 */
function applyTemplateWrites(source: string): { reconfigure: string[]; create: string[] } {
  const sf = ts.createSourceFile('panelSettings.ts', source, ts.ScriptTarget.Latest, true);
  const out = { reconfigure: [] as string[], create: [] as string[] };
  const named = (m: ts.ObjectLiteralElementLike): string[] => {
    if (ts.isPropertyAssignment(m) || ts.isShorthandPropertyAssignment(m)) return [(m.name as ts.Identifier).text];
    if (!ts.isSpreadAssignment(m)) return [];
    if (ts.isIdentifier(m.expression)) return [`...${m.expression.text}`];
    const inner = ts.isParenthesizedExpression(m.expression) ? m.expression.expression : m.expression;
    if (!ts.isConditionalExpression(inner)) return [];
    return [inner.whenTrue, inner.whenFalse].flatMap((arm) => (ts.isObjectLiteralExpression(arm) ? arm.properties.flatMap((q) => named(q).map((n) => `?${n}`)) : []));
  };
  const members = (literal: ts.ObjectLiteralExpression): string[] => literal.properties.flatMap(named);
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'applyTemplate' && node.body !== undefined) {
      for (const statement of node.body.statements) {
        if (ts.isIfStatement(statement) && statement.expression.getText(sf).includes("'reconfigure'")) {
          const inside: readonly ts.Statement[] = ts.isBlock(statement.thenStatement) ? statement.thenStatement.statements : [statement.thenStatement];
          const ret = inside.find((q): q is ts.ReturnStatement => ts.isReturnStatement(q));
          if (ret?.expression !== undefined && ts.isObjectLiteralExpression(ret.expression)) out.reconfigure = members(ret.expression);
        } else if (ts.isReturnStatement(statement) && statement.expression !== undefined && ts.isObjectLiteralExpression(statement.expression)) {
          out.create = members(statement.expression);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The entry fields a configure must never write itself: only applyTemplate's reconfigure branch (through `reparked`) may. */
const ENTRY_FIELDS = ['collapsible', 'listed', 'anchoredEnter', 'size', 'anchor', 'hostData', 'overrides', 'applied', 'live', 'settings', 'title'];
/** The files a configure passes through before and after the engine's update. */
const CONFIGURE_FILES = ['panelConfigure.ts', 'panelPin.ts', 'panelManager.ts', 'panelHandles.ts', 'workspaceCore.ts'];
const CONFIGURE_FUNCTIONS = ['configureOne', 'configureTemplateOne', 'configureTuningOne'];

/** Every write of an entry field in the configure files, as `file function:field`, with workspaceCore.ts narrowed to its three configure functions. */
function configureWriters(read: (file: string) => string): string[] {
  return CONFIGURE_FILES.flatMap((file) =>
    writesOf(read(file), file, ENTRY_FIELDS)
      .filter((site) => file !== 'workspaceCore.ts' || CONFIGURE_FUNCTIONS.includes(site.fn))
      .map((site) => `${file} ${site.fn}:${site.key}`),
  ).sort();
}

test('source: a configure writes an entry only through applyTemplate\'s reconfigure branch, and a planted second writer is found', () => {
  assert.deepEqual(applyTemplateWrites(read('panelSettings.ts')).reconfigure, ['...entry', '?collapsible', 'listed', 'layer', 'anchoredEnter', '...title', 'settings'], 'the reconfigure branch writes the mirror fields, the parkable flip and the title, and no slots, anchor, hostData, key, overrides or applied');
  const create = applyTemplateWrites(read('panelSettings.ts')).create;
  for (const created of ['slots', 'key', 'live']) assert.ok(create.includes(created), `the create branch writes ${created}, so a reconfigure that wrote it would be a second writer`);
  const both = writesOf(read('panelSettings.ts'), 'panelSettings.ts', ['collapsible']).map((s) => `${s.fn}:${s.key}`).sort();
  assert.deepEqual(both, ['applyTemplate:collapsible', 'applyTemplate:collapsible'], 'one write of each per mode, both inside applyTemplate');
  // The configure path: reconfigured() hands the entry to reparked(), which calls applyTemplate in reconfigure mode, and nothing else builds one.
  assert.match(stripComments(read('panelConfigure.ts'), 'panelConfigure.ts'), /reparked\(entry, plan\.resolution\)/);
  assert.match(stripComments(read('panelPin.ts'), 'panelPin.ts'), /applyTemplate\(entry, resolution\.value, 'reconfigure'\)/);
  for (const file of CONFIGURE_FILES) {
    const calls = [...stripComments(read(file), file).matchAll(/\bapplyTemplate\(([^;]*?), '(create|reconfigure)'\)/g)].map((m) => m[2]);
    assert.deepEqual(calls, file === 'panelPin.ts' ? ['reconfigure'] : file === 'workspaceCore.ts' ? ['create'] : [], `${file}: applyTemplate calls (workspaceCore's one is the root entry's creation)`);
  }
  assert.deepEqual(configureWriters(read), ['panelPin.ts reparked:live', 'workspaceCore.ts configureOne:settings'], 'the only other writes: the fixed-column flip in reparked, and the record\'s own layer');

  const dir = mkdtempSync(join(tmpdir(), 'phonux-invariants-'));
  try {
    const planted = (file: string, extra: string): string[] => {
      const copy = join(dir, file);
      writeFileSync(copy, `${read(file)}\n${extra}\n`);
      const text = readFileSync(copy, 'utf8');
      return configureWriters((f) => (f === file ? text : read(f)));
    };
    assert.deepEqual(
      planted('panelConfigure.ts', 'export function plantedWriter(p: PanelWindow): PanelWindow {\n  const q = { ...p, size: undefined };\n  q.collapsible = false;\n  return q;\n}'),
      ['panelConfigure.ts plantedWriter:collapsible', 'panelConfigure.ts plantedWriter:size', 'panelPin.ts reparked:live', 'workspaceCore.ts configureOne:settings'],
      'a second writer in panelConfigure.ts is found, both of its writes',
    );
    assert.deepEqual(
      planted('workspaceCore.ts', 'export function configureOne(p: PanelWindow): PanelWindow {\n  return { ...p, anchor: undefined };\n}').filter((site) => site.includes('anchor')),
      ['workspaceCore.ts configureOne:anchor'],
      'and so is one planted into a configure function of workspaceCore.ts',
    );
    const widened = read('panelSettings.ts').replace("listed: resolved.listed,\n      layer", "listed: resolved.listed,\n      slots: resolved.slots,\n      layer");
    assert.notEqual(widened, read('panelSettings.ts'), 'the plant found its place');
    assert.deepEqual(applyTemplateWrites(widened).reconfigure, ['...entry', '?collapsible', 'listed', 'slots', 'layer', 'anchoredEnter', '...title', 'settings'], 'a slots write planted in the reconfigure branch is found');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const LIBRARY_FILES = [...readdirSync(ROOT), ...readdirSync(join(ROOT, 'panels')).map((f) => `panels/${f}`)].filter((f) => /[.]tsx?$/.test(f) && !f.endsWith('.d.ts')).sort();
const OVERRIDES_WRITERS = ['clearOverrides', 'projectWorkspaceState', 'reconcileWorkspace', 'recordOverride'];

test('source: `overrides` is written only inside recordOverride, clearOverrides, reconcileWorkspace and projectWorkspaceState', () => {
  assert.ok(LIBRARY_FILES.length >= 40, 'the scan list is short');
  const found = LIBRARY_FILES.flatMap((file) => writesOf(read(file), file, ['overrides']).map((site) => `${file} ${site.fn}`));
  assert.deepEqual([...new Set(found.map((f) => f.split(' ')[1]))].sort(), OVERRIDES_WRITERS, 'a writer outside the four, or one of them gone');
  assert.ok(found.length >= OVERRIDES_WRITERS.length, 'control: the scan found every writer');
});

test('source: a scratch copy of useProvidePanels.ts with a fifth writer of `overrides` is found', () => {
  const dir = mkdtempSync(join(tmpdir(), 'phonux-invariants-'));
  try {
    const copy = join(dir, 'useProvidePanels.ts');
    writeFileSync(copy, `${read('panels/useProvidePanels.ts')}\nexport function plantedWriter(p: PanelWindow): PanelWindow {\n  return { ...p, overrides: {} };\n}\n`);
    assert.deepEqual(sitesOf(writesOf(readFileSync(copy, 'utf8'), copy, ['overrides'])), ['plantedWriter:overrides']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Functions that still read `.collapsible`: presence, parking and fixed-column bookkeeping. Permission decisions read effective(p). */
const COLLAPSIBLE_READERS: Record<string, readonly string[]> = {
  'panelWindow.ts': ['firstParkedAfter', 'lastParkedBefore', 'leftmostLiveIndex', 'parksForRoom', 'recordOverride', 'rightmostLiveIndex', 'sideOfLiveRange'],
  'panels/usePanelManager.ts': ['holdPanel', 'markHeld', 'pricing', 'usePanelManager', 'wouldEmptyRow'],
  'panels/useProvidePanels.ts': ['useProvidePanels'],
};

test('source: every read of `.collapsible` in panelWindow.ts, usePanelManager.ts and useProvidePanels.ts sits in a function on the allow-list', () => {
  for (const [file, allowed] of Object.entries(COLLAPSIBLE_READERS)) {
    const readers = [...new Set(collapsibleReads(read(file), file).map((s) => s.fn))].sort();
    assert.deepEqual(readers, [...allowed].sort(), `${file}: the functions that read .collapsible differ from the allow-list`);
  }
});

test('source: a planted `.collapsible` read in a new function is found, so the allow-list can fail', () => {
  const planted = collapsibleReads('export function newGuard(p: { collapsible: boolean }) { return p.collapsible; }', 'planted.ts');
  assert.deepEqual(planted.map((s) => s.fn), ['newGuard']);
  assert.deepEqual(collapsibleReads('const f = ({ collapsible }: { collapsible: boolean }) => collapsible;', 'planted.ts').map((s) => s.fn), ['f'], 'a destructured read counts too');
  assert.deepEqual(collapsibleReads('function g(p: { collapsible: boolean }) { p.collapsible = true; }', 'planted.ts'), [], 'a write is not a read');
});

/** The member names of the object literal `export function NAME(...)` returns, read from the source text. */
function returnedKeys(src: string, name: string): string[] {
  const start = src.search(new RegExp(`export function ${name}[<(]`));
  assert.ok(start >= 0, `${name} not found`);
  const body = src.slice(src.indexOf('return {', start) + 'return {'.length);
  const literal = body.slice(0, body.indexOf('\n  };'));
  return [...literal.matchAll(/^ {4}(\w+)[:(,]/gm)].map((m) => m[1]!);
}

test('source: the read handle has exactly id, templateId, getState, getSettings and subscribe, and the reader exactly get, list, getSnapshot and subscribe', () => {
  const src = read('panelHandles.ts');
  assert.deepEqual(returnedKeys(src, 'makeHandle'), ['id', 'templateId', 'getState', 'getSettings', 'subscribe']);
  assert.deepEqual(returnedKeys(src, 'makeReader'), ['get', 'list', 'getSnapshot', 'subscribe']);
});

test('source: the handle a view receives has the five read members and the twelve verbs, and no manager', () => {
  const src = read('panelHandles.ts');
  assert.deepEqual(returnedKeys(src, 'makeViewHandle'), ['id', 'templateId', 'getState', 'getSettings', 'subscribe', 'show', 'hide', 'toggleVisibility', 'close', 'open', 'move', 'place', 'setSlots', 'scrollTo', 'pin', 'unpin', 'configure']);
  const widened = src.replace('    show: (src', '    manager: {},\n    show: (src');
  assert.notEqual(widened, src, 'control: the plant applied');
  assert.ok(returnedKeys(widened, 'makeViewHandle').includes('manager'), 'the pin sees a planted member');
});

test('source: a planted member on the handle or the reader is found, so the shape pin can fail', () => {
  const src = read('panelHandles.ts');
  const widened = src.replace('    getState: () =>', '    hide: () => {},\n    getState: () =>').replace('    get: (id) =>', '    hide: () => {},\n    get: (id) =>');
  assert.notEqual(widened, src, 'control: the plant applied');
  assert.ok(returnedKeys(widened, 'makeHandle').includes('hide'));
  assert.ok(returnedKeys(widened, 'makeReader').includes('hide'));
});

// ---------------------------------------------------------------------------
// Timing tuning and the hold wiring
// ---------------------------------------------------------------------------

test('source: useRowScrollGesture reads gestureLockMs from a ref assigned on every render, measures the burst lock against it and never lists it as an effect dependency', () => {
  const src = read('panels/useRowScrollGesture.ts');
  assert.match(src, /const gestureLockMsRef = useRef\(gestureLockMs\);\s*gestureLockMsRef\.current = gestureLockMs;/, 'the ref is created and assigned in the render body, like scrollRowRef');
  assert.match(src, /performance\.now\(\) - lastStepAt < gestureLockMsRef\.current/, 'a step inside the lock window is held back, the window read from the ref');
  assert.match(src, /\}, \[overflowContainerRef, mode\]\);/, 'the effect depends on the container ref and the gesture mode alone, so a new lock does not tear the listeners down');
  assert.doesNotMatch(src, /GESTURE_LOCK_MS = /, 'the module constant is gone');
  assert.match(src, /gestureLockMs: number = GESTURE_LOCK_MS/, 'the parameter defaults to the one constant');
});

test('source: useWorkspacePersistence reads saveQuietMs from a ref assigned on every render and arms the save timer from it', () => {
  const src = read('panels/useWorkspacePersistence.ts');
  assert.match(src, /const saveQuietMsRef = useRef\(i\.saveQuietMs \?\? SAVE_QUIET_MS\);\s*saveQuietMsRef\.current = i\.saveQuietMs \?\? SAVE_QUIET_MS;/);
  assert.match(src, /\}, saveQuietMsRef\.current\);/, 'the save timer is armed from the ref');
  assert.doesNotMatch(src, /SAVE_QUIET_MS = 500/, 'the module constant is gone');
});

test('source: usePanelManager takes its new inputs in one optional trailing options object, so the harness call with six arguments still typechecks', () => {
  const sf = ts.createSourceFile('usePanelManager.ts', read('panels/usePanelManager.ts'), ts.ScriptTarget.Latest, true);
  let params: readonly ts.ParameterDeclaration[] | undefined;
  sf.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'usePanelManager') params = node.parameters;
  });
  assert.ok(params, 'usePanelManager was not found');
  assert.deepEqual(params.map((p) => p.name.getText(sf)), ['panels', 'setPanels', 'phoneWidth', 'containerWidth', 'fixedColumnCount', 'rootId', 'options']);
  assert.ok(params[6]!.questionToken !== undefined, 'the options object is optional');
  assert.ok(params.slice(0, 6).every((p) => p.questionToken === undefined), 'the six positional parameters are unchanged');
});

test('source: useProvidePanels drops the hold of a closed panel after forgetting it and before the reveal walk', () => {
  const src = read('panels/useProvidePanels.ts');
  assert.match(src, /forgetCollapsed\(id\);\s*releaseHold\(id\);\s*revealMostRecentlyCollapsed\(remaining\);/);
});

test('source: usePanelManager, PanelRow, Panel and panelHeaderButtons use no useMemo or useCallback', () => {
  for (const file of ['panels/usePanelManager.ts', 'PanelRow.tsx', 'Panel.tsx', 'panelHeaderButtons.tsx']) assert.equal(usesMemo(read(file)), false, `${file} must close over this render's values`);
});

/** Whether `source` imports flushSync from react-dom, comments and strings excluded. */
const importsFlushSync = (source: string): boolean => /\bimport\b[^;]*\bflushSync\b/.test(stripComments(source, 'x.ts'));

test('source: rowNumbers.ts imports no flushSync and uses no useMemo or useCallback, and a planted import is found', () => {
  assert.equal(importsFlushSync("import { flushSync } from 'react-dom';"), true, 'the matcher must find a planted import');
  assert.equal(importsFlushSync("// import { flushSync } from 'react-dom';"), false);
  assert.equal(importsFlushSync(read('rowNumbers.ts')), false);
  assert.equal(usesMemo(read('rowNumbers.ts')), false);
});

test('source: the scroll files import no flushSync and use no useMemo or useCallback, and a planted import is found', () => {
  assert.equal(importsFlushSync("import { flushSync } from 'react-dom';"), true, 'the matcher must find a planted import');
  for (const file of ['rowScroller.ts', 'scrollTargets.ts', 'panels/useRowScrollGesture.ts']) {
    assert.equal(importsFlushSync(read(file)), false, `${file} must not flush a render from a pointer handler`);
    assert.equal(usesMemo(read(file)), false, `${file} must close over this render's values`);
  }
});

test('source: the pin, reset and configure files import no flushSync, and a planted import is found', () => {
  assert.equal(importsFlushSync("import { flushSync } from 'react-dom';"), true, 'the matcher must find a planted import');
  for (const file of ['panelPin.ts', 'panelReset.ts', 'panelConfigure.ts', 'panelManager.ts', 'panelHandles.ts', 'workspaceCore.ts']) {
    assert.equal(importsFlushSync(read(file)), false, `${file} must not flush a render from a verb`);
  }
});

/** The files a configure passes through, and the two hooks that import flushSync today for the park exit and the close exit. */
const FLUSH_SYNC_FREE = ['panelConfigure.ts', 'panelPin.ts', 'panelManager.ts', 'panelHandles.ts', 'workspaceCore.ts'];

test('source: the five configure files import no flushSync, the two hooks that do are not among them, and a scratch copy of each with an import is found', () => {
  assert.deepEqual(FLUSH_SYNC_FREE, CONFIGURE_FILES, 'the scan covers exactly the files a configure passes through');
  for (const file of FLUSH_SYNC_FREE) assert.equal(importsFlushSync(read(file)), false, `${file} must not flush a render from a configure`);
  for (const file of ['panels/usePanelManager.ts', 'panels/usePanelClosing.ts']) assert.equal(importsFlushSync(read(file)), true, `control: ${file} imports flushSync today, so the scan can see one in a real file`);
  const dir = mkdtempSync(join(tmpdir(), 'phonux-invariants-'));
  try {
    for (const file of FLUSH_SYNC_FREE) {
      const copy = join(dir, file);
      writeFileSync(copy, `import { flushSync } from 'react-dom';\n${read(file)}`);
      assert.equal(importsFlushSync(readFileSync(copy, 'utf8')), true, `a scratch copy of ${file} with the import is red`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('source: usePanelManager.ts and useProvidePanels.ts take maxLiveWidth from computeRowNumbers and never name computeMaxLiveWidth', () => {
  for (const file of ['panels/usePanelManager.ts', 'panels/useProvidePanels.ts']) {
    assert.doesNotMatch(read(file), /\bcomputeMaxLiveWidth\b/, `${file} names computeMaxLiveWidth, in code or in a comment`);
    assert.match(read(file), /\bcomputeRowNumbers\b/, `${file} prices from computeRowNumbers`);
  }
});

test('source: PanelRowSlot keeps its one motion element, and PanelRow passes zIndex and enterDirection on lines of their own', () => {
  assert.equal([...stripComments(read('PanelRowSlot.tsx'), 'PanelRowSlot.tsx').matchAll(/<motion\.div\b/g)].length, 1);
  const lines = read('PanelRow.tsx').split('\n');
  assert.ok(lines.find((l) => l.includes('zIndex={')), 'zIndex={ is findable by line');
  assert.ok(lines.find((l) => l.includes('enterDirection={')), 'enterDirection={ is findable by line');
});

test("source: Panel's doc comment for viewId names CaptureRegistryProvider, and no comment line names CaptureRegistryContext", () => {
  const comments = read('Panel.tsx').split('\n').filter((l) => /^\s*(\/\*\*|\*|\/\/)/.test(l));
  assert.equal(comments.filter((l) => l.includes('CaptureRegistryContext')).length, 0);
  assert.ok(comments.some((l) => l.includes('CaptureRegistryProvider')), 'the doc names the exported way to supply a registry');
  assert.match(read('Panel.tsx'), /React\.useContext\(CaptureRegistryContext\)/, 'the code still reads the context');
});

/** What edge-scroll code must not contain, each a pattern over comment-stripped source. */
const EDGE_SCROLL_BANS: ReadonlyArray<[string, RegExp]> = [
  ['useMemo', /\buseMemo\b/],
  ['useCallback', /\buseCallback\b/],
  ['flushSync', /\bflushSync\b/],
  ['a timer instead of requestAnimationFrame', /\b(?:setInterval|setTimeout)\b/],
  ['an import of reorderStepsForOffset', /import[^;]*\breorderStepsForOffset\b/],
];
const edgeScrollViolations = (source: string): string[] => EDGE_SCROLL_BANS.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);

test('source: edge scrolling uses no memo hook, no flushSync, no timer and never the hop rule, and the bans see a planted violation', () => {
  for (const file of ['edgeScroll.ts', 'dragToClose.tsx']) {
    const source = stripComments(read(file), file);
    assert.match(source, /export /, `${file} still exports, so the scan read the file`);
    assert.deepEqual(edgeScrollViolations(source), [], `${file} must keep the pointer loop on requestAnimationFrame alone`);
  }
  assert.match(stripComments(read('dragToClose.tsx'), 'dragToClose.tsx'), /requestAnimationFrame\(/, 'the loop schedules through requestAnimationFrame');
  const planted = [
    "import { flushSync } from 'react-dom';",
    "import { reorderStepsForOffset } from './panelWindow.js';",
    'const a = useMemo(() => 1, []); const b = useCallback(() => 2, []);',
    'setInterval(() => undefined, 16);',
  ].join('\n');
  assert.deepEqual(edgeScrollViolations(planted), ['useMemo', 'useCallback', 'flushSync', 'a timer instead of requestAnimationFrame', 'an import of reorderStepsForOffset']);
  assert.deepEqual(edgeScrollViolations('// setInterval in a comment is stripped before the scan'), ['a timer instead of requestAnimationFrame'], 'the control: an unstripped comment trips the ban');
  assert.deepEqual(edgeScrollViolations(stripComments('// setInterval in a comment is stripped before the scan\nconst ok = 1;', 'planted.ts')), []);
});

test("source: the edge-scroll loop reads the row's drag scroll and never `collapsible`", () => {
  const source = stripComments(read('dragToClose.tsx'), 'dragToClose.tsx');
  const start = source.indexOf('function useEdgeScroll');
  const end = source.indexOf('function settleHome');
  assert.ok(start >= 0 && end > start, 'the hook is found between its neighbours');
  const hook = source.slice(start, end);
  assert.match(hook, /dragScroll/);
  assert.doesNotMatch(hook, /collapsible/);
  assert.match('function useEdgeScroll() { return slot.collapsible; }', /collapsible/, 'the control: the same check sees a planted read');
});

test('source: the header button cluster is built in Panel only, panelHeaderButtons imports no flushSync, and a planted import is found', () => {
  assert.equal(importsFlushSync("import { flushSync } from 'react-dom';"), true, 'the matcher must find a planted import');
  assert.equal(importsFlushSync(read('panelHeaderButtons.tsx')), false);
  const builders = LIBRARY_FILES.filter((file) => file !== 'panelHeaderButtons.tsx' && /<PanelHeaderButtons\b|createElement\(PanelHeaderButtons\b/.test(stripComments(read(file), file)));
  assert.deepEqual(builders, ['Panel.tsx'], 'the cluster is built in Panel only');
  assert.equal(LIBRARY_FILES.filter((file) => /^panelHeaderButtons\.tsx$/.test(file)).length, 1, 'the new file sits flat in the root and is not named useProvide*');
});

test('source: PanelRow keeps its single-line zIndex and enterDirection props, and PanelRowSlot and the slot lines do not read collapsible', () => {
  const lines = read('PanelRow.tsx').split('\n');
  for (const prop of ['zIndex={', 'enterDirection={']) {
    const line = lines.find((l) => l.trim().startsWith(prop));
    assert.ok(line !== undefined, `${prop} stays on one line`);
    assert.equal(/collapsible/.test(line), false, `${prop} does not read collapsible`);
  }
  assert.equal(/collapsible/.test(read('PanelRowSlot.tsx')), false);
});

test("source: the default frame closes and moves through the panel's handle, never the Host bag's raw verbs", () => {
  const source = stripComments(read('defaultFrame.tsx'), 'defaultFrame.tsx');
  assert.match(source, /usePanelDragProps\(/, 'the frame reads its drag props from the hook');
  assert.doesNotMatch(source, /useHost\(|panels\.(move|close)\(/, 'no raw verb');
  assert.match('const { panels } = useHost(); panels.move(id, 1);', /useHost\(|panels\.(move|close)\(/, 'the control: the same check sees a planted raw call');
});
