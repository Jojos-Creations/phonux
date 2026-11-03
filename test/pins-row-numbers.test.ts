/**
 * What the row does before row numbers and scrolling exist: the shell hides its overflow and emits no scrollbar rule,
 * a crowded row leaves a blank margin, and a park exits to the row's own origin. No jsdom here: emotion writes its
 * rules inline into static markup only when no document exists. A pin whose behavior this entry changes is flipped
 * and renamed in the entry that changes it, never deleted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { Workspace } from '../index.js';
import { computeRowLayout } from '../panelRowLayout.js';
import { panelRowSlotMotion } from '../PanelRowSlot.js';

function workspaceMarkup(): string {
  const ref = { current: null };
  const workspace = createElement(Workspace, { overflowContainerRef: ref, rowRef: ref, containerWidth: 1000, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: 1, liveWidths: [390], children: null });
  return renderToStaticMarkup(createElement(CacheProvider, { value: createCache({ key: 'css' }), children: workspace }));
}

test('pin R1: the Workspace container hides its horizontal overflow and its markup carries no scrollbar rule', () => {
  const markup = workspaceMarkup();
  assert.match(markup, /overflow-x:hidden/);
  assert.doesNotMatch(markup, /scrollbar/);
});

test('pin R2: History and ten 390 panels at container 1000 cap the live count at 1 and leave a margin of 86', () => {
  const layout = computeRowLayout({ containerWidth: 1000, phoneWidth: 390, gap: 16, fixedItemCount: 1, liveWidths: Array.from({ length: 10 }, () => 390) });
  assert.equal(layout.maxLiveThatFit, 1);
  assert.equal(layout.computedRowMarginLeft, 86);
});

test('pin R3: a left park exit lands at minus the slot\'s own span, whatever its rest', () => {
  assert.deepEqual(panelRowSlotMotion(0, 390, 700, 'right', 'left').exit, { x: -406, opacity: 0 });
  assert.deepEqual(panelRowSlotMotion(2030, 390, 700, 'right', 'left').exit, { x: -406, opacity: 0 });
});
