/**
 * minWorkspaceWidth: the narrowest row container that still shows every fixed column plus two phone slots, or plus one
 * tablet panel when that is wider. Literal numbers are worked by hand in each name; the cross-checks then hold the
 * function to the row's own fit arithmetic, so the two cannot drift apart.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { createWorkspace, minWorkspaceWidth, TIER_SIZES } from '../index.js';
import { computeMaxLiveWidth, computeRowLayout } from '../panelRowLayout.js';
import { computeRowNumbers } from '../rowNumbers.js';
import { createFakeHost } from '../fakeHost.js';
import type { PanelRowEntry } from '../panelRowEntry.js';
import { cleanup } from './support/mount-harness.js';
import { checkMinWidth } from './support/min-width-invariant.js';
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

test('a fractional phone width rounds the minimum up to a whole pixel, never to the nearest: 390.1 sums to 1234.3, so 1235', () => {
  assert.equal(minWorkspaceWidth({ phoneWidth: 390.1, fixedColumnCount: 1, gap: 16, tabletWidth: 0 }), 1235);
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

test('invariant, phone drawn at the size it was priced from: the guarantee holds at the minimum and breaks one pixel less', () => {
  for (const phoneWidth of [300, 320, 360, 390, 430]) {
    for (const gap of [8, 16, 24]) {
      for (const fixedColumnCount of [0, 1, 2]) {
        for (const tabletWidth of [0, 768]) {
          const w = minWorkspaceWidth({ phoneWidth, fixedColumnCount, gap, tabletWidth });
          const at = `phone ${phoneWidth} gap ${gap} F=${fixedColumnCount} tablet ${tabletWidth}`;
          assert.equal(checkMinWidth({ containerWidth: w, drawnPhoneWidth: phoneWidth, fixedColumnCount, gap, tabletWidth }).holds, true, at);
          assert.equal(checkMinWidth({ containerWidth: w - 1, drawnPhoneWidth: phoneWidth, fixedColumnCount, gap, tabletWidth }).holds, false, at);
        }
      }
    }
  }
});

test('invariant: a minimum priced from a smaller phone than the row draws there fails the check (1504 at 346: tablet capped at 716)', () => {
  const tablet = checkMinWidth({ containerWidth: 1504, drawnPhoneWidth: 346, fixedColumnCount: 2, gap: 24 });
  assert.deepEqual([tablet.phonesFit, tablet.maxLiveWidth, tablet.holds], [true, 716, false]);
  assert.equal(checkMinWidth({ containerWidth: 1136, drawnPhoneWidth: 357, fixedColumnCount: 1, gap: 16 }).maxLiveWidth, 731);
  const phones = checkMinWidth({ containerWidth: 1400, drawnPhoneWidth: 434, fixedColumnCount: 2, gap: 24, tabletWidth: 0 });
  assert.deepEqual([phones.phonesThatFit, phones.holds], [1, false]);
  assert.equal(checkMinWidth({ containerWidth: 1680, drawnPhoneWidth: 390, fixedColumnCount: 2, gap: 24 }).holds, true, 'control: the same row drawn at the phone it was priced from');
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

test('unmeasured and at every container width the provider reports one number for one phone width', async () => {
  const m = await liveRow({ fixed: 2, width: 0, rowGap: 24 });
  assert.equal(m.latest().maxFitPanels, null, 'control: the row is unmeasured');
  assert.equal(m.latest().minWorkspaceWidth, 1680);
  for (const width of [600, 1679, 1680, 1920, 3000]) {
    m.setWidth(width);
    await flush();
    assert.equal(m.latest().minWorkspaceWidth, 1680, `at ${width}`);
  }
});

test('the provider value follows the phone width it is given, and never the container width', async () => {
  const seen = new Set<number>();
  for (const phoneWidth of [320, 390, 430]) {
    const want = minWorkspaceWidth({ phoneWidth, fixedColumnCount: 2, gap: 24 });
    seen.add(want);
    const m = await liveRow({ fixed: 2, width: 0, rowGap: 24, phoneWidth });
    for (const width of [0, 900, want - 1, want, 2400]) {
      m.setWidth(width);
      await flush();
      assert.equal(m.latest().minWorkspaceWidth, want, `phone ${phoneWidth} at ${width}`);
    }
  }
  assert.equal(seen.size, 3, 'control: the three phone widths price three different minimums');
});

test('a phone width of 0 or NaN leaves the value out and the row still renders', async () => {
  for (const phoneWidth of [0, Number.NaN]) {
    const m = await liveRow({ fixed: 1, width: 1280, phoneWidth });
    assert.equal(m.latest().minWorkspaceWidth, undefined, `phone ${phoneWidth}`);
  }
  assert.equal((await liveRow({ fixed: 1, width: 1280, phoneWidth: 390 })).latest().minWorkspaceWidth, 1234, 'control: a real phone width reports');
});
