/**
 * Centring on the one-phone grid. A row of N visible phones is a window of 406N - 16; a first panel of k slots centres at
 * scroll stop s when its left edge (rowMarginLeft + offset - s) is (window - width) / 2 = 203 (N - k). The grid holds that stop only
 * when N - k is even. When it is odd, no grid stop centres it, and the step lands on the nearest one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRowNumbers, maxScrollOf } from '../rowNumbers.js';
import { appendPanel } from '../panelWindow.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import type { PanelSettings, PanelWindow } from '../index.js';

const ROOT = 'root';
const made = (id: string, layer: PanelSettings = {}): PanelWindow => {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'scroll-row-view' }, id, ROOT)[0]!;
  return applyTemplate(skeleton, resolvePanelSettings({ template: layer }).value, 'create');
};

test('a wide panel centres at a step stop exactly where the anchored grid holds its centred position, for N 2 to 6', () => {
  const report: string[] = [];
  for (let N = 2; N <= 6; N++) {
    for (let k = 1; k <= N; k++) {
      const window = 406 * N - 16;
      const want = 203 * (N - k);
      // A phone before the panel: a panel first in the row has no leading room to centre in.
      const entries = [made('lead'), made('w', { slots: k }), ...Array.from({ length: 6 }, (_, j) => made(`p${j}`))];
      const n = computeRowNumbers({ entries, phoneWidth: 390, containerWidth: window + 32, gap: 16, wholePanels: true });
      const left = (s: number) => n.rowMarginLeft + n.leftOffsets[1]! - s;
      const nearest = Math.min(...n.stepStops.map((s) => Math.abs(left(s) - want)));
      // The grid is anchored at scroll 0 and never shifted, so a centred stop exists exactly when the grid holds that position.
      const onGrid = n.stepStops.some((s) => Math.abs(left(s) - want) < 0.5);
      const at = n.rowMarginLeft + n.leftOffsets[1]! - want;
      const gridHolds = Number.isInteger(at / 406) && at >= 0 && at <= maxScrollOf(n);
      assert.equal(onGrid, gridHolds, `N${N} k${k}: centred ${onGrid}, grid holds ${gridHolds}`);
      report.push(`N${N}k${k}:${(N - k) % 2 === 0 ? 'centred' : 'off-by-' + Math.round(nearest)}`);
    }
  }
  assert.equal(report.length, 20, report.join(" "));
  console.log(`CENTRING ${report.join(' ')}`);
});
