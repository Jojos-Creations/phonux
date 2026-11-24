/**
 * The license files say what the package ships under. LICENSE is the Mozilla Public License 2.0 text, byte for byte as
 * Mozilla publishes it, so package.json and the lockfile root carry the SPDX id MPL-2.0. Nothing else claims MIT for
 * this package except the recorded 0.1.0 tarball. No text ships with a placeholder.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const LICENSE_FIELD = 'MPL-2.0';
const MPL_2_0_SHA256 = '3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04';

test('LICENSE is the Mozilla Public License 2.0 text with no edit', () => {
  const license = read('LICENSE');
  assert.ok(license.startsWith('Mozilla Public License Version 2.0\n'), 'LICENSE opens with the MPL 2.0 title');
  assert.equal(createHash('sha256').update(license).digest('hex'), MPL_2_0_SHA256);
});

test('package.json and the package-lock.json root entry carry the MPL-2.0 license id', () => {
  assert.equal(JSON.parse(read('package.json')).license, LICENSE_FIELD);
  assert.equal(JSON.parse(read('package-lock.json')).packages[''].license, LICENSE_FIELD);
});

test('no licence field or LICENSE text claims MIT for this package; the recorded 0.1.0 tarball is the only MIT record', () => {
  assert.doesNotMatch(read('LICENSE'), /Permission is hereby granted/);
  assert.notEqual(JSON.parse(read('package.json')).license, 'MIT');
  assert.notEqual(JSON.parse(read('package-lock.json')).packages[''].license, 'MIT');
  assert.equal(JSON.parse(read('test/fixtures/compat-0.1.0/pkg/package.json')).license, 'MIT');
});

test('THIRD_PARTY_NOTICES.md names DevExpress/device-specs and carries the MIT terms', () => {
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /DevExpress\/device-specs/);
  assert.match(notices, /Permission is hereby granted, free of charge/);
});

test('the license, README and notices text carries no placeholder or TODO', () => {
  for (const name of ['LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md']) {
    assert.doesNotMatch(read(name), /placeholder|TODO/i, `${name} has placeholder text`);
  }
});

test('the README tells a reader which license each version is under and how the license changed', () => {
  const readme = read('README.md');
  assert.match(readme, /0\.1\.0, 0\.2\.0-rc\.1 and 0\.2\.0-rc\.2 were published under the MIT license/);
  assert.match(readme, /0\.2\.0-rc\.3 through 0\.2\.0-rc\.5 were published under the PolyForm Noncommercial License 1\.0\.0/);
  assert.match(readme, /Mozilla Public License 2\.0/);
  assert.match(readme, /0\.2\.0-rc\.6 through 0\.2\.0-rc\.8 were published under the phonux Public License 1\.0\.0/);
});
