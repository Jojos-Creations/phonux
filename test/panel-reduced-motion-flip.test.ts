/**
 * A mounted Panel keeps its content when the app switches Reduce Motion on or off: the app's MotionConfig changing
 * from 'user' to 'always' and back re-renders every Panel with the same hooks in the same order.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { MotionConfig } from 'motion/react';
import { Panel } from '../index.js';
import { cleanup, mount, withHost } from './support/mount-harness.js';

afterEach(() => cleanup());

const ui = (reducedMotion: 'user' | 'always' | 'never'): React.ReactElement =>
  withHost(React.createElement(MotionConfig, { reducedMotion }, React.createElement(Panel, { title: 'History', children: React.createElement('p', { 'data-body': 'content' }, 'content') })));

test('a mounted Panel survives Reduce Motion turning on and off, and keeps its content', () => {
  const originalError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  };
  try {
    const m = mount(ui('user'));
    assert.ok(m.container.querySelector('[data-body="content"]') !== null, 'the panel drew its content under reducedMotion="user"');
    for (const next of ['always', 'user', 'always', 'never'] as const) {
      m.rerender(ui(next));
      assert.ok(m.container.querySelector('[data-body="content"]') !== null, `the panel kept its content after reducedMotion became "${next}"`);
    }
  } finally {
    console.error = originalError;
  }
  const hookOrder = logged.filter((line) => /order of Hooks|Rendered (more|fewer) hooks/.test(line));
  assert.deepEqual(hookOrder, [], 'React saw no change in the order of hooks');
});
