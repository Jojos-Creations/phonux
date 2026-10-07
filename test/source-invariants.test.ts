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

test('source: `.view ===` and `.view !==` appear in neither PanelRow.tsx nor viewRegistry.tsx -- a view is resolved through resolveView(p.view), never compared', () => {
  for (const file of ['PanelRow.tsx', 'viewRegistry.tsx']) {
    assert.doesNotMatch(read(file), /\.view\s*===|\.view\s*!==/, `${file} must select a component by resolving \`view\`, never by comparing it`);
  }
  assert.match(read('PanelRow.tsx'), /resolveView\(/, 'PanelRow.tsx does not call resolveView(: the invariant above is checking the wrong file');
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

test('source: PanelRowSlot has one motion element that owns exit and one that owns layout, never the same', () => {
  const source = read('PanelRowSlot.tsx');
  const openings = [...source.matchAll(/<motion\.div\b[\s\S]*?>\s*\n/g)].map((m) => m[0]);
  assert.equal(openings.length, 2, 'two motion elements: the slot and the size box');
  const exitOwner = openings.filter((o) => /\bexit=\{/.test(o));
  const layoutOwner = openings.filter((o) => /\blayout=/.test(o));
  assert.equal(exitOwner.length, 1, 'exactly one element owns exit');
  assert.equal(layoutOwner.length, 1, 'exactly one element owns layout');
  assert.notEqual(exitOwner[0], layoutOwner[0], 'layout and exit never sit on the same element');
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

test("source: `locked` and `collapsible` are written only by applyTemplate, plus the 0.1.0 literals in appendPanel and createHistoryPanel; `key` is written by applyTemplate alone", () => {
  assert.ok(ENTRY_FILES.length >= 7, 'the scan list is short: panels/ was not read');
  const outside: string[] = [];
  for (const file of ENTRY_FILES) {
    for (const site of writesOf(read(file), file, ['locked', 'collapsible', 'key'])) outside.push(`${file} ${site.fn}:${site.key}`);
  }
  // summarisePanel only copies `locked` into the PanelSummary a view sees; it writes no entry.
  assert.deepEqual(
    outside.sort(),
    [
      'panelRowEntry.ts summarisePanel:locked',
      'panelWindow.ts appendPanel:collapsible',
      'panelWindow.ts appendPanel:locked',
      'panelWindow.ts createHistoryPanel:collapsible',
      'panelWindow.ts createHistoryPanel:locked',
    ],
    'a writer of locked, collapsible or key outside the allowed functions',
  );
  const settingsFile = writesOf(read('panelSettings.ts'), 'panelSettings.ts', ['locked', 'collapsible']);
  assert.deepEqual(sitesOf(settingsFile), ['applyTemplate:collapsible', 'applyTemplate:collapsible', 'applyTemplate:locked', 'applyTemplate:locked'], 'panelSettings.ts writes them in applyTemplate and nowhere else, once per mode');
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

test('source: a planted extra writer of locked, collapsible or key in a scratch copy of panelWindow.ts is found, and a planted key write in the reconfigure branch is too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'phonux-invariants-'));
  try {
    const copy = join(dir, 'panelWindow.ts');
    writeFileSync(copy, `${read('panelWindow.ts')}\nexport function plantedWriter(p: PanelWindow): PanelWindow {\n  const q = { ...p, locked: true, key: 'k' };\n  q.collapsible = false;\n  return q;\n}\n`);
    const planted = sitesOf(writesOf(readFileSync(copy, 'utf8'), copy, ['locked', 'collapsible', 'key']));
    assert.deepEqual(planted.filter((s) => s.startsWith('plantedWriter')), ['plantedWriter:collapsible', 'plantedWriter:key', 'plantedWriter:locked'], 'the scan sees all three planted writes');
    const reconfigureWrite = read('panelSettings.ts').replace("listed: resolved.listed,\n      layer", "listed: resolved.listed,\n      key: entry.id,\n      layer");
    assert.notEqual(reconfigureWrite, read('panelSettings.ts'), 'the plant found its place');
    assert.deepEqual(keyWritesInApplyTemplate(reconfigureWrite), { total: 2, inReconfigure: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Functions that still read `.collapsible`: presence, parking and fixed-column bookkeeping. Permission decisions read effective(p). */
const COLLAPSIBLE_READERS: Record<string, readonly string[]> = {
  'panelWindow.ts': ['firstParkedAfter', 'lastParkedBefore', 'leftmostLiveIndex', 'parksForRoom', 'rightmostLiveIndex', 'sideOfLiveRange'],
  'panels/usePanelManager.ts': ['holdPanel', 'markHeld', 'pricing', 'usePanelManager', 'wouldEmptyRow'],
  'panels/useProvidePanels.ts': ['useProvidePanels', 'withRestoredSettings'],
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

// ---------------------------------------------------------------------------
// Timing tuning and the hold wiring
// ---------------------------------------------------------------------------

test('source: useRowScrollGesture reads gestureLockMs from a ref assigned on every render, arms the timer from it and never lists it as an effect dependency', () => {
  const src = read('panels/useRowScrollGesture.ts');
  assert.match(src, /const gestureLockMsRef = useRef\(gestureLockMs\);\s*gestureLockMsRef\.current = gestureLockMs;/, 'the ref is created and assigned in the render body, like scrollRowRef');
  assert.match(src, /setTimeout\(\(\) => \{\s*locked = false;\s*\}, gestureLockMsRef\.current\);/, 'armUnlock arms the timer from the ref');
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

test('source: usePanelManager and PanelRow use no useMemo or useCallback', () => {
  for (const file of ['panels/usePanelManager.ts', 'PanelRow.tsx']) assert.equal(usesMemo(read(file)), false, `${file} must close over this render's values`);
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

test('source: usePanelManager.ts and useProvidePanels.ts take maxLiveWidth from computeRowNumbers and never name computeMaxLiveWidth', () => {
  for (const file of ['panels/usePanelManager.ts', 'panels/useProvidePanels.ts']) {
    assert.doesNotMatch(read(file), /\bcomputeMaxLiveWidth\b/, `${file} names computeMaxLiveWidth, in code or in a comment`);
    assert.match(read(file), /\bcomputeRowNumbers\b/, `${file} prices from computeRowNumbers`);
  }
});

test('source: PanelRowSlot keeps its two motion elements, and PanelRow passes zIndex and enterDirection on lines of their own', () => {
  assert.equal([...stripComments(read('PanelRowSlot.tsx'), 'PanelRowSlot.tsx').matchAll(/<motion\.div\b/g)].length, 2);
  const lines = read('PanelRow.tsx').split('\n');
  assert.ok(lines.find((l) => l.includes('zIndex={')), 'zIndex={ is findable by line');
  assert.ok(lines.find((l) => l.includes('enterDirection={')), 'enterDirection={ is findable by line');
});

test('source: a kept slot is hidden from its exit animation\'s promise, never from onAnimationComplete, and PanelRow reads keepMounted only through the latch', () => {
  const slot = stripComments(read('PanelRowSlot.tsx'), 'PanelRowSlot.tsx');
  assert.doesNotMatch(slot, /onAnimationComplete/, 'a callback fires only after a frame, which a zero-length slide never gets');
  assert.match(slot, /run\.finished\.then\(/, 'the exit move is awaited through its promise');
  const row = stripComments(read('PanelRow.tsx'), 'PanelRow.tsx');
  assert.equal([...row.matchAll(/\.keepMounted/g)].length, 1, 'keepMounted is read in keepsMounted only, which the latch refs gate');
});

test('source: Panel registers with the capture registry only while it is not hidden', () => {
  const panel = stripComments(read('Panel.tsx'), 'Panel.tsx');
  assert.match(panel, /capture === 'never' \|\| hidden \|\|/);
});

test("source: Panel's doc comment for viewId names CaptureRegistryProvider, and no comment line names CaptureRegistryContext", () => {
  const comments = read('Panel.tsx').split('\n').filter((l) => /^\s*(\/\*\*|\*|\/\/)/.test(l));
  assert.equal(comments.filter((l) => l.includes('CaptureRegistryContext')).length, 0);
  assert.ok(comments.some((l) => l.includes('CaptureRegistryProvider')), 'the doc names the exported way to supply a registry');
  assert.match(read('Panel.tsx'), /React\.useContext\(CaptureRegistryContext\)/, 'the code still reads the context');
});

test('source: usePanelHidden is exported by name from the barrel and read from the slot context PanelRowSlot provides', () => {
  assert.match(read('index.ts'), /\busePanelHidden\b/);
  assert.match(stripComments(read('PanelRowSlot.tsx'), 'PanelRowSlot.tsx'), /PanelHiddenContext\.Provider/);
});
