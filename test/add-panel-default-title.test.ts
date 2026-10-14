/** A panel added with addPanel and no title of its own is titled `labels.panelTitle(counter)`, the same default the Host-bag create gives. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { createElement } from 'react';
import { createWorkspace, definePanel } from '../index.js';
import { resize, rigCleanup, slots, track, until } from './support/auto-rig.js';

afterEach(rigCleanup);

const view = ({ handle }: { handle: { id: string } }) => createElement('i', { 'data-slot': handle.id });

test('addPanel before and after the mount gives an untitled panel the labels.panelTitle default, and a template title wins', async () => {
  const plain = definePanel({ id: 'plain', settings: { frame: 'none', multiple: true }, view });
  const named = definePanel({ id: 'named', settings: { frame: 'none', title: 'My title' }, view });
  await resize(1600);
  const w = track(createWorkspace({ templates: [plain, named], labels: { panelTitle: (id) => `Number ${id}` } }));
  const early = w.addPanel(plain, { id: 'early' });
  await until('the first panel', () => slots(document.body).length === 1);
  const late = w.addPanel(plain);
  const kept = w.addPanel(named);
  await until('all three', () => slots(document.body).length === 3);
  const titleOf = (id: string): string | undefined => w.panels.get(id)!.getState().title;
  assert.match(String(titleOf(early.id)), /^Number \d+$/, 'added before the mount');
  assert.match(String(titleOf(late.id)), /^Number \d+$/, 'added after the mount');
  assert.equal(titleOf(kept.id), 'My title');
});
