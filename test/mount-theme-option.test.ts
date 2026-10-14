/**
 * The theme option: the mount draws one ThemeProvider and one CssBaseline, with the app's theme for the window's color scheme or
 * the default one, and a column draws it once for every workspace in it.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createTheme, useTheme, type Theme } from '@mui/material/styles';
import { createDefaultTheme, createWorkspace, createWorkspaceColumn, definePanel } from '../index.js';
import type { WorkspaceColumnHandle } from '../index.js';
import { rigCleanup, slots, track, until } from './support/auto-rig.js';

let dark = false;
const listeners = new Set<(e: { matches: boolean }) => void>();
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: (query: string) => ({
    get matches() {
      return query.includes('dark') ? dark : false;
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, l: (e: { matches: boolean }) => void) => void listeners.add(l),
    removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => void listeners.delete(l),
    addListener: (l: (e: { matches: boolean }) => void) => void listeners.add(l),
    removeListener: (l: (e: { matches: boolean }) => void) => void listeners.delete(l),
    dispatchEvent: () => false,
  }),
});
const setDark = (value: boolean): Promise<void> =>
  act(async () => {
    dark = value;
    for (const l of [...listeners]) l({ matches: value });
  });

const columns: WorkspaceColumnHandle[] = [];
afterEach(() => {
  dark = false;
  for (const c of columns.splice(0)) act(() => c.dispose());
  rigCleanup();
});

/** A view that draws the theme it sees: the mode, the text color and a marker of which theme function made it. */
const probe = definePanel({
  id: 'probe',
  view: ({ handle }) => {
    const t = useTheme() as Theme & { appMade?: boolean };
    return React.createElement('i', { 'data-slot': handle.id, 'data-mode': t.palette.mode, 'data-text': t.palette.text.primary, 'data-app': String(t.appMade === true) });
  },
});
const appTheme = (mode: 'light' | 'dark'): Theme => Object.assign(createTheme({ palette: { mode, text: { primary: mode === 'dark' ? '#abcdef' : '#123456' } } }), { appMade: true });

/** CssBaseline's sheet is the global one whose first rule sets font smoothing on html; emotion gives each Global its own sheet. */
const baselines = (): number =>
  [...document.querySelectorAll('style[data-emotion="css-global"]')].filter((s) => [...((s as HTMLStyleElement).sheet?.cssRules ?? [])].some((r) => r.cssText.startsWith('html {-webkit-font-smoothing'))).length;
const drawn = (): DOMStringMap => (document.querySelector('[data-slot="probe"]') as HTMLElement).dataset;

async function shown(): Promise<void> {
  await until('the probe', () => slots(document.body).includes('probe'));
}

test('a workspace with a theme option draws under it in light and in dark', async () => {
  const ws = track(createWorkspace({ templates: [probe], theme: appTheme }));
  ws.addPanel('probe');
  await shown();
  assert.deepEqual({ ...drawn() }, { slot: 'probe', mode: 'light', text: '#123456', app: 'true' });
  await setDark(true);
  assert.deepEqual({ ...drawn() }, { slot: 'probe', mode: 'dark', text: '#abcdef', app: 'true' });
});

test('left out, the default theme is drawn for the mode', async () => {
  const ws = track(createWorkspace({ templates: [probe] }));
  ws.addPanel('probe');
  await shown();
  assert.equal(drawn().app, 'false');
  assert.equal(drawn().text, createDefaultTheme('light').palette.text.primary);
  await setDark(true);
  assert.equal(drawn().mode, 'dark');
  assert.equal(drawn().text, createDefaultTheme('dark').palette.text.primary);
});

test('exactly one CssBaseline is in the document with the option and without it', async () => {
  const withOption = track(createWorkspace({ templates: [probe], theme: appTheme }));
  withOption.addPanel('probe');
  await shown();
  assert.equal(baselines(), 1);
  await act(async () => withOption.dispose());
  const without = track(createWorkspace({ templates: [probe] }));
  without.addPanel('probe');
  await shown();
  assert.equal(baselines(), 1);
});

test('the theme function runs once per mode: toggling the color scheme twice calls it three times', async () => {
  const modes: string[] = [];
  const ws = track(createWorkspace({ templates: [probe], theme: (m) => (modes.push(m), appTheme(m)) }));
  ws.addPanel('probe');
  await shown();
  await setDark(true);
  await setDark(false);
  assert.deepEqual(modes, ['light', 'dark', 'light']);
});

test('a theme function that throws goes to onError and the default theme is drawn', async () => {
  const errors: unknown[] = [];
  const ws = track(createWorkspace({ templates: [probe], onError: (e) => void errors.push(e), theme: () => { throw new Error('boom'); } }));
  ws.addPanel('probe');
  await shown();
  await until('the report', () => errors.length > 0);
  assert.equal((errors[0] as Error).message, 'boom');
  assert.equal(drawn().app, 'false');
  assert.equal(drawn().text, createDefaultTheme('light').palette.text.primary);
});

test('a theme function that returns something that is not a theme goes to onError and the default theme is drawn', async () => {
  const errors: unknown[] = [];
  const ws = track(createWorkspace({ templates: [probe], onError: (e) => void errors.push(e), theme: (() => ({})) as never }));
  ws.addPanel('probe');
  await shown();
  await until('the report', () => errors.length > 0);
  assert.match((errors[0] as Error).message, /must return a MUI Theme/);
  assert.equal(drawn().app, 'false');
  assert.equal(errors.length, 1, 'reported once');
});

test('a column draws the theme once for every workspace in it', async () => {
  const c = createWorkspaceColumn({ templates: [probe], theme: appTheme });
  columns.push(c);
  act(() => {
    c.addWorkspace().addPanel('probe');
    c.addWorkspace().addPanel('probe');
  });
  await until('two probes', () => document.querySelectorAll('[data-slot="probe"]').length === 2);
  for (const node of document.querySelectorAll<HTMLElement>('[data-slot="probe"]')) {
    assert.equal(node.dataset.app, 'true');
    assert.equal(node.dataset.text, '#123456');
  }
  assert.equal(baselines(), 1, 'the cells draw no baseline of their own');
  await setDark(true);
  assert.equal(document.querySelectorAll('[data-mode="dark"]').length, 2);
});
