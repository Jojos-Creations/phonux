/**
 * Under Reduce Motion the column snaps to the workspace it moves to: the cells carry no transition, so the new one sits at the
 * new place in the frame the move is drawn.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { rigCleanup, until } from './support/auto-rig.js';
import type { createWorkspaceColumn as CreateColumn } from '../index.js';

afterEach(() => {
  reduceMotion(false);
  rigCleanup();
});

// Motion reads the query once and then follows its 'change' event, so the stub exists before the first mount and the test flips it.
const reduced = { matches: false, listeners: new Set<() => void>() };
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    media: query,
    get matches() {
      return reduced.matches;
    },
    addEventListener: (_type: string, listener: () => void) => void reduced.listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void reduced.listeners.delete(listener),
  }),
});
// Loaded after the stub: Motion reads the preference when it is first used.
const { createWorkspaceColumn } = (await import('../index.js')) as { createWorkspaceColumn: typeof CreateColumn };

function reduceMotion(on: boolean): void {
  reduced.matches = on;
  for (const listener of [...reduced.listeners]) listener();
}

test('Reduce Motion snaps: no transition on the cells, and the new workspace sits in view', async () => {
  reduceMotion(true);
  const c = createWorkspaceColumn({});
  act(() => {
    c.addWorkspace();
    c.addWorkspace();
    c.addWorkspace();
  });
  await until('three cells', () => document.querySelectorAll('[data-workspace-cell]').length === 3);
  await new Promise((r) => setTimeout(r, 30));
  act(() => void c.scrollTo(2));
  const cell = (i: number): HTMLElement => document.querySelectorAll<HTMLElement>('[data-workspace-cell]')[i]!;
  await until('the new workspace is in view', () => cell(2).style.transform === 'translateY(0%)');
  await until('the old one left above', () => cell(0).style.transform === 'translateY(-100%)');
  assert.equal(cell(2).style.transition, 'none', 'the workspace arrived at does not slide');
  assert.equal(cell(0).style.transition, 'none', 'the workspace left does not slide');
  act(() => c.dispose());
});
