/**
 * The rest settle lands on a grid stop. With a phone, a three-slot panel and four phones at a 2000 px container (phone 380, gap 16),
 * the grid is every 396 from 0 and the row ends at 1386, off the grid and a shorter last step. A rest from 892 must settle on the grid stop 792, or the next step is short.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRowNumbers, nearestStop } from '../rowNumbers.js';
import { appendPanel } from '../panelWindow.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import type { PanelSettings, PanelWindow } from '../index.js';

const PHONE = 380;
const GAP = 16;
const STEP = PHONE + GAP;
const ROOT = 'root';
const made = (id: string, layer: PanelSettings = {}): PanelWindow => {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'scroll-row-view' }, id, ROOT)[0]!;
  return applyTemplate(skeleton, resolvePanelSettings({ template: layer }).value, 'create');
};

test('a rest from between stops settles on a grid stop, so the next step is one phone width', () => {
  const n = computeRowNumbers({ entries: [made('a'), made('w', { slots: 3 }), made('p1'), made('p2'), made('p3'), made('p4')], phoneWidth: PHONE, containerWidth: 2000, gap: GAP, wholePanels: true });
  const base = 2 * STEP + 100;
  const onGrid = (at: number) => Math.abs(at / STEP - Math.round(at / STEP)) < 1e-6;
  assert.deepEqual(n.stops, n.stepStops, 'every stop is a grid stop');
  assert.equal(n.stops.at(-1), 1386, 'the row ends at 1386 (2 + 3152 + 200 - 1968), which is off the grid');
  const settled = nearestStop(n, base);
  assert.ok(onGrid(settled), `settled ${settled}`);
  assert.equal(settled, 2 * STEP, 'the grid stop 792 is nearer than the end at 1386');
});
