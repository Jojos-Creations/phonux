/**
 * Spaces side by side: the split arithmetic (a 2560 px window of 390 px phones and 16 px gaps holds six slots, which divide as
 * 2 of 3, 3 of 2 or 6 of 1), the refusals, the order a narrowing window gives room up in, the saved record and its version 1
 * reading, the keys that step and focus, and the divider's keyboard. Rendered layout is in side-by-side-rendered.test.ts.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { createWorkspaceColumn } from '../index.js';
import type { ColumnState, ColumnStorage, WorkspaceColumnHandle } from '../index.js';
import { columnCoreOf } from '../columnHandle.js';
import { dividerRange, evenRows, minRowSlots, planSides, shiftDivider, splitProblem, type SideSpace } from '../columnSplit.js';
import { keyBelongsToRow } from '../rowStep.js';
import { rigCleanup, until } from './support/auto-rig.js';

const columns: WorkspaceColumnHandle[] = [];
afterEach(() => {
  for (const c of columns.splice(0)) act(() => c.dispose());
  rigCleanup();
});

/** A column with `n` workspaces that nothing draws, measured as a window `px` wide. */
function column(n: number, px = 2560, o: Parameters<typeof createWorkspaceColumn>[0] = {}): WorkspaceColumnHandle {
  const c = createWorkspaceColumn({ mount: false, sideBySide: true, ...o });
  columns.push(c);
  for (let k = 0; k < n; k += 1) c.addWorkspace();
  columnCoreOf(c).setWindowWidth(px, 390);
  return c;
}
const view = (c: WorkspaceColumnHandle): string => c.shown.map((s) => `${s.workspace.name} ${s.slots}/${s.rowSlots}`).join(', ');
const measure = (c: WorkspaceColumnHandle, px: number): void => columnCoreOf(c).setWindowWidth(px, 390);

test('the window holds whole slots: one phone and one gap each, less one gap at the end', () => {
  const slotsAt = (px: number): number => column(1, px).shown[0]!.slots;
  assert.deepEqual([390, 1280, 1920, 2240, 2560, 3440, 3840, 5120].map(slotsAt), [1, 3, 4, 5, 6, 8, 9, 12]);
  assert.equal(column(1, 0).shown[0]!.slots, 0, 'an unmeasured window holds none, and the current space is still the one shown');
});

/** Adds a side at the right end, first giving the current space every row slot the others do not need, since a side takes its room from it. */
function addSide(c: WorkspaceColumnHandle, index: number): void {
  const others = c.shown.length - 1;
  c.setSplit(c.shown.map((_, k) => (k === 0 ? 6 - others : 1)));
  assert.deepEqual(c.showSide(index, { at: c.shown.length }), { ok: true }, `side ${index + 1}`);
}

test('six slots divide as 2 of 3, 3 of 2 or 6 of 1, and the split is whatever setSplit gave', () => {
  const c = column(6);
  assert.equal(view(c), 'Space 1 6/6');
  assert.deepEqual(c.showSide(1), { ok: true });
  assert.equal(view(c), 'Space 1 3/3, Space 2 3/3', 'a new side takes half of the current one');
  assert.deepEqual(c.showSide(2, { at: 2 }), { ok: true });
  assert.deepEqual(c.setSplit([2, 2, 2]), { ok: true });
  assert.equal(view(c), 'Space 1 2/2, Space 2 2/2, Space 3 2/2', '3 of 2');
  const six = column(6);
  for (const k of [1, 2, 3, 4, 5]) addSide(six, k);
  assert.equal(six.shown.length, 6, '6 of 1: every slot is a space of its own');
  assert.ok(six.shown.every((s) => s.slots === 1 && s.rowSlots === 1));
  const two = column(6);
  two.showSide(1);
  two.setSplit([2, 4]);
  assert.equal(view(two), 'Space 1 2/2, Space 2 4/4', '2 of 3 as a split of 2 and 4');
  two.setSplit([3, 3]);
  assert.equal(view(two), 'Space 1 3/3, Space 2 3/3');
});

test('a seventh space does not fit six slots', () => {
  const c = column(7);
  for (const k of [1, 2, 3, 4, 5]) addSide(c, k);
  const refused = c.showSide(6);
  assert.equal(refused.ok, false);
  assert.equal((refused as { code: string }).code, 'no-room', 'the current side has one row slot and cannot give one up');
  assert.equal(c.shown.length, 6);
});

test('showSide takes its room from the current space, at the place asked, and answers instead of throwing', () => {
  const c = column(3);
  assert.deepEqual(c.showSide(c.workspaces[2]!, { at: 0 }), { ok: true });
  assert.deepEqual(c.shown.map((s) => s.workspace.name), ['Space 3', 'Space 1'], 'at 0 is left of everything');
  assert.equal(view(c), 'Space 3 3/3, Space 1 3/3');
  assert.equal((c.showSide(c.workspaces[2]!) as { code: string }).code, 'already-shown');
  assert.equal((c.showSide(9) as { code: string }).code, 'unknown-workspace');
  assert.equal((c.showSide(Number.NaN) as { code: string }).code, 'unknown-workspace');
  assert.equal(c.current, 0, 'the current workspace does not change');
  const plain = column(2, 2560, { sideBySide: false });
  assert.equal((plain.showSide(1) as { code: string }).code, 'not-enabled');
  assert.equal((plain.setSplit([1]) as { code: string }).code, 'not-enabled');
  assert.equal((plain.hideSide(0) as { code: string }).code, 'not-enabled');
  assert.equal(plain.focusSide('right'), false);
  const unmeasured = column(2, 0);
  assert.equal((unmeasured.showSide(1) as { code: string }).code, 'not-measured');
  const gone = column(2);
  act(() => gone.dispose());
  assert.equal((gone.showSide(1) as { code: string }).code, 'disposed');
});

test('a side with one row slot cannot share, and a column still reading its saved list refuses', async () => {
  const c = column(3, 828);
  assert.equal(c.shown[0]!.slots, 2);
  assert.deepEqual(c.showSide(1), { ok: true });
  assert.equal(view(c), 'Space 1 1/1, Space 2 1/1');
  assert.equal((c.showSide(2) as { code: string }).code, 'no-room');
  let release = (): void => {};
  const held = new Promise<null>((r) => (release = () => r(null)));
  const storage: ColumnStorage = { load: () => held, save: () => {} };
  const loading = createWorkspaceColumn({ mount: false, sideBySide: true, storage });
  columns.push(loading);
  loading.addWorkspace();
  loading.addWorkspace();
  columnCoreOf(loading).setWindowWidth(2560, 390);
  assert.equal((loading.showSide(1) as { code: string }).code, 'not-ready');
  release();
  await until('ready', () => loading.status === 'ready');
  assert.equal(loading.showSide(1).ok, true);
});

test('a split that is not valid is refused with the reason and changes nothing', () => {
  const c = column(3);
  c.showSide(1);
  c.showSide(2);
  const before = view(c);
  const refuse = (rows: number[]): string => {
    const r = c.setSplit(rows);
    assert.equal(r.ok, false, JSON.stringify(rows));
    assert.equal((r as { code: string }).code, 'invalid-split');
    assert.equal(view(c), before, 'and nothing changed');
    return (r as { message: string }).message;
  };
  assert.match(refuse([3, 3]), /names 2 spaces and the window shows 3/);
  assert.match(refuse([1, 1, 1, 1]), /4 spaces/);
  assert.match(refuse([0, 3, 3]), /side 1 gets 0/);
  assert.match(refuse([2, 1.5, 2]), /side 2 gets 1.5/);
  assert.match(refuse([2, Number.NaN, 2]), /side 2/);
  assert.match(refuse([-1, 4, 3]), /side 1/);
  assert.match(refuse([3, 3, 3]), /9 row panels and the window holds 6 slots/);
  assert.deepEqual(c.setSplit([1, 4, 1]), { ok: true });
  assert.deepEqual(c.shown.map((s) => s.rowSlots), [1, 4, 1]);
  assert.deepEqual(c.setSplit([1, 4, 1]), { ok: true }, 'the same split again changes nothing and is not refused');
});

test('slots a split leaves over go to the current space first and then the nearest', () => {
  const c = column(3, 2240);
  c.showSide(1);
  c.showSide(2, { at: 2 });
  assert.deepEqual(c.setSplit([1, 1, 1]), { ok: true });
  assert.equal(view(c), 'Space 1 2/2, Space 2 2/2, Space 3 1/1', 'two slots over: the current space, then its neighbour');
});

test('hideSide gives the room to the current space, keeps the workspace in the column, and refuses the current one', () => {
  const c = column(3);
  c.showSide(1);
  c.showSide(2, { at: 2 });
  c.setSplit([2, 2, 2]);
  const second = c.workspaces[1]!;
  assert.deepEqual(c.hideSide(second), { ok: true });
  assert.equal(c.shown.length, 2);
  assert.equal(c.shown[0]!.workspace, c.workspaces[0]);
  assert.equal(c.shown.reduce((n, s) => n + s.slots, 0), 6, 'the window is still full');
  assert.equal(c.shown[0]!.rowSlots, 4, 'the current space took the two slots');
  assert.equal(c.workspaces.length, 3, 'the workspace is still in the column');
  assert.equal((c.hideSide(second) as { code: string }).code, 'not-shown');
  assert.equal((c.hideSide(c.workspaces[0]!) as { code: string }).code, 'current');
  assert.equal((c.hideSide(9) as { code: string }).code, 'unknown-workspace');
});

test('narrowing: the sides the person is not in give up slots first, the current side only after them, and the farthest space leaves last', () => {
  const c = column(3);
  c.showSide(1, { at: 1 });
  c.showSide(2, { at: 2 });
  c.setSplit([3, 2, 1]);
  assert.equal(view(c), 'Space 1 3/3, Space 2 2/2, Space 3 1/1');
  measure(c, 2240);
  assert.equal(view(c), 'Space 1 3/3, Space 2 1/1, Space 3 1/1', 'five slots: the other sides give up slots, though the current one is the widest');
  measure(c, 1920);
  assert.equal(view(c), 'Space 1 2/2, Space 2 1/1, Space 3 1/1', 'four slots: only now the current side gives one up');
  measure(c, 1280);
  assert.equal(view(c), 'Space 1 1/1, Space 2 1/1, Space 3 1/1');
  measure(c, 890);
  assert.equal(view(c), 'Space 1 1/1, Space 2 1/1', 'two slots: the space farthest from the current one leaves');
  measure(c, 390);
  assert.equal(view(c), 'Space 1 1/1', 'one slot: the current space alone');
  assert.equal(c.shown[0]!.workspace, c.workspaces[0]);
  measure(c, 2560);
  assert.equal(view(c), 'Space 1 3/3, Space 2 2/2, Space 3 1/1', 'widening brings the saved list and split back');
  measure(c, 3840);
  assert.equal(view(c), 'Space 1 4/4, Space 2 3/3, Space 3 2/2', 'a wider window gives every slot to a space, the current one and the nearest first');
});

const sticky = (...slotsAndRank: [number, number][]): SideSpace['sticky'] => slotsAndRank.map(([slots, rank], k) => ({ k, slots, rank }));
const space = (id: string, rows: number, stickies: SideSpace['sticky'] = [], panels = 8): SideSpace => ({ id, rows, sticky: stickies, panels });
const cellsOf = (spaces: SideSpace[], windowSlots: number, current = 0, min = 1): string => planSides({ spaces, current, windowSlots, minScrollSlots: min }).map((c) => `${c.id} ${c.slots}/${c.rowSlots}+${c.sticky}`).join(', ');

test('the current side keeps its room while another can give up: a split of 4 and 2 narrows to 4|1, then 3|1', () => {
  const c = column(2);
  c.showSide(1);
  assert.deepEqual(c.setSplit([4, 2]), { ok: true });
  measure(c, 2240);
  assert.equal(view(c), 'Space 1 4/4, Space 2 1/1');
  measure(c, 1920);
  assert.equal(view(c), 'Space 1 3/3, Space 2 1/1');
  const right = column(2);
  right.showSide(1);
  right.setSplit([2, 4]);
  right.focusSide('right');
  measure(right, 2240);
  assert.equal(view(right), 'Space 1 1/1, Space 2 4/4', 'with the right side current it is the left one that gives up');
});

test('narrowing order: sticky panels go back into rows first, lowest rank first and of equal rank the later one in the column', () => {
  const two = [space('a', 2, sticky([1, 0])), space('b', 2, sticky([1, 0]))];
  assert.equal(cellsOf(two, 6), 'a 3/2+1, b 3/2+1');
  assert.equal(cellsOf(two, 5), 'a 3/2+1, b 2/2+0', 'of equal rank the later panel in the column goes back first, and its row keeps its two slots');
  assert.equal(cellsOf(two, 5, 1), 'a 3/2+1, b 2/2+0', 'whichever space is current');
  assert.equal(cellsOf(two, 4), 'a 2/2+0, b 2/2+0');
  assert.equal(cellsOf(two, 3), 'a 2/2+0, b 1/1+0', 'only then the side the person is not in gives up a slot');
  assert.equal(cellsOf(two, 3, 1), 'a 1/1+0, b 2/2+0');
  assert.equal(cellsOf(two, 2), 'a 1/1+0, b 1/1+0');
  assert.equal(cellsOf(two, 1), 'a 1/1+0', 'and last the farthest space leaves');
  const ranked = [space('a', 2, sticky([1, 5])), space('b', 2, sticky([1, 1]))];
  assert.equal(cellsOf(ranked, 5, 1), 'a 3/2+1, b 2/2+0', 'a lower rank goes back first whatever the distance');
  const wide = [space('a', 3, sticky([2, 0])), space('b', 1)];
  assert.equal(cellsOf(wide, 6), 'a 5/3+2, b 1/1+0');
  assert.equal(cellsOf(wide, 4), 'a 3/3+0, b 1/1+0', 'a two-slot sticky panel goes back whole');
});

test('a cell is exactly its rows and its sticky panels, so the row can work the same out from its own width', () => {
  for (const window of [2, 3, 4, 5, 6, 8, 9]) {
    for (const current of [0, 1]) {
      const spaces = [space('a', 3, sticky([1, 0], [2, 1])), space('b', 2, sticky([1, 2])), space('c', 1)];
      const cells = planSides({ spaces, current, windowSlots: window, minScrollSlots: 1 });
      assert.ok(cells.every((c) => c.slots === c.rowSlots + c.sticky), `window ${window}`);
      assert.equal(cells.reduce((n, c) => n + c.slots, 0), window, `window ${window} is filled`);
      assert.ok(cells.every((c) => c.rowSlots >= 1), 'every side keeps a row slot');
      assert.ok(cells.some((c) => c.id === spaces[current]!.id), 'the current space is always shown');
    }
  }
});

test('the least a side keeps is one row slot, or minScrollSlots when that is more', () => {
  assert.equal(minRowSlots(0), 1);
  assert.equal(minRowSlots(1), 1);
  assert.equal(minRowSlots(3), 3);
  assert.equal(cellsOf([space('a', 3), space('b', 3)], 5, 0, 3), 'a 5/5+0', 'two sides of three need six slots, so one space alone shows');
});

test('splitProblem, dividerRange, shiftDivider and evenRows', () => {
  assert.equal(splitProblem([2, 2], 2, 6, 1), null);
  assert.match(splitProblem([2], 2, 6, 1)!, /names 1 spaces/);
  assert.match(splitProblem([2, 5], 2, 6, 1)!, /7 row panels/);
  assert.deepEqual(dividerRange([2, 3, 1], 0, 1), { min: 1, max: 4 });
  assert.deepEqual(dividerRange([2, 3, 1], 1, 1), { min: 1, max: 3 });
  assert.deepEqual(shiftDivider([2, 3, 1], 0, 1, 1), [3, 2, 1]);
  assert.deepEqual(shiftDivider([2, 3, 1], 0, 9, 1), [4, 1, 1], 'it stops where the right side keeps one');
  assert.deepEqual(shiftDivider([2, 3, 1], 1, -9, 1), [2, 1, 3], 'and where the left side keeps one');
  assert.deepEqual(shiftDivider([2, 3, 1], 2, 1, 1), [2, 3, 1], 'there is no divider after the last side');
  assert.deepEqual(evenRows([0, 0], 6, 1), [3, 3]);
  assert.deepEqual(evenRows([0, 0, 0], 8, 1), [3, 3, 2]);
  assert.deepEqual(evenRows([1, 0], 6, 1), [2, 3], 'a sticky panel counts in its side share');
  assert.deepEqual(evenRows([0, 0, 0, 0, 0, 0], 6, 1), [1, 1, 1, 1, 1, 1]);
});

test('step changes the workspace in the side that holds focus and skips a workspace shown elsewhere', () => {
  const c = column(4);
  c.showSide(1);
  assert.deepEqual(c.shown.map((s) => s.workspace.name), ['Space 1', 'Space 2']);
  assert.equal(c.step('down'), true);
  assert.equal(c.current, 2, 'Space 2 is shown in the other side, so the step lands on Space 3');
  assert.deepEqual(c.shown.map((s) => s.workspace.name), ['Space 3', 'Space 2'], 'and Space 3 took the side Space 1 held');
  assert.equal(c.step('up'), true);
  assert.equal(c.current, 0, 'stepping up skips Space 2 and goes to Space 1');
  assert.deepEqual(c.shown.map((s) => s.workspace.name), ['Space 1', 'Space 2']);
  assert.equal(c.step('up'), false, 'no workspace above');
  const plain = column(3, 2560, { sideBySide: false });
  assert.equal(plain.step('down'), true);
  assert.equal(plain.current, 1, 'a column without sideBySide steps as it always did');
});

test('focusSide moves the focus to the shown space on the left or the right, and a workspace the window left out is one step away', () => {
  const c = column(3);
  c.showSide(1);
  assert.equal(c.focusSide('left'), false, 'nothing left of the first side');
  assert.equal(c.focusSide('right'), true);
  assert.equal(c.current, 1);
  assert.equal(c.focusSide('right'), false);
  assert.deepEqual(c.shown.map((s) => s.workspace.name), ['Space 1', 'Space 2'], 'the sides stay where they are');
  assert.equal(c.focusSide('left'), true);
  assert.equal(c.current, 0);
  c.scrollTo(1);
  assert.equal(c.current, 1, 'scrollTo a shown workspace focuses its side');
  assert.deepEqual(c.shown.map((s) => s.workspace.name), ['Space 1', 'Space 2']);
  measure(c, 390);
  assert.deepEqual(c.shown.map((s) => s.workspace.name), ['Space 2'], 'narrowed to one slot, the current space alone shows');
  assert.equal(c.step('up'), true, 'Space 1 left the window but is one step away');
  assert.equal(c.current, 0);
  assert.deepEqual(c.shown.map((s) => s.workspace.name), ['Space 1']);
  measure(c, 2560);
  assert.deepEqual(c.shown.map((s) => s.workspace.name), ['Space 1', 'Space 2'], 'stepping discarded no saved side, so the window widens back to both');
});

test('stepping onto a space the window left out takes the current one’s place and keeps everyone’s saved side', () => {
  const c = column(3);
  c.showSide(1, { at: 1 });
  c.showSide(2, { at: 2 });
  c.setSplit([2, 2, 2]);
  measure(c, 890);
  assert.equal(view(c), 'Space 1 1/1, Space 2 1/1');
  assert.equal(c.step('down'), true);
  assert.equal(c.current, 2);
  assert.equal(view(c), 'Space 2 1/1, Space 3 1/1', 'Space 3 came in as Space 1, farthest from it, left');
  measure(c, 2560);
  assert.equal(view(c), 'Space 1 2/2, Space 2 2/2, Space 3 2/2', 'the saved order and split come back whole');
  const d = column(3);
  d.showSide(1);
  assert.equal(d.step('down'), true);
  assert.equal(view(d), 'Space 3 3/3, Space 2 3/3', 'a space with no saved side takes the current one’s');
});

test('removing a workspace gives its side to the one that becomes current, unless that one is shown already', () => {
  const c = column(3);
  c.showSide(1);
  assert.equal(c.removeWorkspace(0), true);
  assert.deepEqual(c.shown.map((s) => s.workspace.name), ['Space 2'], 'Space 2 became current and was shown already, so the window has one side less');
  const d = column(3);
  d.showSide(1);
  assert.equal(d.removeWorkspace(1), true);
  assert.deepEqual(d.shown.map((s) => s.workspace.name), ['Space 1']);
  const e = column(3);
  e.showSide(2);
  e.removeWorkspace(0);
  assert.deepEqual(e.shown.map((s) => s.workspace.name), ['Space 2', 'Space 3'], 'the one that became current took the side of the removed one');
});

test('the subscription tells a reader when the window shows something else, and not when only the pixels moved', () => {
  const c = column(2);
  const core = columnCoreOf(c);
  let n = 0;
  const off = core.subscribe(() => (n += 1));
  const before = core.snapshot().shown;
  core.setWindowWidth(2561, 390);
  assert.equal(n, 0, 'a pixel more is still six slots');
  assert.equal(core.snapshot().shown, before, 'and the snapshot is the same object');
  core.setWindowWidth(1280, 390);
  assert.equal(n, 1);
  assert.deepEqual(core.snapshot().shown.map((s) => s.slots), [3]);
  const shown = c.shown;
  assert.equal(c.shown, shown, 'column.shown is a new array only when something in it changed');
  off();
});

// ---------------------------------------------------------------------------
// The saved record
// ---------------------------------------------------------------------------

/** A storage that keeps what it was given and hands back what it was told to. */
function keep(initial: ColumnState | null = null): ColumnStorage & { saved: ColumnState[] } {
  const saved: ColumnState[] = [];
  return { saved, load: async () => initial, save: (state) => void saved.push(JSON.parse(JSON.stringify(state)) as ColumnState) };
}
async function loaded(storage: ColumnStorage, o: Parameters<typeof createWorkspaceColumn>[0] = {}): Promise<WorkspaceColumnHandle> {
  const c = createWorkspaceColumn({ mount: false, sideBySide: true, storage, ...o });
  columns.push(c);
  await until('ready', () => c.status === 'ready');
  columnCoreOf(c).setWindowWidth(2560, 390);
  return c;
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

test('the shown list and the split are saved as version 2 and read back', async () => {
  const storage = keep();
  const c = await loaded(storage);
  c.addWorkspace({ id: 'a', name: 'Research' });
  c.addWorkspace({ id: 'b', name: 'Trip food' });
  c.addWorkspace({ id: 'c', name: 'Notes' });
  assert.deepEqual(c.showSide(1), { ok: true });
  assert.deepEqual(c.setSplit([4, 2]), { ok: true });
  await flush();
  const last = storage.saved[storage.saved.length - 1]!;
  assert.deepEqual(last, { version: 2, workspaces: [{ id: 'a', name: 'Research' }, { id: 'b', name: 'Trip food' }, { id: 'c', name: 'Notes' }], current: 'a', side: { shown: ['a', 'b'], split: [4, 2] } });
  const back = await loaded(keep(last));
  assert.deepEqual(back.workspaces.map((w) => w.id), ['a', 'b', 'c']);
  assert.equal(view(back), 'Research 4/4, Trip food 2/2', 'the same split after a reload');
  assert.equal(back.workspaces[back.current]!.id, 'a');
});

test('a record of version 1 reads as only the current workspace shown', async () => {
  const c = await loaded(keep({ version: 1, workspaces: [{ id: 'a', name: 'Research' }, { id: 'b', name: 'Trip food' }], current: 'b' }));
  assert.deepEqual(c.shown.map((s) => s.workspace.id), ['b']);
  assert.equal(c.shown[0]!.slots, 6);
  assert.equal(c.showSide(0).ok, true, 'and a side can be added to it');
});

test('a malformed side is read as none and the workspaces beside it are kept', async () => {
  for (const side of [{ shown: ['a'], split: [] }, { shown: ['a', 'a'], split: [1, 1] }, { shown: ['a'], split: [0] }, { shown: 'a', split: [1] }, { shown: ['a'], split: [1.5] }] as unknown[]) {
    const c = await loaded(keep({ version: 2, workspaces: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], current: 'a', side: side as never }));
    assert.deepEqual(c.workspaces.map((w) => w.id), ['a', 'b']);
    assert.deepEqual(c.shown.map((s) => s.workspace.id), ['a'], JSON.stringify(side));
  }
});

test('a saved side that names a workspace that is gone, or leaves out the current one, is repaired', async () => {
  const c = await loaded(keep({ version: 2, workspaces: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], current: 'b', side: { shown: ['gone', 'a'], split: [3, 3] } }));
  assert.deepEqual(c.shown.map((s) => s.workspace.id), ['a', 'b'], 'the current workspace is shown, after the ones the record named');
  assert.equal(c.workspaces[c.current]!.id, 'b');
});

test('a column without sideBySide writes version 1 and ignores a saved side', async () => {
  const storage = keep({ version: 2, workspaces: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], current: 'a', side: { shown: ['a', 'b'], split: [3, 3] } });
  const c = await loaded(storage, { sideBySide: false });
  assert.equal(c.shown.length, 1);
  c.addWorkspace({ id: 'z', name: 'Z' });
  await flush();
  assert.equal(storage.saved[storage.saved.length - 1]!.version, 1);
  assert.equal('side' in storage.saved[storage.saved.length - 1]!, false);
});

// ---------------------------------------------------------------------------
// The divider and the keys, drawn
// ---------------------------------------------------------------------------

const proto = HTMLElement.prototype;
const rowWidth = Object.getOwnPropertyDescriptor(proto, 'clientWidth')!;
let columnWidth = 0;
Object.defineProperty(proto, 'clientWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return this.hasAttribute('data-workspace-column') ? columnWidth : (rowWidth.get as () => number).call(this);
  },
});
const separators = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="separator"]')];
const press = (el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => void el.dispatchEvent(e));
  return e;
};

async function drawn(n = 3): Promise<WorkspaceColumnHandle> {
  columnWidth = 2560;
  const c = createWorkspaceColumn({ sideBySide: true });
  columns.push(c);
  for (let k = 0; k < n; k += 1) c.addWorkspace();
  await until('measured', () => document.querySelectorAll('[data-workspace-cell]').length === n && c.shown[0]!.slots === 6);
  act(() => void c.showSide(1));
  await until('a divider', () => separators().length === 1);
  return c;
}

test('the divider is a focusable separator that reads as a slider with the two sides spoken', async () => {
  const c = await drawn();
  const bar = separators()[0]!;
  assert.equal(bar.getAttribute('tabindex'), '0');
  assert.equal(bar.getAttribute('aria-orientation'), 'vertical');
  assert.equal(bar.getAttribute('aria-label'), 'Resize Space 1 and Space 2');
  const controlled = document.getElementById(bar.getAttribute('aria-controls')!);
  assert.equal(controlled?.getAttribute('data-workspace-id'), c.workspaces[0]!.id, 'it names the cell on its left, whose row panels it counts');
  assert.equal(bar.getAttribute('aria-valuenow'), '3');
  assert.equal(bar.getAttribute('aria-valuemin'), '1');
  assert.equal(bar.getAttribute('aria-valuemax'), '5');
  assert.equal(bar.getAttribute('aria-valuetext'), 'Space 1 3 panels, Space 2 3 panels');
  assert.equal(c.shown.length, 2);
});

test('divider keys: Left and Right move it one slot, Home and End go to the minimums, and a minimum stops it', async () => {
  const c = await drawn();
  const rows = (): string => c.shown.map((s) => s.rowSlots).join(',');
  const bar = (): HTMLElement => separators()[0]!;
  assert.equal(rows(), '3,3');
  assert.equal(press(bar(), 'ArrowRight').defaultPrevented, true);
  assert.equal(rows(), '4,2');
  assert.equal(bar().getAttribute('aria-valuenow'), '4');
  assert.equal(bar().getAttribute('aria-valuetext'), 'Space 1 4 panels, Space 2 2 panels');
  press(bar(), 'ArrowLeft');
  press(bar(), 'ArrowLeft');
  assert.equal(rows(), '2,4');
  press(bar(), 'End');
  assert.equal(rows(), '5,1', 'End: the right side at its minimum');
  press(bar(), 'ArrowRight');
  assert.equal(rows(), '5,1', 'a drag past the minimum stops there');
  assert.equal(bar().getAttribute('aria-valuetext'), 'Space 1 5 panels, Space 2 1 panel');
  press(bar(), 'Home');
  assert.equal(rows(), '1,5', 'Home: the left side at its minimum');
  press(bar(), 'ArrowLeft');
  assert.equal(rows(), '1,5');
  const other = press(bar(), 'a');
  assert.equal(other.defaultPrevented, false, 'a key the divider does not use is left alone');
  const held = press(bar(), 'ArrowRight', { altKey: true });
  assert.equal(held.defaultPrevented, false, 'a modified arrow is the app’s own chord');
  assert.equal(rows(), '1,5');
});

test('a double click evens the split out', async () => {
  const c = await drawn();
  act(() => void c.setSplit([5, 1]));
  assert.equal(c.shown.map((s) => s.rowSlots).join(','), '5,1');
  act(() => void separators()[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  assert.equal(c.shown.map((s) => s.rowSlots).join(','), '3,3');
  act(() => void c.setSplit([1, 4]));
  act(() => void separators()[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  assert.equal(c.shown.map((s) => s.rowSlots).join(','), '3,3', 'from any split');
});

test('the divider takes the arrows from the row: a keydown on it is not one the row listens to', async () => {
  await drawn();
  const bar = separators()[0]!;
  const seen: KeyboardEvent[] = [];
  const onWindow = (e: Event): void => void seen.push(e as KeyboardEvent);
  window.addEventListener('keydown', onWindow);
  press(bar, 'ArrowRight');
  window.removeEventListener('keydown', onWindow);
  assert.equal(seen[0]!.defaultPrevented, true, 'it was taken before it reached the window, where a row would step');
});

test('every cell stays mounted and the ones the window does not show are inert; a press in a side makes it the current workspace', async () => {
  const c = await drawn();
  const cellsNow = [...document.querySelectorAll<HTMLElement>('[data-workspace-cell]')];
  assert.equal(cellsNow.length, 3);
  assert.deepEqual(cellsNow.map((x) => x.hasAttribute('inert')), [false, false, true]);
  assert.deepEqual(cellsNow.map((x) => x.getAttribute('aria-hidden')), [null, null, 'true']);
  assert.deepEqual(cellsNow.map((x) => x.hasAttribute('data-workspace-active')), [true, false, false]);
  act(() => void cellsNow[1]!.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  assert.equal(c.current, 1);
  assert.deepEqual([...document.querySelectorAll<HTMLElement>('[data-workspace-cell]')].map((x) => x.hasAttribute('data-workspace-active')), [false, true, false]);
  assert.equal(document.querySelectorAll('[role="separator"]').length, 1, 'and the divider stays');
});

test('a key aimed at a cell goes to that cell’s row, and one aimed at the page to the current workspace’s', () => {
  document.body.innerHTML = `
    <div data-workspace-cell data-workspace-active><div id="a"><i id="ai"></i></div></div>
    <div data-workspace-cell><div id="b"><i id="bi"></i></div></div>
    <div id="alone"></div>`;
  const get = (id: string): Element => document.getElementById(id)!;
  assert.equal(keyBelongsToRow(get('a'), get('ai')), true);
  assert.equal(keyBelongsToRow(get('b'), get('ai')), false, 'a key in the first cell is not the second row’s');
  assert.equal(keyBelongsToRow(get('a'), get('bi')), false, 'nor the first row’s when it landed in the second');
  assert.equal(keyBelongsToRow(get('b'), get('bi')), true);
  assert.equal(keyBelongsToRow(get('a'), document.body), true, 'a key aimed at the page goes to the current cell’s row');
  assert.equal(keyBelongsToRow(get('b'), document.body), false, 'and not to the other');
  assert.equal(keyBelongsToRow(get('alone'), get('ai')), true, 'a row outside any cell answers every key');
});

test('two dividers have distinct names and each names its own left cell', async () => {
  const c = await drawn();
  act(() => void c.showSide(2, { at: 2 }));
  await until('two dividers', () => separators().length === 2);
  const [a, b] = separators() as [HTMLElement, HTMLElement];
  assert.deepEqual([a.getAttribute('aria-label'), b.getAttribute('aria-label')], ['Resize Space 1 and Space 2', 'Resize Space 2 and Space 3']);
  assert.notEqual(a.getAttribute('aria-controls'), b.getAttribute('aria-controls'));
  assert.equal(document.getElementById(b.getAttribute('aria-controls')!)?.getAttribute('data-workspace-id'), c.workspaces[1]!.id);
});

/** What the column's element holds, in document order: the cells by workspace name, the dividers, and the hidden cells last. */
const domOrder = (c: WorkspaceColumnHandle): string[] =>
  [...document.querySelectorAll<HTMLElement>('[data-workspace-cell], [role="separator"]')].map((el) => (el.hasAttribute('data-workspace-cell') ? c.workspaces.find((w) => w.id === el.dataset.workspaceId)!.name : '|'));

test('the DOM holds the shown spaces left to right with each divider between its two cells, hidden cells last', async () => {
  const c = await drawn();
  assert.deepEqual(domOrder(c), ['Space 1', '|', 'Space 2', 'Space 3']);
  act(() => void c.step('down'));
  assert.deepEqual(c.shown.map((s) => s.workspace.name), ['Space 3', 'Space 2']);
  assert.deepEqual(domOrder(c), ['Space 3', '|', 'Space 2', 'Space 1'], 'on screen Space 3 | Space 2, and so for Tab and a screen reader');
  act(() => void c.showSide(0, { at: 1 }));
  await until('three cells', () => separators().length === 2);
  assert.deepEqual(domOrder(c), ['Space 3', '|', 'Space 1', '|', 'Space 2']);
});

test('focus in a cell the window stops showing goes to the current space’s cell', async () => {
  const c = await drawn();
  const cellOf = (name: string): HTMLElement => document.querySelector<HTMLElement>(`[data-workspace-id="${c.workspaces.find((w) => w.name === name)!.id}"]`)!;
  const inside = document.createElement('button');
  cellOf('Space 2').appendChild(inside);
  const focused: string[] = [];
  const first = cellOf('Space 1');
  first.focus = () => void focused.push('Space 1');
  const was = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement')!;
  // The page holds focus in Space 2, as a browser does until it drops the focus of a cell that went inert.
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => inside });
  try {
    assert.equal(c.current, 0);
    act(() => void c.hideSide(1));
    assert.deepEqual(focused, ['Space 1'], 'focus went to the current space’s cell');
  } finally {
    delete (document as { activeElement?: unknown }).activeElement;
    Object.defineProperty(Document.prototype, 'activeElement', was);
  }
});
