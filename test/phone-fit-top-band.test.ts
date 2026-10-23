/**
 * What the fit reads above the row inside a workspace column's cell: the column's top band, the host's `topInset` and the row
 * gap. Its height budget is the container less that top padding less the gap, so each part moves the count a window draws.
 * A bare `Panel` and `PanelFrame` outside a row slot are drawn at the size the workspace published, not at a fixed 390.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { COLUMN_TOP_BAND, createWorkspaceColumn, definePanel, Panel, PanelFrame, usePhoneSize, Workspace } from '../index.js';
import type { WorkspaceColumnHandle } from '../index.js';
import { createDefaultTheme, muiThemeFor } from '../defaultTheme.js';
import { HostProvider } from '../hostApi.js';
import { ThemeProvider } from '@mui/material/styles';
import { mount } from './support/mount-harness.js';
import { fitPhone } from '../phoneFit.js';
import { PHONE_FIT_MAX, PHONE_FIT_MIN } from '../rowConstants.js';
import { rigCleanup, until, win } from './support/auto-rig.js';

const columns: WorkspaceColumnHandle[] = [];
afterEach(() => {
  for (const c of columns.splice(0)) act(() => c.dispose());
  rigCleanup();
});

const GAP = 24;
const PREFERRED = { width: 390, height: 700 };
const probe = definePanel({
  id: 'probe',
  settings: {},
  view: ({ handle }) => {
    const size = usePhoneSize();
    return React.createElement('i', { 'data-slot': handle.id, 'data-phone': `${size.width}x${size.height}` });
  },
});

/** The fit for a window, priced as the plan states: the container less (band + inset + gap) less the bottom gap. `padding` replaces that top padding where a test prices a mutated join. */
const fitAt = (windowHeight: number, padding: number) =>
  fitPhone({ windowWidth: 1800, heightBudget: windowHeight - padding - GAP, rowCount: 1, preferred: PREFERRED, gap: GAP, edge: GAP, min: PHONE_FIT_MIN, max: PHONE_FIT_MAX });
const expected = (windowHeight: number, inset: number) => fitAt(windowHeight, COLUMN_TOP_BAND + inset + GAP);
const size = (f: { width: number; height: number }): string => `${f.width}x${f.height}`;

/** What one column cell draws a panel at in a 1800 px window `height` high; the window is stubbed before the mount, so the first measurement applies at once. */
async function drawnIn(height: number, inset: number): Promise<string> {
  win.width = 1800;
  win.height = height;
  const column = createWorkspaceColumn({ topInset: inset, templates: [probe], tuning: { rowGap: GAP, phoneFit: 'fit' } });
  columns.push(column);
  const ws = column.addWorkspace();
  ws.addPanel('probe');
  const phone = (): string | undefined => document.querySelector<HTMLElement>('[data-phone]')?.dataset.phone;
  await until('the fit', () => phone() !== undefined && phone() !== '390x700');
  await new Promise((r) => setTimeout(r, 50));
  return phone()!;
}

test('inside a column cell the band is in the fit\'s top padding: at 860 px the budget is 736 and 5 slots draw, where a fit that ignored the band (812) would draw 4', async () => {
  const want = expected(860, 0);
  assert.equal(want.count, 5);
  assert.equal(fitAt(860, GAP).count, 4, 'the same window priced without the band draws 4, so the band is load-bearing here');
  assert.equal(await drawnIn(860, 0), size(want));
  assert.equal(size(want), '331x594');
});

test('inside a column cell the topInset is in the fit\'s top padding: at 900 px 0 draws 4 slots and 32 draws 5', async () => {
  const bare = expected(900, 0);
  const inset = expected(900, 32);
  assert.deepEqual([bare.count, inset.count], [4, 5], 'the two insets draw different counts');
  assert.equal(await drawnIn(900, 0), size(bare));
  rigCleanup();
  assert.equal(await drawnIn(900, 32), size(inset));
  assert.deepEqual([size(bare), size(inset)], ['420x754', '331x594']);
});

const Bare = ({ sized }: { sized: 'panel' | 'frame' }): React.ReactElement =>
  sized === 'panel'
    ? React.createElement(Panel, { 'data-bare': '', title: 't' } as never)
    : React.createElement(PanelFrame, { 'data-bare': '' } as never);

function BareWorkspace({ sized }: { sized: 'panel' | 'frame' }): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);
  return React.createElement(Workspace, { overflowContainerRef: ref, rowRef, containerWidth: 1000, phoneWidth: 434, phoneHeight: 780, fixedColumnCount: 0, liveWidths: [], children: React.createElement(Bare, { sized }) });
}

/** A bare Panel or PanelFrame under a Workspace given a fitted size (434 x 780) that is neither the preference nor the host's device.size. */
async function bareSize(sized: 'panel' | 'frame'): Promise<{ width: string; height: string }> {
  const host = { device: { size: { modelId: 'x', width: 300, height: 600 } } } as never;
  await mount(
    React.createElement(
      ThemeProvider,
      { theme: muiThemeFor(createDefaultTheme('light')) },
      React.createElement(HostProvider, { host, children: React.createElement(BareWorkspace, { sized }) }),
    ),
  );
  const el = document.querySelector<HTMLElement>('[data-bare]')!;
  return { width: getComputedStyle(el).width, height: getComputedStyle(el).height };
}

test('a bare Panel outside a row slot is drawn at the width the Workspace published, not 390 or the device size 300', async () => {
  assert.equal((await bareSize('panel')).width, '434px');
});

test('a bare PanelFrame outside a row slot is drawn at the size the Workspace published, width and height', async () => {
  assert.deepEqual(await bareSize('frame'), { width: '434px', height: '780px' });
});
