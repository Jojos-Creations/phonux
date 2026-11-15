/**
 * A panel carried more than two of its own pitches in one move is drawn at its new place at once: a glide would draw it across
 * every panel between, over the view. A move of one place still glides.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createWorkspace, definePanel, type WorkspaceHandle } from '../index.js';
import { advanceFrames } from './support/mount-harness.js';
import { resize, rigCleanup, slots, track, until, win } from './support/auto-rig.js';
import { slotDriver } from '../PanelRowSlot.js';

afterEach(rigCleanup);

const IDS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const probe = (id: string) => definePanel({ id, view: ({ handle }) => React.createElement('i', { 'data-slot': handle.id }) });
const slotOf = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-row-slot]:has([data-slot="${id}"])`)!;

async function mountRow(): Promise<WorkspaceHandle> {
  win.width = 1400;
  win.height = 1117;
  const ws = track(createWorkspace({ templates: IDS.map(probe) }));
  for (const id of IDS) ws.addPanel(id);
  await until('every probe', () => IDS.every((id) => slots(document.body).includes(id)));
  await resize(1400);
  await advanceFrames(400);
  return ws;
}

/** The slots the row glides and the slots it sets at once while `run` runs. */
async function record(run: () => Promise<void>): Promise<{ glided: HTMLElement[]; set: HTMLElement[] }> {
  const glided: HTMLElement[] = [];
  const set: HTMLElement[] = [];
  const { glide, set: put } = slotDriver;
  slotDriver.glide = (el, ...rest) => {
    glided.push(el);
    glide(el, ...rest);
  };
  slotDriver.set = (el, mover, pose) => {
    set.push(el);
    put(el, mover, pose);
  };
  try {
    await run();
  } finally {
    slotDriver.glide = glide;
    slotDriver.set = put;
  }
  return { glided, set };
}

test('a panel moved from code past five others is set at its new place, with no glide across the row', async () => {
  const ws = await mountRow();
  const moved = slotOf('p0');
  const seen = await record(async () => {
    await act(async () => void ws.panels.get('p0')!.move(5, 'code'));
    await advanceFrames(400);
  });
  assert.ok(seen.set.some((el) => el === moved), 'the far-moved slot is set at once');
  assert.ok(!seen.glided.some((el) => el === moved), 'and never glides');
  assert.ok(seen.glided.some((el) => el !== moved), 'the panels it passed still glide their one place');
});

test('a panel moved one place still glides there', async () => {
  const ws = await mountRow();
  const moved = slotOf('p0');
  const seen = await record(async () => {
    await act(async () => void ws.panels.get('p0')!.move(1, 'code'));
    await advanceFrames(400);
  });
  assert.ok(seen.glided.some((el) => el === moved), 'a one-place move glides');
});
