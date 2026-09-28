/**
 * workspaceShellStyle (client/src/desktop/row/useRowShell.ts): the PURE half of the row shell. It turns the measured
 * widths into the values the front page's markup reads (there is no scrollbar: `overflowX` is always
 * 'hidden'). The mount tests (goal-front-page-row-shell.test.ts, RS3-RS4,
 * RS14) pin the same behaviour through the whole page in jsdom; these pin the function itself with plain
 * data, so a wrong input (a hard-coded phone width, a parked panel counted as live) fails here by name. No
 * DOM, no React: the function is not a hook.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceShellStyle, type WorkspaceShellStyleInput } from '../client/src/desktop/row/useRowShell.js';
import { PANEL_TRANSITION } from 'phonux';

const base: WorkspaceShellStyleInput = {
  shell: { containerWidth: 1300, rowResizeSettled: false },
  phoneWidth: 390,
  // History alone: Settings toggles inside its body rather than adding a second fixed column, so this is
  // never more than 1 in the real app.
  fixedColumnCount: 1,
  liveWidths: [],
};
const phones = (n: number): number[] => Array.from({ length: n }, () => 390);
const withShell = (shell: Partial<WorkspaceShellStyleInput['shell']>): WorkspaceShellStyleInput => ({ ...base, shell: { ...base.shell, ...shell } });

test('workspaceShellStyle: overflowX is always "hidden" -- there is no scrollbar, whatever the inputs', () => {
  assert.equal(workspaceShellStyle(base).overflowX, 'hidden');
  assert.equal(workspaceShellStyle({ ...base, liveWidths: phones(9) }).overflowX, 'hidden');
  assert.equal(workspaceShellStyle(withShell({ containerWidth: 0 })).overflowX, 'hidden');
});

test('workspaceShellStyle: the margin snaps (duration 0) until the container width has settled, then glides with the panels\' own transition', () => {
  assert.deepEqual(workspaceShellStyle(withShell({ rowResizeSettled: false })).transition, { duration: 0 });
  assert.equal(workspaceShellStyle(withShell({ rowResizeSettled: true })).transition, PANEL_TRANSITION, 'the very same transition the panels slide with, so the row and a panel read as one motion');
});

test('workspaceShellStyle: the margin centres the column and LIVE panels it is given, at the phone width it is given (390 and 430, a parked panel not counted)', () => {
  const margin = (over: Partial<WorkspaceShellStyleInput>): number => workspaceShellStyle({ ...base, ...over }).marginLeft;
  // (containerWidth - 2*16 - (n*w + (n-1)*16)) / 2 with room for no live panel
  assert.equal(margin({}), 439, '1 column of 390 in 1300');
  assert.equal(margin({ phoneWidth: 430 }), 419, '1 column of 430 in 1300: a hard-coded 390 would say 439');
  // room for live panels beside the one column (RS3b / RS14d): every live panel moves the row, up to what fits
  const wide = { shell: { ...base.shell, containerWidth: 2100 } };
  assert.equal(margin({ ...wide, liveWidths: phones(2) }), 433, '(2068 - (390 + 2*406)) / 2');
  assert.equal(margin({ ...wide, liveWidths: phones(4) }), 27, 'a fourth LIVE panel fills the row exactly: fixed 390 + 4*406 = 2014 inside 2068');
  assert.equal(margin({ ...wide, liveWidths: phones(9) }), 27, 'never more than fit: the margin stops at what the container holds, and never goes negative -- a parked one must not be passed as live (RS14d)');
  assert.equal(margin({ shell: { ...base.shell, containerWidth: 0 } }), 0, 'before the first measurement');
});

test('workspaceShellStyle E3/E4: a fractional pixel of margin is kept exactly, never rounded or truncated (an odd container width centres on a half pixel)', () => {
  // Every other case here and in RS3/RS14d lands on a whole pixel, so a stray `Math.round` or `Math.floor` would pass them all; 1301 (one
  // wider than the usual 1300) is the smallest change that lands the centring on a half pixel: (1301 - 2*16 - 390) / 2 = 439.5.
  const margin = (over: Partial<WorkspaceShellStyleInput>): number => workspaceShellStyle({ ...base, ...over }).marginLeft;
  assert.equal(margin({ shell: { ...base.shell, containerWidth: 1301 } }), 439.5, 'a whole pixel of drift either way (439 or 440) would be a rounding bug, not measurement noise');
});

test('workspaceShellStyle: a live panel wider than a phone centres by its OWN width -- a tablet among phones moves the margin exactly as computeRowLayout sums it, never as a count of phones', () => {
  const margin = (over: Partial<WorkspaceShellStyleInput>): number => workspaceShellStyle({ ...base, ...over }).marginLeft;
  const wide = { shell: { ...base.shell, containerWidth: 2100 } };
  // (2068 - (390 + 784 + 406)) / 2 = 244; counting two phones instead gives (2068 - (390 + 812)) / 2 = 433.
  assert.equal(margin({ ...wide, liveWidths: [768, 390] }), 244, 'a tablet (768) and a phone');
  assert.notEqual(margin({ ...wide, liveWidths: [768, 390] }), margin({ ...wide, liveWidths: phones(2) }), 'the same COUNT of panels, a different margin');
  assert.equal(margin({ ...wide, liveWidths: [1200] }), (2068 - (390 + 1216)) / 2, 'a desktop panel alone');
});
