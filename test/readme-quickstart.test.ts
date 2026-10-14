/**
 * The README's quickstart is the text a reader copies, so it is read out of README.md by its markers, type-checked against this
 * checkout's index.ts, run under jsdom with a stubbed ResizeObserver, and compared with the hand-built layer the README shows
 * after it. tools/phonux-pack-smoke.mjs builds the same block against the packed tarball.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { transformSync } from 'esbuild';
import { ThemeProvider } from '@mui/material/styles';
import { createWorkspace } from '../index.js';
import type { PanelTemplate, WorkspaceHandle } from '../index.js';
import { createDefaultTheme } from '../defaultTheme.js';
import { extractReadmeBlock } from '../tools/readme-blocks.mjs';
import { advanceFrames } from './support/mount-harness.js';
import { rigCleanup, track, until, win } from './support/auto-rig.js';

afterEach(rigCleanup);

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const TSC = join(ROOT, 'node_modules', '.bin', 'tsc');
const INDEX = join(ROOT, 'index.ts');

/**
 * A throwaway folder in the checkout for the README's blocks.
 * It is a folder of the checkout, not of node_modules, so the generated files resolve react from it and load as the same
 * modules the tests do (a file under node_modules would load as a second, CommonJS copy).
 */
function scratch(files: Record<string, string>): string {
  const dir = mkdtempSync(join(ROOT, '.readme-run-'));
  for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);
  return dir;
}

/** Type-checks `files` (name to source); returns tsc's exit status and output. */
function typecheck(files: Record<string, string>): { status: number | null; out: string } {
  const dir = scratch(files);
  try {
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        extends: join(ROOT, 'tsconfig.json'),
        compilerOptions: { lib: ['ES2022', 'DOM', 'DOM.Iterable'], typeRoots: [join(ROOT, 'node_modules', '@types')], baseUrl: '.', paths: { phonux: [join(ROOT, 'index.ts')] } },
        include: Object.keys(files),
        exclude: [],
      }),
    );
    const run = spawnSync(TSC, ['-p', join(dir, 'tsconfig.json')], { encoding: 'utf8' });
    return { status: run.status, out: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The two blocks, read when a test needs them, so a broken marker fails the tests that use the block and not the load of this file. */
const blocks = (): { quickstart: string; advanced: string } => ({ quickstart: extractReadmeBlock(README, 'quickstart'), advanced: extractReadmeBlock(README, 'advanced') });

test('the README blocks are extracted by marker and refuse a broken marker or fence', () => {
  const { quickstart, advanced } = blocks();
  assert.ok(quickstart.includes("from 'phonux'") && quickstart.includes('createWorkspace'));
  assert.ok(advanced.includes('HostProvider'));
  assert.throws(() => extractReadmeBlock(README.replace('<!-- quickstart:start -->', '<!-- quickstart:begin -->'), 'quickstart'), /no <!-- quickstart:start --> marker/);
  assert.throws(() => extractReadmeBlock(README.replace('<!-- quickstart:end -->', ''), 'quickstart'), /no <!-- quickstart:end --> marker/);
  const unclosed = README.replace(/```\n<!-- quickstart:end -->/, '\n<!-- quickstart:end -->');
  assert.throws(() => extractReadmeBlock(unclosed, 'quickstart'), /does not close its fence/);
  assert.throws(() => extractReadmeBlock(README.replace('```tsx\nimport { createWorkspace', '```ts\nimport { createWorkspace'), 'quickstart'), /does not open with a tsx fence/);
  assert.throws(() => extractReadmeBlock(`${README}\n<!-- advanced:start -->\n`, 'advanced'), /more than one/);
});

test('the quickstart and the advanced block type-check against this checkout', () => {
  const { quickstart, advanced } = blocks();
  const ok = typecheck({ 'quickstart.tsx': quickstart, 'advanced.tsx': advanced });
  assert.equal(ok.status, 0, ok.out);
});

test('a block that calls a removed export fails the type-check', () => {
  const { quickstart } = blocks();
  const broken = typecheck({ 'quickstart.tsx': quickstart.replace(/createWorkspace/g, 'startWorkspace') });
  assert.notEqual(broken.status, 0);
  assert.match(broken.out, /startWorkspace/);
});

// ---------------------------------------------------------------------------

/** A README block as plain ESM: types stripped, JSX compiled, and `phonux` pointed at this checkout's index.ts. */
const compiled = (source: string): string => transformSync(source.replace("from 'phonux'", `from ${JSON.stringify(INDEX)}`), { loader: 'tsx', jsx: 'automatic', format: 'esm' }).code;

/** The quickstart as a module this process can import: `phonux` points at this checkout, and what the test needs is exported. */
async function loadQuickstart(): Promise<{ workspace: WorkspaceHandle; notes: PanelTemplate }> {
  const { quickstart } = blocks();
  const dir = scratch({ 'quickstart.mjs': compiled(`${quickstart}\nexport { notes, workspace };\n`) });
  try {
    const file = join(dir, 'quickstart.mjs');
    return (await import(pathToFileURL(file).href)) as { workspace: WorkspaceHandle; notes: PanelTemplate };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function loadAdvanced(): Promise<{ Row: React.ComponentType<{ workspace: WorkspaceHandle }> }> {
  const { advanced } = blocks();
  const dir = scratch({ 'advanced.mjs': compiled(advanced) });
  try {
    const file = join(dir, 'advanced.mjs');
    return (await import(pathToFileURL(file).href)) as { Row: React.ComponentType<{ workspace: WorkspaceHandle }> };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The row's HTML with the numbers its two workspaces counted differently (panel ids) and dnd-kit's accessibility counters removed. */
const normal = (html: string): string => html.replace(/data-row-id="[^"]*"/g, 'data-row-id="N"').replace(/(Dnd(?:DescribedBy|LiveRegion))-\d+/g, '$1-N');

test('the quickstart, run as written, draws a framed Notes panel with its title and its text', async () => {
  win.width = 1000;
  win.height = 800;
  const { workspace } = await loadQuickstart();
  track(workspace);
  await until('the panel text', () => document.body.textContent?.includes('Hello from a phone-shaped panel.') === true);
  await advanceFrames(400);
  const header = document.querySelector('[data-panel-chrome-part="header"]');
  assert.ok(header !== null && header.textContent?.includes('Notes') === true, 'the library draws a header with the template title');
  assert.ok(document.querySelector('[data-panel-chrome-part="grab-bar"]') !== null, 'and a grab bar');
});

test('the advanced block draws the same DOM as the quickstart', async () => {
  win.width = 1000;
  win.height = 800;
  const { workspace: auto, notes } = await loadQuickstart();
  track(auto);
  const { Row } = await loadAdvanced();
  const hand = track(createWorkspace({ templates: [notes], mount: false }));
  hand.addPanel('notes');
  const target = document.createElement('div');
  document.body.append(target);
  const root = createRoot(target);
  await act(async () => root.render(React.createElement(ThemeProvider, { theme: createDefaultTheme('light') }, React.createElement(Row, { workspace: hand }))));
  const scroller = (el: ParentNode): Element => el.querySelector('[data-row-scroller]')!;
  await until('both rows', () => document.body.querySelectorAll('[data-row-scroller]').length === 2 && document.body.textContent!.split('Hello from a phone-shaped panel.').length === 3);
  await advanceFrames(800);
  const all = [...document.body.querySelectorAll('[data-row-scroller]')];
  const autoRow = all.find((n) => !target.contains(n))!;
  const handRow = scroller(target);
  assert.equal(normal(handRow.outerHTML), normal(autoRow.outerHTML));
  await act(async () => root.unmount());
});

test('registerView, the plain-view registry, is named by neither README.md nor DESIGN.md', () => {
  for (const file of ['README.md', 'DESIGN.md']) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    assert.deepEqual(text.split('\n').filter((l) => l.includes('registerView')), [], `${file} still names registerView`);
  }
});
