/**
 * The stored max-panels choice and the four SettingsAPI members around it are gone: what the capacity decision
 * and the fake host's settings member do now, and a source check that no retired name is left behind.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { effectiveMaxPanels } from '../panelCapacity.js';
import { createFakeHost } from '../fakeHost.js';

test('pin P1 (flipped): effectiveMaxPanels takes (fitCount, fixedColumnCount) and follows the fit count above the floor', () => {
  assert.equal(effectiveMaxPanels(null, 2), Number.POSITIVE_INFINITY);
  assert.equal(effectiveMaxPanels(5, 2), 5);
  assert.equal(effectiveMaxPanels(1, 3), 4);
});

test('pin P2 (flipped): the fake host settings member holds settingsColumn alone', () => {
  assert.deepEqual(Object.keys(createFakeHost().settings), ['settingsColumn']);
});

const RETIRED = /maxPanelsOnScreen|minPanelsOnScreen|setMaxPanelsOnScreen|storedMaxPanels|SettingsAPI.{1,5}fitCount|settings[.]fitCount|readonly fitCount/;

test('pin P3: the changelog names each retired member', () => {
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  for (const name of ['SettingsAPI.maxPanelsOnScreen', 'fitCount', 'minPanelsOnScreen', 'setMaxPanelsOnScreen', 'PanelsInput.storedMaxPanels']) {
    assert.ok(changelog.includes(name), `CHANGELOG.md names ${name}`);
  }
});

test('pin P4: no source, tool, doc or API report outside the changelog, the fixtures, the compat typecheck, the design reference, the mutant spec for this change and this file names a retired member', () => {
  assert.ok(RETIRED.test('maxPanelsOnScreen'), 'control: the pattern reports a scratch string that names a retired member');
  const root = new URL('..', import.meta.url).pathname;
  const skipped = new Set(['.git', 'node_modules', 'dist', 'design', 'test/fixtures', 'CHANGELOG.md', 'test/compat-0.1.0.typecheck.ts', 'test/pins-retire-max-panels.test.ts', 'tools/mutants/phonux-retire-max-panels-members.json']);
  const walk = (dir: string): string[] =>
    readdirSync(`${root}${dir}`, { withFileTypes: true }).flatMap((e) => {
      const rel = `${dir}${e.name}`;
      if (skipped.has(rel)) return [];
      return e.isDirectory() ? walk(`${rel}/`) : [rel];
    });
  const files = walk('');
  const hits = files.flatMap((file) =>
    readFileSync(`${root}${file}`, 'utf8')
      .split('\n')
      .flatMap((line, i) => (RETIRED.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
  );
  assert.deepEqual(hits, []);
});
