/**
 * PanelFrame draws its border, radius and size and nothing inside: the view owns padding and scrolling.
 * Server-render checks on the emitted CSS, which emotion writes without spaces.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
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

test('the scroll and bare exports stay importable; bare is an empty no-op', () => {
  assert.equal(panelFrameScrollSx.pl, '12px');
  assert.deepEqual({ ...panelFrameBareSx }, {});
});
