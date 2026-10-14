/**
 * minWorkspaceWidth: the narrowest row container that still shows every fixed column plus two phone slots, or plus one
 * tablet panel when that is wider. Literal numbers are worked by hand in each name; the cross-checks then hold the
 * function to the row's own fit arithmetic, so the two cannot drift apart.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { createWorkspace, minWorkspaceWidth, TIER_SIZES } from '../index.js';
import { fitPhone } from '../phoneFit.js';
import { PHONE_FIT_MIN } from '../rowConstants.js';
import { computeMaxLiveWidth, computeRowLayout } from '../panelRowLayout.js';
import { computeRowNumbers } from '../rowNumbers.js';
import { createFakeHost } from '../fakeHost.js';
import type { PanelRowEntry } from '../panelRowEntry.js';
import { cleanup } from './support/mount-harness.js';
import { flush, markerTemplate, mountWorkspace } from './support/workspace-row.js';

afterEach(cleanup);

test('History alone, phone 390, gap 16: 16 + (390 + 16) + 2 x 390 + 16 + 16 = 1234', () => {
  assert.equal(minWorkspaceWidth({ phoneWidth: 390, fixedColumnCount: 1, gap: 16 }), 1234);
});

test('Profile and History, phone 390, gap 24 (free.music): 24 + 2 x (390 + 24) + 2 x 390 + 24 + 24 = 1680', () => {
  assert.equal(minWorkspaceWidth({ phoneWidth: 390, fixedColumnCount: 2, gap: 24 }), 1680);
});

test('no fixed column: two phones and three gaps, 2 x 390 + 3 x 16 = 828', () => {
  assert.equal(minWorkspaceWidth({ phoneWidth: 390, fixedColumnCount: 0, gap: 16 }), 828);
});

test('the gap defaults to ROW_GAP (16) and the phone slots to 2', () => {
  assert.equal(minWorkspaceWidth({ phoneWidth: 390, fixedColumnCount: 1 }), 1234);
});

test('gaps and edge margins are counted once each: K columns in all take K phones and K + 1 gaps', () => {
  for (const fixedColumnCount of [0, 1, 2, 3]) {
    for (const phoneSlots of [1, 2, 3]) {
      const k = fixedColumnCount + phoneSlots;
      assert.equal(minWorkspaceWidth({ phoneWidth: 400, fixedColumnCount, phoneSlots, gap: 10, tabletWidth: 0 }), k * 400 + (k + 1) * 10, `F=${fixedColumnCount} N=${phoneSlots}`);
    }
  }
});

test('tablet wider than two phones: phone 320, gap 16, History: 16 + 336 + 768 + 16 = 1136, not 16 + 336 + 656 + 16 = 1024', () => {
  assert.equal(minWorkspaceWidth({ phoneWidth: 320, fixedColumnCount: 1, gap: 16 }), 1136);
  assert.equal(minWorkspaceWidth({ phoneWidth: 320, fixedColumnCount: 1, gap: 16, tabletWidth: 0 }), 1024);
});

test('two phones wider than the tablet: phone 390 gives 796 > 768, so the tablet changes nothing', () => {
  assert.equal(minWorkspaceWidth({ phoneWidth: 390, fixedColumnCount: 1, gap: 16, tabletWidth: TIER_SIZES.tablet.width }), 1234);
  assert.equal(minWorkspaceWidth({ phoneWidth: 390, fixedColumnCount: 1, gap: 16, tabletWidth: 0 }), 1234);
});

test('the tablet defaults to the tier table width (768): no fixed column, phone 320 gives 16 + 768 + 16 = 800', () => {
  assert.equal(TIER_SIZES.tablet.width, 768);
  assert.equal(minWorkspaceWidth({ phoneWidth: 320, fixedColumnCount: 0, gap: 16 }), 800);
});

test('a fractional phone width rounds the minimum up to a whole pixel, never down', () => {
  assert.equal(minWorkspaceWidth({ phoneWidth: 390.2, fixedColumnCount: 1, gap: 16, tabletWidth: 0 }), 1235);
  assert.equal(minWorkspaceWidth({ phoneWidth: 390.8, fixedColumnCount: 1, gap: 16, tabletWidth: 0 }), 1237);
});

test('refuses a count that is not a whole number, or a phone slot count below one', () => {
  assert.throws(() => minWorkspaceWidth({ phoneWidth: 390, fixedColumnCount: -1 }), RangeError);
  assert.throws(() => minWorkspaceWidth({ phoneWidth: 390, fixedColumnCount: 1.5 }), RangeError);
  assert.throws(() => minWorkspaceWidth({ phoneWidth: 390, fixedColumnCount: 1, phoneSlots: 0 }), RangeError);
  assert.throws(() => minWorkspaceWidth({ phoneWidth: 0, fixedColumnCount: 1 }), RangeError);
});

test('cross-check, parking row: at the minimum N phones fit beside the fixed columns, and one pixel less fits fewer', () => {
  for (const phoneWidth of [320, 360, 390, 430]) {
    for (const gap of [8, 16, 24]) {
      for (const fixedItemCount of [0, 1, 2]) {
        for (const phoneSlots of [1, 2, 3]) {
          const w = minWorkspaceWidth({ phoneWidth, fixedColumnCount: fixedItemCount, phoneSlots, gap, tabletWidth: 0 });
          const fits = (containerWidth: number) => computeRowLayout({ containerWidth, phoneWidth, gap, fixedItemCount, liveWidths: [] }).maxLiveThatFit;
          const at = `phone ${phoneWidth} gap ${gap} F=${fixedItemCount} N=${phoneSlots}`;
          assert.equal(fits(w), phoneSlots, at);
          assert.equal(fits(w - 1), phoneSlots - 1, at);
        }
      }
    }
  }
});

test('cross-check, tablet branch: at the minimum one tablet fits uncapped beside the fixed columns, and one pixel less caps it', () => {
  for (const fixedItemCount of [0, 1, 2]) {
    const w = minWorkspaceWidth({ phoneWidth: 320, fixedColumnCount: fixedItemCount, gap: 16 });
    const cap = (containerWidth: number) => computeMaxLiveWidth({ containerWidth, phoneWidth: 320, gap: 16, fixedItemCount });
    assert.equal(cap(w), 768, `F=${fixedItemCount}`);
    assert.equal(cap(w - 1), 767, `F=${fixedItemCount}`);
  }
});

test('cross-check, scrolling row: at the minimum the fixed columns and N phones are exactly the window, so nothing scrolls', () => {
  const entry = (id: string, collapsible: boolean): PanelRowEntry => ({ id, title: id, live: true, collapsible, listed: collapsible, settings: { overflow: 'scroll' } }) as unknown as PanelRowEntry;
  for (const fixed of [0, 1, 2]) {
    const entries = [...Array.from({ length: fixed }, (_, k) => entry(`f${k}`, false)), entry('a', true), entry('b', true)];
    const w = minWorkspaceWidth({ phoneWidth: 390, fixedColumnCount: fixed, gap: 24 });
    const n = computeRowNumbers({ entries, phoneWidth: 390, containerWidth: w, gap: 24 });
    assert.equal(n.rowScroll, true);
    assert.equal(n.stripWidth, n.windowWidth, `F=${fixed}`);
    const short = computeRowNumbers({ entries, phoneWidth: 390, containerWidth: w - 1, gap: 24 });
    assert.ok(short.stripWidth > short.windowWidth, `F=${fixed}: one pixel less scrolls`);
  }
});

test('the fake host leaves it out until a test sets a number', () => {
  assert.equal(createFakeHost().panels.minWorkspaceWidth, undefined);
  assert.equal(createFakeHost({ panels: { minWorkspaceWidth: 1234 } }).panels.minWorkspaceWidth, 1234);
});

/** A row of History plus `fixed - 1` more fixed columns and two web panels, mounted at `width`. */
async function liveRow(o: { fixed: number; width: number; phoneWidth?: number; rowGap?: number }) {
  const extra = Array.from({ length: o.fixed - 1 }, (_, k) => `fixed${k + 1}`);
  const ws = createWorkspace({
    mount: false,
    root: markerTemplate('root', { settings: { title: 'History' } }),
    templates: [...extra.map((id) => markerTemplate(id, { settings: { parkable: false, closable: false, placeOnAdd: 'row-start' } })), markerTemplate('w1'), markerTemplate('w2')],
    ...(o.rowGap === undefined ? {} : { tuning: { rowGap: o.rowGap } }),
  });
  for (const id of [...extra].reverse()) ws.addPanel(id);
  ws.addPanel('w1');
  ws.addPanel('w2');
  const m = mountWorkspace(ws, { width: o.width, ...(o.phoneWidth === undefined ? {} : { over: { phoneWidth: o.phoneWidth } }) });
  await flush();
  return m;
}

test('the provider reports it from the live fixed columns, phone width and row gap: Profile and History at gap 24 give 1680', async () => {
  const m = await liveRow({ fixed: 2, width: 1280, rowGap: 24 });
  assert.equal(m.latest().fixedViewCount, 2);
  assert.equal(m.latest().minWorkspaceWidth, 1680);
});

test('the provider: History alone at the default gap gives 1234; phone 320 gives the tablet branch, 1136', async () => {
  assert.equal((await liveRow({ fixed: 1, width: 1280 })).latest().minWorkspaceWidth, 1234);
  assert.equal((await liveRow({ fixed: 1, width: 1280, phoneWidth: 320 })).latest().minWorkspaceWidth, 1136);
});

// The harness holds phoneWidth constant, so this pins only that the container width alone never moves the number. A phone
// width derived from the window (phoneFit) is fed to the provider from outside it and is covered by the fit test below.
test('unmeasured and at every container width the provider reports one number while the phone width is fed constant', async () => {
  const m = await liveRow({ fixed: 2, width: 0, rowGap: 24 });
  assert.equal(m.latest().maxFitPanels, null, 'control: the row is unmeasured');
  assert.equal(m.latest().minWorkspaceWidth, 1680);
  for (const width of [600, 1679, 1680, 1920, 3000]) {
    m.setWidth(width);
    await flush();
    assert.equal(m.latest().minWorkspaceWidth, 1680, `at ${width}`);
  }
});

test('a phone width that is not a positive finite number leaves it unset and does not take the row down', async () => {
  for (const phoneWidth of [0, Number.NaN, -5, Number.POSITIVE_INFINITY]) {
    const m = await liveRow({ fixed: 1, width: 1280, phoneWidth });
    assert.equal(m.latest().minWorkspaceWidth, undefined, `phoneWidth ${phoneWidth}`);
  }
});

test('pricing the minimum from the smallest phone the fit draws does not hold: at 1504 the fit draws 346, and 346 needs 1556', () => {
  const preferred = { width: 390, height: 844 };
  const smallest = Math.ceil(PHONE_FIT_MIN * preferred.width);
  const floor = minWorkspaceWidth({ phoneWidth: smallest, fixedColumnCount: 2, gap: 24 });
  assert.equal(floor, 1504);
  const drawn = fitPhone({ windowWidth: floor, heightBudget: 0, rowCount: 1, preferred, gap: 24, edge: 24, min: PHONE_FIT_MIN, max: 1.13 });
  assert.equal(drawn.width, 346, 'the window at that minimum draws a larger phone');
  assert.ok(minWorkspaceWidth({ phoneWidth: drawn.width, fixedColumnCount: 2, gap: 24 }) > floor, 'and the two slots no longer fit beside the fixed columns');
});
