/**
 * edgeHold on the Embla row, through a mounted provider, Workspace and PanelRow laid out by `stubSlotBoxes` (the stub draws each
 * slot where Embla's translate, the slot's rest and its mover put it). Container 1800: the window is 1768, four slots of 406. A left
 * or right hold takes one slot out of the window, so the strip is seen through three (1202 px) and the held panel sits one gap
 * beside it. The stubbed strip window starts at ORIGIN on screen.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { advanceUntilRowRests, emblaWindowIn, rowOffsetOf, stubSlotBoxes } from './support/strip.js';
import type { PanelWindow } from '../index.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { createRootPanel } from '../panelWindow.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { ROOT, made, mountRow, row, type MountedRow } from './support/scroll-row.js';

afterEach(() => cleanup());

const ORIGIN = 422;
const PITCH = 406;
type Hold = 'left' | 'right' | 'both' | 'off';

const rootHolding = (edgeHold: Hold): PanelWindow =>
  applyTemplate({ ...createRootPanel(ROOT), view: 'scroll-row-view' }, resolvePanelSettings({ template: { title: 'History', edgeHold } }, { root: true }).value, 'create');

async function mounted(edgeHold: Hold): Promise<{ m: MountedRow; width: number }> {
  const m = mountRow(row(rootHolding(edgeHold), ...Array.from({ length: 12 }, (_, k) => made(`s${k + 1}`))), 1800);
  stubSlotBoxes(m.container, ORIGIN);
  await advanceFrames(64);
  return { m, width: Number.parseFloat(emblaWindowIn(m.container)!.style.width) };
}

const slotOf = (m: MountedRow, id: string): HTMLElement => m.container.querySelector<HTMLElement>(`[data-row-slot][data-row-id="${id}"]`)!;
const rectOf = (m: MountedRow, id: string): { left: number; right: number } => {
  const r = slotOf(m, id).getBoundingClientRect();
  return { left: Math.round(r.left * 100) / 100, right: Math.round(r.right * 100) / 100 };
};
const shownPages = (m: MountedRow): string[] => m.latest().entries.filter((p) => p.id !== ROOT && !slotOf(m, p.id).hasAttribute('inert')).map((p) => p.id);
/** Every page the row does not mark out of sight is drawn whole inside the strip's window. */
function noPageCut(m: MountedRow, width: number, where: string): void {
  for (const id of shownPages(m)) {
    const r = rectOf(m, id);
    assert.ok(r.left >= ORIGIN - 0.5 && r.right <= ORIGIN + width + 0.5, `${where}: ${id} is cut or out of the window (${r.left}..${r.right} against ${ORIGIN}..${ORIGIN + width})`);
  }
}
async function stepRight(m: MountedRow, n: number): Promise<void> {
  for (let k = 0; k < n; k += 1) m.key('ArrowRight');
  await advanceUntilRowRests(m.container);
  await advanceFrames(100);
}

for (const side of ['left', 'right'] as const) {
  test(`edgeHold '${side}': the held panel stays whole beside the strip's window at every rest, and no page is cut`, async () => {
    const { m, width } = await mounted(side);
    assert.equal(width, 3 * PITCH - 16, 'the strip is seen through the three slots the hold leaves');
    const at = side === 'left' ? { left: ORIGIN - PITCH, right: ORIGIN - 16 } : { left: ORIGIN + width + 16, right: ORIGIN + width + PITCH };
    assert.deepEqual(rectOf(m, ROOT), at, 'at the start');
    assert.ok(!slotOf(m, ROOT).hasAttribute('inert'), 'the held panel is not marked out of sight');
    assert.equal(shownPages(m).length, 3, `three pages shown: ${shownPages(m)}`);
    noPageCut(m, width, 'start');
    await stepRight(m, 3);
    assert.ok(rowOffsetOf(m.container) > 0, 'the row moved');
    assert.deepEqual(rectOf(m, ROOT), at, 'after three steps the held panel is where it was');
    assert.ok(!slotOf(m, ROOT).hasAttribute('inert'));
    noPageCut(m, width, 'after three steps');
    await stepRight(m, 20);
    assert.deepEqual(rectOf(m, ROOT), at, 'at the end');
    noPageCut(m, width, 'end');
  });
}

test("edgeHold 'both': the panel scrolls with the strip until it reaches the window's edge, then sticks there; the page under it is out of sight", async () => {
  const { m, width } = await mounted('both');
  assert.equal(width, 4 * PITCH - 16, 'nothing is taken out of the window');
  assert.deepEqual(rectOf(m, ROOT), { left: ORIGIN, right: ORIGIN + 390 }, 'drawn first in the strip at the start');
  await stepRight(m, 3);
  assert.ok(rowOffsetOf(m.container) >= 3 * PITCH - 1, `the row moved three slots: ${rowOffsetOf(m.container)}`);
  assert.deepEqual(rectOf(m, ROOT), { left: ORIGIN, right: ORIGIN + 390 }, 'stuck at the left edge');
  assert.ok(!slotOf(m, ROOT).hasAttribute('inert'), 'the stuck panel is in sight');
  const under = m.latest().entries.filter((p) => p.id !== ROOT && rectOf(m, p.id).left === ORIGIN);
  assert.equal(under.length, 1, 'one page rests under the stuck panel');
  assert.ok(slotOf(m, under[0]!.id).hasAttribute('inert'), 'the page under it is marked out of sight');
  assert.equal(shownPages(m).length, 3);
  noPageCut(m, width, 'after three steps');
});

test('control, no edgeHold: the root scrolls out of the window like any page', async () => {
  const { m, width } = await mounted('off');
  assert.equal(width, 4 * PITCH - 16);
  await stepRight(m, 3);
  assert.ok(rectOf(m, ROOT).right <= ORIGIN, `the root is left of the window: ${JSON.stringify(rectOf(m, ROOT))}`);
  assert.ok(slotOf(m, ROOT).hasAttribute('inert'), 'and marked out of sight');
  assert.equal(shownPages(m).length, 4);
});

test("edgeHold 'left': the held panel draws its own view at every rest, never the unloaded placeholder, however far the row scrolls", async () => {
  const { m } = await mounted('left');
  for (const n of [0, 3, 20]) {
    if (n > 0) await stepRight(m, n);
    assert.ok(slotOf(m, ROOT).querySelector('[data-row-unloaded]') === null, `after ${n} more steps the held panel is drawn, not unloaded`);
  }
  assert.ok(rowOffsetOf(m.container) > 0, 'the row moved');
});
