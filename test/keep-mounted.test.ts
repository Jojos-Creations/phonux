/**
 * The slot motion helpers a parking slot is built from, and usePanelHidden: false for a live panel and outside a row.
 * A fixed column is never parked by its live flag. jsdom proves structure only, never that the browser draws or skips it.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { PanelRow, registerView, usePanelHidden } from '../index.js';
import type { PanelWindow } from '../index.js';
import { resolvePanelSettings } from '../panelSettings.js';
import { PANEL_TRANSITION } from '../index.js';
import { enterStart, panelRowSlotMotion, parkExitTarget, slotDriver } from '../PanelRowSlot.js';
import { advanceFrames, cleanup, mount, withHost } from './support/mount-harness.js';

const seen = { hidden: [] as boolean[] };

registerView('km-view', ({ panel }) => {
  const hidden = usePanelHidden();
  if (panel.id === 'a') seen.hidden.push(hidden);
  return React.createElement('i', { 'data-slot': panel.id });
});
registerView('km-root', () => React.createElement('b'));

const base = resolvePanelSettings().value;
const entry = (id: string, live: boolean, over: Partial<PanelWindow> = {}): PanelWindow => ({
  id,
  url: `https://${id}.example`,
  title: id,
  live,
  locked: false,
  view: 'km-view',
  collapsible: true,
  listed: true,
  settings: { ...base, overflow: 'park' },
  ...over,
});
const root = (): PanelWindow => ({ id: 'root', url: '', title: 'History', live: true, locked: true, view: 'km-root', collapsible: false, listed: false });
const NONE: ReadonlySet<string> = new Set();
const rowOf = (entries: PanelWindow[]): React.ReactElement => withHost(React.createElement(PanelRow, { entries, rootId: 'root', closingIds: NONE, enteringViaAnchorIds: NONE }));
const slotOf = (container: HTMLElement, id: string): HTMLElement => {
  const view = container.querySelector(`[data-slot="${id}"]`);
  assert.ok(view, `the view of ${id} is mounted`);
  return view.closest<HTMLElement>('[data-row-slot]')!;
};
const isHidden = (slot: HTMLElement): boolean => slot.style.display === 'none' && slot.hasAttribute('inert') && slot.getAttribute('aria-hidden') === 'true';

afterEach(() => {
  cleanup();
  seen.hidden.length = 0;
});

function Lone(): React.ReactElement {
  return React.createElement('span', null, String(usePanelHidden()));
}

test('usePanelHidden is false while the panel is live', async () => {
  mount(rowOf([root(), entry('a', true)]));
  await advanceFrames(1000);
  assert.equal(seen.hidden.at(-1), false);
});

test('usePanelHidden is false outside a row', () => {
  const lone = mount(withHost(React.createElement(Lone)));
  assert.equal(lone.container.textContent, 'false');
});

test('parkExitTarget returns the literal left and right targets of a park exit', () => {
  assert.deepEqual(parkExitTarget(406, 406, 'left', false), { x: -406, opacity: 0 });
  assert.deepEqual(parkExitTarget(406, 406, 'right', false), { x: 812, opacity: 0 });
  assert.deepEqual(parkExitTarget(0, 390, 'right', false), { x: 390, opacity: 0 });
});

test('enterStart returns the literal enter start for left and right', () => {
  assert.deepEqual(enterStart(406, 406, 'left'), { x: 0, opacity: 0 });
  assert.deepEqual(enterStart(406, 406, 'right'), { x: 812, opacity: 0 });
  assert.deepEqual(enterStart(0, 390, 'left'), { x: -390, opacity: 0 });
});

test('panelRowSlotMotion keeps its five-argument form and its default transition', () => {
  const motion = panelRowSlotMotion(406, 390, 700, 'right', 'left');
  assert.deepEqual(motion.exit, { x: -406, opacity: 0 });
  assert.equal(motion.transition, PANEL_TRANSITION);
});

test('slotDriver.read answers nothing for an element no motion component owns', () => {
  assert.equal(slotDriver.read(document.createElement('div')), undefined);
});

test('a fixed column stays drawn when its live flag goes false', async () => {
  const fixed = (live: boolean): React.ReactElement => rowOf([root(), entry('a', live, { collapsible: false })]);
  const column = mount(fixed(true));
  column.rerender(fixed(false));
  await advanceFrames(1000);
  assert.equal(column.container.querySelectorAll('[data-slot="a"]').length, 1);
  assert.equal(isHidden(slotOf(column.container, 'a')), false);
});
