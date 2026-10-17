/**
 * The header's title colour and the scrollbar thumb follow the MUI palette's text colour, so a light theme
 * shows them and the dark default is unchanged (its text.primary is white). Server-render checks on the emitted CSS.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Box from '@mui/material/Box';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { HostProvider, PanelHeader, panelFrameScrollSx } from '../index.js';
import { createFakeHost } from '../fakeHost.js';

function render(mode: 'light' | 'dark'): string {
  return renderToStaticMarkup(
    createElement(
      HostProvider,
      {
        host: createFakeHost(),
        children: createElement(
          ThemeProvider,
          { theme: createTheme({ palette: { mode } }), children: [
            createElement(PanelHeader, { key: 'h', children: 'Title' }),
            createElement(Box, { key: 's', sx: { ...panelFrameScrollSx }, children: 'body' }),
          ] },
        ),
      },
    ),
  );
}

test('a light theme draws the header title in its own dark text colour, not white', () => {
  const markup = render('light');
  assert.doesNotMatch(markup, /[;{]color:#fff;/);
  assert.doesNotMatch(markup, /color:rgb\(255,\s*255,\s*255\)/);
  assert.match(markup, /color:rgba\(0,\s*0,\s*0,\s*0\.87\)/);
});

test('a light theme draws the scrollbar thumb in the text colour at 0.25, and at 0.4 on hover', () => {
  const markup = render('light');
  assert.match(markup, /rgba\(0,\s*0,\s*0,\s*0\.25\)/);
  assert.match(markup, /rgba\(0,\s*0,\s*0,\s*0\.4\)/);
  assert.doesNotMatch(markup, /rgba\(255,\s*255,\s*255,\s*0\.25\)/);
});

test('the dark default keeps the header white and the thumb white at 0.25 and 0.4', () => {
  const markup = render('dark');
  assert.match(markup, /[;{]color:#fff;/);
  assert.match(markup, /rgba\(255,\s*255,\s*255,\s*0\.25\)/);
  assert.match(markup, /rgba\(255,\s*255,\s*255,\s*0\.4\)/);
});
