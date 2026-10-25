/**
 * The phone fit prices the row's height from the same reserve under the frames that Workspace pads with: the footer's room,
 * or the row gap when that is more. It is the same in every theme.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createDefaultTheme, createWorkspace, definePanel, usePhoneSize, type PhonuxTheme } from '../index.js';
import { FOOTER_ROOM_PX } from '../panelChromeSize.js';
import { advanceFrames } from './support/mount-harness.js';
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

async function autoMounted(opts: { theme?: PhonuxTheme; rowGap?: number }): Promise<void> {
  win.width = 1000;
  win.height = WINDOW_HEIGHT;
  const ws = track(createWorkspace({ templates: [probe], tuning: { phoneFit: 'fit', rowGap: opts.rowGap ?? GAP }, ...(opts.theme === undefined ? {} : { theme: () => opts.theme! }) }));
  ws.addPanel('reserve-probe');
  await until('the probe', () => slots(document.body).includes('reserve-probe'));
  await advanceFrames(400);
}

test('the default mount: the phone fills the window less the top inset and the reserve, which is also the scroller padding', async () => {
  await autoMounted({});
  assert.equal(padBottom(), 40);
  assertFills(phoneHeight(), WINDOW_HEIGHT - TOP - 40, 'priced from the reserve, not from the row gap');
});

test('the row height Workspace publishes is the window less the top padding and the reserve', async () => {
  await autoMounted({});
  assert.equal(Number(document.querySelector<HTMLElement>('[data-row-height]')!.dataset.rowHeight), WINDOW_HEIGHT - TOP - 40);
});

test('a row gap wider than the footer room is the reserve', async () => {
  await autoMounted({ rowGap: 60 });
  assert.equal(padBottom(), 60);
  assertFills(phoneHeight(), WINDOW_HEIGHT - 60 - 60, 'reserve from the wide gap, not the footer room');
});

test('a mount theme with another corner radius: the reserve is 40 for the fit and the scroller padding alike', async () => {
  const theme = { ...createDefaultTheme('light'), radiusUnitPx: 6 };
  await autoMounted({ theme });
  assert.equal(padBottom(), 40);
  assertFills(phoneHeight(), WINDOW_HEIGHT - TOP - 40, 'the fit reserve is the padding');
});

test('a live row gap change re-fits the phone to the new reserve', async () => {
  win.width = 1000;
  win.height = WINDOW_HEIGHT;
  const ws = track(createWorkspace({ templates: [probe], topInset: TOP, tuning: { phoneFit: 'fit', rowGap: GAP } }));
  ws.addPanel('reserve-probe');
  await until('the probe', () => slots(document.body).includes('reserve-probe'));
  await until('the first fit', () => phoneHeight() > 0 && phoneHeight() >= WINDOW_HEIGHT - TOP - FOOTER_ROOM_PX - 2);
  assertFills(phoneHeight(), WINDOW_HEIGHT - TOP - FOOTER_ROOM_PX, 'gap under the footer room');
  act(() => ws.panels.configureTuning({ rowGap: 60 }));
  await until('the re-fit', () => phoneHeight() < 640);
  await advanceFrames(1000);
  assert.ok(phoneHeight() <= WINDOW_HEIGHT - TOP - 60, `the wider gap is the reserve: ${phoneHeight()} against ${WINDOW_HEIGHT - TOP - 60}`);
  assert.equal(padBottom(), 60);
});

test('under phoneHeight auto the frame is never shorter than the fit, even when the row room is shorter', async () => {
  win.width = 1300;
  win.height = 700;
  const drawn = async (phoneHeightMode: 'fit' | 'auto'): Promise<number> => {
    win.width = 1300;
    win.height = WINDOW_HEIGHT;
    const ws = track(createWorkspace({ templates: [probe], tuning: { phoneFit: 'fit', rowGap: GAP, rowTop: 162, phoneHeight: phoneHeightMode } }));
    ws.addPanel('reserve-probe');
    await until('the probe', () => slots(document.body).includes('reserve-probe'));
    await until('the first fit', () => phoneHeight() > 0);
    await advanceFrames(1000);
    const height = phoneHeight();
    rigCleanup();
    return height;
  };
  const fit = await drawn('fit');
  const room = WINDOW_HEIGHT - 162 - 40;
  assert.ok(room < fit, `the row room ${room} is shorter than the fit ${fit}, so the floor binds`);
  assert.equal(await drawn('auto'), fit, 'auto draws the fit, not the shorter room');
});
