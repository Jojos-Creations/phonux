/**
 * The header's title color follows the MUI palette's text color, so a light theme
 * shows it and the dark default is unchanged (its text.primary is white). Server-render checks on the emitted CSS.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { HostProvider, PanelHeader } from '../index.js';
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

test('the dark default keeps the header white', () => {
  const markup = render('dark');
  assert.match(markup, /[;{]color:#fff;/);
});
