/** `rowEngine` on `createWorkspace`: the auto mount runs its row on that engine, and the default stays the library's own row. */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import './support/embla-globals.js';
import * as React from 'react';
import { createWorkspace, definePanel } from '../index.js';
import { rigCleanup, slots, track, until } from './support/auto-rig.js';

afterEach(() => rigCleanup());

const plain = definePanel({ id: 'plain', view: ({ handle }) => React.createElement('i', { 'data-slot': handle.id }) });

test("rowEngine 'embla' makes the auto-mounted row an Embla row", async () => {
  const ws = track(createWorkspace({ templates: [plain], rowEngine: 'embla', rowNearSlots: 1 }));
  ws.addPanel('plain');
  await until('the panel', () => slots(document.body).length === 1);
  assert.equal(document.querySelectorAll('[data-row-engine="embla"]').length, 1);
});

  assert.equal(stepRow(event, 'right'), true);
  assert.equal(stepRow(event, 'left'), true);
  assert.deepEqual(steps, ['next', 'prev'], 'Embla moved the row');
});

test('without rowEngine the auto-mounted row is the own row', async () => {
  const ws = track(createWorkspace({ templates: [plain] }));
  ws.addPanel('plain');
  await until('the panel', () => slots(document.body).length === 1);
  assert.equal(document.querySelectorAll('[data-row-engine]').length, 0);
});
