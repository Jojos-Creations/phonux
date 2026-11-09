/**
 * The theme option: the mount draws one ThemeProvider and one CssBaseline, with the app's theme for the window's color scheme or
 * the default one, and a column draws it once for every workspace in it.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { useTheme, type Theme } from '@mui/material/styles';
import { createDefaultTheme, createWorkspace, createWorkspaceColumn, definePanel } from '../index.js';
import type { PhonuxTheme, WorkspaceColumnHandle } from '../index.js';
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

/** A view that draws the mode it sees; `seen` reads the colors from the custom properties the mount writes. */
const probe = definePanel({
  id: 'probe',
  view: ({ handle }) => {
    const t = useTheme() as Theme;
    return React.createElement('i', { 'data-slot': handle.id, 'data-mode': t.palette.mode });
  },
});
const APP_PRIMARY = '#ff00aa';
const appTheme = (mode: 'light' | 'dark'): PhonuxTheme => ({ ...createDefaultTheme(mode), primary: APP_PRIMARY, foreground: mode === 'dark' ? '#abcdef' : '#123456' });

/** CssBaseline's sheet is the global one whose first rule sets font smoothing on html; emotion gives each Global its own sheet. */
const baselines = (): number =>
  [...document.querySelectorAll('style[data-emotion="css-global"]')].filter((s) => [...((s as HTMLStyleElement).sheet?.cssRules ?? [])].some((r) => r.cssText.startsWith('html {-webkit-font-smoothing'))).length;
/** What a probe draws: its mode, the foreground color and whether the accent is the app's. jsdom does not inherit custom properties, so they are read where the mount writes them. */
function seen(node: HTMLElement): { slot?: string; mode?: string; text: string; app: string } {
  const style = getComputedStyle(document.documentElement);
  return { ...node.dataset, text: style.getPropertyValue('--phonux-foreground').trim(), app: String(style.getPropertyValue('--phonux-primary').trim() === APP_PRIMARY) };
}
const drawn = () => seen(document.querySelector('[data-slot="probe"]') as HTMLElement);

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
  assert.equal(drawn().text, createDefaultTheme('light').foreground);
  await setDark(true);
  assert.equal(drawn().mode, 'dark');
  assert.equal(drawn().text, createDefaultTheme('dark').foreground);
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
  const ws = track(createWorkspace({ templates: [probe], theme: (m) => {
    modes.push(m);
    return appTheme(m);
  } }));
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
  assert.equal(drawn().text, createDefaultTheme('light').foreground);
});

test('a theme function that returns something that is not a theme goes to onError and the default theme is drawn', async () => {
  const errors: unknown[] = [];
  const ws = track(createWorkspace({ templates: [probe], onError: (e) => void errors.push(e), theme: (() => ({})) as never }));
  ws.addPanel('probe');
  await shown();
  await until('the report', () => errors.length > 0);
  assert.match((errors[0] as Error).message, /must return a PhonuxTheme/);
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
    assert.equal(seen(node).app, 'true');
    assert.equal(seen(node).text, '#123456');
  }
  assert.equal(baselines(), 1, 'the cells draw no baseline of their own');
  await setDark(true);
  assert.equal(document.querySelectorAll('[data-mode="dark"]').length, 2);
});

test('the theme is CSS custom properties: MUI draws from them and a stylesheet rule overrides them', async () => {
  const seenPalette: string[] = [];
  const reader = definePanel({
    id: 'reader',
    view: () => {
      const t = useTheme() as Theme;
      seenPalette.push(t.palette.primary.main, t.palette.background.paper, t.palette.divider);
      return React.createElement('i', { 'data-slot': 'reader' });
    },
  });
  const rule = document.createElement('style');
  rule.textContent = ':root { --phonux-primary: #00ff00; }';
  const ws = track(createWorkspace({ templates: [reader], theme: appTheme }));
  ws.addPanel('reader');
  await until('the reader', () => slots(document.body).includes('reader'));
  assert.deepEqual(seenPalette.slice(0, 3), ['var(--phonux-primary)', 'var(--phonux-card)', 'var(--phonux-border)']);
  const root = (): CSSStyleDeclaration => getComputedStyle(document.documentElement);
  assert.equal(root().getPropertyValue('--phonux-primary').trim(), APP_PRIMARY);
  assert.equal(root().getPropertyValue('--phonux-radius').trim(), `${createDefaultTheme('light').radius}px`);
  document.head.appendChild(rule);
  assert.equal(root().getPropertyValue('--phonux-primary').trim(), '#00ff00', 'a plain :root rule beats the zero-specificity default');
  rule.remove();
});

test('a color-scheme key the page stored for its own MUI does not switch the mount', async () => {
  localStorage.setItem('mui-mode', 'dark');
  localStorage.setItem('mui-color-scheme-light', 'dark');
  try {
    const ws = track(createWorkspace({ templates: [probe], theme: appTheme }));
    ws.addPanel('probe');
    await shown();
    assert.equal(drawn().mode, 'light');
    assert.equal(drawn().text, '#123456');
  } finally {
    localStorage.clear();
  }
});
