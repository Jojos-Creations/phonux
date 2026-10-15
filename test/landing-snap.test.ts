/**
 * The row's first measurement lands the fitted phone size in one commit. Panels present at mount must not slide from the
 * preferred size to it, while a move after the measurement still slides. Asserted on the slot driver's start seam.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createWorkspace, definePanel, usePhoneSize, type WorkspaceHandle } from '../index.js';
import { advanceFrames } from './support/mount-harness.js';
import { resize, rigCleanup, slots, track, until, win } from './support/auto-rig.js';
import { slotDriver } from '../PanelRowSlot.js';

afterEach(rigCleanup);

const probe = (id: string) =>
  definePanel({
    id,
    view: ({ handle }) => {
      usePhoneSize();
      return React.createElement('i', { 'data-slot': handle.id });
    },
  });

/** Records every slot the row starts a pending slide on, for the length of `run`. */
async function recordStarts(run: () => Promise<void>): Promise<HTMLElement[]> {
  const started: HTMLElement[] = [];
  const startPending = slotDriver.startPending;
  slotDriver.startPending = (el) => {
    started.push(el);
    startPending(el);
  };
  try {
    await run();
  } finally {
    slotDriver.startPending = startPending;
  }
  return started;
}

const slotOf = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-row-slot]:has([data-slot="${id}"])`)!;

async function mountTwoAtZero(): Promise<WorkspaceHandle> {
  win.width = 0;
  win.height = 1117;
  const ws = track(createWorkspace({ templates: [probe('probe-a'), probe('probe-b')], tuning: { phoneFit: 'fit' } }));
  ws.addPanel('probe-a');
  ws.addPanel('probe-b');
  await until('both probes', () => slots(document.body).includes('probe-a') && slots(document.body).includes('probe-b'));
  return ws;
}

test('a slot the measuring commit moves is set at once, and no pending slide starts for it', async () => {
  await mountTwoAtZero();
  const moved = slotOf('probe-b');
  const before = moved.dataset.rowSlot;
  const sets: HTMLElement[] = [];
  const set = slotDriver.set;
  slotDriver.set = (el, values) => {
    sets.push(el);
    set(el, values);
  };
  let started: HTMLElement[] = [];
  try {
    started = await recordStarts(async () => {
      await resize(1400);
      await advanceFrames(400);
    });
  } finally {
    slotDriver.set = set;
  }
  assert.notEqual(moved.dataset.rowSlot, before, 'the measuring commit moves the second slot');
  assert.ok(sets.includes(moved), 'the moved slot is set at once in that commit');
  assert.deepEqual(started.filter((el) => el.hasAttribute('data-row-slot')), [], 'no pending slide starts for it');
});

test('a move after the measurement still starts its slide', async () => {
  const ws = await mountTwoAtZero();
  await resize(1400);
  await advanceFrames(400);
  const started = await recordStarts(async () => {
    await act(async () => void ws.panels.get('probe-a')!.move(1));
    await advanceFrames(400);
  });
  assert.ok(started.some((el) => el === slotOf('probe-a') || el === slotOf('probe-b')), 'a moved slot slides');
});
