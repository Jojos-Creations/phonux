/**
 * Every move of the row's scroll goes through `applyRowIntent` and every hold through `holdRow`: no source file but the driver
 * (rowScroller.ts) and the intents (rowIntents.ts) calls `glideTo(` or `.claim(` on a row scroller. A site that picks its own
 * duration or instant flag for a purpose would drift from the others, which is what the intents exist to stop.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', 'test', 'tools', 'dist', 'docs', '.git']);
const ALLOWED = new Set(['rowScroller.ts', 'rowIntents.ts']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

/** A scroller call: `glideTo(` after a dot, or `.claim(` on something that is not the frame's part claims. */
const CALL = /\.glideTo\(|\bscroll(?:er)?\.claim\(|\bscroll\.claim\(/g;

test('no source file outside the driver and the intents moves or claims the row scroller directly', () => {
  const files = sources(ROOT);
  assert.ok(files.length > 50, `control: the scan saw the library's sources (${files.length} files)`);
  const inIntents = (readFileSync(join(ROOT, 'rowIntents.ts'), 'utf8').match(CALL) ?? []).length;
  assert.ok(inIntents >= 5, `control: the pattern finds the calls in rowIntents.ts (${inIntents})`);
  const offenders = files
    .filter((file) => !ALLOWED.has(relative(ROOT, file)))
    .flatMap((file) => (readFileSync(file, 'utf8').match(CALL) ?? []).map(() => relative(ROOT, file)));
  assert.deepEqual(offenders, [], 'these files drive the row scroller without an intent');
});
