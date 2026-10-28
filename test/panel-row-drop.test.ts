/**
 * usePanelRowDrop: a drag that starts outside the row parts it by the header drag's hop rule and drops the panel at the
 * pointed slot. Slots are read through their drawn translateX, since jsdom has no layout; the row's own rect is the
 * origin, so a pointer at slotX + 195 + offset is `offset` px from the slot's center.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { rowOffsetOf } from './support/strip.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose, usePanelRowDrop, useWorkspace } from '../index.js';
import type { PanelRowDrop, PanelResult, ViewWorkspace } from '../index.js';
import { landPanelIn } from '../workspaceCore.js';
import { FRAME_MS } from './support/jsdom-globals.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';
import { made, mountRow, panelsOf, rootEntry, row, type MountedRow } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';

afterEach(async () => {
  document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  await advanceFrames(5 * FRAME_MS);
  cleanup();
});

const seen: { drop?: PanelRowDrop; ws?: ViewWorkspace } = {};
function DropView({ id }: { id: string }): React.ReactElement {
  const drop = usePanelRowDrop();
  const ws = useWorkspace();
  if (id === 'root') {
    seen.drop = drop;
    if (ws !== undefined) seen.ws = ws;
  }
  return React.createElement(DragToClose, {
    reorder: { onDragEnd: () => {} },
    children: (handle) => React.createElement('div', { 'data-grab': id, onPointerDown: handle.onPointerDown }, id),
  });
}
registerTestView('scroll-row-view', ({ panel }) => React.createElement(DropView, { id: panel.id }));

const SPAN = 406;
const HALF = 195;
const slotOf = (m: MountedRow, id: string): HTMLElement => {
  const grab = m.container.querySelector<HTMLElement>(`[data-grab="${id}"]`);
  assert.ok(grab, `${id} rendered`);
  const slot = grab.closest<HTMLElement>('[data-drag-to-close]')?.closest<HTMLElement>('[data-row-slot]');
  assert.ok(slot, `${id} sits in a slot`);
  return slot;
};
const xOf = (m: MountedRow, id: string): number => {
  const match = /translateX\((-?[\d.e+-]+)px\)/.exec(slotOf(m, id).style.transform);
  return match === null ? 0 : Math.round(Number(match[1]));
};
const xs = (m: MountedRow, ids: string[]): Record<string, number> => Object.fromEntries(ids.map((id) => [id, xOf(m, id)]));
const order = (m: MountedRow): string => m.latest().entries.map((p) => p.id).join(',');
const liveIds = (m: MountedRow): string => m.latest().entries.filter((p) => p.live).map((p) => p.id).join(',');
const gapOf = (m: MountedRow): HTMLElement | null => m.container.querySelector<HTMLElement>('[data-panel-row-drop-gap]');
const frames = (n: number): Promise<void> => advanceFrames(n * FRAME_MS);
const settle = async (): Promise<void> => frames(120);

/** A row of four panels after the root, mounted wide enough to show all of them. */
async function mounted(entries = panelsOf(4), width = 3000): Promise<MountedRow> {
  seen.drop = undefined;
  seen.ws = undefined;
  const m = mountRow(entries, width);
  await settle();
  assert.ok(seen.drop && seen.ws, 'the views rendered inside the row');
  return m;
}
const hook = (): PanelRowDrop => seen.drop!;
const begin = (id: string, source?: 'code' | 'person'): boolean => {
  let started = false;
  act(() => {
    started = hook().begin(id, source);
  });
  return started;
};
const update = async (x: number): Promise<void> => {
  await act(async () => hook().update(x));
  await frames(40);
};
const finish = async (): Promise<PanelResult> => {
  let result: PanelResult | undefined;
  await act(async () => {
    result = hook().end();
  });
  await settle();
  return result!;
};
/** A pointer `offset` px from the center of `id`'s slot as it rests now. */
const at = (m: MountedRow, id: string, offset: number): number => xOf(m, id) + HALF + offset;

// ---------------------------------------------------------------------------
// begin refuses
// ---------------------------------------------------------------------------

test('begin refuses an unknown panel, the root, and a second drag while one is in progress', async () => {
  const m = await mounted();
  assert.equal(begin('nobody'), false, 'unknown id');
  assert.equal(begin('root'), false, 'the fixed root');
  assert.equal(begin('s2'), true);
  assert.equal(begin('s3'), false, 'one row drop at a time');
  act(() => hook().cancel());
  assert.equal(begin('s3'), true, 'cancel frees the next drag');
  act(() => hook().cancel());
  assert.equal(order(m), 'root,s1,s2,s3,s4');
});

test('begin refuses a panel that is not movable for a person, and takes it for code', async () => {
  const m = await mounted(row(rootEntry(), made('s1', { movable: false }), made('s2'), made('s3')));
  assert.equal(begin('s1'), false, 'a person may not move it');
  assert.equal(begin('s1', 'person'), false);
  assert.equal(begin('s1', 'code'), true, 'code is not limited by movable');
  act(() => hook().cancel());
  assert.equal(begin('s2'), true);
  act(() => hook().cancel());
  assert.equal(order(m), 'root,s1,s2,s3');
});

test('begin refuses the root for code as well, whatever its movable says', async () => {
  await mounted();
  assert.equal(begin('root', 'code'), false);
});

test('begin refuses a closed panel, and one that is still being added', async () => {
  const m = await mounted();
  const handle = seen.ws!.panels.get('s3')!;
  await act(async () => void handle.close());
  await settle();
  assert.equal(begin('s3'), false, 'closed');
  assert.equal(order(m), 'root,s1,s2,s4');
});

test('begin refuses a panel that is still being added', async () => {
  const m = await mounted();
  let status: string | undefined;
  let started = true;
  act(() => {
    m.workspace.addPanel('scroll-row-view', { id: 'fresh' });
    status = m.workspace.panels.get('fresh')?.getState().status;
    started = hook().begin('fresh');
  });
  assert.equal(status, 'pending', 'the panel is not in the row yet');
  assert.equal(started, false);
  await settle();
});

test('outside a row the hook answers false and does nothing', () => {
  let drop: PanelRowDrop | undefined;
  function Outside(): React.ReactElement {
    drop = usePanelRowDrop();
    return React.createElement('i');
  }
  mount(React.createElement(Outside));
  assert.equal(drop!.begin('s1'), false);
  drop!.update(10);
  drop!.cancel();
  assert.equal(drop!.end().ok, false);
});

test('end with no drag in progress is a refusal that touches nothing', async () => {
  const m = await mounted();
  const result = await finish();
  assert.equal(result.ok, false);
  assert.equal(order(m), 'root,s1,s2,s3,s4');
});

// ---------------------------------------------------------------------------
// update parts the row by the header drag's rule
// ---------------------------------------------------------------------------

const OFFSETS = [-1300, -620, -410, -200, 0, 150, 205, 420, 700, 1300];

test('for the same offsets the hook parts the neighbours exactly as a header drag of the same panel does', async () => {
  const others = ['root', 's1', 's3', 's4'];
  for (const offset of OFFSETS) {
    let viaHook: Record<string, number>;
    {
      const m = await mounted();
      begin('s2');
      await update(at(m, 's2', offset));
      viaHook = xs(m, others);
      act(() => hook().cancel());
      cleanup();
    }
    const m = await mounted();
    await drag(slotOf(m, 's2').querySelector('[data-grab="s2"]')!, { dx: offset, dy: 0, steps: 12, hold: 8, keepDown: true });
    await frames(60);
    const viaHeader = xs(m, others);
    await release(offset, 0);
    await frames(60);
    cleanup();
    assert.deepEqual(viaHook, viaHeader, `offset ${offset}`);
  }
});

test('the hop count is the header rule at literal offsets: a hop needs half the next neighbour\'s span, counted from where the last hop ended', async () => {
  // A phone neighbor is 390 + 16 gap = 406 wide, so the thresholds are 203, 609 and 1015.
  const cases: Array<[number, string]> = [
    [202, 'root,s1,s2,s3,s4'],
    [204, 'root,s2,s1,s3,s4'],
    [608, 'root,s2,s1,s3,s4'],
    [610, 'root,s2,s3,s1,s4'],
  ];
  for (const [offset, expected] of cases) {
    const m = await mounted();
    begin('s1');
    await update(at(m, 's1', offset));
    await finish();
    assert.equal(order(m), expected, `offset ${offset}`);
    cleanup();
  }
});

test('the dragged panel itself sits in the slot its hops end in, and the drop commits that order with one move', async () => {
  const m = await mounted();
  const before = xs(m, ['s2', 's3', 's4']);
  begin('s2');
  await update(at(m, 's2', SPAN + 10));
  assert.equal(xOf(m, 's3'), before.s3! - SPAN, 'the crossed neighbour made room');
  assert.equal(xOf(m, 's4'), before.s4, 'the next one did not move yet');
  assert.equal(xOf(m, 's2'), before.s2! + SPAN, 'the dragged panel stands where it would land');
  assert.equal(order(m), 'root,s1,s2,s3,s4', 'the order only changes at the drop');
  let changes = 0;
  const off = seen.ws!.panels.subscribe(() => void (changes += 1));
  const result = await finish();
  off();
  assert.deepEqual(result, { ok: true, changed: true });
  assert.equal(order(m), 'root,s1,s3,s2,s4');
  assert.equal(changes, 1, 'one change reached the workspace');
});

test('a drop that crosses nothing is accepted and changes nothing', async () => {
  const m = await mounted();
  begin('s2');
  await update(at(m, 's2', 30));
  const result = await finish();
  assert.deepEqual(result, { ok: true, changed: false });
  assert.equal(order(m), 'root,s1,s2,s3,s4');
});

test('dragging left parts the panels on the left the other way', async () => {
  const m = await mounted();
  const rest = xs(m, ['s1', 's2']);
  begin('s3');
  await update(at(m, 's3', -SPAN * 2 + 10));
  assert.equal(xOf(m, 's2'), rest.s2! + SPAN);
  assert.equal(xOf(m, 's1'), rest.s1! + SPAN);
  await finish();
  assert.equal(order(m), 'root,s3,s1,s2,s4');
});

test('a panel that cannot be crossed stops the preview and the drop at it', async () => {
  const m = await mounted(row(rootEntry(), made('s1'), made('s2', { crossable: false }), made('s3')));
  const before = xs(m, ['s2', 's3']);
  begin('s1');
  await update(at(m, 's1', SPAN * 2 + 10));
  assert.deepEqual(xs(m, ['s2', 's3']), before);
  const result = await finish();
  assert.equal(result.ok && result.changed, false);
  assert.equal(order(m), 'root,s1,s2,s3');
});

test('a pinned panel (left of the root) does not hop over an uncrossable entry either', async () => {
  const m = await mounted(row(made('s1'), made('s2', { crossable: false }), rootEntry(), made('s3')));
  const before = xs(m, ['s2', 'root']);
  begin('s1');
  await update(at(m, 's1', SPAN * 2 + 10));
  assert.deepEqual(xs(m, ['s2', 'root']), before);
  await finish();
  assert.equal(order(m), 's1,s2,root,s3');
});

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

test('cancel leaves a panel in view and every slot exactly as it was', async () => {
  const m = await mounted();
  const ids = ['root', 's1', 's2', 's3', 's4'];
  const before = xs(m, ids);
  const entries = m.latest().entries;
  let changes = 0;
  const off = seen.ws!.panels.subscribe(() => void (changes += 1));
  begin('s2');
  await update(at(m, 's2', SPAN * 2 + 10));
  assert.notDeepEqual(xs(m, ids), before, 'the preview moved something');
  act(() => hook().cancel());
  await settle();
  off();
  assert.deepEqual(xs(m, ids), before);
  assert.equal(m.latest().entries, entries, 'the row was never rewritten');
  assert.equal(changes, 0);
  assert.equal(slotOf(m, 's2').style.zIndex, '1', 'and nothing stays raised');
});

// ---------------------------------------------------------------------------
// a panel that is not in view
// ---------------------------------------------------------------------------

const parkedRow = (): ReturnType<typeof panelsOf> => row(rootEntry(), made('s1'), made('s2'), made('s3', {}, { live: false }), made('s4'), made('s5'));

test('a parked source holds open a gap its own width at its slot, and the panels after it move right by the span', async () => {
  const m = await mounted(parkedRow());
  assert.equal(liveIds(m), 'root,s1,s2,s4,s5');
  const rest = xs(m, ['s2', 's4', 's5']);
  assert.equal(gapOf(m), null, 'no gap before the drag');
  assert.equal(begin('s3'), true);
  await frames(40);
  const gap = gapOf(m);
  assert.ok(gap, 'a gap appears while dragging');
  assert.equal(getComputedStyle(gap).width, '390px', 'as wide as the entry');
  assert.equal(getComputedStyle(gap).left, `${rest.s4}px`, 'where the next panel rested');
  assert.equal(xOf(m, 's4'), rest.s4! + SPAN);
  assert.equal(xOf(m, 's5'), rest.s5! + SPAN);
  assert.equal(xOf(m, 's2'), rest.s2, 'a panel before it is untouched');
  act(() => hook().cancel());
  await frames(40);
  assert.equal(gapOf(m), null, 'the gap goes with the drag');
  assert.deepEqual(xs(m, ['s2', 's4', 's5']), rest);
});

test('the gap follows the pointer: crossing a neighbour moves it past that neighbour', async () => {
  const m = await mounted(parkedRow());
  const rest = xs(m, ['s4', 's5']);
  begin('s3');
  await frames(40);
  const centre = rest.s4! + HALF;
  await update(centre + SPAN + 10);
  assert.equal(getComputedStyle(gapOf(m)!).left, `${rest.s4! + SPAN}px`);
  assert.equal(xOf(m, 's4'), rest.s4, 's4 slid back into the place before the gap');
  assert.equal(xOf(m, 's5'), rest.s5! + SPAN);
  await update(centre - SPAN - 10);
  assert.equal(getComputedStyle(gapOf(m)!).left, `${rest.s4! - SPAN}px`);
  act(() => hook().cancel());
});

test('cancel on a parked source leaves it parked and the row as it was', async () => {
  const m = await mounted(parkedRow());
  const ids = ['root', 's1', 's2', 's4', 's5'];
  const before = xs(m, ids);
  const entries = m.latest().entries;
  begin('s3');
  await update(at(m, 's4', SPAN + 10));
  act(() => hook().cancel());
  await settle();
  assert.deepEqual(xs(m, ids), before);
  assert.equal(m.latest().entries, entries);
  assert.equal(liveIds(m), 'root,s1,s2,s4,s5');
});

test('end places and shows a parked source in one commit, at the slot the gap showed', async () => {
  const m = await mounted(parkedRow());
  begin('s3');
  await update(at(m, 's4', SPAN + 10));
  let changes = 0;
  const off = seen.ws!.panels.subscribe(() => void (changes += 1));
  const result = await finish();
  off();
  assert.deepEqual(result, { ok: true, changed: true });
  assert.equal(order(m), 'root,s1,s2,s4,s3,s5', 'dropped after s4');
  assert.equal(liveIds(m), 'root,s1,s2,s4,s3,s5', 'and shown');
  assert.equal(changes, 1, 'one change reached the workspace');
  assert.equal(gapOf(m), null);
});

test('a drop on a parked source that crosses nothing shows it where it was', async () => {
  const m = await mounted(parkedRow());
  begin('s3');
  await update(at(m, 's4', 0));
  const result = await finish();
  assert.equal(result.ok, true);
  assert.equal(order(m), 'root,s1,s2,s3,s4,s5');
  assert.equal(liveIds(m), 'root,s1,s2,s3,s4,s5');
});

test('place then show in one turn refuse each other as busy, which is why the drop is its own gated op', async () => {
  const m = await mounted(parkedRow());
  const handle = seen.ws!.panels.get('s3')!;
  let second: PanelResult | undefined;
  await act(async () => {
    handle.place({ after: 's4' });
    second = handle.show();
  });
  assert.equal(second?.ok, false);
  assert.equal(second?.ok === false && second.code, 'busy');
  void m;
});

test('the land op refuses the root and, for a person, a panel that is not movable; a live panel is only placed', async () => {
  const entries = row(rootEntry(), made('s1', { movable: false }, { live: false }), made('s2'), made('s3'));
  const m = await mounted(entries);
  const rootRefusal = await opResult(m, 'root', 'person');
  assert.equal(rootRefusal.ok === false && rootRefusal.code, 'root-fixed');
  const immovable = await opResult(m, 's1', 'person');
  assert.equal(immovable.ok === false && immovable.code, 'not-movable');
  const code = await opResult(m, 's1', 'code');
  assert.equal(code.ok, true);
  assert.equal(liveIds(m), 'root,s2,s1,s3', 'code lands it after s2 and shows it');
  const live = await opResult(m, 's2', 'code', 's3');
  assert.equal(live.ok, true);
  assert.equal(order(m), 'root,s3,s2,s1', 'a live panel is placed where asked, and the panel anchored to it follows');
});

test('the land op answers busy to a second land on the same panel in the same turn', async () => {
  const m = await mounted(parkedRow());
  let first: PanelResult | undefined;
  let second: PanelResult | undefined;
  await act(async () => {
    first = landPanelIn(m.workspace, 's3', { after: 's4' }, 'code');
    second = landPanelIn(m.workspace, 's3', { after: 's1' }, 'code');
  });
  await settle();
  assert.equal(first?.ok, true);
  assert.equal(second?.ok, false);
  assert.equal(second?.ok === false && second.code, 'busy');
  assert.equal(order(m), 'root,s1,s2,s4,s3,s5', 'the second land changed nothing');
});

test('the land op gives its token back: a later operation on the same panel is accepted', async () => {
  const m = await mounted(parkedRow());
  const landed = await opResult(m, 's3', 'code', 's4');
  assert.equal(landed.ok, true);
  let hidden: PanelResult | undefined;
  await act(async () => {
    hidden = seen.ws!.panels.get('s3')!.hide();
  });
  assert.equal(hidden?.ok, true, hidden?.ok === false ? hidden.code : undefined);
  await settle();
  assert.equal(liveIds(m), 'root,s1,s2,s4,s5', 'hidden again');
});

test('ending a hidden drag gives the token back: the panel can be hidden straight after', async () => {
  const m = await mounted(parkedRow());
  begin('s3');
  await update(at(m, 's4', SPAN + 10));
  const dropped = await finish();
  assert.equal(dropped.ok, true);
  let hidden: PanelResult | undefined;
  await act(async () => {
    hidden = seen.ws!.panels.get('s3')!.hide();
  });
  assert.equal(hidden?.ok, true, hidden?.ok === false ? hidden.code : undefined);
  await settle();
  assert.equal(liveIds(m), 'root,s1,s2,s4,s5');
});

/** Runs the internal land verb through the workspace the row was mounted with. */
async function opResult(m: MountedRow, key: string, source: 'code' | 'person', after = 's2'): Promise<PanelResult> {
  let result: PanelResult | undefined;
  await act(async () => {
    result = landPanelIn(m.workspace, key, { after }, source);
  });
  await settle();
  return result!;
}

// ---------------------------------------------------------------------------
// edge scroll
// ---------------------------------------------------------------------------

const WINDOW = 1000;

async function mountedScrolling(): Promise<MountedRow> {
  seen.drop = undefined;
  const m = mountRow(row(rootEntry(), ...Array.from({ length: 10 }, (_, k) => made(`s${k + 1}`))), WINDOW);
  Object.defineProperty(m.container, 'clientWidth', { value: WINDOW, configurable: true });
  m.container.getBoundingClientRect = () => ({ left: 0, right: WINDOW, top: 0, bottom: 700, width: WINDOW, height: 700, x: 0, y: 0, toJSON: () => ({}) });
  await settle();
  return m;
}

test('held in the right edge band the row scrolls and the hop count follows the scroll; held mid-window it stays', async () => {
  const m = await mountedScrolling();
  assert.equal(rowOffsetOf(m.container), 0);
  assert.equal(begin('s1'), true);
  await update(500);
  await frames(60);
  assert.equal(rowOffsetOf(m.container), 0, 'the pointer is outside both bands');
  await update(WINDOW);
  await frames(60);
  assert.ok(rowOffsetOf(m.container) > 100, `the row scrolled: ${rowOffsetOf(m.container)}`);
  assert.equal(m.scroller.claimHeld(), true, 'the drag holds the scroller');
  act(() => hook().cancel());
  assert.equal(m.scroller.claimHeld(), false, 'and gives it back');
  await settle();
});

test('held in the left edge band the row scrolls back', async () => {
  const m = await mountedScrolling();
  m.scroller.glideTo(1200, { durationSec: 0, instant: true, ease: 'linear' });
  assert.equal(rowOffsetOf(m.container), 1200);
  begin('s5');
  await update(0);
  await frames(60);
  assert.ok(rowOffsetOf(m.container) < 1200 - 100, `the row scrolled left: ${rowOffsetOf(m.container)}`);
  act(() => hook().cancel());
  await settle();
});

test('ending the drag gives the scroller back', async () => {
  const m = await mountedScrolling();
  begin('s1');
  await update(WINDOW);
  await frames(20);
  await finish();
  assert.equal(m.scroller.claimHeld(), false);
});

// ---------------------------------------------------------------------------
// the unmount
// ---------------------------------------------------------------------------

test('a row that unmounts mid-drag gives the scroller back', async () => {
  const m = await mountedScrolling();
  const scroller = m.scroller;
  begin('s1');
  await update(WINDOW);
  cleanup();
  assert.equal(scroller.claimHeld(), false);
});
