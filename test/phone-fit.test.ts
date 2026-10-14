/**
 * The phone fit: `fitPhone`'s table and invariants, the margin that keeps a window jittering at a breakpoint from flipping the
 * count, and the default mount drawing the fitted size through `usePhoneSize`.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { PanelRow, Workspace, createWorkspace, definePanel, usePhoneFit, usePhoneSize, useProvidePanels, type WorkspaceHandle } from '../index.js';
import { createDefaultTheme } from '../defaultTheme.js';
import { HostProvider } from '../hostApi.js';
import { ThemeProvider } from '@mui/material/styles';
import { advanceFrames, mount } from './support/mount-harness.js';
import { fitPhone, PHONE_FIT_MARGIN, type PhoneFitInput } from '../phoneFit.js';
import { PHONE_FIT_MAX, PHONE_FIT_MIN } from '../rowConstants.js';
import { differential } from './support/differential.js';
import { resize, rigCleanup, slots, track, until, win } from './support/auto-rig.js';

afterEach(rigCleanup);

const GAP = 24;
const PREFERRED = { width: 390, height: 700 };
const base = (over: Partial<PhoneFitInput>): PhoneFitInput => ({ windowWidth: 1000, heightBudget: 900, rowCount: 1, preferred: PREFERRED, gap: GAP, edge: GAP, min: PHONE_FIT_MIN, max: PHONE_FIT_MAX, ...over });
/** The row's height budget for a window height: the container less the app's 96 px top inset and the bottom gap. */
const budgetOf = (windowHeight: number): number => windowHeight - 96 - GAP;
const fit = (windowWidth: number, windowHeight: number, over: Partial<PhoneFitInput> = {}) => fitPhone(base({ windowWidth, heightBudget: budgetOf(windowHeight), ...over }));
const drawn = (f: { count: number; width: number }): number => f.count * f.width + (f.count - 1) * GAP;

test('unmeasured: no count, and the preferred size back', () => {
  assert.deepEqual(fitPhone(base({ windowWidth: 0 })), { count: 0, width: 390, height: 700, heightCapped: false });
});

test('the table at the real phone height and gap 24: widths, counts and leftovers', () => {
  const rows = [
    [560, 900, 1, 434],
    [600, 900, 1, 434],
    [700, 900, 1, 434],
    [844, 900, 2, 386],
    [1280, 720, 3, 334],
    [1440, 900, 4, 330],
    [1728, 1117, 4, 402],
    [1920, 1080, 5, 355],
    [2560, 1440, 6, 398],
    [1024, 768, 2, 361],
  ] as const;
  for (const [w, h, count, width] of rows) {
    const f = fit(w, h);
    assert.deepEqual([f.count, f.width], [count, width], `${w}x${h}`);
    assert.equal(f.height, Math.round((f.width / 390) * 700), `${w}x${h}: the height follows the width`);
    assert.ok(drawn(f) <= w - 2 * GAP, `${w}x${h}: the slots fit the window`);
  }
  assert.equal(w(fit(1280, 720)), 182, '1280x720 leaves 182 px centred');
  function w(f: { count: number; width: number }): number {
    return 1280 - 2 * GAP - drawn(f);
  }
});

test('a window the height cap binds in: the minimum wins, with as many slots as fit, never one by default', () => {
  const short = fit(844, 390);
  assert.deepEqual([short.count, short.width, short.heightCapped], [2, 320, true]);
  assert.ok(short.height > budgetOf(390), 'the row scrolls vertically');
  assert.deepEqual([fit(1280, 650).count, fit(1280, 650).width], [3, 320]);
});

test('a window narrower than one minimum phone gets one slot at the minimum', () => {
  const f = fit(300, 900);
  assert.deepEqual([f.count, f.width], [1, 320]);
});

test('rowCount 2 gives each row half the height and one scale for both', () => {
  const one = fit(1440, 900);
  const two = fit(1440, 900, { rowCount: 2 });
  assert.ok(two.width < one.width || two.count > one.count, 'the shared scale shrinks, or more slots fit');
  assert.ok(two.height <= (budgetOf(900) - GAP) / 2 + 1 || two.width === 320, 'neither row is taller than its share');
});

test('invariants over every container width and height-budget class', () => {
  for (const height of [390, 650, 720, 900, 1117, 1440]) {
    for (let width = 300; width <= 3000; width += 1) {
      const f = fit(width, height);
      const room = width - 2 * GAP;
      assert.ok(f.count >= 1, `${width}x${height}: at least one slot`);
      assert.ok(Number.isInteger(f.width) && Number.isInteger(f.height), `${width}x${height}: whole pixels`);
      const minWidth = Math.ceil(PHONE_FIT_MIN * 390);
      assert.ok(f.width >= minWidth && f.width <= Math.floor(PHONE_FIT_MAX * 390), `${width}x${height}: the scale stays in the band, got ${f.width}`);
      if (room >= minWidth) assert.ok(drawn(f) <= room, `${width}x${height}: ${drawn(f)} fits ${room}`);
      else assert.equal(f.count, 1, `${width}x${height}: a window under one minimum phone has one slot`);
      const exact = Math.floor((room + GAP) / f.count) - GAP === f.width;
      if (exact) assert.ok(room - drawn(f) < f.count, `${width}x${height}: an exact fill leaves less than ${f.count} px`);
    }
  }
});

test('the width follows the band edge: a window holding still makes one count change at most', () => {
  let held = fit(704, 900);
  const counts = new Set<number>();
  for (const width of [711, 712, 711, 712, 713, 712, 711, 712, 711]) {
    held = fit(width, 900, { previousCount: held.count });
    counts.add(held.count);
  }
  assert.equal(counts.size, 1, 'jitter over the 2-slot breakpoint (712) flips nothing');
  assert.equal(fit(712, 900).count, 2, 'the same width with no history is the new count');
  assert.equal(fit(712, 900, { previousCount: 1 }).count, 1, 'a step up needs margin inside the band');
  const wide = fit(712 + 20, 900, { previousCount: 1 });
  assert.equal(wide.count, 2, 'and takes it once there is room');
  assert.ok(wide.width / 390 >= PHONE_FIT_MIN * (1 + PHONE_FIT_MARGIN));
  assert.equal(fit(711, 900, { previousCount: 2 }).count, 1, 'a count that left the band is not held');
});

test('the band, the cap and the whole pixels are each load-bearing', () => {
  assert.equal(fit(700, 900, { min: 0.9 }).count, 1, 'a higher minimum drops the 2-slot fit');
  assert.equal(fit(1000, 1117).width, 440);
  assert.equal(fit(1000, 1117, { max: 1.3 }).width, 464, 'a higher maximum lets the phone grow to the 2-slot fit');
  assert.notEqual(fit(1000, 600).width, fit(1000, 900).width, 'the height budget caps the phone');
  assert.equal(fit(1001, 900).width % 1, 0);
});

// ---------------------------------------------------------------------------
// The default mount
// ---------------------------------------------------------------------------

const widths: number[] = [];
const probe = definePanel({
  id: 'fit-probe',
  view: ({ handle }) => {
    const size = usePhoneSize();
    widths.push(size.width);
    return React.createElement('i', { 'data-slot': handle.id, 'data-phone': `${size.width}x${size.height}` });
  },
});

async function mounted(tuning: Parameters<typeof createWorkspace>[0], width: number, height: number): Promise<{ ws: WorkspaceHandle; slotWidth: () => number; phone: () => string }> {
  win.width = width;
  win.height = height;
  widths.length = 0;
  const ws = track(createWorkspace({ templates: [probe], ...tuning }));
  ws.addPanel('fit-probe');
  await until('the probe', () => slots(document.body).includes('fit-probe'));
  const slot = (): HTMLElement => document.querySelector('[data-row-slot]:has([data-phone])') as HTMLElement;
  return { ws, slotWidth: () => Number.parseFloat(slot().style.width), phone: () => document.querySelector<HTMLElement>('[data-phone]')!.dataset.phone! };
}

/** The slot width the default mount draws a panel at under `tuning`, observed on a real mount. */
async function drawnWidth(tuning: Record<string, unknown>, width: number, height: number): Promise<number> {
  const m = await mounted({ tuning }, width, height);
  const result = m.slotWidth();
  rigCleanup();
  return result;
}

test('differential tuning.phoneFit: the panel is drawn at the preferred width, or at the fitted one', async () => {
  const seen = { off: await drawnWidth({ phoneFit: 'off' }, 1000, 900), fit: await drawnWidth({ phoneFit: 'fit' }, 1000, 900) };
  differential('tuning.phoneFit', (run) => {
    for (const mode of ['off', 'fit'] as const) run(mode, () => seen[mode]);
  });
  assert.deepEqual(seen, { off: 390, fit: 440 });
});

test('differential tuning.phoneFitMin: a higher minimum drops the 2-slot fit for one wide slot', async () => {
  const seen = { low: await drawnWidth({ phoneFit: 'fit' }, 700, 1117), high: await drawnWidth({ phoneFit: 'fit', phoneFitMin: 0.9 }, 700, 1117) };
  differential('tuning.phoneFitMin', (run) => {
    run(0.82, () => seen.low);
    run(0.9, () => seen.high);
  });
  assert.deepEqual(seen, { low: 326, high: 440 });
});

test('differential tuning.phoneFitMax: a higher maximum lets the phone grow to the exact fit', async () => {
  const seen = { low: await drawnWidth({ phoneFit: 'fit' }, 1000, 1117), high: await drawnWidth({ phoneFit: 'fit', phoneFitMax: 1.3 }, 1000, 1117) };
  differential('tuning.phoneFitMax', (run) => {
    run(1.13, () => seen.low);
    run(1.3, () => seen.high);
  });
  assert.deepEqual(seen, { low: 440, high: 476 });
});

test('a reader of usePhoneSize sees what the slot draws, and device.size stays the preference', async () => {
  const m = await mounted({ tuning: { phoneFit: 'fit' } }, 1000, 1117);
  assert.equal(m.slotWidth(), 440);
  assert.equal(m.phone(), '440x790');
});

test('a resize holds the previous size until the width has settled, then draws the new fit', async () => {
  const m = await mounted({ tuning: { phoneFit: 'fit' } }, 1000, 1117);
  assert.equal(m.slotWidth(), 440);
  await resize(1400);
  assert.equal(m.slotWidth(), 440, 'held while the window is still moving');
  await until('the settled fit', () => m.slotWidth() !== 440);
  assert.equal(m.slotWidth(), 330, '4 slots of 330 fill 1400 (3 would need 445, over the cap)');
});

test('a hand-wired flow: usePhoneFit before useProvidePanels, the pair to Workspace, and every reader sees the fitted size', async () => {
  win.width = 1000;
  win.height = 1117;
  widths.length = 0;
  const hand = track(createWorkspace({ mount: false, templates: [probe], tuning: { phoneFit: 'fit' } }));
  hand.addPanel('fit-probe');
  const preferred = { width: 390, height: 700 };
  function HandWired(): React.ReactElement {
    const ref = React.useRef<HTMLDivElement>(null);
    const rowRef = React.useRef<HTMLDivElement>(null);
    const [width, setWidth] = React.useState(0);
    React.useLayoutEffect(() => setWidth(ref.current!.clientWidth), []);
    const phone = usePhoneFit(ref, width, preferred, hand.tuning);
    const provided = useProvidePanels({ workspace: hand, phoneWidth: phone.width, containerWidth: width, overflowContainerRef: ref });
    const row = React.createElement(PanelRow, { entries: provided.entries, rootId: hand.rootId, closingIds: provided.closingIds, enteringViaAnchorIds: provided.enteringViaAnchorIds, exitRightIds: provided.exitRightIds, enterSideById: provided.enterSideById, maxLiveWidth: provided.maxLiveWidth, tuning: provided.tuning, rowNumbers: provided.rowNumbers, workspace: hand });
    const shell = React.createElement(Workspace, { overflowContainerRef: ref, rowRef, containerWidth: width, phoneWidth: phone.width, phoneHeight: phone.height, fixedColumnCount: provided.fixedViewCount, liveWidths: provided.liveWidths, rowScroll: provided.rowScroll, rowNumbers: provided.rowNumbers, tuning: provided.tuning, children: row });
    return React.createElement(ThemeProvider, { theme: createDefaultTheme('light'), children: React.createElement(HostProvider, { host: { panels: provided }, children: shell }) });
  }
  mount(React.createElement(HandWired));
  await advanceFrames(400);
  assert.equal(document.querySelector<HTMLElement>('[data-phone]')?.dataset.phone, '440x790');
  const slot = document.querySelector('[data-row-slot]:has([data-phone])') as HTMLElement;
  assert.equal(slot.style.width, '440px', 'the slot is priced at the width the reader sees');
});

test('a Workspace given no phoneHeight publishes no phone size: usePhoneSize is the host device size', async () => {
  win.width = 1000;
  win.height = 1117;
  widths.length = 0;
  const hand = track(createWorkspace({ mount: false, templates: [probe] }));
  hand.addPanel('fit-probe');
  function HandWired(): React.ReactElement {
    const ref = React.useRef<HTMLDivElement>(null);
    const rowRef = React.useRef<HTMLDivElement>(null);
    const provided = useProvidePanels({ workspace: hand, phoneWidth: 390, containerWidth: 1000, overflowContainerRef: ref });
    const row = React.createElement(PanelRow, { entries: provided.entries, rootId: hand.rootId, closingIds: provided.closingIds, enteringViaAnchorIds: provided.enteringViaAnchorIds, exitRightIds: provided.exitRightIds, enterSideById: provided.enterSideById, maxLiveWidth: provided.maxLiveWidth, tuning: provided.tuning, rowNumbers: provided.rowNumbers, workspace: hand });
    const shell = React.createElement(Workspace, { overflowContainerRef: ref, rowRef, containerWidth: 1000, phoneWidth: 390, fixedColumnCount: provided.fixedViewCount, liveWidths: provided.liveWidths, rowScroll: provided.rowScroll, rowNumbers: provided.rowNumbers, tuning: provided.tuning, children: row });
    return React.createElement(ThemeProvider, { theme: createDefaultTheme('light'), children: React.createElement(HostProvider, { host: { panels: provided }, children: shell }) });
  }
  mount(React.createElement(HandWired));
  await advanceFrames(400);
  assert.equal(document.querySelector<HTMLElement>('[data-phone]')?.dataset.phone, '390x700');
});
