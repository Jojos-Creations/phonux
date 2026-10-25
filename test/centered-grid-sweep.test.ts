/**
 * Centering on the one-phone grid. The row is a phone, then one panel of k slots, then six phones; the window shows N phones, so
 * it is N * (phone + gap) - gap wide, which leaves no leftover, so the grid from scroll 0 is not shifted. The panel's left edge at a step stop
 * is rowMarginLeft + offset - stop; it centers when that equals (window - width) / 2. Rows are pure, and the phone size is an
 * input, so no width is written in as a literal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRowNumbers, maxScrollOf } from '../rowNumbers.js';
import { appendPanel } from '../panelWindow.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import type { PanelSettings, PanelWindow } from '../index.js';

const PHONE = 390;
const GAP = 16;
const STEP = PHONE + GAP;
const ROOT = 'root';
const made = (id: string, layer: PanelSettings = {}): PanelWindow => {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'scroll-row-view' }, id, ROOT)[0]!;
  return applyTemplate(skeleton, resolvePanelSettings({ template: layer }).value, 'create');
};

/**
 * The cells (N visible phones, k slots) whose panel centers on a grid stop. The row has no margin, so the panel's offset is one
 * phone and it centers at stop (1 - (N - k) / 2) phones: k = N - 2 centers at stop 0, and k = N, filling the window, at stop 1.
 */
const CENTERED = new Set(['2:2', '3:1', '3:3', '4:2', '4:4', '5:3', '5:5', '6:4', '6:6']);

test('for N visible phones (2 to 6) and a first panel of k slots (1 to N), the panel centers on a grid stop exactly in the listed cells', () => {
  const centered: string[] = [];
  for (let N = 2; N <= 6; N++) {
    for (let k = 1; k <= N; k++) {
      const window = N * STEP - GAP;
      const width = k * STEP - GAP;
      const want = (window - width) / 2;
      // A phone before the panel: a panel first in the row has no leading room to center in.
      const entries = [made('lead'), made('w', { slots: k }), ...Array.from({ length: 6 }, (_, j) => made(`p${j}`))];
      const n = computeRowNumbers({ entries, phoneWidth: PHONE, containerWidth: window + 2 * GAP, gap: GAP, wholePanels: true });
      const at = (s: number) => n.rowMarginLeft + n.leftOffsets[1]! - s;
      // Only the one-phone grid counts here: a rest added for a panel the grid never shows whole is not a grid stop.
      const grid = n.stepStops.filter((s) => Math.abs(s / STEP - Math.round(s / STEP)) < 1e-9 || s === maxScrollOf(n));
      const onGrid = grid.some((s) => Math.abs(at(s) - want) < 0.5);
      if (onGrid) centered.push(`${N}:${k}`);
      const gridHolds = Number.isInteger((n.rowMarginLeft + n.leftOffsets[1]! - want) / STEP) && n.rowMarginLeft + n.leftOffsets[1]! - want >= 0 && n.rowMarginLeft + n.leftOffsets[1]! - want <= maxScrollOf(n);
      assert.equal(onGrid, gridHolds, `N${N} k${k}: centered ${onGrid}, grid holds ${gridHolds}`);
    }
  }
  assert.deepEqual(centered.sort(), [...CENTERED].sort());
});
