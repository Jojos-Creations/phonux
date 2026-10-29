/**
 * The license files say what the package ships under. LICENSE is the canonical Prosperity Public License 3.0.0 text with
 * only the edits its new name allows: the title, one difference note, the filled-in contributor and source lines, and a
 * ninety-day commercial trial. A modified license has no SPDX id, so package.json and the lockfile root point at the file.
 * Nothing else claims MIT for this package except the recorded 0.1.0 tarball. No text ships with a placeholder.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const LICENSE_FIELD = 'SEE LICENSE IN LICENSE';
const CANONICAL_SHA256 = '8238c1f42828e9f3e734c5076dca2291e2126ffc0a453b4e953d54ca0c440797';
const HEAD = [
  '# The phonux Public License 1.0.0\n\n',
  'This license is based on the Prosperity Public License 3.0.0 <https://prosperitylicense.com/versions/3.0.0>. ',
  'It differs only in that the commercial trial is ninety days instead of thirty.\n\n',
  'Contributor: Jojos-Creations\n\n',
  'Source Code: https://github.com/Jojos-Creations/phonux\n',
].join('');
const CANONICAL_HEAD = '# The Prosperity Public License 3.0.0\n\nContributor: $name\n\nSource Code: $address\n';
const TRIAL: [string, string][] = [
  ['for commercial purposes for ninety days.', 'for commercial purposes for thirty days.'],
  ['to a ninety-day trial period.', 'to a thirty-day trial period.'],
];

test('LICENSE is the canonical Prosperity Public License 3.0.0 text, retitled, with a ninety-day trial and no other change', () => {
  const license = read('LICENSE');
  assert.ok(license.startsWith(HEAD), 'LICENSE opens with the phonux title, the difference note and the filled-in lines');
  let canonical = CANONICAL_HEAD + license.slice(HEAD.length);
  for (const [ours, theirs] of TRIAL) {
    assert.equal(canonical.split(ours).length, 2, `LICENSE says "${ours}" once`);
    canonical = canonical.replace(ours, theirs);
  }
  assert.equal(createHash('sha256').update(canonical).digest('hex'), CANONICAL_SHA256);
});

test('package.json and the package-lock.json root entry point at the LICENSE file', () => {
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

test('the README tells a reader which license each version is under and where to ask about commercial use', () => {
  const readme = read('README.md');
  assert.match(readme, /0\.1\.0 and 0\.2\.0-rc\.2 were published under the MIT license/);
  assert.match(readme, /0\.2\.0-rc\.3 through 0\.2\.0-rc\.5 were published under the PolyForm Noncommercial License 1\.0\.0/);
  assert.match(readme, /phonux Public License 1\.0\.0/);
  assert.match(readme, /https:\/\/github\.com\/Jojos-Creations/);
});
