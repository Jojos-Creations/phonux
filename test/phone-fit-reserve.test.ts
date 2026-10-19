/**
 * The phone fit prices the row's height from the same reserve under the frames that Workspace pads with: the footer's room,
 * or the row gap when that is more, read from the theme the mount draws with.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createTheme, ThemeProvider, type Theme } from '@mui/material/styles';
import { PanelRow, Workspace, createWorkspace, definePanel, usePhoneFit, usePhoneSize, useProvidePanels } from '../index.js';
import { HostProvider } from '../hostApi.js';
import { rowBottomReservePx } from '../panelChromeSize.js';
import { advanceFrames, mount } from './support/mount-harness.js';
import { RowHeightContext } from '../panelTuning.js';
import { rigCleanup, slots, track, until, win } from './support/auto-rig.js';

afterEach(rigCleanup);

const probe = definePanel({
  id: 'reserve-probe',
  view: ({ handle }) => {
    const size = usePhoneSize();
    const rowHeight = React.useContext(RowHeightContext);
    return React.createElement('i', { 'data-slot': handle.id, 'data-phone': `${size.width}x${size.height}`, 'data-row-height': rowHeight });
  },
});

const phoneHeight = (): number => Number(document.querySelector<HTMLElement>('[data-phone]')!.dataset.phone!.split('x')[1]);
const padBottom = (): number => Number.parseFloat(getComputedStyle(document.querySelector('[data-row-scroller]')!).paddingBottom);
const GAP = 16;
const TOP = GAP;
/** The fitted height is the width-quantized phone, so it falls at most 2 px short of the budget and never over. */
const assertFills = (actual: number, budget: number, what: string): void => assert.ok(actual <= budget && actual > budget - 2, `${what}: ${actual} against a budget of ${budget}`);
const WINDOW_HEIGHT = 700;

async function autoMounted(opts: { theme?: Theme; rowGap?: number }): Promise<void> {
  win.width = 1000;
  win.height = WINDOW_HEIGHT;
  const ws = track(createWorkspace({ templates: [probe], tuning: { phoneFit: 'fit', rowGap: opts.rowGap ?? GAP }, ...(opts.theme === undefined ? {} : { theme: () => opts.theme! }) }));
  ws.addPanel('reserve-probe');
  await until('the probe', () => slots(document.body).includes('reserve-probe'));
  await advanceFrames(400);
}

test('the default mount: the phone fills the window less the top inset and the reserve, which is also the scroller padding', async () => {
  await autoMounted({});
  const reserve = rowBottomReservePx(createTheme(), GAP);
  assert.equal(padBottom(), reserve);
  assertFills(phoneHeight(), WINDOW_HEIGHT - TOP - reserve, 'priced from the reserve, not from the row gap');
});

test('the row height Workspace publishes is the window less the top padding and the reserve', async () => {
  await autoMounted({});
  assert.equal(Number(document.querySelector<HTMLElement>('[data-row-height]')!.dataset.rowHeight), WINDOW_HEIGHT - TOP - rowBottomReservePx(createTheme(), GAP));
});

test('a row gap wider than the footer room is the reserve', async () => {
  await autoMounted({ rowGap: 60 });
  assert.equal(padBottom(), 60);
  assertFills(phoneHeight(), WINDOW_HEIGHT - 60 - 60, 'reserve from the wide gap, not the footer room');
});

test('a mount theme with another corner radius: the fit reserve is the scroller padding, one theme for both', async () => {
  const theme = createTheme({ shape: { borderRadius: 6 } });
  await autoMounted({ theme });
  const reserve = rowBottomReservePx(theme, GAP);
  assert.notEqual(reserve, rowBottomReservePx(createTheme(), GAP), 'the theme changes the reserve');
  assert.equal(padBottom(), reserve);
  assertFills(phoneHeight(), WINDOW_HEIGHT - TOP - reserve, 'the mount theme prices the fit');
});

test('a hand-wired fit re-measures when the theme changes the reserve and nothing else changes', async () => {
  win.width = 1000;
  win.height = WINDOW_HEIGHT;
  const hand = track(createWorkspace({ mount: false, templates: [probe], tuning: { phoneFit: 'fit', rowGap: GAP } }));
  hand.addPanel('reserve-probe');
  let setTheme: (t: Theme) => void = () => undefined;
  function Inner(): React.ReactElement {
    const ref = React.useRef<HTMLDivElement>(null);
    const rowRef = React.useRef<HTMLDivElement>(null);
    const [width, setWidth] = React.useState(0);
    React.useLayoutEffect(() => setWidth(ref.current!.clientWidth), []);
    const phone = usePhoneFit(ref, width, { width: 390, height: 700 }, hand.tuning, TOP);
    const provided = useProvidePanels({ workspace: hand, phoneWidth: phone.width, containerWidth: width, overflowContainerRef: ref });
    const row = React.createElement(PanelRow, { entries: provided.entries, rootId: hand.rootId, closingIds: provided.closingIds, enteringViaAnchorIds: provided.enteringViaAnchorIds, exitRightIds: provided.exitRightIds, enterSideById: provided.enterSideById, maxLiveWidth: provided.maxLiveWidth, rowNumbers: provided.rowNumbers, workspace: hand });
    const shell = React.createElement(Workspace, { overflowContainerRef: ref, rowRef, containerWidth: width, phoneWidth: phone.width, phoneHeight: phone.height, topPadding: TOP, fixedColumnCount: provided.fixedViewCount, liveWidths: provided.liveWidths, rowScroll: provided.rowScroll, rowNumbers: provided.rowNumbers, workspace: hand, children: row });
    return React.createElement(HostProvider, { host: { panels: provided }, children: shell });
  }
  function Outer(): React.ReactElement {
    const [theme, set] = React.useState(() => createTheme());
    setTheme = set;
    return React.createElement(ThemeProvider, { theme, children: React.createElement(Inner) });
  }
  mount(React.createElement(Outer));
  await advanceFrames(400);
  assertFills(phoneHeight(), WINDOW_HEIGHT - TOP - rowBottomReservePx(createTheme(), GAP), 'first theme');
  const wide = createTheme({ shape: { borderRadius: 9 } });
  await act(async () => setTheme(wide));
  await until('the re-fit', () => phoneHeight() < 640);
  assert.equal(padBottom(), rowBottomReservePx(wide, GAP));
  assertFills(phoneHeight(), WINDOW_HEIGHT - TOP - rowBottomReservePx(wide, GAP), 'after the theme change');
});
