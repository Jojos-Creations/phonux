/**
 * The resize settle: a width change inside the settle period snaps, one after a full settle period of stillness glides from
 * its first render, and every change restarts the period.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { useResizeSettled } from '../Workspace.js';
import { mount } from './support/mount-harness.js';

const DELAY_MS = 2000;
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

function Probe({ width }: { width: number }): React.ReactElement {
  return React.createElement('i', { 'data-settled': String(useResizeSettled(width, DELAY_MS, false)) });
}

const settled = (container: HTMLElement): string => container.querySelector('i')!.dataset.settled!;

test('a width change after a full settle period of stillness is settled on its first render, so it glides', async () => {
  const m = mount(React.createElement(Probe, { width: 300 }));
  await pause(DELAY_MS + 500);
  m.rerender(React.createElement(Probe, { width: 400 }));
  assert.equal(settled(m.container), 'true', 'the first render that sees 400 glides');
  m.unmount();
});

test('a width change inside the settle period snaps until the period passes, and each change restarts it', async () => {
  const m = mount(React.createElement(Probe, { width: 300 }));
  await pause(DELAY_MS + 500);
  m.rerender(React.createElement(Probe, { width: 400 }));
  assert.equal(settled(m.container), 'true');
  await pause(500);
  m.rerender(React.createElement(Probe, { width: 500 }));
  assert.equal(settled(m.container), 'false', 'a change 500 ms after the last one snaps');
  await pause(DELAY_MS + 100);
  assert.equal(settled(m.container), 'true', 'settles once 500 has held for the full period');
  m.unmount();
});
