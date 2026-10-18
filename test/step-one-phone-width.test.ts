/**
 * A step moves one phone width (phone 390 + gap 16 = 406), whatever the panels: the step stops are the grid from scroll 0,
 * and the last stop is the row's end. Rows are literal, from computeRowNumbers; the events are stepTarget walks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRowNumbers, maxScrollOf } from '../rowNumbers.js';
import { stepTarget } from '../scrollTargets.js';
import { appendPanel, createHistoryPanel } from '../panelWindow.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import type { PanelSettings, PanelWindow } from '../index.js';

const STEP = 390 + 16;
const ROOT = 'root';
const made = (id: string, layer: PanelSettings = {}): PanelWindow => {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'scroll-row-view' }, id, ROOT)[0]!;
  return applyTemplate(skeleton, resolvePanelSettings({ template: layer }).value, 'create');
};
const root = (): PanelWindow => applyTemplate({ ...createHistoryPanel(ROOT), view: 'scroll-row-view' }, resolvePanelSettings({ template: { title: 'History' } }, { root: true }).value, 'create');
const numbers = (entries: PanelWindow[], containerWidth: number) => computeRowNumbers({ entries, phoneWidth: 390, containerWidth, gap: 16, wholePanels: true });

/** The stops a walk of single steps visits from 0 to the row's end, one event per step. */
function walk(n: ReturnType<typeof numbers>): number[] {
  const maxScroll = maxScrollOf(n);
  const visited = [0];
  for (let at = stepTarget('right', 0, n.stepStops, maxScroll); at !== null; at = stepTarget('right', at, n.stepStops, maxScroll)) visited.push(at);
  return visited;
}

test('a mixed row of 1, 2, 4 and 5 slots at a 2046 container: every step is one phone width, the last one is shorter', () => {
  const n = numbers([root(), made('a'), made('b', { slots: 2 }), made('c', { slots: 4 }), made('d', { slots: 5 })], 2046);
  const visited = walk(n);
  const maxScroll = maxScrollOf(n);
  assert.equal(visited.at(-1), maxScroll, 'the walk ends at the row end');
  const steps = visited.slice(1).map((at, k) => at - visited[k]!);
  assert.ok(steps.slice(0, -1).every((s) => s === STEP), `steps ${steps.join(',')}`);
  assert.ok(steps.at(-1)! <= STEP);
});

test('a row that does not scroll has no step stops', () => {
  assert.deepEqual(numbers([root(), made('a')], 1000).stepStops, []);
});

test('the grid covers every phone width up to the end, and the end is the last stop', () => {
  const n = numbers([root(), ...['a', 'b', 'c', 'd', 'e'].map((id) => made(id))], 1000);
  assert.deepEqual(n.stepStops, [0, 406, 812, 1218, 1452], 'five phones at a 968 window: four phone widths, then the rest to the end at 1452');
});

test('events for one pass across a row at 1280 with a five-slot desktop panel: each step is one phone width', () => {
  // Count = the steps to the end, printed in the PR body. Five slots cannot fit a 1248 window, so the panel is drawn at the slots that fit.
  const n = numbers([root(), made('desk', { slots: 5 }), made('p1'), made('p2')], 1280);
  const visited = walk(n);
  assert.equal(visited.length - 1, Math.ceil(maxScrollOf(n) / STEP), `${visited.length - 1} events to ${maxScrollOf(n)}`);
});

test('events for one pass across five phone panels at 1000: one per phone width', () => {
  const n = numbers([root(), ...['a', 'b', 'c', 'd', 'e'].map((id) => made(id))], 1000);
  assert.equal(walk(n).length - 1, 4, 'four events: three of 406, then the rest to the end at 1452');
});
