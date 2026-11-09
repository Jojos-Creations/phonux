/** `rowEngine` on `createWorkspace`: the auto mount runs its row on that engine, and the default stays the library's own row. */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import './support/embla-globals.js';
import * as React from 'react';
import { createWorkspace, definePanel, stepRow } from '../index.js';
import { EMBLA_WINDOW_ATTRIBUTE, emblaOf } from '../emblaRow.js';
import { rigCleanup, slots, track, until } from './support/auto-rig.js';

afterEach(() => rigCleanup());

const plain = definePanel({ id: 'plain', view: ({ handle }) => React.createElement('i', { 'data-slot': handle.id }) });

test("rowEngine 'embla' makes the auto-mounted row an Embla row", async () => {
  const ws = track(createWorkspace({ templates: [plain], rowEngine: 'embla', rowNearSlots: 1 }));
  ws.addPanel('plain');
  await until('the panel', () => slots(document.body).length === 1);
  assert.equal(document.querySelectorAll('[data-row-engine="embla"]').length, 1);
});

test("a host's stepRow chord reaches an Embla row", async () => {
  const ws = track(createWorkspace({ templates: [plain], rowEngine: 'embla' }));
  ws.addPanel('plain');
  await until('the panel', () => slots(document.body).length === 1);
  const embla = emblaOf(document.querySelector(`[${EMBLA_WINDOW_ATTRIBUTE}]`)!)!;
  // jsdom lays nothing out, so the row gets three stops 100 px apart; a step goes one stop from the stop nearest where it is heading.
  const engine = embla.internalEngine();
  engine.scrollSnaps.splice(0, engine.scrollSnaps.length, 0, -100, -200);
  embla.scrollSnapList = () => [0, 0.5, 1];
  const steps: number[] = [];
  embla.scrollTo = (k: number) => void steps.push(k);
  const event = new window.KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true });
  engine.target.set(0);
  assert.equal(stepRow(event, 'right'), true);
  engine.target.set(-100);
  assert.equal(stepRow(event, 'left'), true);
  assert.deepEqual(steps, [1, 0], 'Embla moved the row one stop each way');
});

test('without rowEngine the auto-mounted row is the own row', async () => {
  const ws = track(createWorkspace({ templates: [plain] }));
  ws.addPanel('plain');
  await until('the panel', () => slots(document.body).length === 1);
  assert.equal(document.querySelectorAll('[data-row-engine]').length, 0);
});
