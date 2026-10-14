/**
 * Under Reduce Motion the column snaps to the workspace it moves to: the cell track carries no transition, so it sits at the
 * new place in the frame the move is drawn.
 */
import { afterEach, test } from 'node:test';
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

test('Reduce Motion snaps: no transition on the track, and it sits at the new workspace', async () => {
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
  const track = document.querySelector<HTMLElement>('[data-workspace-cell]')!.parentElement!;
  await until('the track moved', () => track.style.transform === 'translateY(-200%)');
  await until('no transition', () => track.style.transition === 'none');
  act(() => c.dispose());
});
