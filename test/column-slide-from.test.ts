/**
 * `slideFrom` picks the side each move of the column comes in from. The arriving cell is first drawn on that side with no
 * transition, then glides in; the cell left glides out the other way; a move made mid-slide never makes a cell jump; and
 * `reducedSwitch: 'fade'` crossfades under Reduce Motion. A mutant that drops the first frame on the arriving side, or that clears a
 * cell's transition before its own transition ends, fails here.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { rigCleanup, until } from './support/auto-rig.js';
import type { createWorkspaceColumn as CreateColumn, ColumnSlide, WorkspaceColumnHandle, WorkspaceHandle } from '../index.js';
import { SLIDE_DURATION_SEC, SLIDE_EASE } from '../rowConstants.js';
import { STILL, settledMotion, switchMotion } from '../columnSlide.js';

const reduced = { matches: false, listeners: new Set<() => void>() };
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    media: query,
    get matches() {
      return reduced.matches;
    },
    addEventListener: (_type: string, listener: () => void) => void reduced.listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void reduced.listeners.delete(listener),
  }),
});
const { createWorkspaceColumn } = (await import('../index.js')) as { createWorkspaceColumn: typeof CreateColumn };

function reduceMotion(on: boolean): void {
  reduced.matches = on;
  for (const listener of [...reduced.listeners]) listener();
}

const columns: WorkspaceColumnHandle[] = [];
afterEach(() => {
  reduceMotion(false);
  for (const c of columns.splice(0)) act(() => c.dispose());
  rigCleanup();
});

const GLIDE = `transform ${SLIDE_DURATION_SEC}s cubic-bezier(${SLIDE_EASE.join(',')})`;
const cellOf = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-workspace-cell][data-workspace-id="${id}"]`)!;

/** Every style a cell is drawn with, in order. Read from each mutation's old value, so a frame two commits overwrite in one task is still seen. */
function record(id: string): () => { transform: string; transition: string; opacity: string }[] {
  const el = cellOf(id);
  const styles: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const r of records) styles.push(r.oldValue ?? '');
  });
  observer.observe(el, { attributes: true, attributeFilter: ['style'], attributeOldValue: true });
  const probe = document.createElement('div');
  const read = (css: string) => {
    probe.style.cssText = css;
    return { transform: probe.style.transform, transition: probe.style.transition, opacity: probe.style.opacity };
  };
  return () => {
    for (const r of observer.takeRecords()) styles.push(r.oldValue ?? '');
    return [...styles, el.style.cssText].map(read);
  };
}

async function column(o: Parameters<typeof CreateColumn>[0], n = 4): Promise<WorkspaceColumnHandle> {
  const c = createWorkspaceColumn(o);
  columns.push(c);
  act(() => {
    for (let i = 0; i < n; i++) c.addWorkspace();
  });
  await until(`${n} cells`, () => document.querySelectorAll('[data-workspace-cell]').length === n);
  await until('ready', () => c.status === 'ready');
  await new Promise((r) => setTimeout(r, 30));
  return c;
}

for (const [side, start, exit] of [
  ['right', 'translate(100%, 0%)', 'translate(-100%, 0%)'],
  ['left', 'translate(-100%, 0%)', 'translate(100%, 0%)'],
  ['above', 'translate(0%, -100%)', 'translate(0%, 100%)'],
  ['below', 'translate(0%, 100%)', 'translate(0%, -100%)'],
] as const) {
  test(`slideFrom '${side}': the arriving space starts on that side and the one left goes out the other way`, async () => {
    // Every move to index 2 comes from `side`, though it is further down the list.
    const c = await column({ slideFrom: () => side });
    const [a, , target] = c.workspaces as WorkspaceHandle[];
    const drawn = record(target!.id);
    act(() => c.scrollTo(target!));
    await until('arrived', () => cellOf(target!.id).style.transform === 'translate(0%, 0%)');
    const arriving = drawn();
    const first = arriving.findIndex((s) => s.transform === start);
    assert.ok(first >= 0, `the arriving space was drawn at ${start}: ${JSON.stringify(arriving)}`);
    assert.equal(arriving[first]!.transition, 'none', 'and put there without a glide');
    const last = arriving[arriving.length - 1]!;
    assert.deepEqual([last.transform, last.transition], ['translate(0%, 0%)', GLIDE], 'then it glides into view');
    assert.equal(cellOf(a!.id).style.transform, exit, 'the space left rests on the opposite side');
    assert.equal(cellOf(a!.id).style.transition, GLIDE, 'and glides there');
  });
}

test('slideFrom is asked with the space left and the one arrived at, and none moves at once', async () => {
  const asked: [string, string][] = [];
  const c = await column({ slideFrom: (from, to) => (asked.push([from.name, to.name]), 'none') });
  act(() => c.scrollTo(3));
  await until('arrived', () => cellOf(c.workspaces[3]!.id).style.transform === 'translate(0%, 0%)');
  assert.deepEqual(asked, [['Space 1', 'Space 4']]);
  assert.equal(cellOf(c.workspaces[3]!.id).style.transition, 'none');
  assert.equal(cellOf(c.workspaces[0]!.id).style.transition, 'none');
});

test('a delete that moves on asks slideFrom with the removed space as the one left', async () => {
  const asked: [string, string][] = [];
  const c = await column({ slideFrom: (from, to) => (asked.push([from.name, to.name]), 'right') });
  act(() => c.removeWorkspace(0));
  await until('three cells', () => document.querySelectorAll('[data-workspace-cell]').length === 3);
  assert.deepEqual(asked, [['Space 1', 'Space 2']]);
  assert.equal(cellOf(c.workspaces[0]!.id).style.transition, GLIDE, 'the next space glides in');
});

test('a space called back mid-slide turns around from where it is; none of the cells loses its glide', async () => {
  const sides: ColumnSlide[] = ['right', 'left'];
  const c = await column({ slideFrom: () => sides.shift() ?? 'right' });
  const [a, b] = c.workspaces as WorkspaceHandle[];
  act(() => c.scrollTo(b!));
  await until('b in view', () => cellOf(b!.id).style.transform === 'translate(0%, 0%)');
  const drawnBack = record(a!.id);
  act(() => c.scrollTo(a!));
  await until('a in view again', () => cellOf(a!.id).style.transform === 'translate(0%, 0%)');
  const back = drawnBack();
  assert.ok(!back.some((s) => s.transition === 'none'), `a still sliding out is never snapped to a side: ${JSON.stringify(back)}`);
  assert.equal(cellOf(b!.id).style.transform, 'translate(100%, 0%)', 'b goes back out to the right');
  assert.equal(cellOf(b!.id).style.transition, GLIDE, 'and glides, from where it got to');
});

test('a third space chosen mid-slide leaves the earlier one still gliding to its side, not jumping there', async () => {
  const c = await column({});
  const [a, b, d] = c.workspaces as WorkspaceHandle[];
  act(() => c.scrollTo(b!));
  await until('b in view', () => cellOf(b!.id).style.transform === 'translateY(0%)');
  act(() => c.scrollTo(d!));
  await until('d in view', () => cellOf(d!.id).style.transform === 'translateY(0%)');
  assert.equal(cellOf(a!.id).style.transition, GLIDE, 'the first space left keeps its glide until its own transition ends');
  assert.equal(cellOf(b!.id).style.transition, GLIDE, 'the half-arrived one glides away');
  act(() => void cellOf(a!.id).dispatchEvent(Object.assign(new Event('transitionend', { bubbles: true }), { propertyName: 'transform' })));
  await until('a settled', () => cellOf(a!.id).style.transition === 'none');
});

test("reducedSwitch 'fade' crossfades under Reduce Motion: nothing moves, the space left fades out and the one arrived at fades in", async () => {
  reduceMotion(true);
  const c = await column({ slideFrom: () => 'right', reducedSwitch: 'fade' });
  const [a, , target] = c.workspaces as WorkspaceHandle[];
  const drawn = record(target!.id);
  act(() => c.scrollTo(target!));
  await until('arrived', () => cellOf(target!.id).style.opacity === '1');
  const arriving = drawn();
  assert.ok(arriving.some((s) => s.opacity === '0' && s.transition === 'none' && s.transform === 'translate(0%, 0%)'), `it starts transparent in place: ${JSON.stringify(arriving)}`);
  assert.ok(!arriving.some((s) => s.transition.startsWith('transform')), 'it never slides');
  assert.match(cellOf(target!.id).style.transition, /^opacity /, 'it fades');
  assert.equal(cellOf(a!.id).style.transform, 'translate(0%, 0%)', 'the space left stays where it stood');
  assert.equal(cellOf(a!.id).style.opacity, '0', 'and fades out');
});

test("Reduce Motion without reducedSwitch still switches at once", async () => {
  reduceMotion(true);
  const c = await column({ slideFrom: () => 'right' });
  act(() => c.scrollTo(2));
  await until('arrived', () => cellOf(c.workspaces[2]!.id).style.transform === 'translate(0%, 0%)');
  assert.equal(cellOf(c.workspaces[2]!.id).style.transition, 'none');
  assert.equal(cellOf(c.workspaces[0]!.id).style.transition, 'none');
});

test('switchMotion: an arriving cell already resting on its side needs no first frame; a sliding one turns around', () => {
  const rest = (): 'below' => 'below';
  const first = switchMotion(STILL, 'a', 'b', 'below', rest);
  assert.equal(first.pre, null, 'b rests below already');
  assert.equal(first.park.get('a'), 'above');
  const sideways = switchMotion(STILL, 'a', 'b', 'right', rest);
  assert.deepEqual(sideways.pre, { id: 'b', slide: 'right' }, 'b is put on the right first');
  const back = switchMotion({ ...sideways, pre: null }, 'b', 'a', 'left', rest);
  assert.equal(back.pre, null, 'a is still sliding, so it turns around');
  assert.equal(back.park.get('b'), 'right');
  const settled = settledMotion(back, 'b');
  assert.equal(settled.moving.has('b'), false);
  assert.equal(settled.moving.get('a'), 'slide');
});
