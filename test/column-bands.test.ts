/**
 * Column bands: a column draws the slots its options name, in order, above and below every cell's row; `withSlotChanges`
 * replaces, hides and adds by id and hands a replacement the default it replaced; the row keeps `columnBandRoom` clear.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import {
  COLUMN_BOTTOM_BAND,
  COLUMN_TOP_BAND,
  columnBandRoom,
  createWorkspaceColumn,
  DEFAULT_COLUMN_BANDS,
  definePanel,
  withSlotChanges,
} from '../index.js';
import type { ColumnSlotProps, PanelTemplate, WorkspaceColumnHandle } from '../index.js';
import { rigCleanup, until } from './support/auto-rig.js';

const columns: WorkspaceColumnHandle[] = [];
afterEach(() => {
  for (const c of columns.splice(0)) act(() => c.dispose());
  rigCleanup();
});

const tpl: PanelTemplate = definePanel({ id: 'a', view: () => React.createElement('i') });
const make = (o: Parameters<typeof createWorkspaceColumn>[0] = {}): WorkspaceColumnHandle => {
  const c = createWorkspaceColumn({ templates: [tpl], ...o });
  columns.push(c);
  return c;
};
const cells = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-workspace-cell]')];
const slotIds = (cell: HTMLElement, side: 'above' | 'below'): string[] =>
  [...cell.querySelectorAll<HTMLElement>(`[data-column-band="${side}"] > [data-column-slot]`)].map((el) => el.dataset.columnSlot!);

const Orange = ({ Default, ...props }: ColumnSlotProps): React.ReactElement =>
  props.index === 0 ? React.createElement('b', { 'data-orange': props.workspace.name }) : React.createElement(Default!, { ...props, Default: undefined });
const Strip = ({ workspace }: ColumnSlotProps): React.ReactElement => React.createElement('span', { 'data-strip': workspace.id });

test('the default bands keep the room the column always kept: 76 above, 26 below', () => {
  assert.deepEqual(columnBandRoom(DEFAULT_COLUMN_BANDS), { above: 76, below: 26 });
  assert.equal(COLUMN_TOP_BAND, 76);
  assert.equal(COLUMN_BOTTOM_BAND, 26);
});

test('without bands a cell draws the default slots in order', async () => {
  const c = make();
  act(() => void c.addWorkspace());
  await until('a cell', () => cells().length === 1);
  assert.deepEqual(slotIds(cells()[0]!, 'above'), ['neighbour-above', 'workspace-name']);
  assert.deepEqual(slotIds(cells()[0]!, 'below'), ['neighbour-below']);
});

test('withSlotChanges replaces, hides and adds by id, and leaves the bands it was given alone', () => {
  const before = JSON.stringify(DEFAULT_COLUMN_BANDS.above.slots.map((s) => s.id));
  const bands = withSlotChanges(DEFAULT_COLUMN_BANDS, {
    replace: { 'neighbour-above': Orange, 'neighbour-below': { component: Orange, height: 40 } },
    hide: ['workspace-name'],
    add: [
      { id: 'strip', band: 'below', before: 'neighbour-below', height: 30, component: Strip },
      { id: 'tail', band: 'above', height: 10, component: Strip },
      { id: 'head', band: 'above', after: 'nowhere', height: 10, component: Strip },
    ],
  });
  assert.deepEqual(bands.above.slots.map((s) => s.id), ['neighbour-above', 'tail', 'head']);
  assert.deepEqual(bands.below.slots.map((s) => [s.id, s.height]), [['strip', 30], ['neighbour-below', 40]]);
  assert.equal(bands.above.slots[0]!.base, DEFAULT_COLUMN_BANDS.above.slots[0]!.component, 'the replaced default is kept as base');
  assert.equal(JSON.stringify(DEFAULT_COLUMN_BANDS.above.slots.map((s) => s.id)), before);
  assert.deepEqual(columnBandRoom(bands), { above: 24 + 10 + 10 + 28, below: 30 + 40 + 2 });
});

test('an id that names no slot is skipped with one warning, never thrown', () => {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (m: string) => void warnings.push(m);
  try {
    const bands = withSlotChanges(DEFAULT_COLUMN_BANDS, { replace: { 'gone-slot': Strip }, hide: ['gone-too'] });
    withSlotChanges(DEFAULT_COLUMN_BANDS, { replace: { 'gone-slot': Strip } });
    assert.deepEqual(bands.above.slots.map((s) => s.id), ['neighbour-above', 'workspace-name']);
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 2, warnings.join('\n'));
  assert.match(warnings[0]!, /'gone-slot'/);
  assert.match(warnings[1]!, /'gone-too'/);
});

test('a column draws its own bands, and a replacement falls back to the default it was given', async () => {
  const bands = withSlotChanges(DEFAULT_COLUMN_BANDS, {
    replace: { 'neighbour-above': Orange },
    add: [{ id: 'strip', band: 'below', before: 'neighbour-below', height: 30, component: Strip, align: 'end' }],
  });
  const c = make({ bands });
  act(() => {
    c.addWorkspace();
    c.addWorkspace();
  });
  await until('two cells', () => cells().length === 2);
  const [first, second] = cells() as [HTMLElement, HTMLElement];
  assert.ok(first.querySelector('[data-column-slot="neighbour-above"] [data-orange]'), 'the first workspace draws the replacement');
  assert.equal(first.querySelector('[data-workspace-neighbour="above"]'), null);
  assert.equal(second.querySelector('[data-workspace-neighbour="above"]')?.textContent, first.querySelector('[data-orange]')!.getAttribute('data-orange'), 'the second falls back to the default link');
  assert.deepEqual(slotIds(first, 'below'), ['strip', 'neighbour-below']);
  const strip = first.querySelector<HTMLElement>('[data-column-slot="strip"]')!;
  assert.equal(strip.style.height, '30px');
  assert.equal(strip.style.justifyContent, 'flex-end');
  assert.equal(first.querySelector<HTMLElement>('[data-column-band="below"]')!.style.height, '54px');
});

test('a band lets clicks through to the row; only its slots take them', async () => {
  const c = make();
  act(() => void c.addWorkspace());
  await until('a cell', () => cells().length === 1);
  const band = cells()[0]!.querySelector<HTMLElement>('[data-column-band="above"]')!;
  assert.equal(band.style.pointerEvents, 'none');
  // jsdom does no hit-testing, so the test pins the structure that makes it right: the slot box spans the cell's width and
  // inherits `none`; the wrapper that turns events back on draws no box, so only the slot's own content takes them.
  const slot = band.querySelector<HTMLElement>('[data-column-slot]')!;
  assert.equal(slot.style.pointerEvents, '');
  const wrapper = slot.firstElementChild as HTMLElement;
  assert.equal(wrapper.style.display, 'contents');
  assert.equal(wrapper.style.pointerEvents, 'auto');
  assert.ok(wrapper.querySelector('[data-workspace-neighbour="above"]'), 'the link is inside the wrapper');
});

test('a band with a size and a justify spreads its slots through it', async () => {
  const bands = withSlotChanges(DEFAULT_COLUMN_BANDS, { above: { size: 'var(--row-above)', justify: 'space-evenly' } });
  const c = make({ bands });
  act(() => void c.addWorkspace());
  await until('a cell', () => cells().length === 1);
  const band = cells()[0]!.querySelector<HTMLElement>('[data-column-band="above"]')!;
  assert.equal(band.style.height, 'var(--row-above)');
  assert.equal(band.style.justifyContent, 'space-evenly');
});

test('a band below that outgrows the default lifts the library row by the difference; the default leaves it alone', async () => {
  const padding = async (o: Parameters<typeof createWorkspaceColumn>[0]): Promise<string> => {
    const c = make(o);
    act(() => void c.addWorkspace());
    await until('the row', () => document.querySelector('[data-row-scroller]') !== null);
    const value = getComputedStyle(document.querySelector('[data-row-scroller]')!).paddingBottom;
    act(() => c.dispose());
    rigCleanup();
    return value;
  };
  assert.equal(await padding({}), '40px');
  const bands = withSlotChanges(DEFAULT_COLUMN_BANDS, { add: [{ id: 'strip', band: 'below', height: 30, component: Strip }] });
  assert.equal(await padding({ bands }), '70px');
});

test('a band edge moves the band off its window edge and counts in its room', async () => {
  const bands = withSlotChanges(DEFAULT_COLUMN_BANDS, { above: { edge: 10 }, below: { edge: 24 } });
  assert.deepEqual(columnBandRoom(bands), { above: 86, below: 48 });
  const c = make({ bands, topInset: 4 });
  act(() => void c.addWorkspace());
  await until('a cell', () => cells().length === 1);
  const cell = cells()[0]!;
  assert.match(cell.querySelector<HTMLElement>('[data-column-band="above"]')!.style.top, /^calc\(14px \+ /);
  assert.match(cell.querySelector<HTMLElement>('[data-column-band="below"]')!.style.bottom, /^calc\(24px \+ /);
});
