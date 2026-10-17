/**
 * PanelFrame draws its border, radius and size and nothing inside: the view owns padding and scrolling.
 * Server-render checks on the emitted CSS, which emotion writes without spaces.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { createTheme, type Theme } from '@mui/material/styles';
import { renderToStaticMarkup } from 'react-dom/server';
import { HostProvider, PanelFrame, panelFrameBareSx, panelFrameScrollSx } from '../index.js';
import { createFakeHost } from '../fakeHost.js';

test('PanelFrame: the content it holds gets no inset and no scrollbar rule', () => {
  const host = createFakeHost();
  const markup = renderToStaticMarkup(
    createElement(HostProvider, {
      host,
      children: createElement(PanelFrame, { footer: false, children: createElement('p', null, 'body') }),
    }),
  );

  assert.doesNotMatch(markup, /scrollbar/);
  assert.doesNotMatch(markup, /padding-left:12px/);
  assert.doesNotMatch(markup, /padding-top:12px/);
});

test('panelFrameScrollSx is the whole recipe a scroller spreads: 12px inset, 4px right under an 8px classic gutter', () => {
  const { '&::-webkit-scrollbar-thumb': thumb, '&::-webkit-scrollbar-thumb:hover': thumbHover, ...rest } = panelFrameScrollSx;
  assert.deepEqual(
    { ...rest },
    {
      overflowX: 'hidden',
      overflowY: 'auto',
      scrollbarGutter: 'stable',
      pt: '12px',
      pb: '12px',
      pl: '12px',
      pr: '4px',
      '&::-webkit-scrollbar': { width: 8 },
      '&::-webkit-scrollbar-track': { background: 'transparent' },
    },
  );
  // The thumb is the palette's text colour, so a light theme shows it and the dark default stays white.
  const dark = createTheme({ palette: { mode: 'dark' } });
  const light = createTheme({ palette: { mode: 'light' } });
  const thumbBg = (t: Theme) => (thumb as { background: (theme: Theme) => string; borderRadius: number }).background(t);
  const hoverBg = (t: Theme) => (thumbHover as { background: (theme: Theme) => string }).background(t);
  assert.deepEqual([thumbBg(dark), hoverBg(dark)], ['rgba(255, 255, 255, 0.25)', 'rgba(255, 255, 255, 0.4)']);
  assert.deepEqual([thumbBg(light), hoverBg(light)], ['rgba(0, 0, 0, 0.25)', 'rgba(0, 0, 0, 0.4)']);
  assert.equal((thumb as { borderRadius: number }).borderRadius, 4);
});

test('panelFrameBareSx is an empty no-op', () => {
  assert.deepEqual({ ...panelFrameBareSx }, {});
});
