/**
 * The mount harness proved against itself: an effect really runs under it, its clock really gates an exit, and the
 * import order that clock needs is checked on every test file that uses it. Each assertion below can fail: the
 * mutants in tools/mutants/phonux-test-scaffold.json break the harness one way each and name the tests that must go red.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PanelRow, registerView, useProvidePanels, type PanelWindow } from '../index.js';
import { FRAME_MS, frameClock } from './support/jsdom-globals.js';
import { advanceFrames, cleanup, mount, panelsInput, usePanelManagerWith, withHost } from './support/mount-harness.js';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

registerView('harness-probe', ({ panel }) => React.createElement('div', { 'data-probe': panel.id }, panel.title));

const rootEntry: PanelWindow = { id: 'root', url: '', title: 'History', live: true, locked: true, view: 'harness-probe', collapsible: false, listed: false };
const liveEntry: PanelWindow = {
  id: 'a',
  url: 'https://a.example',
  title: 'A',
  live: true,
  locked: false,
  view: 'harness-probe',
  collapsible: true,
  listed: true,
  anchor: { panel: 'root', position: 'right', priority: 0 },
};
const NONE: ReadonlySet<string> = new Set();

const row = (entries: PanelWindow[]): React.ReactElement =>
  withHost(React.createElement(PanelRow, { entries, rootId: 'root', closingIds: NONE, enteringViaAnchorIds: NONE }));
const slotPresent = (container: HTMLElement): boolean => container.querySelector('[data-probe="a"]') !== null;
/** The slot's current translateX in px: an exit toward the left only ever lowers it from the rest position. */
const slotX = (container: HTMLElement): number => {
  const slot = container.querySelector('[data-probe="a"]')?.parentElement;
  const match = /translateX\((-?[\d.]+)px\)/.exec(slot?.style.transform ?? '');
  assert.ok(match, 'the slot carries a translateX while it animates');
  return Number(match[1]);
};

afterEach(() => {
  cleanup();
  document.body.querySelectorAll('[data-harness-marker]').forEach((node) => node.remove());
});

test('harness positive control: an effect runs under mount() and its marker node is in document.body', () => {
  const runs = { count: 0 };
  function Probe(): React.ReactElement {
    const provided = useProvidePanels(panelsInput({ initialEntries: [rootEntry] }));
    const [panels, setPanels] = React.useState<PanelWindow[]>([rootEntry]);
    const manager = usePanelManagerWith({ panels, setPanels, phoneWidth: 390, containerWidth: 0, fixedColumnCount: 1, rootId: 'root' });
    React.useEffect(() => {
      runs.count += 1;
      const marker = document.createElement('i');
      marker.setAttribute('data-harness-marker', '');
      document.body.appendChild(marker);
    }, []);
    return React.createElement('output', null, `${provided.entries.length}:${typeof manager.scrollRow}`);
  }
  const mounted = mount(React.createElement(Probe));
  assert.ok(runs.count > 0, 'the effect ran: mount() flushes effects inside act()');
  assert.ok(document.body.querySelector('[data-harness-marker]') !== null, 'the effect wrote its marker into the document');
  assert.equal(mounted.container.textContent, '1:function', 'useProvidePanels and usePanelManagerWith both ran with the helper inputs');
});

test('virtual frame clock: a callback runs only when the clock is stepped, a cancelled one never, and performance.now reads the same counter', () => {
  const seen: number[] = [];
  requestAnimationFrame((t) => seen.push(t));
  const cancelled = requestAnimationFrame((t) => seen.push(-t));
  cancelAnimationFrame(cancelled);
  const before = performance.now();
  assert.equal(seen.length, 0, 'nothing runs until the clock is stepped');
  assert.equal(performance.now(), before, 'two reads with no step between them agree: real time is not read');
  frameClock.step(1);
  assert.deepEqual(seen, [before + FRAME_MS], 'one frame ran the one live callback with the new counter value');
  assert.equal(performance.now(), before + FRAME_MS);
  assert.ok(window.requestAnimationFrame === globalThis.requestAnimationFrame, 'window and globalThis share the clock');
  let chained = 0;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      chained += 1;
    });
  });
  frameClock.step(1);
  assert.equal(chained, 0, 'a callback requested during a frame waits for the next one');
  frameClock.step(1);
  assert.equal(chained, 1);
});

test('PanelRow exit: a removed entry is still in the DOM right after the rerender and gone only once advanceFrames has run the exit', async () => {
  const mounted = mount(row([rootEntry, liveEntry]));
  assert.ok(slotPresent(mounted.container), 'control: the entry renders before it is removed');
  const restX = slotX(mounted.container);
  mounted.rerender(row([rootEntry]));
  assert.ok(slotPresent(mounted.container), 'right after the rerender the slot is still mounted: AnimatePresence is playing its exit');
  await advanceFrames(100);
  assert.ok(slotPresent(mounted.container), 'a fifth of the way through the exit it is still mounted');
  assert.ok(slotX(mounted.container) < restX, 'a park exits to the left of its rest position');
  await advanceFrames(500);
  assert.ok(!slotPresent(mounted.container), 'after advanceFrames(500) the exit has finished and the slot is gone');
});

/** The specifiers of `file`'s value imports in order, ignoring node: built-ins (they load nothing a clock must precede). */
function valueImports(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.importClause?.isTypeOnly) continue;
    if (statement.moduleSpecifier.text.startsWith('node:')) continue;
    specifiers.push(statement.moduleSpecifier.text);
  }
  return specifiers;
}

/** True when the first module `file` loads is jsdom-globals, or one that itself loads it first. */
function loadsJsdomGlobalsFirst(file: string): boolean {
  const [first] = valueImports(file);
  if (first === undefined) return false;
  if (/(^|\/)jsdom-globals\.js$/.test(first)) return true;
  if (!first.startsWith('.') && !isAbsolute(first)) return false;
  const target = resolve(dirname(file), first.replace(/\.js$/, '.ts'));
  return existsSync(target) && loadsJsdomGlobalsFirst(target);
}

test('isolation: every test that uses the mount harness loads jsdom-globals before react, and a file importing react first fails the check', () => {
  const users = readdirSync(TEST_DIR)
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => join(TEST_DIR, name))
    .filter((file) => /support\/(mount-harness|jsdom-globals)/.test(readFileSync(file, 'utf8')));
  assert.ok(users.includes(fileURLToPath(import.meta.url)), 'the scan found at least this file, so it is not an empty pass');
  const offenders = users.filter((file) => !loadsJsdomGlobalsFirst(file));
  assert.deepEqual(offenders, [], 'these mount tests load something else before jsdom-globals');
  assert.ok(loadsJsdomGlobalsFirst(join(TEST_DIR, 'support', 'mount-harness.ts')), 'the harness itself loads the clock first');

  const scratch = mkdtempSync(join(tmpdir(), 'phonux-import-order-'));
  try {
    const clock = join(TEST_DIR, 'support', 'jsdom-globals.js');
    const reactFirst = join(scratch, 'react-first.test.ts');
    const clockFirst = join(scratch, 'clock-first.test.ts');
    writeFileSync(reactFirst, `import * as React from 'react';\nimport '${clock}';\nvoid React;\n`);
    writeFileSync(clockFirst, `import '${clock}';\nimport * as React from 'react';\nvoid React;\n`);
    assert.ok(!loadsJsdomGlobalsFirst(reactFirst), 'control: a file importing react first is reported');
    assert.ok(loadsJsdomGlobalsFirst(clockFirst), 'control: the same imports in the other order pass');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
