/**
 * Sticky panels on the Embla row, through a mounted provider, Workspace and PanelRow laid out by `stubSlotBoxes` (the stub draws each
 * slot of the strip where Embla's translate, the slot's rest and its mover put it). Container 1800: the window is 1768, four slots of
 * 406. A sticky panel takes one slot, so the strip is seen through three (1202 px). A sticky panel is drawn outside the strip's window,
 * so jsdom proves where it sits in the tree and that it is never redrawn, never marked out of sight and never unloaded; where it
 * lands on screen as the row scrolls is proven in a real browser (sticky-rendered.test.ts), which this stub cannot lay out.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { advanceUntilRowRests, emblaWindowIn, rowOffsetOf, stubSlotBoxes } from './support/strip.js';
import type { PanelWindow } from '../index.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { createRootPanel } from '../panelWindow.js';
import { focusPanelSlot } from '../rowStep.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { ROOT, made, mountRow, row, type MountedRow } from './support/scroll-row.js';

afterEach(() => cleanup());

const ORIGIN = 422;
const PITCH = 406;
type Sticky = 'start' | 'end' | 'off';

const rootSticky = (sticky: Sticky): PanelWindow =>
  applyTemplate({ ...createRootPanel(ROOT), view: 'scroll-row-view' }, resolvePanelSettings({ template: { title: 'History', sticky } }, { root: true }).value, 'create');

async function mounted(sticky: Sticky): Promise<{ m: MountedRow; width: number }> {
  const m = mountRow(row(rootSticky(sticky), ...Array.from({ length: 12 }, (_, k) => made(`s${k + 1}`))), 1800);
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
const groupOf = (m: MountedRow, side: 'start' | 'end'): HTMLElement | null => m.container.querySelector<HTMLElement>(`[data-row-sticky="${side}"]`);

for (const side of ['start', 'end'] as const) {
  test(`sticky '${side}': the panel sits in its own group outside the strip's window, and the strip is seen through the slots left`, async () => {
    const { m, width } = await mounted(side);
    assert.equal(width, 3 * PITCH - 16, 'the strip is seen through the three slots the sticky panel leaves');
    const win = emblaWindowIn(m.container)!;
    const group = groupOf(m, side)!;
    assert.ok(group.contains(slotOf(m, ROOT)), 'the panel is in the group on its side');
    assert.ok(!win.contains(slotOf(m, ROOT)), 'and not in the window Embla moves');
    assert.equal(groupOf(m, side === 'start' ? 'end' : 'start'), null, 'the other end has no group');
    assert.equal(m.container.querySelectorAll('[data-row-embla-slot]').length > 0, true);
    const order = [...m.container.querySelector('[data-row-root]')!.children];
    assert.equal(order.indexOf(group) < order.indexOf(win), side === 'start', 'the start group comes before the window and the end group after it');
    assert.equal(shownPages(m).length, 3, `three pages shown: ${shownPages(m)}`);
    noPageCut(m, width, 'start');
  });

  test(`sticky '${side}': across steps of the row the panel is the same element in the same group, drawn and never marked out of sight`, async () => {
    const { m, width } = await mounted(side);
    const before = slotOf(m, ROOT);
    const group = groupOf(m, side)!;
    await stepRight(m, 3);
    assert.ok(rowOffsetOf(m.container) > 0, 'the row moved');
    assert.equal(slotOf(m, ROOT), before, 'the same element: it was not redrawn or remounted');
    assert.equal(before.parentElement === group || group.contains(before), true, 'still in its group');
    assert.ok(!before.hasAttribute('inert'), 'not marked out of sight');
    assert.ok(before.querySelector('[data-row-unloaded]') === null, 'its own view is drawn, never the unloaded placeholder');
    noPageCut(m, width, 'after three steps');
    await stepRight(m, 20);
    assert.equal(slotOf(m, ROOT), before);
    assert.ok(!before.hasAttribute('inert'));
    assert.ok(before.querySelector('[data-row-unloaded]') === null);
    noPageCut(m, width, 'end');
  });
}

test('control, no sticky: the root is in the strip and scrolls out of the window like any page', async () => {
  const { m, width } = await mounted('off');
  assert.equal(width, 4 * PITCH - 16);
  assert.equal(groupOf(m, 'start'), null);
  assert.equal(groupOf(m, 'end'), null);
  assert.ok(emblaWindowIn(m.container)!.contains(slotOf(m, ROOT)));
  await stepRight(m, 3);
  assert.ok(rectOf(m, ROOT).right <= ORIGIN, `the root is left of the window: ${JSON.stringify(rectOf(m, ROOT))}`);
  assert.ok(slotOf(m, ROOT).hasAttribute('inert'), 'and marked out of sight');
  assert.equal(shownPages(m).length, 4);
});

test('keys: an arrow with focus in a sticky panel steps the strip, and the sticky panel stays', async () => {
  const { m } = await mounted('start');
  const root = slotOf(m, ROOT);
  act(() => focusPanelSlot(root));
  assert.ok(root.contains(document.activeElement), 'control: focus is in the sticky panel');
  await stepRight(m, 1);
  assert.ok(rowOffsetOf(m.container) > 0, 'the strip stepped');
  assert.equal(slotOf(m, ROOT), root);
  assert.ok(root.contains(document.activeElement), 'and focus stayed in the sticky panel');
});

test('keys: a row whose every panel is sticky has no strip to step, and an arrow does nothing', async () => {
  const m = mountRow(row(rootSticky('start'), made('s1', { sticky: 'end' })), 1000, { tuning: { minScrollSlots: 0 } });
  stubSlotBoxes(m.container, ORIGIN);
  await advanceFrames(64);
  assert.equal(m.latest().rowNumbers.held.length, 2, 'control: both panels are sticky at 1000');
  m.key('ArrowRight');
  await advanceFrames(100);
  assert.equal(rowOffsetOf(m.container), 0);
});

test('a page drawn under a sticky panel does not exist: the strip never draws past its own window, so nothing shows through', async () => {
  for (const side of ['start', 'end'] as const) {
    const { m, width } = await mounted(side);
    for (const n of [3, 1, 20]) {
      await stepRight(m, n);
      for (const p of m.latest().entries) {
        if (p.id === ROOT) continue;
        const r = rectOf(m, p.id);
        if (slotOf(m, p.id).hasAttribute('inert')) continue;
        assert.ok(r.left >= ORIGIN - 0.5 && r.right <= ORIGIN + width + 0.5, `${side}: ${p.id} is drawn at ${r.left}..${r.right}, outside the window that ends where the sticky panel begins`);
      }
      assert.equal(slotOf(m, ROOT).style.clipPath, '', 'the sticky panel itself is not cut');
    }
  }
});
