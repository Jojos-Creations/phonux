/**
 * The header pill's text and the frame's scrollbar thumb are drawn from the theme palette, so they read on a light
 * theme as well as a dark one.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { createElement } from 'react';
import Box from '@mui/material/Box';
import { ThemeProvider, alpha, createTheme, decomposeColor } from '@mui/material/styles';
import { PanelHeader, panelFrameScrollSx } from '../index.js';
import { cleanup, mount } from './support/mount-harness.js';

afterEach(() => cleanup());

const themed = (mode: 'light' | 'dark', ...children: React.ReactNode[]) =>
  createElement(ThemeProvider, { theme: createTheme({ palette: { mode } }) }, ...children);

// Alpha included: text.primary and text.secondary share their rgb in both modes.
const rgb = (css: string): string => {
  const [r = 0, g = 0, b = 0, a = 1] = decomposeColor(css).values;
  return [r, g, b, a].join(',');
};
const thumbRules = (): string[] => {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) for (const rule of Array.from(sheet.cssRules)) if (rule.cssText.includes('scrollbar-thumb')) out.push(rule.cssText);
  return out;
};

for (const mode of ['light', 'dark'] as const) {
  test(`${mode} theme: the header text is the theme's text colour, never the pill's own background`, () => {
    const m = mount(themed(mode, createElement(PanelHeader, { 'data-testid': 'h' } as never, 'Title')));
    const header = m.container.querySelector('[data-testid="h"]')!;
    const style = getComputedStyle(header);
    const palette = createTheme({ palette: { mode } }).palette;
    assert.equal(rgb(style.color), rgb(palette.text.primary), 'text is text.primary');
    assert.notEqual(rgb(style.color), rgb(style.backgroundColor), 'text differs from the pill background');
  });

  test(`${mode} theme: the scrollbar thumb is the text colour at 25 percent, 40 percent on hover`, () => {
    mount(themed(mode, createElement(Box, { sx: panelFrameScrollSx }, 'x')));
    const ink = createTheme({ palette: { mode } }).palette.text.primary;
    const rules = thumbRules().join('\n').replace(/\s+/g, '');
    assert.ok(rules.includes(`background:${alpha(ink, 0.25)}`.replace(/\s+/g, '')), `thumb rule in ${rules}`);
    assert.ok(rules.includes(`background:${alpha(ink, 0.4)}`.replace(/\s+/g, '')), `hover rule in ${rules}`);
  });
}
