/**
 * `enterSide` in jsdom: when the column asks it, with which workspaces, what a bad answer does, and the transforms and fades it
 * leads to. The motion itself, frame by frame, is in workspace-switch-rendered.test.ts.
 */
import './support/jsdom-globals.js';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { act } from 'react';

// Motion reads the query once per module, so the stub is in place before anything that uses Motion loads.
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({ media: query, matches: false, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
});

const { MotionConfig } = (await import('motion/react')) as typeof import('motion/react');
const { advanceFrames, cleanup, mount } = await import('./support/mount-harness.js');
const { createWorkspaceColumn, WorkspaceColumn } = await import('../index.js');
type Side = 'left' | 'right' | 'above' | 'below';

afterEach(() => cleanup());

async function rig(answer: (from: string, to: string) => unknown, reduced = false) {
  const asked: string[] = [];
  const errors: unknown[] = [];
  const column = createWorkspaceColumn({
    mount: false,
    onError: (e) => void errors.push(e),
    enterSide: (from, to) => {
      asked.push(`${from.id}>${to.id}`);
      return answer(from.id, to.id) as Side;
    },
  });
  for (const id of ['a', 'b', 'c', 'd']) column.addWorkspace({ id });
  const ui = React.createElement(WorkspaceColumn, { column, children: () => React.createElement('div', null, 'panels') });
  const mounted = mount(reduced ? React.createElement(MotionConfig, { reducedMotion: 'always' }, ui) : ui);
  await advanceFrames(50);
  const cell = (id: string): HTMLElement => mounted.container.querySelector<HTMLElement>(`[data-workspace-cell][data-workspace-id="${id}"]`)!;
  return { column, asked, errors, cell };
}

test('asked once per switch, with the workspace left and the one arrived at: scrollTo, step and the removal of the current one', async () => {
  const { column, asked } = await rig(() => 'right');
  assert.deepEqual(asked, [], 'not asked while the column places itself');
  act(() => void column.scrollTo(2));
  act(() => void column.step('up'));
  act(() => void column.removeWorkspace(1));
  await advanceFrames(1);
  assert.deepEqual(asked, ['a>c', 'c>b', 'b>c']);
  act(() => void column.scrollTo(1));
  assert.deepEqual(asked.length, 3, 'scrollTo the current workspace is no switch');
});

for (const [side, arrive, leave] of [
  ['right', 'translateX(100%)', 'translateX(-100%)'],
  ['left', 'translateX(-100%)', 'translateX(100%)'],
  ['below', 'translateY(100%)', 'translateY(-100%)'],
  ['above', 'translateY(-100%)', 'translateY(100%)'],
] as const) {
  test(`${side}: the arriving cell is sent from ${arrive} to rest, and the one left goes to ${leave}`, async () => {
    const { column, cell } = await rig(() => side);
    const starts: string[] = [];
    // Every style b held on the way, read from the value each change replaced.
    const watch = new MutationObserver((records) => starts.push(...records.map((r) => r.oldValue ?? '')));
    watch.observe(cell('b'), { attributes: true, attributeOldValue: true, attributeFilter: ['style'] });
    act(() => void column.scrollTo(1));
    await advanceFrames(1);
    watch.disconnect();
    assert.ok(starts.some((s) => s.includes(`transform: ${arrive}`)), `b was placed at ${arrive} first (${starts.join(' | ')})`);
    assert.equal(cell('b').style.transform, 'translateY(0%)');
    assert.match(cell('b').style.transition, /^transform [\d.]+s cubic-bezier\(/);
    assert.equal(cell('a').style.transform, leave);
    assert.match(cell('a').style.transition, /^transform [\d.]+s cubic-bezier\(/);
    assert.equal(cell('c').style.transition, 'none', 'a cell not in the switch does not move');
  });
}

test('a throw or an answer that is no side is reported, and the switch goes by index', async () => {
  let answer: () => unknown = () => {
    throw new Error('app broke');
  };
  const { column, errors, cell } = await rig(() => answer());
  act(() => void column.scrollTo(2));
  await advanceFrames(1);
  assert.equal(errors.length, 1);
  assert.equal((errors[0] as Error).message, 'app broke');
  assert.equal(cell('a').style.transform, 'translateY(-100%)', 'a later workspace came up from below, so the one left went up');
  answer = () => 'sideways';
  act(() => void column.scrollTo(0));
  await advanceFrames(1);
  assert.equal(errors.length, 2);
  assert.equal((errors[1] as { code?: string }).code, 'invalid-options');
  assert.equal(cell('c').style.transform, 'translateY(100%)', 'an earlier workspace came down from above, so the one left went down');
});

test('Reduce Motion with enterSide: both cells stay in place and fade, and no side is asked', async () => {
  const { column, asked, cell } = await rig(() => 'right', true);
  act(() => void column.scrollTo(1));
  await advanceFrames(1);
  assert.deepEqual(asked, [], 'a fade has no side');
  for (const id of ['a', 'b']) assert.equal(cell(id).style.transform, 'translateY(0%)', `${id} is in place`);
  assert.equal(cell('b').style.opacity, '1');
  assert.equal(cell('a').style.opacity, '0');
  assert.match(cell('b').style.transition, /^opacity 0\.15s/);
  assert.match(cell('a').style.transition, /^opacity 0\.15s/);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(cell('a').style.transform, 'translateY(-100%)', 'after the fade the one left waits out of sight');
  assert.equal(cell('a').style.opacity, '', 'with its opacity back');
});
