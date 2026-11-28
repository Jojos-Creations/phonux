/** Test and demo data uses the reserved example domains, so no address in the public repository can be somebody's mailbox. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = fileURLToPath(new URL('.', import.meta.url));
const ADDRESS = /[A-Za-z0-9._+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const RESERVED = /^(?:example\.(?:com|org|net)|[a-z0-9.-]+\.example|[a-z0-9.-]*\.invalid)$/i;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return entry.name === 'fixtures' ? [] : files(join(dir, entry.name));
    return /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : [];
  });
}

// Built from parts so that this file holds no such address itself.
const PLANTED = ['marcus', 'me.com'].join('@');
const OTHER = ['dana', 'proton.me'].join('@');

/** The addresses in `text` whose domain is not a reserved one. */
function realLooking(text: string): string[] {
  return [...text.matchAll(ADDRESS)].filter((m) => !RESERVED.test(m[1]!) && !/^(?:types|mui|emotion)\//.test(m[0])).map((m) => m[0]);
}

test('no test or demo file names an address on a real mail domain', () => {
  const all = files(TESTS);
  assert.ok(all.length > 100, 'the scan reached the test folder');
  const found = all.flatMap((file) => realLooking(readFileSync(file, 'utf8')).map((address) => `${file.slice(TESTS.length)}: ${address}`));
  assert.deepEqual(found, []);
});

test('the scan sees a planted real-domain address and lets the reserved ones through', () => {
  assert.deepEqual(realLooking(`const a = '${PLANTED}'; const b = 'priya@example.com'; const c = 'x@example.org';`), [PLANTED]);
  assert.deepEqual(realLooking(`'${OTHER}' 'v@scope.invalid' 'q@mail.example'`), [OTHER]);
});
