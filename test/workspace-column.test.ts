/**
 * The workspace column: addWorkspace is the one way in, ArrowUp/ArrowDown and the neighbour buttons are the only way to move, the
 * name input renames, off-screen cells are inert, and the saved list restores around what code added. A mutant that drops a hotkey
 * guard, the inert flag or the create-and-scroll fails a test here.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { COLUMN_BOTTOM_BAND, createWorkspace, createWorkspaceColumn, definePanel, MAX_WORKSPACE_NAME } from '../index.js';
import type { ColumnState, ColumnStorage, PanelTemplate, WorkspaceColumnHandle } from '../index.js';
import { arrowKeyBelongsElsewhere } from '../WorkspaceColumn.js';
import { rigCleanup, slots, until } from './support/auto-rig.js';

const columns: WorkspaceColumnHandle[] = [];
afterEach(() => {
  for (const c of columns.splice(0)) act(() => c.dispose());
  rigCleanup();
});

const tpl = (id: string): PanelTemplate => definePanel({ id, view: ({ handle }) => React.createElement('i', { 'data-slot': handle.id }) });
const make = (o: Parameters<typeof createWorkspaceColumn>[0] = {}): WorkspaceColumnHandle => {
  const c = createWorkspaceColumn({ templates: [tpl('a')], ...o });
  columns.push(c);
  return c;
};
const cells = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-workspace-cell]')];
const key = (target: EventTarget, k: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(e));
  return e;
};
const neighbour = (cell: HTMLElement, side: 'above' | 'below'): HTMLElement => cell.querySelector<HTMLElement>(`[data-workspace-neighbour="${side}"]`)!;
const click = (el: Element): void => act(() => void (el as HTMLElement).click());

async function three(o: Parameters<typeof createWorkspaceColumn>[0] = {}): Promise<WorkspaceColumnHandle> {
  const c = make(o);
  act(() => {
    c.addWorkspace();
    c.addWorkspace();
    c.addWorkspace();
  });
  await until('three cells', () => cells().length === 3);
  // The hotkey listener is attached by an effect that runs after the commit.
  await new Promise((r) => setTimeout(r, 30));
  return c;
}

test('addWorkspace names workspaces Workspace 1, 2, 3, stores the name and draws a cell each', async () => {
  const c = await three();
  assert.deepEqual(c.workspaces.map((w) => w.name), ['Workspace 1', 'Workspace 2', 'Workspace 3']);
  assert.equal(c.current, 0);
  assert.deepEqual([...document.querySelectorAll<HTMLInputElement>('[data-workspace-name-input]')].map((i) => i.value), ['Workspace 1', 'Workspace 2', 'Workspace 3']);
});

test('the default name skips a number a workspace already uses', () => {
  const c = make({ mount: false });
  c.addWorkspace({ name: 'Workspace 2' });
  assert.equal(c.addWorkspace().name, 'Workspace 3');
});

test('one addWorkspace call with templates yields a mounted workspace with its panel', async () => {
  const c = make();
  const ws = c.addWorkspace({ id: 'main' });
  ws.addPanel('a');
  await until('the panel', () => slots(document.body).includes('a'));
  assert.equal(ws.id, 'main');
});

test('an id already in the column is refused, and a disposed column refuses an add', () => {
  const c = make({ mount: false });
  c.addWorkspace({ id: 'x' });
  assert.throws(() => c.addWorkspace({ id: 'x' }), { code: 'invalid-options' });
  c.dispose();
  assert.throws(() => c.addWorkspace(), { code: 'disposed' });
});

test('ArrowDown and ArrowUp move the current workspace and stop at the ends', async () => {
  const c = await three();
  assert.equal(key(window, 'ArrowUp').defaultPrevented, false, 'nothing above the first');
  assert.equal(c.current, 0);
  assert.equal(key(window, 'ArrowDown').defaultPrevented, true);
  key(window, 'ArrowDown');
  key(window, 'ArrowDown');
  assert.equal(c.current, 2);
  key(window, 'ArrowUp');
  assert.equal(c.current, 1);
});

test('the keys do nothing while focus is in a field, a widget, an editor, or a dialog is open', async () => {
  const c = await three();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const make1 = (tag: string, attrs: Record<string, string> = {}): HTMLElement => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    host.replaceChildren(el);
    return el;
  };
  const fields: Array<[string, () => HTMLElement]> = [
    ['input', () => make1('input')],
    ['textarea', () => make1('textarea')],
    ['select', () => make1('select')],
    ['contenteditable', () => make1('div', { contenteditable: 'true' })],
    ['textbox role', () => make1('div', { role: 'textbox' })],
    ['combobox role', () => make1('div', { role: 'combobox' })],
    ['keyboard drag', () => make1('div', { 'aria-pressed': 'true', 'aria-roledescription': 'Draggable' })],
  ];
  for (const [name, build] of fields) {
    key(build(), 'ArrowDown');
    assert.equal(c.current, 0, `${name} keeps the key`);
  }
  const plain = make1('div');
  key(plain, 'ArrowDown', { shiftKey: true });
  key(plain, 'ArrowDown', { altKey: true });
  key(plain, 'ArrowDown', { ctrlKey: true });
  key(plain, 'ArrowDown', { metaKey: true });
  key(plain, 'ArrowDown', { repeat: true });
  key(plain, 'ArrowDown', { isComposing: true });
  assert.equal(c.current, 0, 'modified, repeated and composing keys are left alone');
  const taken = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
  plain.addEventListener('keydown', (e) => e.preventDefault(), { once: true });
  act(() => void plain.dispatchEvent(taken));
  assert.equal(c.current, 0, 'a key a handler took is left alone');
  const dialog = document.createElement('div');
  dialog.setAttribute('aria-modal', 'true');
  document.body.appendChild(dialog);
  key(plain, 'ArrowDown');
  assert.equal(c.current, 0, 'an open dialog keeps the key');
  dialog.remove();
  key(plain, 'ArrowDown');
  assert.equal(c.current, 1, 'and the plain key then moves');
});

test('arrowKeyBelongsElsewhere is false for a bare key on the body', () => {
  assert.equal(arrowKeyBelongsElsewhere(new KeyboardEvent('keydown', { key: 'ArrowDown' }), document), false);
});

test('only the current cell is reachable: the others are inert and aria-hidden', async () => {
  const c = await three();
  const state = () => cells().map((el) => [el.hasAttribute('inert'), el.getAttribute('aria-hidden')]);
  assert.deepEqual(state(), [[false, null], [true, 'true'], [true, 'true']]);
  act(() => void c.scrollTo(2));
  await until('the last cell active', () => !cells()[2]!.hasAttribute('inert'));
  assert.deepEqual(state(), [[true, 'true'], [true, 'true'], [false, null]]);
});

test('the neighbour buttons name the workspace above and below, and a click moves there', async () => {
  const c = await three();
  act(() => void c.scrollTo(1));
  const mid = cells()[1]!;
  assert.equal(neighbour(mid, 'above').textContent, 'Workspace 1');
  assert.equal(neighbour(mid, 'below').textContent, 'Workspace 3');
  click(neighbour(mid, 'below'));
  assert.equal(c.current, 2);
  click(neighbour(cells()[2]!, 'above'));
  assert.equal(c.current, 1);
});

test('with no workspace below, the button reads Create new workspace and creates one and scrolls to it', async () => {
  const c = await three();
  act(() => void c.scrollTo(2));
  const last = cells()[2]!;
  assert.equal(neighbour(last, 'below').textContent, 'Create new workspace');
  click(neighbour(last, 'below'));
  await until('a fourth cell', () => cells().length === 4);
  assert.equal(c.workspaces.length, 4);
  assert.equal(c.current, 3);
  assert.equal(c.workspaces[3]!.name, 'Workspace 4');
});

test('with no workspace above, the button creates one at the top and scrolls to it', async () => {
  const c = await three();
  const first = cells()[0]!;
  assert.equal(neighbour(first, 'above').textContent, 'Create new workspace');
  click(neighbour(first, 'above'));
  await until('a fourth cell', () => cells().length === 4);
  assert.equal(c.current, 0);
  assert.equal(c.workspaces[0]!.name, 'Workspace 4');
  assert.equal(c.workspaces[1]!.name, 'Workspace 1');
});

test('an empty column offers Create new workspace alone', async () => {
  const c = make();
  await until('the button', () => document.querySelector('[data-workspace-neighbour="empty"]') !== null);
  click(document.querySelector('[data-workspace-neighbour="empty"]')!);
  assert.equal(c.workspaces.length, 1);
  assert.equal(c.current, 0);
});

test('labels replace every string the column draws', async () => {
  const c = make({ labels: { newWorkspace: 'Neuer Bereich', goToWorkspace: (n) => `Zu ${n}`, workspaceName: 'Name' } });
  act(() => void c.addWorkspace());
  await until('a cell', () => cells().length === 1);
  const cell = cells()[0]!;
  assert.equal(neighbour(cell, 'above').textContent, 'Neuer Bereich');
  assert.equal(cell.querySelector('[data-workspace-name-input]')!.getAttribute('aria-label'), 'Name');
});

test('the name input renames on blur and Enter, reverts on Escape and on an empty name', async () => {
  const c = await three();
  const input = document.querySelector<HTMLInputElement>('[data-workspace-name-input]')!;
  const type = async (value: string): Promise<void> => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 30));
  };
  input.focus();
  await type('  Kitchen  ');
  act(() => void input.blur());
  assert.equal(c.workspaces[0]!.name, 'Kitchen');
  await until('the input shows it', () => input.value === 'Kitchen');
  await type('Garage');
  key(input, 'Escape');
  assert.equal(c.workspaces[0]!.name, 'Kitchen', 'Escape discards');
  await until('the draft is gone', () => input.value === 'Kitchen');
  await new Promise((r) => setTimeout(r, 30));
  act(() => void input.blur());
  assert.equal(c.workspaces[0]!.name, 'Kitchen', 'an empty name is ignored');
  await until('the input reverts', () => input.value === 'Kitchen');
  act(() => void input.focus());
  await type('Attic');
  key(input, 'Enter');
  assert.equal(c.workspaces[0]!.name, 'Attic');
});

test('the workspace below shows the new name of a renamed workspace', async () => {
  const c = await three();
  act(() => void c.workspaces[1]!.rename('Studio'));
  await until('the new name', () => neighbour(cells()[0]!, 'below').textContent === 'Studio');
  assert.equal(neighbour(cells()[0]!, 'below').textContent, 'Studio');
});

test('rename trims, cuts to the limit, ignores an empty name, and reports only a change', () => {
  const seen: string[] = [];
  const ws = createWorkspace({ mount: false, name: ' Home ', onRename: (n) => seen.push(n) });
  assert.equal(ws.name, 'Home');
  assert.equal(ws.rename('Home'), 'Home');
  assert.equal(ws.rename('   '), 'Home');
  assert.equal(ws.rename('x'.repeat(MAX_WORKSPACE_NAME + 20)), 'x'.repeat(MAX_WORKSPACE_NAME));
  assert.equal(ws.rename('Work'), 'Work');
  assert.deepEqual(seen, ['x'.repeat(MAX_WORKSPACE_NAME), 'Work']);
  assert.equal(ws.rename(' Work '), 'Work');
  assert.equal(seen.length, 2);
  ws.dispose();
  assert.throws(() => ws.rename('Late'), { code: 'disposed' });
  assert.ok(ws.id.length > 0);
});

test('focus moves into the cell that arrives when it was inside the one left', async () => {
  const c = await three();
  const button = neighbour(cells()[0]!, 'below');
  button.focus();
  assert.equal(document.activeElement, button);
  click(button);
  await act(async () => {});
  assert.equal(document.activeElement, cells()[1]);
});

test('without Reduce Motion the column glides to the new workspace', async () => {
  const c = await three();
  act(() => void c.scrollTo(2));
  const track = cells()[0]!.parentElement!;
  await until('the track moved', () => track.style.transform === 'translateY(-200%)');
  assert.match(track.style.transition, /^transform 0\.4s cubic-bezier\(/);
});

// ---------------------------------------------------------------------------
// The saved list
// ---------------------------------------------------------------------------

function memoryColumnStorage(initial: unknown, panels: Record<string, string[]> = {}): ColumnStorage & { saved: ColumnState[] } {
  const saved: ColumnState[] = [];
  return {
    saved,
    load: async () => initial as ColumnState | null,
    save: async (s) => void saved.push(s),
    workspace: (id) => {
      (panels[id] ??= []).push('asked');
      return undefined;
    },
  };
}

test('the saved list comes back in order with its names and current workspace, around what code added', async () => {
  const storage = memoryColumnStorage({ version: 1, workspaces: [{ id: 'b', name: 'Beta' }, { id: 'main', name: 'Home' }, { id: 'c', name: 'Gamma' }], current: 'c' });
  const c = make({ storage, mount: false });
  const main = c.addWorkspace({ id: 'main' });
  const extra = c.addWorkspace({ id: 'extra' });
  assert.equal(c.status, 'loading');
  await until('ready', () => c.status === 'ready');
  assert.deepEqual(c.workspaces.map((w) => w.id), ['b', 'main', 'c', 'extra']);
  assert.deepEqual(c.workspaces.map((w) => w.name), ['Beta', 'Home', 'Gamma', 'Workspace 2']);
  assert.equal(c.workspaces[1], main);
  assert.equal(c.workspaces[3], extra);
  assert.equal(c.current, 2);
});

test('a changed list is saved: an add, a rename and a move each', async () => {
  const storage = memoryColumnStorage(null);
  const c = make({ storage, mount: false });
  await until('ready', () => c.status === 'ready');
  const ws = c.addWorkspace({ id: 'one' });
  c.addWorkspace({ id: 'two' });
  ws.rename('First');
  c.scrollTo(1);
  await until('saved', () => storage.saved.length >= 4);
  const last = storage.saved.at(-1)!;
  assert.deepEqual(last, { version: 1, workspaces: [{ id: 'one', name: 'First' }, { id: 'two', name: 'Workspace 2' }], current: 'two' });
});

test('the panels of a workspace are stored under its id, not its name', async () => {
  const asked: Record<string, string[]> = {};
  const storage = memoryColumnStorage(null, asked);
  const c = make({ storage, mount: false });
  await until('ready', () => c.status === 'ready');
  c.addWorkspace({ id: 'main' }).rename('Renamed');
  assert.deepEqual(Object.keys(asked), ['main']);
});

test('a saved record that is not a ColumnState reads as nothing saved', async () => {
  for (const bad of [{ version: 2, workspaces: [], current: null }, { version: 1, workspaces: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }], current: null }, 'text']) {
    const c = make({ storage: memoryColumnStorage(bad), mount: false });
    await until('ready', () => c.status === 'ready');
    assert.equal(c.workspaces.length, 0);
  }
});

test('a storage that rejects its load or its save is reported, not thrown', async () => {
  const errors: unknown[] = [];
  const storage: ColumnStorage = { load: async () => Promise.reject(new Error('no')), save: async () => Promise.reject(new Error('full')) };
  const c = make({ storage, mount: false, onError: (e) => errors.push(e) });
  await until('ready', () => c.status === 'ready');
  c.addWorkspace();
  await until('a save error', () => errors.length > 0);
});

test('update reaches every workspace and the ones added later', () => {
  const c = make({ mount: false });
  const a = c.addWorkspace();
  c.update({ topInset: 40 });
  const b = c.addWorkspace();
  assert.ok(a.id !== b.id);
  assert.throws(() => c.update({ storage: undefined } as never), { code: 'invalid-options' });
});

test('topInset clears chrome the app draws: the controls start below it', async () => {
  const c = make({ topInset: 32 });
  act(() => void c.addWorkspace());
  await until('a cell', () => cells().length === 1);
  const cell = cells()[0]!;
  const top = (el: Element): string => getComputedStyle(el).top;
  assert.equal(top(neighbour(cell, 'above')), '32px');
  assert.equal(top(cell.querySelector('[data-workspace-name-input]')!.parentElement!), '56px');
});

test('each control the column draws is exactly 24 px high: the neighbour buttons, the empty-column button and the name input', async () => {
  const c = await three();
  const cell = cells()[0]!;
  const high = (el: Element): number => Number.parseFloat(getComputedStyle(el).height);
  assert.equal(high(neighbour(cell, 'above')), 24, 'top button');
  assert.equal(high(neighbour(cell, 'below')), 24, 'bottom button');
  assert.equal(high(cell.querySelector('[data-workspace-name-input]')!.parentElement!), 24, 'name input');
  act(() => c.dispose());
  const empty = make();
  await until('the empty button', () => document.querySelector('[data-workspace-neighbour="empty"]') !== null);
  assert.equal(high(document.querySelector('[data-workspace-neighbour="empty"]')!), 24, 'empty-column button');
  act(() => empty.dispose());
});

test('the bottom band holds a 24 px button', () => {
  assert.ok(COLUMN_BOTTOM_BAND >= 24);
});
