/**
 * Properties of the library's own source that no compiler sees. Each test reads a file by path and asserts it found
 * the thing it checks, so a renamed file or a moved declaration fails the test instead of turning it into a pass.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
