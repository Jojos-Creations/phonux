/**
 * rowShellStyle (client/src/desktop/row/useRowShell.ts): the PURE half of the row shell, step 18. It turns the measured
 * widths and the settings into the three values the front page's markup reads. The mount tests
 * (goal-front-page-row-shell.test.ts, RS3-RS5, RS14) pin the same behaviour through the whole page in jsdom; these
 * pin the function itself with plain data, so a wrong input (a hard-coded phone width, a parked panel counted as live,
 * a swapped flag) fails here by name. No DOM, no React: the function is not a hook.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowShellStyle, type RowShellStyleInput } from '../client/src/desktop/row/useRowShell.js';
import { PANEL_TRANSITION } from '../client/src/desktop/panels/LivePanelSlot.js';

const base: RowShellStyleInput = {
  shell: { containerWidth: 1300, rowOverflowSettled: false, rowResizeSettled: false },
  phoneWidth: 390,
  fixedColumnCount: 2,
  liveCount: 0,
  maxViewsMode: 'screen-width',
  autoCollapse: true,
};
const withShell = (shell: Partial<RowShellStyleInput['shell']>): RowShellStyleInput => ({ ...base, shell: { ...base.shell, ...shell } });

test('rowShellStyle: the margin snaps (duration 0) until the container width has settled, then glides with the panels\' own transition', () => {
  assert.deepEqual(rowShellStyle(withShell({ rowResizeSettled: false })).transition, { duration: 0 });
  assert.equal(rowShellStyle(withShell({ rowResizeSettled: true })).transition, PANEL_TRANSITION, 'the very same transition the panels slide with, so the row and a panel read as one motion');
  // the overflow flag is a different clock: it must not decide the transition
  assert.deepEqual(rowShellStyle(withShell({ rowResizeSettled: false, rowOverflowSettled: true })).transition, { duration: 0 });
  assert.equal(rowShellStyle(withShell({ rowResizeSettled: true, rowOverflowSettled: false })).transition, PANEL_TRANSITION);
});

test('rowShellStyle: the scrollbar rule over every combination of mode, auto-collapse and a settled overflow', () => {
  // expected, written out (not derived): 'use window width' hides the bar exactly when auto-collapse is on (the reactive net guarantees the row
  // settles back to fitting), and ignores the overflow clock; count mode hides it until an overflow has lasted, and ignores auto-collapse.
  const table: Array<[mode: 'screen-width' | 'count', autoCollapse: boolean, overflowSettled: boolean, expected: 'hidden' | 'auto']> = [
    ['screen-width', true, false, 'hidden'],
    ['screen-width', true, true, 'hidden'],
    ['screen-width', false, false, 'auto'],
    ['screen-width', false, true, 'auto'],
    ['count', true, false, 'hidden'],
    ['count', true, true, 'auto'],
    ['count', false, false, 'hidden'],
    ['count', false, true, 'auto'],
  ];
  for (const [mode, autoCollapse, overflowSettled, expected] of table) {
    const got = rowShellStyle({ ...withShell({ rowOverflowSettled: overflowSettled }), maxViewsMode: mode, autoCollapse }).overflowX;
    assert.equal(got, expected, `${mode}, auto-collapse ${autoCollapse}, overflow settled ${overflowSettled}`);
  }
});

test('rowShellStyle: the margin centres the columns and LIVE panels it is given, at the phone width it is given (390 and 430, two columns and one, a parked panel not counted)', () => {
  const margin = (over: Partial<RowShellStyleInput>): number => rowShellStyle({ ...base, ...over }).marginLeft;
  // (containerWidth - 2*16 - (n*w + (n-1)*16)) / 2 with room for no live panel
  assert.equal(margin({}), 236, '2 columns of 390 in 1300');
  assert.equal(margin({ phoneWidth: 430 }), 196, '2 columns of 430 in 1300: a hard-coded 390 would say 236');
  assert.equal(margin({ fixedColumnCount: 1 }), 439, 'Settings hidden: one column, half a column further right');
  // room for two live panels beside two columns (RS3b / RS14d): every live panel moves the row, up to what fits
  const wide = { shell: { ...base.shell, containerWidth: 2100 } };
  assert.equal(margin({ ...wide, liveCount: 2 }), 230, '(2068 - (796 + 2*406)) / 2');
  assert.equal(margin({ ...wide, liveCount: 3 }), 27, 'the same room with a third LIVE panel: a parked one must not be passed as live (RS14d)');
  assert.equal(margin({ ...wide, liveCount: 9 }), 27, 'never more than fit: the margin stops at what the container holds, and never goes negative');
  assert.equal(margin({ shell: { ...base.shell, containerWidth: 0 } }), 0, 'before the first measurement');
});
