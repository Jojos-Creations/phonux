/**
 * DragToClose with the system's reduced-motion preference off, under each MotionConfig value. Motion reads the preference once per
 * process, so the system-on cases live in drag-to-close-motion-config-os-on.test.ts.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { cleanup } from './support/mount-harness.js';
import { releaseOverflow } from './support/motion-config-release.js';

afterEach(() => cleanup());

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
});

test('MotionConfig always with the system preference off: the release snaps', async () => {
  const { early } = await releaseOverflow('always');
  assert.equal(early, 'auto', 'the scroll parent gets its overflow back on the release frame');
});

test('MotionConfig never with the system preference off: the release animates', async () => {
  const { early, settled } = await releaseOverflow('never');
  assert.equal(early, 'hidden', 'the spring has not settled on the release frame');
  assert.equal(settled, 'auto', 'and it settles');
});

test('no MotionConfig with the system preference off: the release animates', async () => {
  const { early, settled } = await releaseOverflow(undefined);
  assert.equal(early, 'hidden', 'the spring has not settled on the release frame');
  assert.equal(settled, 'auto', 'and it settles');
});
