/**
 * slideFrom and side by side together, and side by side alone: a cell already on screen is never thrown aside by a move, and
 * a side that comes into view glides in.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { rigCleanup, until } from './support/auto-rig.js';
import { createWorkspaceColumn } from '../index.js';
import type { ColumnOptions, WorkspaceColumnHandle } from '../index.js';
import { SLIDE_DURATION_SEC, SLIDE_EASE } from '../rowConstants.js';

const proto = HTMLElement.prototype;
const clientWidth = Object.getOwnPropertyDescriptor(proto, 'clientWidth')!;
Object.defineProperty(proto, 'clientWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return this.hasAttribute('data-workspace-column') ? 2560 : (clientWidth.get as () => number).call(this);
  },
});

const columns: WorkspaceColumnHandle[] = [];
afterEach(() => {
  for (const c of columns.splice(0)) act(() => c.dispose());
  rigCleanup();
});

const GLIDE = `transform ${SLIDE_DURATION_SEC}s cubic-bezier(${SLIDE_EASE.join(',')})`;
const cellOf = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-workspace-cell][data-workspace-id="${id}"]`)!;
const pause = () => new Promise((r) => setTimeout(r, 30));

/** Every style the cell is drawn with from now on, the one it ends with last. */
function record(id: string): () => string[] {
  const el = cellOf(id), styles: string[] = [];
  const observer = new MutationObserver((rs) => {
    for (const r of rs) styles.push(r.oldValue ?? '');
  });
  observer.observe(el, { attributes: true, attributeFilter: ['style'], attributeOldValue: true });
  return () => {
    for (const r of observer.takeRecords()) styles.push(r.oldValue ?? '');
    observer.disconnect();
    return [...styles.slice(1), el.getAttribute('style') ?? ''];
  };
}

async function sideBySide(extra: Partial<ColumnOptions> = {}): Promise<WorkspaceColumnHandle> {
  const c = createWorkspaceColumn({ sideBySide: true, ...extra });
  columns.push(c);
  act(() => {
    for (let k = 0; k < 4; k++) c.addWorkspace();
  });
  await until('measured', () => document.querySelectorAll('[data-workspace-cell]').length === 4 && c.shown[0]!.slots > 1);
  await until('ready', () => c.status === 'ready');
  await pause();
  act(() => c.scrollTo(1));
  await pause();
  return c;
}

test('without slideFrom a side newly shown beside the current space glides in', async () => {
  const c = await sideBySide();
  const target = c.workspaces[3]!;
  act(() => void c.showSide(3));
  await until('shown', () => c.shown.length === 2);
  await pause();
  assert.equal(cellOf(target.id).style.transition, GLIDE);
});

for (const withSlideFrom of [false, true]) {
  test(`a move to a side already on screen moves no cell${withSlideFrom ? ', and slideFrom is not asked' : ''}`, async () => {
    let asked = 0;
    const c = await sideBySide(withSlideFrom ? { slideFrom: () => { asked++; return 'right'; } } : {});
    act(() => void c.showSide(3));
    await until('shown', () => c.shown.length === 2);
    await pause();
    const other = c.shown.find((s) => s.workspace.id !== c.workspaces[c.current]!.id)!.workspace;
    const askedBefore = asked, drawn = record(other.id);
    act(() => c.scrollTo(other));
    await pause();
    const styles = drawn();
    assert.ok(styles.every((s) => !/translate\((?:-)?100%|translateY\((?:-)?100%/.test(s)), `never put aside: ${JSON.stringify(styles)}`);
    if (withSlideFrom) assert.equal(asked, askedBefore, 'slideFrom is not asked for a move that moves nothing');
  });
}
