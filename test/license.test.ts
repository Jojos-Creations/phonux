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

const APACHE_2_0_SHA256 = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30';

test('THIRD_PARTY_NOTICES.md carries the Apache License 2.0 text for the Material Icons, byte for byte', () => {
  const notices = read('THIRD_PARTY_NOTICES.md');
  const open = '<!-- apache-2.0:start -->\n```text\n';
  const close = '```\n<!-- apache-2.0:end -->';
  const from = notices.indexOf(open);
  const to = notices.indexOf(close);
  assert.ok(from !== -1 && to > from, 'the Apache text sits between its markers');
  const text = notices.slice(from + open.length, to);
  assert.match(text, /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/);
  assert.equal(createHash('sha256').update(text).digest('hex'), APACHE_2_0_SHA256);
  assert.equal(notices.indexOf(open, from + 1), -1, 'the text is there once');
});

test('THIRD_PARTY_NOTICES.md credits @mui/icons-material with its copyright line, and names the QR Code trademark', () => {
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /@mui\/icons-material/);
  assert.match(notices, /Copyright \(c\) 2014 Call-Em-All/);
  assert.match(notices, /"QR Code" is a registered trademark of DENSO WAVE INCORPORATED/);
});

test('the README names the copyright holder and carries the MPL Exhibit A notice, and package.json names the author', () => {
  const readme = read('README.md');
  assert.match(readme, /Copyright \(c\) 2026 Joseph Reed/);
  assert.ok(
    readme.includes('This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at http://mozilla.org/MPL/2.0/.'),
    'the Exhibit A sentence, word for word',
  );
  assert.equal(JSON.parse(read('package.json')).author, 'Joseph Reed');
});

test('the README says when the dist branch is built, and that the repository is public', () => {
  const readme = read('README.md');
  assert.doesNotMatch(readme, /repository is private|needs a GitHub credential/);
  assert.doesNotMatch(readme, /Every push to `main`/);
  assert.match(readme, /push to `release`/);
});
