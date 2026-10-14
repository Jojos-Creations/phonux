/** The package-major rule for PANEL_API: pure functions checked with synthetic versions, and the real package checked by the same code. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { apiLevelVersionProblem, newestLevelIn, packageApiLevelProblem, requiredLevelFor } from '../tools/phonux-api-level-version.js';
import { PANEL_API } from '../index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('a release needs the level of its major version, and a prerelease of N.0.0 already needs level N', () => {
  assert.equal(requiredLevelFor('1.0.0'), 1);
  assert.equal(requiredLevelFor('1.4.2'), 1);
  assert.equal(requiredLevelFor('2.0.0'), 2);
  assert.equal(requiredLevelFor('2.0.0-rc.1'), 2);
  assert.equal(requiredLevelFor('3.1.0+build.5'), 3);
  assert.equal(requiredLevelFor('12.0.0'), 12);
});

test('a 0.x version is exempt: level 1 moves with the prereleases until 1.0.0', () => {
  assert.equal(requiredLevelFor('0.2.0-rc.3'), null);
  assert.equal(requiredLevelFor('0.9.9'), null);
  assert.equal(apiLevelVersionProblem('0.2.0-rc.3', 1), null);
});

test('a version that is not semver requires nothing, so a malformed version is another check\'s to refuse', () => {
  assert.equal(requiredLevelFor('next'), null);
  assert.equal(requiredLevelFor(''), null);
});

test('PANEL_API must equal the major: too low, too high and exact', () => {
  assert.equal(apiLevelVersionProblem('2.0.0-rc.1', 2), null);
  assert.match(apiLevelVersionProblem('2.0.0-rc.1', 1)!, /needs panel API level 2.*says 1/);
  assert.match(apiLevelVersionProblem('2.0.0', 3)!, /needs panel API level 2.*says 3/);
  assert.match(apiLevelVersionProblem('1.9.9', 2)!, /needs panel API level 1/);
});

test('the newest level is read from the PANEL_API line', () => {
  assert.equal(newestLevelIn('export const PANEL_API: PanelApiLevel = 4;'), 4);
  assert.equal(newestLevelIn('no such line'), null);
});

test('the real package agrees with its own PANEL_API', () => {
  assert.equal(packageApiLevelProblem(ROOT), null);
  assert.equal(typeof PANEL_API, 'number');
});
