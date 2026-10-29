/**
 * The workspace's own undo-close toast: a close the person makes opens it with what closed, its Undo puts the panel back
 * where it was, a close from code raises none, and the host's labels replace its words.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act, createElement } from 'react';
import { createWorkspace, definePanel, UNDO_CLOSE_TOAST_ATTRIBUTE } from '../index.js';
import type { PhonuxLabels, WorkspaceHandle } from '../index.js';
import { DEFAULT_LABELS } from '../labels.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { UndoCloseToast } from '../undoCloseToast.js';
import { resize, rigCleanup, slots, track, until } from './support/auto-rig.js';

afterEach(rigCleanup);

const view = ({ handle }: { handle: { id: string } }) => createElement('i', { 'data-slot': handle.id });
const toast = (): HTMLElement | null => document.querySelector<HTMLElement>(`[${UNDO_CLOSE_TOAST_ATTRIBUTE}]`);
const message = (): string => toast()?.querySelector('.MuiSnackbarContent-message')?.textContent ?? '';
const button = (text: string): HTMLButtonElement | undefined => [...(toast()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === text);

async function row(labels?: Partial<PhonuxLabels>, undoToast?: boolean): Promise<WorkspaceHandle> {
  const t = (id: string) => definePanel({ id, settings: { title: id.toUpperCase() }, view });
  await resize(1600);
  const w = track(createWorkspace({ templates: [t('a'), t('b'), t('c')], ...(labels === undefined ? {} : { labels }), ...(undoToast === undefined ? {} : { undoToast }) }));
  for (const id of ['a', 'b', 'c']) w.addPanel(id, { id: `${id}1` });
  await until('three panels', () => slots(document.body).length === 3);
  return w;
}

test('no close, no toast', async () => {
  await row();
  assert.equal(message(), '');
});

test('a close by the person opens the toast with its title, and Undo puts the panel back where it was', async () => {
  const w = await row();
  const order = (): string[] => w.panels.getSnapshot().panels.filter((p) => p.status === 'live').map((p) => p.id);
  const before = order();
  assert.deepEqual(before, ['a1', 'b1', 'c1'], 'control: three live panels');
  await act(async () => void w.panels.get('b1')!.close('person'));
  await until('b closed', () => !order().includes('b1'));
  assert.equal(message(), 'Closed B');
  const undo = button(DEFAULT_LABELS.undo);
  assert.ok(undo, 'the toast has its Undo button');
  await act(async () => undo!.click());
  await until('b came back', () => order().includes('b1'));
  assert.deepEqual(order(), before);
});

test('two closes in one window are counted', async () => {
  const w = await row();
  await act(async () => void w.panels.get('a1')!.close('person'));
  await act(async () => void w.panels.get('b1')!.close('person'));
  await until('the toast counts both', () => message() === 'Closed 2 panels');
});

test('a close from code raises no toast', async () => {
  const w = await row();
  await act(async () => void w.panels.get('a1')!.close());
  await until('a closed', () => w.panels.getSnapshot().panels.find((p) => p.id === 'a1')?.status !== 'live');
  assert.equal(message(), '');
});

test('undoToast: false leaves the notice to the host, so the mount draws no toast', async () => {
  const w = await row(undefined, false);
  await act(async () => void w.panels.get('a1')!.close('person'));
  await until('a closed', () => w.panels.getSnapshot().panels.find((p) => p.id === 'a1')?.status !== 'live');
  assert.equal(toast(), null);
});

test('the host labels replace the words', async () => {
  const w = await row({ undoCloseMessage: (titles) => `${titles.length} cerrada`, undo: 'Deshacer' });
  await act(async () => void w.panels.get('c1')!.close('person'));
  await until('the toast says it in the host words', () => message() === '1 cerrada');
  assert.ok(button('Deshacer'));
});

test('the default words', () => {
  assert.equal(DEFAULT_LABELS.undoCloseMessage(['Docs']), 'Closed Docs');
  assert.equal(DEFAULT_LABELS.undoCloseMessage(['Docs', 'Mail']), 'Closed 2 panels');
  assert.equal(DEFAULT_LABELS.undo, 'Undo');
});

test('a closed panel with no title is named by the untitled label', () => {
  const html = renderToStaticMarkup(createElement(UndoCloseToast, { closed: [{ id: 'n', live: false, url: '' }], onUndo: () => {} }));
  assert.match(html, new RegExp(`>Closed ${DEFAULT_LABELS.untitledHeader}<`));
});
