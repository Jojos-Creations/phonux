/**
 * The exit distance of a drag-to-close reaches the bottom of what the person sees, which a pinch or the on-screen keyboard can
 * move away from the layout viewport's bottom.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleViewportBottom } from '../dragToClose.js';

type Stub = { innerHeight: number; visualViewport?: { offsetTop: number; height: number } | null };

function withWindow(stub: Stub, body: () => void): void {
  const saved = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = stub;
  try {
    body();
  } finally {
    (globalThis as { window?: unknown }).window = saved;
  }
}

test('without a visual viewport the bottom is the layout viewport height', () => {
  withWindow({ innerHeight: 800, visualViewport: null }, () => assert.equal(visibleViewportBottom(), 800));
});

test('a shrunk visual viewport moves the bottom to its own bottom edge', () => {
  withWindow({ innerHeight: 800, visualViewport: { offsetTop: 0, height: 460 } }, () => assert.equal(visibleViewportBottom(), 460));
});

test('a scrolled visual viewport adds its offset to its height', () => {
  withWindow({ innerHeight: 800, visualViewport: { offsetTop: 40, height: 500 } }, () => assert.equal(visibleViewportBottom(), 540));
});
