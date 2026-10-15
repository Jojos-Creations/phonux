/**
 * A workspace switch snaps when the system's reduced-motion query is on, with or without a MotionConfig that follows the
 * system. This file keeps the query on from the first mount, because Motion reads it once per module.
 */
import './support/jsdom-globals.js';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { act } from 'react';
import type { MotionConfigProps } from 'motion/react';

// Motion reads the query once per module, the first time it is used, so the stub is in place before anything that uses Motion loads.
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    media: query,
    matches: query.includes('prefers-reduced-motion'),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }),
});

const { MotionConfig } = (await import('motion/react')) as typeof import('motion/react');
const { advanceFrames, cleanup, mount } = await import('./support/mount-harness.js');
const { createWorkspaceColumn, WorkspaceColumn } = await import('../index.js');

afterEach(() => cleanup());

async function switchTo(reducedMotion: MotionConfigProps['reducedMotion'] | undefined): Promise<{ transition: string; transform: string }> {
  const column = createWorkspaceColumn({ mount: false });
  column.addWorkspace();
  column.addWorkspace();
  column.addWorkspace();
  const ui = React.createElement(WorkspaceColumn, { column, children: () => React.createElement('div', null, 'panels') });
  const mounted = mount(reducedMotion === undefined ? ui : React.createElement(MotionConfig, { reducedMotion }, ui));
  await advanceFrames(50);
  const track = mounted.container.querySelector<HTMLElement>('[data-workspace-cell]')!.parentElement!;
  act(() => void column.scrollTo(2));
  await advanceFrames(1);
  const out = { transition: track.style.transition, transform: track.style.transform };
  column.dispose();
  return out;
}

test('system query on, no MotionConfig: the switch snaps in its first frame', async () => {
  const { transition, transform } = await switchTo(undefined);
  assert.equal(transition, 'none');
  assert.equal(transform, 'translateY(-200%)');
});

test('system query on, MotionConfig user: the switch snaps in its first frame', async () => {
  const { transition, transform } = await switchTo('user');
  assert.equal(transition, 'none');
  assert.equal(transform, 'translateY(-200%)');
});
