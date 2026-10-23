/**
 * `WorkspacePanel` with host entries: the host's tiles in the groups they fall in, the library's own search over them, a
 * drag that reorders within the grid, a drop on a `WorkspaceTrash` that reports to the host, and the header slot.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { WorkspacePanel, WorkspaceTrash } from '../index.js';
import type { WorkspacePanelEntry, WorkspacePanelProps } from '../index.js';
import { reorderWorkspaceIds, workspaceTileRatio, workspaceTileSpan } from '../workspacePanelModel.js';
import { advanceFrames, cleanup, mount, withHost, type Mounted } from './support/mount-harness.js';
import { FRAME_MS } from './support/jsdom-globals.js';

afterEach(() => cleanup());

const h = React.createElement;
const entry = (id: string, over: Partial<WorkspacePanelEntry> = {}): WorkspacePanelEntry => ({ id, title: `Title ${id}`, live: true, pinned: false, ...over });

function render(props: WorkspacePanelProps): Mounted {
  return mount(withHost(h(WorkspacePanel, props)));
}

const tileIds = (container: HTMLElement): string[] => [...container.querySelectorAll<HTMLElement>('[data-workspace-tile]')].map((t) => t.dataset.workspaceTile ?? '');

function setSearch(container: HTMLElement, value: string): void {
  const input = container.querySelector<HTMLInputElement>('[data-workspace-search]');
  assert.ok(input, 'the search field rendered');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  assert.ok(set, 'the input value setter exists');
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('the host entries render as tiles in the groups they fall in, pinned then viewing then hidden', () => {
  const m = render({
    entries: [entry('parked', { live: false }), entry('open'), entry('kept', { pinned: true, live: false })],
  });
  const groups = [...m.container.querySelectorAll<HTMLElement>('[data-workspace-group]')].map((heading) => ({
    key: heading.dataset.workspaceGroup,
    ids: [...(heading.nextElementSibling?.querySelectorAll<HTMLElement>('[data-workspace-tile]') ?? [])].map((t) => t.dataset.workspaceTile),
  }));
  assert.deepEqual(groups, [
    { key: 'pinned', ids: ['kept'] },
    { key: 'viewing', ids: ['open'] },
    { key: 'hidden', ids: ['parked'] },
  ]);
  m.unmount();
});

test('the library search filters the host entries by title, and says when nothing matches', () => {
  const m = render({ entries: [entry('a', { title: 'Inbox' }), entry('b', { title: 'Calendar' })] });
  setSearch(m.container, 'cal');
  assert.deepEqual(tileIds(m.container), ['b']);
  setSearch(m.container, 'zzz');
  assert.deepEqual(tileIds(m.container), []);
  assert.equal(m.container.querySelector('[data-workspace-empty]')?.textContent, 'No panels match.');
  m.unmount();
});

test('an entry with no picture shows its placeholder photo', () => {
  const m = render({ entries: [entry('a', { placeholder: 'photo.webp' }), entry('b')] });
  const photos = [...m.container.querySelectorAll<HTMLImageElement>('[data-workspace-placeholder]')];
  assert.equal(photos.length, 1);
  assert.equal(photos[0]?.getAttribute('src'), 'photo.webp');
  m.unmount();
});

test('the header slot renders above the grid, and no header is drawn when none is given', () => {
  const withHeader = render({ entries: [entry('a')], header: h('span', { 'data-host-header': '' }, 'icons') });
  const header = withHeader.container.querySelector('[data-workspace-header]');
  const grid = withHeader.container.querySelector('[data-workspace-tiles]');
  assert.ok(header?.querySelector('[data-host-header]'), 'the host content is inside the header');
  assert.ok(header && grid && (header.compareDocumentPosition(grid) & 4) !== 0, 'the header comes before the grid');
  withHeader.unmount();

  const without = render({ entries: [entry('a')] });
  assert.equal(without.container.querySelector('[data-workspace-header]'), null);
  without.unmount();
});

test('the reorder helper moves the dragged id onto the target place, as a sortable list does', () => {
  assert.deepEqual(reorderWorkspaceIds(['a', 'b', 'c'], 'a', 'c'), ['b', 'c', 'a']);
  assert.deepEqual(reorderWorkspaceIds(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  assert.deepEqual(reorderWorkspaceIds(['a', 'b', 'c'], 'b', 'b'), ['a', 'b', 'c'], 'the same id changes nothing');
  assert.deepEqual(reorderWorkspaceIds(['a', 'b'], 'x', 'a'), ['a', 'b'], 'an absent id changes nothing');
});

test('a tile spans its panel slots, capped at the grid columns, and one slot when none is given', () => {
  assert.equal(workspaceTileSpan(undefined, 4), 1);
  assert.equal(workspaceTileSpan(2, 4), 2, 'a Fold-width panel spans two columns');
  assert.equal(workspaceTileSpan(3, 4), 3);
  assert.equal(workspaceTileSpan(4, 3), 3, 'a Desktop panel on a Large grid is capped at its three columns');
  assert.equal(workspaceTileSpan(5, 5), 5, 'the cap is the grid, not a fixed number');
  assert.throws(() => workspaceTileSpan(0, 4), RangeError);
  assert.throws(() => workspaceTileSpan(1.5, 4), RangeError);
});

test('the rendered tiles span their slots within the medium grid of four columns', () => {
  const m = render({ entries: [entry('phone'), entry('fold', { slots: 2 }), entry('desk', { slots: 4 }), entry('ultra', { slots: 6 })] });
  const spans = Object.fromEntries([...m.container.querySelectorAll<HTMLElement>('[data-workspace-tile]')].map((t) => [t.dataset.workspaceTile, t.dataset.span]));
  assert.deepEqual(spans, { phone: '1', fold: '2', desk: '4', ultra: '4' });
  m.unmount();
});

test('a tile picture is its span in phone widths by one phone height, so a two-column tile is no taller than a one-column tile', () => {
  const phone = { width: 390, height: 844 };
  assert.equal(workspaceTileRatio(1, phone), '390 / 844');
  assert.equal(workspaceTileRatio(2, phone), '780 / 844', 'twice as wide, the same height');
  assert.equal(workspaceTileRatio(3, phone), '1170 / 844');
});

// jsdom lays nothing out, so each tile and the trash get a fixed box that the drag measures against.
const rowRect = (index: number): DOMRect => toRect(index * 50, 0, 100, 40);
const TRASH_RECT = toRect(0, 300, 40, 40);

function toRect(top: number, left: number, width: number, height: number): DOMRect {
  return { x: left, y: top, top, left, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}

/** Places each tile in its row (by DOM order) and the trash at the right, for the length of `run`. */
async function withLayout(container: HTMLElement, run: () => Promise<void>): Promise<void> {
  const original = Element.prototype.getBoundingClientRect;
  const rects = new Map<string, DOMRect>();
  [...container.querySelectorAll<HTMLElement>('[data-workspace-tile]')].forEach((tile, index) => rects.set(tile.dataset.workspaceTile ?? '', rowRect(index)));
  rects.set('trash', TRASH_RECT);
  Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element): DOMRect {
    const key = this.hasAttribute('data-workspace-trash') ? 'trash' : (this as HTMLElement).dataset.workspaceTile;
    return (key !== undefined && rects.get(key)) || original.call(this);
  };
  try {
    await run();
  } finally {
    Element.prototype.getBoundingClientRect = original;
  }
}

/** A mouse drag from `from` by (dx, dy): press, move past the drag threshold, move on, release. */
async function dragBy(from: HTMLElement, dx: number, dy: number): Promise<void> {
  const x = 50;
  const y = 20;
  const mouse = (type: string, cx: number, cy: number): MouseEvent => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: type === 'mouseup' ? 0 : 1 });
  act(() => {
    from.dispatchEvent(mouse('mousedown', x, y));
  });
  await advanceFrames(FRAME_MS);
  await act(async () => {
    document.dispatchEvent(mouse('mousemove', x, y + 10));
  });
  await advanceFrames(FRAME_MS);
  await act(async () => {
    document.dispatchEvent(mouse('mousemove', x + dx, y + dy));
  });
  await advanceFrames(FRAME_MS);
  await act(async () => {
    document.dispatchEvent(mouse('mouseup', x + dx, y + dy));
  });
  await advanceFrames(FRAME_MS);
}

test('dragging a tile onto another reorders the grid through onReorder and leaves the order to the host', async () => {
  const reordered: string[][] = [];
  const entries = [entry('a'), entry('b'), entry('c')];
  const m = render({ entries, onReorder: (ids) => reordered.push([...ids]) });
  await withLayout(m.container, async () => {
    const tile = m.container.querySelector<HTMLElement>('[data-workspace-tile="a"]');
    assert.ok(tile, 'the tile rendered');
    await dragBy(tile, 0, 100);
  });
  assert.deepEqual(reordered, [['b', 'c', 'a']]);
  assert.deepEqual(tileIds(m.container), ['a', 'b', 'c'], 'the library drew no new order of its own');

  m.rerender(withHost(h('div', null, h(WorkspacePanel, { entries: [entry('b'), entry('c'), entry('a')], onReorder: (ids) => reordered.push([...ids]) }))));
  assert.deepEqual(tileIds(m.container), ['b', 'c', 'a'], 'the grid shows the order the host gives');
  m.unmount();
});

test('dropping a tile on the host trash calls onTrash with its id and removes nothing itself', async () => {
  const trashed: string[] = [];
  const reordered: string[][] = [];
  const entries = [entry('a'), entry('b')];
  const m = render({ entries, onTrash: (id) => trashed.push(id), onReorder: (ids) => reordered.push([...ids]), header: h(WorkspaceTrash, null, 'bin') });
  await withLayout(m.container, async () => {
    const tile = m.container.querySelector<HTMLElement>('[data-workspace-tile="a"]');
    assert.ok(tile, 'the tile rendered');
    await dragBy(tile, 270, 0);
  });
  assert.deepEqual(trashed, ['a']);
  assert.deepEqual(reordered, [], 'a trash drop is not a reorder');
  assert.deepEqual(tileIds(m.container), ['a', 'b'], 'the library does not remove the entry');
  m.unmount();
});
