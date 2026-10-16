/**
 * The rest settle lands on a step stop. With a phone, a three-slot panel and four phones at a 2000 px container (phone 380, gap 16),
 * the whole-panel stops are 0, 396 and 1386; 1386 is off the 396 grid. From 1188 the nearest whole-panel stop is 1386, so a settle
 * there leaves the next step 198 long. The settle must use the step stops, which are every 396 from 0.
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

test('a rest from between stops settles on a step stop, so the next step is one phone width', () => {
  const n = computeRowNumbers({ entries: [made('a'), made('w', { slots: 3 }), made('p1'), made('p2'), made('p3'), made('p4')], phoneWidth: PHONE, containerWidth: 2000, gap: GAP, wholePanels: true });
  const base = 3 * STEP;
  const onGrid = (at: number) => Math.abs(at / STEP - Math.round(at / STEP)) < 1e-6;
  assert.ok(!onGrid(nearestStop(n, base)), 'the whole-panel settle is off the grid: this is the half step');
  const settled = nearestStop({ ...n, stops: n.stepStops }, base);
  assert.ok(onGrid(settled), `settled ${settled}`);
});
