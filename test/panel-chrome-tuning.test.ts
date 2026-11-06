/**
 * tuning.chrome as a value: its default, each member's bounds on both sides, the one-member patch that keeps the rest,
 * and the slot carrying the workspace's value to every panel. Labels the host may override sit
 * here too, since they are chrome names the library hands to a host.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY_TUNING_DEFAULTS } from '../index.js';
import { checkTuningLeaf } from '../panelSettings.js';
import { resolveWorkspaceTuning, slotTuning } from '../panelTuning.js';

const chrome = (value: unknown) => checkTuningLeaf('chrome', value);

test('the default is always, 120, easeOut and is frozen', () => {
  assert.deepEqual({ ...LIBRARY_TUNING_DEFAULTS.chrome }, { mode: 'always', fadeMs: 120, fadeEase: 'easeOut' });
  assert.ok(Object.isFrozen(LIBRARY_TUNING_DEFAULTS.chrome));
});

const BOUNDS: ReadonlyArray<readonly [member: string, ceiling: number]> = [
  ['fadeMs', 10000],
];
for (const [member, ceiling] of BOUNDS) {
  test(`chrome.${member}: 0 and ${ceiling} are accepted, -1 and ${ceiling + 1} refused, and a fraction or a string refused`, () => {
    assert.deepEqual(chrome({ [member]: 0 }).problems, []);
    assert.deepEqual(chrome({ [member]: ceiling }).problems, []);
    for (const bad of [-1, ceiling + 1, 1.5, '10', null, Number.NaN]) {
      const checked = chrome({ [member]: bad });
      assert.equal(checked.problems.length, 1, `${String(bad)} refused`);
      assert.equal(checked.problems[0]!.key, `tuning.chrome.${member}`);
      assert.equal(checked.accepted, undefined);
    }
  });
}

test('chrome.fadeEase: the four names and a bezier tuple are accepted, anything else refused with the dotted key', () => {
  for (const ok of ['easeIn', 'easeOut', 'easeInOut', 'linear', [0.25, 0.1, 0.25, 1], [0, -1, 1, 2]]) assert.deepEqual(chrome({ fadeEase: ok }).problems, [], JSON.stringify(ok));
  for (const bad of ['cubic-out', 'ease', '', 5, null, [0.25, 0.1, 0.25], [2, 0, 0, 1], [0, 0, -0.1, 1], [0, 0, 0, Number.NaN], [0, 0, 0, 1, 1]]) {
    const checked = chrome({ fadeEase: bad });
    assert.equal(checked.problems.length, 1, `${JSON.stringify(bad)} refused`);
    assert.equal(checked.problems[0]!.key, 'tuning.chrome.fadeEase');
    assert.equal(checked.accepted, undefined);
  }
});

test("chrome.mode: 'always' and 'hover-or-active' are accepted, anything else refused", () => {
  assert.deepEqual(chrome({ mode: 'always' }).problems, []);
  assert.deepEqual(chrome({ mode: 'hover-or-active' }).problems, []);
  for (const bad of ['hover', 'sometimes', '', true, 0]) assert.equal(chrome({ mode: bad }).problems.length, 1, String(bad));
});

test('an unknown member and a non-object are refused, and a bad member leaves its good neighbour accepted', () => {
  assert.equal(chrome({ fade: 100 }).problems[0]!.problem, 'unknown tuning member');
  assert.equal(chrome('always').problems[0]!.problem, 'expected an object');
  const mixed = chrome({ fadeMs: 90, mode: 'sometimes' });
  assert.deepEqual(mixed.accepted, { fadeMs: 90 });
  assert.equal(mixed.problems.length, 1);
});

test('resolving a one-member chrome keeps the library value of the others, and a bad member keeps its default', () => {
  const resolved = resolveWorkspaceTuning({ chrome: { fadeMs: 60 } });
  assert.deepEqual({ ...resolved.chrome }, { mode: 'always', fadeMs: 60, fadeEase: 'easeOut' });
  const refused = resolveWorkspaceTuning({ chrome: { mode: 'hover-or-active', fadeMs: 99999 } as never });
  assert.deepEqual({ ...refused.chrome }, { mode: 'hover-or-active', fadeMs: 120, fadeEase: 'easeOut' });
});

test("every slot carries the workspace's chrome and the same tuning object for the same workspace tuning", () => {
  const workspace = resolveWorkspaceTuning({ chrome: { mode: 'hover-or-active' } });
  assert.equal(slotTuning(workspace).chrome, workspace.chrome);
  assert.equal(slotTuning(workspace), slotTuning(workspace));
});

