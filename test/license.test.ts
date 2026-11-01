/**
 * The license files say what the package ships under. LICENSE is the canonical PolyForm Noncommercial 1.0.0 text under one
 * Required Notice line; package.json and the lockfile root name the matching SPDX id; nothing else claims MIT for this
 * package except the recorded 0.1.0 tarball. Contact and notice text never ships with a placeholder.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const SPDX = 'PolyForm-Noncommercial-1.0.0';
const NOTICE = 'Required Notice: Copyright (c) 2026 Jojos-Creations\n\n';
const CANONICAL_SHA256 = 'c0ea4a896d2c8c394b29f9427589996db826cd501c512279ff0ed3ef48fabbe5';

test('LICENSE is the Required Notice line over the unmodified canonical PolyForm Noncommercial 1.0.0 text', () => {
  const license = read('LICENSE');
  assert.ok(license.startsWith(NOTICE), 'LICENSE opens with the copyright notice');
  const canonical = license.slice(NOTICE.length);
  assert.equal(createHash('sha256').update(canonical).digest('hex'), CANONICAL_SHA256);
  assert.ok(canonical.startsWith('# PolyForm Noncommercial License 1.0.0\n'));
});

test('package.json and the package-lock.json root entry carry the SPDX id the LICENSE title names', () => {
  const title = /^# PolyForm Noncommercial License (\d+\.\d+\.\d+)$/m.exec(read('LICENSE'));
  assert.ok(title, 'LICENSE has a PolyForm Noncommercial title');
  assert.equal(`PolyForm-Noncommercial-${title[1]}`, SPDX);
  assert.equal(JSON.parse(read('package.json')).license, SPDX);
  assert.equal(JSON.parse(read('package-lock.json')).packages[''].license, SPDX);
});

test('no licence field or LICENSE text claims MIT for this package; the recorded 0.1.0 tarball is the only MIT record', () => {
  assert.doesNotMatch(read('LICENSE'), /\bMIT\b/);
  assert.notEqual(JSON.parse(read('package.json')).license, 'MIT');
  assert.notEqual(JSON.parse(read('package-lock.json')).packages[''].license, 'MIT');
  assert.equal(JSON.parse(read('test/fixtures/compat-0.1.0/pkg/package.json')).license, 'MIT');
});

test('THIRD_PARTY_NOTICES.md names DevExpress/device-specs and carries the MIT terms', () => {
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /DevExpress\/device-specs/);
  assert.match(notices, /Permission is hereby granted, free of charge/);
});

test('the licence, README and notices text carries no placeholder or TODO', () => {
  for (const name of ['LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md']) {
    assert.doesNotMatch(read(name), /placeholder|TODO/i, `${name} has placeholder text`);
  }
});

test('the README tells a reader which versions are MIT, which are not, and where to ask about commercial use', () => {
  const readme = read('README.md');
  assert.match(readme, /0\.1\.0 and 0\.2\.0-rc\.2 were published under the MIT license/);
  assert.match(readme, /PolyForm Noncommercial/);
  assert.match(readme, /https:\/\/github\.com\/Jojos-Creations/);
});
