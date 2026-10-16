/**
 * A stepping row does not scroll vertically: its overflow box is overflowY hidden, so a vertical wheel over the row,
 * or over a plain panel in it, cannot move the row up off its workspace. A panel's own inner scroller still scrolls, and
 * proof/rc4-vertical-wheel-keeps-row shows that in Chromium.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { cleanup } from './support/mount-harness.js';
import { mountRow, panelsOf } from './support/scroll-row.js';

afterEach(() => cleanup());

test('a stepping row is overflowY hidden, so the row container cannot scroll vertically', () => {
  const m = mountRow(panelsOf(4), 1000, { tuning: { rowGesture: 'step' } });
  assert.equal(getComputedStyle(m.container).overflowY, 'hidden');
});

test('a vertical wheel over a stepping row neither steps nor moves the row', () => {
  const m = mountRow(panelsOf(4), 1000, { tuning: { rowGesture: 'step' } });
  m.wheel({ deltaY: 300 });
  assert.equal(m.scroller.glideTarget() ?? null, null, 'no step glide starts');
  assert.equal(m.container.scrollTop, 0);
});
