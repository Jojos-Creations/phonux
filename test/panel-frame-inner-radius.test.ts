/**
 * The frame's content box takes the frame's own radius and clips what it holds, so opaque full-bleed content cannot paint
 * over the 1 px ring along a corner arc, whatever sets that radius. jsdom has no cascade for `inherit`, so a helper resolves
 * it up the tree the way an engine does; the pixels are proved in real engines by tools/proof/frame-corner-ring-probe.mjs.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { createDefaultTheme, PanelFrame, panelCornerRadiusPx, type CssStyle } from '../index.js';
import { cleanup, mount, withHost } from './support/mount-harness.js';

afterEach(() => {
  document.head.querySelectorAll('style[data-test-rule]').forEach((el) => el.remove());
  cleanup();
});

/** A border radius as an engine resolves it: `inherit` is the parent's. */
function radiusOf(el: HTMLElement): string {
  const value = getComputedStyle(el).borderRadius;
  return value === 'inherit' && el.parentElement !== null ? radiusOf(el.parentElement) : value;
}

function rendered(radius: number, frameProps: Record<string, unknown> = {}, sx?: CssStyle) {
  const theme = createTheme({ shape: { borderRadius: radius } });
  const frame = React.createElement(PanelFrame, { footer: false, ...frameProps, ...(sx !== undefined ? { sx } : {}), children: React.createElement('img', { 'data-fullbleed': '' }) });
  const m = mount(withHost(React.createElement(ThemeProvider, { theme }, frame)));
  const outer = m.container.querySelector<HTMLElement>('[data-phone-frame]') as HTMLElement;
  const inner = outer.firstElementChild as HTMLElement;
  return { theme, outer, inner };
}

test('the content box follows the theme radius of the frame, in every theme', () => {
  for (const radius of [4, 6, 9]) {
    const { theme, outer, inner } = rendered(radius);
    assert.equal(radiusOf(outer), `${panelCornerRadiusPx({ ...createDefaultTheme('light'), radius: 4 * radius })}px`, `outer at theme radius ${radius}`);
    assert.equal(radiusOf(inner), radiusOf(outer), `inner at theme radius ${radius}`);
    cleanup();
  }
});

test('the content box follows a radius the frame is given inline, a stylesheet rule, or a later style write', () => {
  const inline = rendered(6, { style: { borderRadius: '40px' } });
  assert.equal(radiusOf(inline.inner), '40px', 'inline style prop');
  cleanup();

  const rule = document.createElement('style');
  rule.setAttribute('data-test-rule', '');
  rule.textContent = '[data-phone-frame] { border-radius: 40px !important; }';
  document.head.appendChild(rule);
  const sheet = rendered(6);
  assert.equal(radiusOf(sheet.inner), '40px', 'a stylesheet rule on the frame');
  rule.remove();
  cleanup();

  const live = rendered(6);
  assert.equal(radiusOf(live.inner), '24px', 'before the write');
  live.outer.style.borderRadius = '40px';
  assert.equal(radiusOf(live.inner), '40px', 'after a style write on the mounted frame');
  live.outer.style.borderRadius = '12px';
  assert.equal(radiusOf(live.inner), '12px', 'and after the next one');
});

test('the content box clips its children', () => {
  const { inner } = rendered(6);
  assert.equal(getComputedStyle(inner).overflow, 'hidden');
});

test('the edge width is one value: the padding equals the shadow spread', () => {
  const { outer } = rendered(6);
  const padding = Number.parseFloat(getComputedStyle(outer).paddingTop);
  assert.match(getComputedStyle(outer).boxShadow, new RegExp(`^inset 0(px)? 0(px)? 0(px)? ${padding}px `), getComputedStyle(outer).boxShadow);
});

test('a view can still set its own radius or overflow on the content box through sx', () => {
  const { inner } = rendered(6, {}, { overflow: 'auto', borderRadius: '0px' });
  assert.equal(getComputedStyle(inner).overflow, 'auto');
  assert.equal(radiusOf(inner), '0px');
});
