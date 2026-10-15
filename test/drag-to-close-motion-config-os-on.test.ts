/**
 * DragToClose with the system's reduced-motion preference on: the OS query alone snaps the release unless MotionConfig says
 * "never" -- which must not beat the system preference. See drag-to-close-motion-config-os-off.test.ts for the other cases.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { cleanup } from './support/mount-harness.js';
import { releaseOverflow } from './support/motion-config-release.js';

afterEach(() => cleanup());

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
});

test('no MotionConfig with the system preference on: the release snaps', async () => {
  const { early } = await releaseOverflow(undefined);
  assert.equal(early, 'auto');
});

test('MotionConfig never with the system preference on: the release still snaps', async () => {
  const { early } = await releaseOverflow('never');
  assert.equal(early, 'auto');
});
