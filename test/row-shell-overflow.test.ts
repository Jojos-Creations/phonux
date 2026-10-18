/**
 * The row shell's overflow: workspaceShellStyle's literals per row and gesture, and the stylesheet a static render
 * of Workspace emits for each. Emotion writes declarations without spaces, so the reads are `scrollbar-width:none`.
 * No jsdom: a document would send emotion's rules to the head instead of the markup.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { Workspace } from '../index.js';
import type { WorkspaceTuning } from '../index.js';
import { workspaceShellStyle, type WorkspaceShellStyleInput } from '../Workspace.js';
import { computeRowNumbers, type RowNumbers } from '../rowNumbers.js';
import { appendPanel, createHistoryPanel } from '../panelWindow.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';

const ROOT = 'root';
const scrollEntry = (id: string) => applyTemplate(appendPanel([], { url: `https://${id}.example` }, id, ROOT)[0]!, resolvePanelSettings().value, 'create');
const scrollRoot = () => applyTemplate(createHistoryPanel(ROOT), resolvePanelSettings({}, { root: true }).value, 'create');
const rowOf = (count: number): RowNumbers => computeRowNumbers({ entries: [scrollRoot(), ...Array.from({ length: count }, (_, k) => scrollEntry(`p${k}`))], phoneWidth: 390, containerWidth: 1000, gap: 16 });
const legacy: RowNumbers = computeRowNumbers({ entries: [createHistoryPanel(ROOT)], phoneWidth: 390, containerWidth: 1000, gap: 16 });

const base: WorkspaceShellStyleInput = { containerWidth: 1000, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: 1, liveWidths: [] };
const shell = (over: Partial<WorkspaceShellStyleInput>) => workspaceShellStyle({ ...base, ...over });

test('workspaceShellStyle: a row with no settings is hidden and shows no scrollbar rule, whatever the gesture', () => {
  for (const rowGesture of [undefined, 'step', 'free', 'off'] as const) {
    const s = shell({ rowNumbers: legacy, ...(rowGesture === undefined ? {} : { rowGesture }) });
    assert.equal(s.overflowX, 'hidden');
    assert.equal(s.hideScrollbar, false);
  }
  assert.equal(shell({}).overflowX, 'hidden', 'and a call with no numbers at all is a row with no settings');
});

test("workspaceShellStyle: a scrolling row with rowGesture 'step' is overflow hidden, so only its scroll writer moves it, with its scrollbar hidden", () => {
  assert.deepEqual([shell({ rowNumbers: rowOf(2), rowGesture: 'step' }).overflowX, shell({ rowNumbers: rowOf(2), rowGesture: 'step' }).hideScrollbar], ['hidden', true]);
  assert.equal(shell({ rowNumbers: rowOf(2) }).overflowX, 'hidden', "step is the default gesture");
  assert.equal(shell({ rowNumbers: rowOf(2) }).hideScrollbar, true, "step is the default gesture");
});

test("workspaceShellStyle: a scrolling row with rowGesture 'free' scrolls and keeps its scrollbar", () => {
  const s = shell({ rowNumbers: rowOf(2), rowGesture: 'free' });
  assert.deepEqual([s.overflowX, s.hideScrollbar], ['auto', false]);
});

test("workspaceShellStyle: a scrolling row with rowGesture 'off' does not scroll", () => {
  const s = shell({ rowNumbers: rowOf(2), rowGesture: 'off' });
  assert.deepEqual([s.overflowX, s.hideScrollbar], ['hidden', false]);
});

test("workspaceShellStyle: the margin is the numbers' rowMarginLeft, 0 for eleven panels and 86 for two", () => {
  assert.equal(shell({ rowNumbers: rowOf(10) }).marginLeft, 0);
  assert.equal(shell({ rowNumbers: rowOf(1) }).marginLeft, 86);
  assert.equal(shell({ rowNumbers: rowOf(1) }).marginLeft, rowOf(1).rowMarginLeft);
});

function markupOf(rowNumbers: RowNumbers, tuning?: WorkspaceTuning): string {
  const ref = { current: null };
  const workspace = createElement(Workspace, { overflowContainerRef: ref, rowRef: ref, containerWidth: 1000, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: 1, liveWidths: [], rowNumbers, ...(tuning === undefined ? {} : { tuning }), children: null });
  return renderToStaticMarkup(createElement(CacheProvider, { value: createCache({ key: 'css' }), children: workspace }));
}
const HIDES_SCROLLBAR = /scrollbar-width:none/;
const WEBKIT_RULE = /::-webkit-scrollbar\{display:none;?\}/;

const NO_CHAINING = /overscroll-behavior-x:none/;

test('a mounted Workspace for a row with no settings emits overflow-x:hidden, no scrollbar rule and no overscroll rule', () => {
  const markup = markupOf(legacy);
  assert.match(markup, /overflow-x:hidden/);
  assert.doesNotMatch(markup, /scrollbar/);
  assert.doesNotMatch(markup, NO_CHAINING);
});

test("a mounted Workspace for a scrolling row at rowGesture 'step' emits overflow-x:hidden, overscroll-behavior-x:none and both scrollbar-hiding rules", () => {
  const markup = markupOf(rowOf(2), { rowGesture: 'step' });
  assert.match(markup, /overflow-x:hidden/);
  assert.doesNotMatch(markup, /overflow-x:auto/);
  assert.match(markup, NO_CHAINING);
  assert.match(markup, HIDES_SCROLLBAR);
  assert.match(markup, WEBKIT_RULE);
});

test("a mounted Workspace at rowGesture 'free' is the one that emits overflow-x:auto, with neither scrollbar-hiding rule (the step case above is the positive control)", () => {
  const markup = markupOf(rowOf(2), { rowGesture: 'free' });
  assert.match(markup, /overflow-x:auto/);
  assert.match(markup, NO_CHAINING);
  assert.doesNotMatch(markup, HIDES_SCROLLBAR);
  assert.doesNotMatch(markup, WEBKIT_RULE);
});

test("a mounted Workspace at rowGesture 'off' emits overflow-x:hidden with neither scrollbar-hiding rule", () => {
  const markup = markupOf(rowOf(2), { rowGesture: 'off' });
  assert.match(markup, /overflow-x:hidden/);
  assert.doesNotMatch(markup, HIDES_SCROLLBAR);
  assert.doesNotMatch(markup, WEBKIT_RULE);
});
