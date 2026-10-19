/**
 * The footer is the header's height, sits HEADER_GAP_PX under the frame, and the row reserves exactly that much under its
 * frames. The numbers and the styles that carry them are pinned here.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { PanelFooter, PanelHeader } from '../index.js';
import { PanelFooterContext } from '../panelFooter.js';
import { BAR_HEIGHT_PX, FOOTER_ROOM_PX, rowBottomReservePx } from '../panelChromeSize.js';
import { HEADER_GAP_PX } from '../rowConstants.js';
import { cleanup, mount, withHost } from './support/mount-harness.js';

afterEach(() => cleanup());

test('the footer room is the offset below the frame plus 36, and the row reserves at least that: 40 in every theme', () => {
  assert.equal(BAR_HEIGHT_PX, 36);
  assert.equal(HEADER_GAP_PX, 4);
  assert.equal(FOOTER_ROOM_PX, 40);
  assert.equal(rowBottomReservePx(16), 40);
  assert.equal(rowBottomReservePx(500), 500, 'a wider row gap still wins');
});

test('the footer and the header are 36 px tall in every theme, the footer border-box, HEADER_GAP_PX under the frame', () => {
  for (const radius of [4, 6, 9]) {
    const theme = createTheme({ shape: { borderRadius: radius } });
    const m = mount(withHost(React.createElement(ThemeProvider, { theme }, React.createElement(PanelFooterContext.Provider, { value: React.createElement('i', null, 'f') }, React.createElement(PanelFooter), React.createElement(PanelHeader, { id: 'hdr', children: 'h' })))));
    const footer = getComputedStyle(m.container.querySelector('[data-panel-footer]') as HTMLElement);
    assert.equal(footer.height, '36px', `radius ${radius}`);
    assert.equal(footer.boxSizing, 'border-box');
    assert.equal(footer.top, `calc(100% + ${HEADER_GAP_PX}px)`);
    assert.equal(getComputedStyle(m.container.querySelector('#hdr') as HTMLElement).height, '36px', `header at radius ${radius}`);
    cleanup();
  }
});
