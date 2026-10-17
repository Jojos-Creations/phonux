/**
 * phonux.PanelFrame draws its border, radius and size and nothing inside: the view owns padding and scrolling.
 * Server-render checks on the emitted CSS, which emotion writes without spaces.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as phonux from '../index.js';
import { createFakeHost } from '../fakeHost.js';

test('PanelFrame: the content it holds gets no inset and no scrollbar rule', () => {
  const host = createFakeHost();
  const markup = renderToStaticMarkup(
    createElement(phonux.HostProvider, {
      host,
      children: createElement(phonux.PanelFrame, { footer: false, children: createElement('p', null, 'body') }),
    }),
  );

  assert.doesNotMatch(markup, /scrollbar/);
  assert.doesNotMatch(markup, /padding-left:12px/);
  assert.doesNotMatch(markup, /padding-top:12px/);
});

test('the library ships no scroller recipe: no inset or scrollbar value is exported for a view to spread', () => {
  assert.equal('panelFrameScrollSx' in phonux, false);
});

test('panelFrameBareSx is an empty no-op', () => {
  assert.deepEqual({ ...phonux.panelFrameBareSx }, {});
});
