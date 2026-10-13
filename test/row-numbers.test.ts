/**
 * computeRowNumbers and maxScrollOf on literal rows (phone 390, gap 16), written from their sums. No jsdom: the one
 * mounted case reads the stylesheet and markup of a static render, where emotion writes its rules inline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { HostProvider, PanelRow, Workspace, registerView, resolvePanelSettings } from '../index.js';
import type { PanelSettings, PanelWindow } from '../index.js';
import { createFakeHost } from '../fakeHost.js';
import { applyTemplate } from '../panelSettings.js';
import { appendPanel, createHistoryPanel } from '../panelWindow.js';
import { computeRowNumbers, maxScrollOf } from '../rowNumbers.js';

const ROOT = 'root';
const GAP = 16;

registerView('rn-view', ({ panel }) => createElement('i', { 'data-slot': panel.id }, panel.title));

/** An entry as a creation path builds it: appendPanel's skeleton, then the 'create' writer over `layer`. */
function made(id: string, layer: PanelSettings = {}): PanelWindow {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'rn-view' }, id, ROOT)[0]!;
  return applyTemplate(skeleton, resolvePanelSettings({ template: layer }).value, 'create');
}
const scrollRoot = (): PanelWindow =>
  applyTemplate({ ...createHistoryPanel(ROOT), view: 'rn-view' }, resolvePanelSettings({ template: { title: 'History' } }, { root: true }).value, 'create');
const legacyRoot = (): PanelWindow => ({ ...createHistoryPanel(ROOT), view: 'rn-view' });
const legacyPanel = (id: string): PanelWindow => appendPanel([], { url: `https://${id}.example`, title: id, view: 'rn-view' }, id, ROOT)[0]!;
const numbers = (entries: PanelWindow[], containerWidth = 1000) => computeRowNumbers({ entries, phoneWidth: 390, containerWidth, gap: GAP });
const eleven = (): PanelWindow[] => [scrollRoot(), ...[1, 2, 3, 4, 5].map((k) => made(`pin${k}`, { parkable: false })), ...[1, 2, 3, 4, 5].map((k) => made(`web${k}`))];

test('computeRowNumbers: a row of hand-built entries is not a scrolling row and keeps the 0.1.0 numbers', () => {
  const n = numbers([legacyRoot(), legacyPanel('a'), legacyPanel('b')], 1300);
  assert.equal(n.rowScroll, false);
  assert.equal(n.windowWidth, 1268);
  assert.equal(n.maxLiveWidth, 862, '1268 less the fixed 390 and one gap');
  assert.equal(n.rowMarginLeft, 33, '(1268 - (390 + 2 * 406)) / 2');
  assert.equal(n.stripWidth, 1202);
  assert.deepEqual(n.reservedWidths, [390]);
  assert.deepEqual(n.parkLiveWidths, [390, 390]);
});

test('computeRowNumbers: History, five pinned and five web panels, all scroll, at container 1000', () => {
  const n = numbers(eleven());
  assert.equal(n.rowScroll, true);
  assert.equal(n.windowWidth, 968);
  assert.equal(n.stripWidth, 4450, '11 * 390 + 10 * 16');
  assert.equal(n.rowMarginLeft, 0);
  assert.deepEqual(n.leftOffsets, Array.from({ length: 11 }, (_, k) => k * 406));
  assert.deepEqual(n.reservedWidths, Array.from({ length: 11 }, () => 390));
  assert.deepEqual(n.parkLiveWidths, []);
  assert.equal(n.maxLiveWidth, 968);
  assert.equal(maxScrollOf(n), 3482, '4450 - 968');
});

test('computeRowNumbers: a tablet panel is two slots, 796, beside the root, and the strip scrolls by what exceeds the window', () => {
  const n = numbers([scrollRoot(), made('t', { formFactor: 'tablet' })]);
  assert.deepEqual(n.widths, [390, 796]);
  assert.deepEqual(n.leftOffsets, [0, 406]);
  assert.equal(n.stripWidth, 1202);
  assert.equal(n.rowMarginLeft, 0);
  assert.equal(maxScrollOf(n), 234, '1202 - 968');
});

test('computeRowNumbers: a desktop panel takes the slots that fit the window, two of them', () => {
  const n = numbers([scrollRoot(), made('d', { formFactor: 'desktop' })]);
  assert.deepEqual(n.widths, [390, 796]);
  assert.equal(n.stripWidth, 1202);
  assert.equal(maxScrollOf(n), 234, '1202 - 968');
});

test('computeRowNumbers: two scroll panels fit the window and are centred, with nothing to scroll', () => {
  const n = numbers([scrollRoot(), made('a')]);
  assert.equal(n.stripWidth, 796);
  assert.equal(n.rowMarginLeft, 86, '(968 - 796) / 2');
  assert.equal(maxScrollOf(n), 0);
});

test('computeRowNumbers: the third scroll panel overflows the window, so the margin goes to 0', () => {
  const n = numbers([scrollRoot(), made('a'), made('b')]);
  assert.equal(n.stripWidth, 1202);
  assert.equal(n.rowMarginLeft, 0);
  assert.equal(maxScrollOf(n), 234, '1202 - 968');
});

test('computeRowNumbers: unmeasured (container 0) has an unbounded window, no margin and nothing to scroll', () => {
  const n = numbers([scrollRoot(), made('a'), made('b'), made('d', { formFactor: 'desktop' })], 0);
  assert.equal(n.windowWidth, Number.POSITIVE_INFINITY);
  assert.equal(n.rowMarginLeft, 0);
  assert.equal(n.widths[3], 1202, 'a desktop panel is three slots until the row is measured');
  assert.equal(maxScrollOf(n), 0);
});

test('computeRowNumbers: the root-less marker is never drawn, counted or priced', () => {
  const marker: PanelWindow = { ...legacyRoot(), id: '__root__', marker: true };
  const n = numbers([marker, made('A'), made('B')]);
  assert.deepEqual(n.ids, ['A', 'B']);
  assert.deepEqual(n.widths, [390, 390]);
  assert.deepEqual(n.leftOffsets, [0, 406]);
  assert.equal(n.stripWidth, 796);
  assert.equal(n.rowMarginLeft, 86);
});

test('computeRowNumbers: a fixedItemCount the host passes prices a hand-built row, and the default is the drawn fixed columns', () => {
  const entries = [legacyRoot(), legacyPanel('a')];
  const price = (fixedItemCount?: number) => computeRowNumbers({ entries, phoneWidth: 390, containerWidth: 1300, gap: GAP, ...(fixedItemCount === undefined ? {} : { fixedItemCount }) }).maxLiveWidth;
  assert.equal(price(), 862);
  assert.equal(price(2), 862 - 406, 'a second fixed column takes its width and gap out of the cap');
});

test('a mounted scrolling row: the container pads 16 on the left, the end element is the right edge space, and the eleven slots plus ten gaps sum to the strip', () => {
  const entries = eleven().map((p) => ({ ...p, view: 'rn-view' }));
  const n = numbers(entries);
  const ref = { current: null };
  const row = createElement(PanelRow, { entries, rootId: ROOT, closingIds: new Set<string>(), enteringViaAnchorIds: new Set<string>(), rowNumbers: n });
  const workspace = createElement(Workspace, { overflowContainerRef: ref, rowRef: ref, containerWidth: 1000, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: 6, liveWidths: [], rowNumbers: n, children: row });
  const markup = renderToStaticMarkup(createElement(CacheProvider, { value: createCache({ key: 'css' }), children: createElement(HostProvider, { host: createFakeHost(), children: workspace }) }));
  assert.match(markup, /padding-left:16px/);
  assert.match(markup, /padding-right:0px/, 'the right edge space is the end element, so every engine counts it');
  assert.match(markup, new RegExp(`data-row-end-pad="" style="flex:0 0 ${n.endPad + GAP}px`), 'the end element is endPad plus the row gap');
  const slotWidths = [...markup.matchAll(/style="[^"]*?width:(\d+)px/g)].map((m) => Number(m[1]));
  assert.equal(slotWidths.length, 11);
  assert.equal(slotWidths.reduce((sum, w) => sum + w, 0) + 10 * GAP, n.stripWidth);
  assert.equal(n.stripWidth, 4450);
  assert.match(markup, /width:4450px/, 'the row box is as wide as the strip');
});
