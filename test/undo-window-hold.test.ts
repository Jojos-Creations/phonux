/**
 * The undo window is the only way back for a closed panel, so the toast holds it open while it has the pointer or focus, and
 * the window starts over when the hold ends. The provider's timer runs on mock timers; the toast is checked for what it reports.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { useProvidePanels, type PanelWindow, type ProvidedPanels } from '../index.js';
import { UndoCloseToast } from '../undoCloseToast.js';
import { cleanup, mount, useSeededInput } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';

registerTestView('hold-view', ({ panel }) => React.createElement('i', { 'data-slot': panel.id }, panel.title));
afterEach(() => {
  mock.timers.reset();
  cleanup();
});

const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({ id, url: `https://${id}.example`, title: id, live: true, view: 'hold-view', collapsible: true, listed: true, ...over });
const root = (): PanelWindow => entry('root', { url: '', title: 'History', collapsible: false, listed: false });

function provide(): () => ProvidedPanels {
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(useSeededInput({ initialEntries: [root(), entry('a'), entry('b')] }));
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  return () => latest!;
}
const open = (p: () => ProvidedPanels): boolean => p().recentlyClosed !== null;

test('control: an undo window nobody holds ends at its length', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const p = provide();
  act(() => void p().close('a'));
  assert.equal(open(p), true);
  act(() => mock.timers.tick(9999));
  assert.equal(open(p), true, 'one millisecond short');
  act(() => mock.timers.tick(1));
  assert.equal(open(p), false, 'ended on time');
});

test('a held window does not end, and letting go gives it its whole length again', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const p = provide();
  act(() => void p().close('a'));
  act(() => p().holdUndo(true));
  act(() => mock.timers.tick(60_000));
  assert.equal(open(p), true, 'a minute later it is still open');
  act(() => void p().close('b'));
  act(() => mock.timers.tick(60_000));
  assert.equal(open(p), true, 'a close made while it is held does not start the clock either');
  act(() => p().holdUndo(false));
  act(() => mock.timers.tick(9999));
  assert.equal(open(p), true);
  act(() => mock.timers.tick(1));
  assert.equal(open(p), false);
});

test('Undo works on a window that was held for a long time', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const p = provide();
  act(() => void p().close('a'));
  act(() => p().holdUndo(true));
  act(() => mock.timers.tick(120_000));
  act(() => p().undoClose());
  assert.equal(p().entries.some((e) => e.id === 'a'), true);
});

test('holding with no window open does nothing, and does not arm one', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const p = provide();
  act(() => p().holdUndo(true));
  act(() => p().holdUndo(false));
  assert.equal(open(p), false);
  act(() => void p().close('a'));
  act(() => mock.timers.tick(10_000));
  assert.equal(open(p), false, 'a hold that came before the close does not stay behind');
});

test('the toast reports a hold while it has focus or the pointer, and lets go when both are gone', () => {
  const calls: boolean[] = [];
  const m = mount(React.createElement(UndoCloseToast, { closed: [{ id: 'a', live: false, url: '', title: 'A' }], onUndo: () => {}, onHold: (on: boolean) => calls.push(on) }));
  const toast = document.querySelector<HTMLElement>('[data-undo-close-toast]') ?? document.querySelector<HTMLElement>('.MuiSnackbar-root')!;
  const undo = toast.querySelector<HTMLButtonElement>('button')!;
  act(() => undo.focus());
  assert.deepEqual(calls.slice(-1), [true], 'focus holds');
  act(() => void toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  act(() => undo.blur());
  assert.deepEqual(calls.slice(-1), [true], 'the pointer still holds after focus left');
  act(() => void toast.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
  assert.deepEqual(calls.slice(-1), [false], 'nothing holds, so it lets go');
  act(() => undo.focus());
  m.rerender(React.createElement(UndoCloseToast, { closed: null, onUndo: () => {}, onHold: (on: boolean) => calls.push(on) }));
  assert.deepEqual(calls.slice(-1), [false], 'a toast that goes while held lets go');
});
