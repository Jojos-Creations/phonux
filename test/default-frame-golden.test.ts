/**
 * A view that draws its own frame renders the DOM the golden file holds, and mounts and unmounts its view the same number of
 * times, as it did before the library drew a default frame. The golden file was recorded from the same fixtures; the default
 * frame adds nothing to it.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import './support/jsdom-globals.js';
import { cleanup } from './support/mount-harness.js';
import { SELF_FRAMED, effects, renderFixture } from './support/frame-fixtures.js';

const GOLDEN = fileURLToPath(new URL('./golden/default-frame-self-framed.json', import.meta.url));
type Golden = Record<string, { html: string; mounts: number; unmounts: number }>;

afterEach(() => cleanup());

async function recordAll(): Promise<Golden> {
  const out: Golden = {};
  for (const [name, make] of SELF_FRAMED) {
    const r = await renderFixture(make());
    const e = effects.get(name) ?? { mounts: 0, unmounts: 0 };
    out[name] = { html: r.html, mounts: e.mounts, unmounts: e.unmounts };
    r.unmount();
    cleanup();
  }
  return out;
}

if (process.env.RECORD_FRAME_GOLDEN === '1') {
  test('record the golden DOM of the self-framed fixtures', async () => {
    mkdirSync(fileURLToPath(new URL('./golden/', import.meta.url)), { recursive: true });
    writeFileSync(GOLDEN, `${JSON.stringify(await recordAll(), null, 2)}\n`);
  });
} else {
  test('every self-framed fixture renders the DOM recorded without the default frame, with one mount and no unmount', async () => {
    assert.ok(existsSync(GOLDEN), 'the golden file is committed');
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden;
    const now = await recordAll();
    assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).sort());
    for (const name of Object.keys(golden)) {
      assert.equal(now[name]!.html, golden[name]!.html, `${name}: the DOM is what it was`);
      assert.deepEqual([now[name]!.mounts, now[name]!.unmounts], [golden[name]!.mounts, golden[name]!.unmounts], `${name}: effect counts are what they were`);
      assert.deepEqual([golden[name]!.mounts, golden[name]!.unmounts], [1, 0], `${name}: one mount, no unmount at launch`);
    }
  });
}
