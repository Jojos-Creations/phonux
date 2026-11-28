/**
 * The development warnings in a browser-shaped bundle: the bundler rewrites `process.env.NODE_ENV` and the page has no `process`
 * global. The module is bundled for real with esbuild's `define`, then run in a context that has no `process`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';

const here = fileURLToPath(new URL('..', import.meta.url));

/** Bundles `entry` (a module body that calls the library and reports through `report`) and runs it where there is no `process`; returns what it warned. */
async function warningsOf(body: string, nodeEnv: string | null): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), 'phonux-dev-warn-'));
  try {
    const entry = join(dir, 'entry.ts');
    writeFileSync(entry, `import { stickyFromEdgeHold } from ${JSON.stringify(join(here, 'panelSettings.ts'))};\n${body}\n`);
    const out = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      platform: nodeEnv === null ? 'neutral' : 'browser',
      format: 'iife',
      logLevel: 'silent',
      ...(nodeEnv === null ? {} : { define: { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) } }),
    });
    const warned: string[] = [];
    const context = vm.createContext({ console: { warn: (m: string) => warned.push(String(m)), error: () => undefined, log: () => undefined } });
    assert.equal(vm.runInContext('typeof process', context), 'undefined', 'control: the page has no process global');
    vm.runInContext(out.outputFiles[0]!.text, context);
    return warned;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CALL = "stickyFromEdgeHold('both');";

test('a development bundle with no process global still warns about a replaced setting', async () => {
  const warned = await warningsOf(CALL, 'development');
  assert.equal(warned.length, 1);
  assert.match(warned[0]!, /edgeHold/);
});

test('a production bundle stays silent', async () => {
  assert.deepEqual(await warningsOf(CALL, 'production'), []);
});

test('a page whose bundler rewrites nothing and has no process reads as production, and does not throw', async () => {
  assert.deepEqual(await warningsOf(CALL, null), []);
});
