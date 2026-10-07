/**
 * Whether a panel reads as pinned: a pure function of its entry, the row and the `pinning` definition, so a drag that
 * moves it, or re-anchors every entry to the root, changes the answer only when the place itself changes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPinned } from '../panelPin.js';
import type { Pinning } from '../panelSettings.js';
import { resolvePanelSettings } from '../panelSettings.js';
import type { PanelWindow } from '../panelWindow.js';

const ROOT = 'root';
const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({ id, url: '', title: id, live: true, locked: false, view: id, collapsible: true, listed: true, key: id, ...over });
const rootEntry = (): PanelWindow => entry(ROOT, { marker: true });
const settingsOf = (parkable: boolean): PanelWindow['settings'] => resolvePanelSettings({ template: { parkable } }).value;

const BY_PLACE: Pinning = { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } };
const BY_PARKABLE: Pinning = { pinned: { parkable: false }, unpinned: { parkable: true } };
const BOTH: Pinning = { pinned: { placement: 'row-start', parkable: false }, unpinned: { placement: 'row-end', parkable: true } };
const EMPTY: Pinning = { pinned: {}, unpinned: {} };

test('(B) row-start and row-end: pinned exactly when the panel sits left of the root', () => {
  const left = entry('l');
  const right = entry('r');
  const row = [left, rootEntry(), right];
  assert.equal(isPinned(left, row, BY_PLACE, ROOT), true);
  assert.equal(isPinned(right, row, BY_PLACE, ROOT), false);
});

test('(B) reads the anchor first: an entry anchored right of the root is not pinned even if the array puts it left', () => {
  const odd = entry('odd', { anchor: { panel: ROOT, position: 'right', priority: 0 } });
  assert.equal(isPinned(odd, [odd, rootEntry()], BY_PLACE, ROOT), false);
  const anchoredLeft = entry('al', { anchor: { panel: ROOT, position: 'left', priority: 0 } });
  assert.equal(isPinned(anchoredLeft, [rootEntry(), anchoredLeft], BY_PLACE, ROOT), true);
});

test('(B) a panel left of the root but anchored to another panel is not pinned', () => {
  const far = entry('far', { anchor: { panel: 'other', position: 'left', priority: 0 } });
  assert.equal(isPinned(far, [far, rootEntry()], BY_PLACE, ROOT), false);
});

test('(A) parkable in both halves is read by the resolved parkable, wherever the panel sits', () => {
  const pinned = entry('p', { settings: settingsOf(false) });
  const free = entry('f', { settings: settingsOf(true) });
  const row = [rootEntry(), pinned, free];
  assert.equal(isPinned(pinned, row, BY_PARKABLE, ROOT), true, 'right of the root and still pinned');
  assert.equal(isPinned(free, row, BY_PARKABLE, ROOT), false);
});

test('(A) does not read the placement of its half', () => {
  const half: Pinning = { pinned: { parkable: false, placement: 'row-start' }, unpinned: { parkable: true, placement: 'after-fixed' } };
  const e = entry('x', { settings: settingsOf(false) });
  assert.equal(isPinned(e, [rootEntry(), e], BY_PARKABLE, ROOT), true);
  assert.equal(isPinned(e, [rootEntry(), e], half, ROOT), false, 'a definition that names placement is also read by place');
});

test('(A) with a named place in only one half is still read by parkable alone, wherever the panel sits', () => {
  const half: Pinning = { pinned: { parkable: false, placement: 'row-start' }, unpinned: { parkable: true } };
  const e = entry('x', { settings: settingsOf(false) });
  assert.equal(isPinned(e, [rootEntry(), e], half, ROOT), true, 'right of the root and pinned by parkable');
});

test('a definition with both readings needs both to hold', () => {
  const both = entry('b', { settings: settingsOf(false) });
  const notParkable = entry('c', { settings: settingsOf(true) });
  assert.equal(isPinned(both, [both, rootEntry()], BOTH, ROOT), true);
  assert.equal(isPinned(both, [rootEntry(), both], BOTH, ROOT), false, 'right of the root');
  assert.equal(isPinned(notParkable, [notParkable, rootEntry()], BOTH, ROOT), false, 'parkable');
});

test('an empty definition, one with the same value in both halves, and one naming other places read false', () => {
  const e = entry('e');
  const row = [e, rootEntry()];
  assert.equal(isPinned(e, row, EMPTY, ROOT), false);
  assert.equal(isPinned(e, row, { pinned: { parkable: true }, unpinned: { parkable: true } }, ROOT), false);
  assert.equal(isPinned(e, row, { pinned: { placement: 'row-end' }, unpinned: { placement: 'row-start' } }, ROOT), false);
});

test('the root itself is never pinned', () => {
  const r = rootEntry();
  assert.equal(isPinned(r, [r], BY_PLACE, ROOT), false);
});

test('rootId omitted: the marker, else the entry with no anchor, is the root', () => {
  const left = entry('l');
  assert.equal(isPinned(left, [left, rootEntry()], BY_PLACE), true);
  const plainRoot = entry('top');
  const kid = entry('kid', { anchor: { panel: 'top', position: 'left', priority: 0 } });
  assert.equal(isPinned(kid, [kid, plainRoot], BY_PLACE), true);
});

test('a drag that re-anchors every entry to the root leaves a place-pinned panel pinned', () => {
  const left = entry('l', { anchor: { panel: ROOT, position: 'left', priority: 0 } });
  const right = entry('r', { anchor: { panel: ROOT, position: 'right', priority: 0 } });
  assert.equal(isPinned(left, [left, rootEntry(), right], BY_PLACE, ROOT), true);
  assert.equal(isPinned(right, [left, rootEntry(), right], BY_PLACE, ROOT), false);
});
