/** Under the OS Reduce Motion setting the fitted size snaps to the new window at once instead of waiting for the resize settle. */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { createWorkspace, definePanel, usePhoneSize } from '../index.js';
import { resize, rigCleanup, slots, track, until, win } from './support/auto-rig.js';

afterEach(rigCleanup);

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
});

const probe = definePanel({
  id: 'fit-probe',
  settings: { frame: 'none' },
  view: ({ handle }) => React.createElement('i', { 'data-slot': handle.id, 'data-phone': String(usePhoneSize().width) }),
});

test('a resize draws the new fit in the same commit, with no settle wait', async () => {
  win.width = 1000;
  win.height = 1117;
  const ws = track(createWorkspace({ templates: [probe], tuning: { phoneFit: 'fit' } }));
  ws.addPanel('fit-probe');
  await until('the probe', () => slots(document.body).includes('fit-probe'));
  const width = (): string => document.querySelector<HTMLElement>('[data-phone]')!.dataset.phone!;
  assert.equal(width(), '440');
  await resize(1400);
  assert.equal(width(), '330', 'snapped, not held');
});
