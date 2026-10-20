/**
 * The frame's content box is rounded one edge width inside the outer corner and clips what it holds, so opaque
 * full-bleed content cannot paint over the 1 px ring along a corner arc. jsdom reads the emitted rules through
 * getComputedStyle; the pixels are proved in a real engine by tools/proof/frame-corner-ring-probe.mjs.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { PanelFrame, panelCornerRadiusPx } from '../index.js';
import { cleanup, mount, withHost } from './support/mount-harness.js';

afterEach(() => cleanup());

function rendered(radius: number, sx?: Record<string, unknown>): { theme: ReturnType<typeof createTheme>; outer: CSSStyleDeclaration; inner: CSSStyleDeclaration; child: HTMLElement } {
  const theme = createTheme({ shape: { borderRadius: radius } });
  const frame = React.createElement(PanelFrame, { footer: false, ...(sx !== undefined ? { sx } : {}), children: React.createElement('img', { 'data-fullbleed': '' }) });
  const m = mount(withHost(React.createElement(ThemeProvider, { theme }, frame)));
  const outerEl = m.container.querySelector<HTMLElement>('[data-phone-frame]') as HTMLElement;
  const innerEl = outerEl.firstElementChild as HTMLElement;
  return { theme, outer: getComputedStyle(outerEl), inner: getComputedStyle(innerEl), child: innerEl.firstElementChild as HTMLElement };
}

test('the content box is rounded at the outer radius minus the edge width, in every theme', () => {
  for (const radius of [4, 6, 9]) {
    const { theme, outer, inner } = rendered(radius);
    const outerPx = panelCornerRadiusPx(theme);
    assert.equal(outer.borderRadius, `${outerPx}px`, `outer at theme radius ${radius}`);
    assert.equal(inner.borderRadius, `${outerPx - 1}px`, `inner at theme radius ${radius}`);
    cleanup();
  }
});

test('the content box clips its children', () => {
  const { inner } = rendered(6);
  assert.equal(inner.overflow, 'hidden');
});

test('the edge width is one value: the padding equals the shadow spread, and the radii differ by exactly it', () => {
  const { outer, inner } = rendered(6);
  const padding = Number.parseFloat(outer.paddingTop);
  assert.match(outer.boxShadow, new RegExp(`^inset 0(px)? 0(px)? 0(px)? ${padding}px `), outer.boxShadow);
  assert.equal(Number.parseFloat(outer.borderRadius) - Number.parseFloat(inner.borderRadius), padding);
});

test('a view can still set its own radius or overflow on the content box through sx', () => {
  const { inner } = rendered(6, { overflow: 'auto', borderRadius: '0px' });
  assert.equal(inner.overflow, 'auto');
  assert.equal(inner.borderRadius, '0px');
});
