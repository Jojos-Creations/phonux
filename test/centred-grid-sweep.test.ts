/**
 * Centring on the one-phone grid. The row is a phone, then one panel of k slots, then six phones; the window shows N phones, so
 * it is N * (phone + gap) - gap wide. The grid is anchored at scroll 0 and never shifted. The panel's left edge at a step stop
 * is rowMarginLeft + offset - stop; it centres when that equals (window - width) / 2. Rows are pure, and the phone size is an
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
 * The cells (N visible phones, k slots) whose panel centres on a grid stop. The first whole run is centred, so the panel's
 * offset is that margin plus one phone: k = N - 2 centres at stop 0, and odd N with k = N centres at stop (N + 1) / 2 phones.
 * A panel that fills the window with even N centres on no stop.
 */
const CENTRED = new Set(['3:1', '3:3', '4:2', '5:3', '5:5', '6:4']);

test('for N visible phones (2 to 6) and a first panel of k slots (1 to N), the panel centres on a grid stop exactly in the listed cells', () => {
  const centred: string[] = [];
  for (let N = 2; N <= 6; N++) {
    for (let k = 1; k <= N; k++) {
      const window = N * STEP - GAP;
      const width = k * STEP - GAP;
      const want = (window - width) / 2;
      // A phone before the panel: a panel first in the row has no leading room to centre in.
      const entries = [made('lead'), made('w', { slots: k }), ...Array.from({ length: 6 }, (_, j) => made(`p${j}`))];
      const n = computeRowNumbers({ entries, phoneWidth: PHONE, containerWidth: window + 2 * GAP, gap: GAP, wholePanels: true });
      const at = (s: number) => n.rowMarginLeft + n.leftOffsets[1]! - s;
      // Only the one-phone grid counts here: a rest added for a panel the grid never shows whole is not a grid stop.
      const grid = n.stepStops.filter((s) => Math.abs(s / STEP - Math.round(s / STEP)) < 1e-9 || s === maxScrollOf(n));
      const onGrid = grid.some((s) => Math.abs(at(s) - want) < 0.5);
      if (onGrid) centred.push(`${N}:${k}`);
      const gridHolds = Number.isInteger((n.rowMarginLeft + n.leftOffsets[1]! - want) / STEP) && n.rowMarginLeft + n.leftOffsets[1]! - want >= 0 && n.rowMarginLeft + n.leftOffsets[1]! - want <= maxScrollOf(n);
      assert.equal(onGrid, gridHolds, `N${N} k${k}: centred ${onGrid}, grid holds ${gridHolds}`);
    }
  }
  assert.deepEqual(centred.sort(), [...CENTRED].sort());
});
