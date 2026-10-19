/**
 * The footer is the header's height, sits HEADER_GAP_PX under the frame, and the row reserves exactly that much under its
 * frames. Real layout is measured in proof/footer-room; here the numbers and the styles that carry them are pinned.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { createTheme } from '@mui/material/styles';
import { PanelFooter } from '../index.js';
import { PanelFooterContext } from '../panelFooter.js';
import { footerRoomPx, panelHeaderHeightPx, rowBottomReservePx } from '../panelChromeSize.js';
import { HEADER_GAP_PX } from '../rowConstants.js';
import { cleanup, mount, withHost } from './support/mount-harness.js';

afterEach(() => cleanup());

test('the footer room is the offset below the frame plus the header height, and the row reserves at least that', () => {
  for (const radius of [4, 6, 9]) {
    const theme = createTheme({ shape: { borderRadius: radius } });
    assert.equal(footerRoomPx(theme), HEADER_GAP_PX + panelHeaderHeightPx(theme));
    assert.equal(rowBottomReservePx(theme, 16), Math.max(16, footerRoomPx(theme)));
    assert.equal(rowBottomReservePx(theme, 500), 500, 'a wider row gap still wins');
  }
});

test('the footer box is the header height, border-box, HEADER_GAP_PX under the frame', () => {
  const m = mount(withHost(React.createElement(PanelFooterContext.Provider, { value: React.createElement('i', null, 'f') }, React.createElement(PanelFooter))));
  const box = m.container.querySelector('[data-panel-footer]') as HTMLElement;
  const style = getComputedStyle(box);
  const theme = createTheme();
  assert.equal(style.height, `${panelHeaderHeightPx(theme)}px`);
  assert.equal(style.boxSizing, 'border-box');
  assert.equal(style.top, `calc(100% + ${HEADER_GAP_PX}px)`);
});
