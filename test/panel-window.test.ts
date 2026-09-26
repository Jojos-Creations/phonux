/**
 * desktop/panels/panelWindow.ts's pure panel-array helpers (append, close/restore, the row's edge and side
 * helpers, promote). Closing a view removes it completely (closePanel) and undo puts it back (restorePanel).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  type PanelWindow,
  appendPanel,
  closePanel,
  createHistoryPanel,
  firstParkedAfter,
  HISTORY_PANEL_ID,
  lastParkedBefore,
  leftmostLiveIndex,
  movePanel,
  promoteToLive,
  reorderStepsForOffset,
  restorePanel,
  rightmostLiveIndex,
  sideOfLiveRange,
} from '../client/src/desktop/panels/panelWindow.js';

test('appendPanel: appends a new LIVE extra panel carrying the source id and url, unstarted webContentsId', () => {
  const next = appendPanel([], { sourceWebContentsId: 7, url: 'https://example.com/new-tab' }, 'w1');
  assert.deepEqual(next, [
    { id: 'w1', url: 'https://example.com/new-tab', webContentsId: null, sourceWebContentsId: 7, live: true, locked: false, view: 'web', collapsible: true, listed: true, insertAt: 'end', layer: 'base', anchoredEnter: false },
  ]);
});

test('createHistoryPanel: an always-shown, unlisted, locked, live entry -- never a plain web panel', () => {
  const history = createHistoryPanel();
  assert.deepEqual(
    [history.id, history.view, history.collapsible, history.listed, history.locked, history.live],
    [HISTORY_PANEL_ID, 'history', false, false, true, true],
  );
});

test('createHistoryPanel: start/raised/anchored -- matching its own current position/layer/enter behavior exactly', () => {
  const history = createHistoryPanel();
  assert.deepEqual([history.insertAt, history.layer, history.anchoredEnter], ['start', 'raised', true]);
});

test('appendPanel: view/params/listed/layer/anchoredEnter from create()\'s options land on the new entry; it is always unlocked regardless of options (create() has no locked key to set)', () => {
  const next = appendPanel(
    [],
    { sourceWebContentsId: -1, url: 'about:blank', view: 'test-custom', params: { a: 1 }, listed: false, layer: 'raised', anchoredEnter: true },
    'c1',
  );
  assert.deepEqual(next, [
    { id: 'c1', url: 'about:blank', webContentsId: null, sourceWebContentsId: -1, live: true, locked: false, view: 'test-custom', collapsible: true, listed: false, params: { a: 1 }, insertAt: 'end', layer: 'raised', anchoredEnter: true },
  ]);
});

test('appendPanel: insertAt "start" lands immediately after the last non-collapsible entry (History), never before it; the default still appends to the array end', () => {
  const withHistory = [createHistoryPanel(), ...makeExtraPanels('w1', 'w2')];
  const front = appendPanel(withHistory, { sourceWebContentsId: -1, url: 'https://front.example', insertAt: 'start' }, 'front');
  assert.deepEqual(front.map((p) => p.id), [HISTORY_PANEL_ID, 'front', 'w1', 'w2'], 'right after History, never before it');
  const end = appendPanel(withHistory, { sourceWebContentsId: -1, url: 'https://end.example' }, 'end');
  assert.deepEqual(end.map((p) => p.id), [HISTORY_PANEL_ID, 'w1', 'w2', 'end'], 'a plain create() still appends to the array end');
});

test('appendPanel: always appends to the end, regardless of which panel the request came from', () => {
  let panels = appendPanel([], { sourceWebContentsId: 1, url: 'https://a.example' }, 'w1');
  panels = appendPanel(panels, { sourceWebContentsId: 1, url: 'https://b.example' }, 'w2');
  // A third panel opened FROM w1 (source id 1 again, not w2's own id) still lands last, not next to its source.
  panels = appendPanel(panels, { sourceWebContentsId: 1, url: 'https://c.example' }, 'w3');
  assert.deepEqual(
    panels.map((p) => p.id),
    ['w1', 'w2', 'w3'],
  );
});

function makeExtraPanels(...ids: string[]): PanelWindow[] {
  return ids.reduce(
    (acc, id) => appendPanel(acc, { sourceWebContentsId: 1, url: `https://${id}.example` }, id),
    [] as PanelWindow[],
  );
}

/** Parks the given ids in place (the tests below need parked panels without going through any close flow). */
function park(panels: PanelWindow[], ...ids: string[]): PanelWindow[] {
  return panels.map((p) => (ids.includes(p.id) ? { ...p, live: false } : p));
}

test('closePanel: removes ONE panel, live or parked alike, and reports what it removed and where it sat', () => {
  const panels = park(makeExtraPanels('w1', 'w2', 'w3', 'w4'), 'w1'); // w1 parked; w2..w4 live
  const live = closePanel(panels, 'w3')!;
  assert.deepEqual(live.remaining.map((p) => p.id), ['w1', 'w2', 'w4'], 'gone from the array, the rest in their own order');
  assert.deepEqual([live.closed.id, live.closed.live, live.index], ['w3', true, 2]);
  const parked = closePanel(panels, 'w1')!;
  assert.deepEqual([parked.remaining.map((p) => p.id), parked.closed.live, parked.index], [['w2', 'w3', 'w4'], false, 0], 'a parked panel closes the same way');
  assert.equal(panels.length, 4, 'the input array is not touched');
});

test('closePanel: an unknown or already-closed id is null -- nothing to do, not an error', () => {
  const panels = makeExtraPanels('w1', 'w2');
  assert.equal(closePanel(panels, 'nope'), null);
  assert.equal(closePanel(closePanel(panels, 'w1')!.remaining, 'w1'), null, 'closing the same id twice: the second finds nothing');
  assert.equal(closePanel([], 'w1'), null);
});

test('restorePanel: puts the panel back at its old index with webContentsId reset, and keeps its live state as it was', () => {
  const panels = makeExtraPanels('w1', 'w2', 'w3');
  const { remaining, closed, index } = closePanel(panels, 'w2')!;
  const back = restorePanel(remaining, { ...closed, webContentsId: 9 }, index);
  assert.deepEqual(back.map((p) => p.id), ['w1', 'w2', 'w3'], 'the same order as before the close');
  assert.equal(back[1]!.webContentsId, null, 'whatever it pointed at was unmounted when it closed');
  assert.equal(back[1]!.live, true, 'restored live if it was live');
  const parkedBack = restorePanel(remaining, { ...closed, live: false }, index);
  assert.equal(parkedBack[1]!.live, false, 'and parked if it was parked');
});

test('restorePanel: an index past the end is clamped, a negative one goes first, and an id that is already present changes nothing', () => {
  const panels = makeExtraPanels('w1', 'w2');
  const extra = makeExtraPanels('w9')[0]!;
  assert.deepEqual(restorePanel(panels, extra, 99).map((p) => p.id), ['w1', 'w2', 'w9']);
  assert.deepEqual(restorePanel(panels, extra, -3).map((p) => p.id), ['w9', 'w1', 'w2']);
  assert.deepEqual(restorePanel(panels, extra, -1).map((p) => p.id), ['w9', 'w1', 'w2'], 'a negative index goes first however small it is: -1 is not "before the last" (slice would read it that way, and -3 only clamps by accident on two panels)');
  assert.equal(restorePanel(panels, panels[0]!, 1), panels, 'a double undo never duplicates a panel');
});

test('closePanel then restorePanel in REVERSE order undoes a run of closes exactly, even when each index was taken from a different array', () => {
  const start = makeExtraPanels('w1', 'w2', 'w3', 'w4');
  const first = closePanel(start, 'w1')!; // w1 at 0
  const second = closePanel(first.remaining, 'w3')!; // w3 at 1 of [w2, w3, w4]
  const third = closePanel(second.remaining, 'w2')!; // w2 at 0 of [w2, w4]
  assert.deepEqual(third.remaining.map((p) => p.id), ['w4']);
  let back = third.remaining;
  for (const step of [third, second, first]) back = restorePanel(back, step.closed, step.index);
  assert.deepEqual(back.map((p) => p.id), ['w1', 'w2', 'w3', 'w4'], 'last closed first: the original order comes back');
});

// ---------------------------------------------------------------------------
// sideOfLiveRange / leftmostLiveIndex / rightmostLiveIndex / firstParkedAfter / lastParkedBefore: the
// row-gesture and exit-direction primitives -- pure, so their edge cases are pinned without a hook or a
// DOM.
// ---------------------------------------------------------------------------

test('sideOfLiveRange: the leftmost live panel always reads LEFT, the rightmost always reads RIGHT', () => {
  const panels = makeExtraPanels('w1', 'w2', 'w3');
  assert.equal(sideOfLiveRange(panels, 'w1'), 'left');
  assert.equal(sideOfLiveRange(panels, 'w3'), 'right');
});

test('sideOfLiveRange: a parked id (about to be revived) is judged the same way, against the OTHER live ids', () => {
  const panels = park(makeExtraPanels('w1', 'w2', 'w3'), 'w1', 'w3'); // w2 live; w1, w3 parked
  assert.equal(sideOfLiveRange(panels, 'w1'), 'left', 'w1 sits left of the only other live one (w2)');
  assert.equal(sideOfLiveRange(panels, 'w3'), 'right', 'w3 sits right of it');
});

test('leftmostLiveIndex / rightmostLiveIndex: -1 with nothing live, otherwise the array index of the edge panel', () => {
  assert.equal(leftmostLiveIndex([]), -1);
  assert.equal(rightmostLiveIndex([]), -1);
  const panels = park(makeExtraPanels('w1', 'w2', 'w3'), 'w1');
  assert.equal(leftmostLiveIndex(panels), 1, 'w2, the first live one');
  assert.equal(rightmostLiveIndex(panels), 2, 'w3, the last live one');
});

test('firstParkedAfter / lastParkedBefore: the next parked panel toward each side, or null with nothing parked that way', () => {
  const panels = park(makeExtraPanels('w1', 'w2', 'w3', 'w4'), 'w1', 'w4');
  assert.equal(firstParkedAfter(panels, rightmostLiveIndex(panels))?.id, 'w4');
  assert.equal(lastParkedBefore(panels, leftmostLiveIndex(panels))?.id, 'w1');
  assert.equal(firstParkedAfter(panels, panels.length - 1), null, 'nothing after the last entry');
  assert.equal(lastParkedBefore(panels, 0), null, 'nothing before the first entry');
});

test('History stays at array index 0 through appendPanel, closePanel and restorePanel', () => {
  let panels: PanelWindow[] = [createHistoryPanel()];
  panels = appendPanel(panels, { sourceWebContentsId: -1, url: 'https://a.example' }, 'a');
  panels = appendPanel(panels, { sourceWebContentsId: -1, url: 'https://b.example' }, 'b');
  assert.equal(panels[0]!.id, HISTORY_PANEL_ID, 'append never disturbs index 0');
  const closedA = closePanel(panels, 'a')!;
  assert.equal(closedA.remaining[0]!.id, HISTORY_PANEL_ID, 'closing a later entry leaves History at 0');
  const restored = restorePanel(closedA.remaining, closedA.closed, closedA.index);
  assert.equal(restored[0]!.id, HISTORY_PANEL_ID, 'restoring it back leaves History at 0 too');
  assert.deepEqual(restored.map((p) => p.id), ['history', 'a', 'b'], 'and the original order is exactly back');
});

// ---------------------------------------------------------------------------
// promoteToLive: flips `live` IN PLACE (never reorders), and demotes at most one OTHER live panel -- the
// one farthest from `id`'s own array index -- when doing so would exceed `capacity`.
// ---------------------------------------------------------------------------

test('promoteToLive: makes a parked panel live IN PLACE -- array order is unchanged, nothing is appended', () => {
  const panels = park(makeExtraPanels('w1', 'w2', 'w3'), 'w1', 'w2'); // w1,w2 parked; w3 live
  const result = promoteToLive(panels, 'w1', Number.POSITIVE_INFINITY)!;
  assert.deepEqual(
    result.map((p) => p.id),
    ['w1', 'w2', 'w3'],
    'same array order as before -- w1 did NOT jump to the end',
  );
  assert.equal(result[0]!.live, true);
});

test('promoteToLive: over capacity, demotes exactly one OTHER live panel -- the one farthest from the promoted id', () => {
  const panels = park(makeExtraPanels('w1', 'w2', 'w3'), 'w1'); // w1 parked (index 0); w2,w3 live
  const result = promoteToLive(panels, 'w1', 2)!; // capacity 2: promoting w1 would make 3 live
  assert.deepEqual(
    result.filter((p) => p.live).map((p) => p.id),
    ['w1', 'w2'],
    'w3 (farthest from w1\'s own index 0) was demoted to keep exactly one swap',
  );
  const demoted = result.find((p) => p.id === 'w3')!;
  assert.equal(demoted.live, false);
});

test('promoteToLive: exactly at capacity demotes nothing at all', () => {
  const panels = park(makeExtraPanels('w1', 'w2'), 'w1'); // w1 parked; w2 live
  const result = promoteToLive(panels, 'w1', 2)!; // promoting w1 makes 2 live, exactly capacity
  assert.deepEqual(
    result.filter((p) => p.live).map((p) => p.id).sort(),
    ['w1', 'w2'],
    'both live now -- there was room, nothing needed to leave',
  );
});

test('promoteToLive: an already-live panel is a no-op (null) -- "keep it live" needs nothing applied', () => {
  const panels = makeExtraPanels('w1');
  assert.equal(promoteToLive(panels, 'w1', 1), null);
});

test('promoteToLive: an unknown id returns null -- nothing to promote', () => {
  assert.equal(promoteToLive(makeExtraPanels('w1'), 'nope', Number.POSITIVE_INFINITY), null);
});

test('promoteToLive: demotion never targets a collapsible:false entry (History) -- a manual activation must not bump an always-shown column', () => {
  const panels = park([createHistoryPanel(), ...makeExtraPanels('w1')], 'w1'); // History live; w1 parked
  const result = promoteToLive(panels, 'w1', 1)!; // capacity 1: something should demote, but History is exempt
  assert.equal(result.find((p) => p.id === HISTORY_PANEL_ID)!.live, true, 'History stays live: it is the only OTHER live entry, but it is exempt');
  assert.equal(result.find((p) => p.id === 'w1')!.live, true, 'w1 was promoted -- nothing was left to demote');
});

// ---------------------------------------------------------------------------
// movePanel: the drag-to-reorder gesture's own pure primitive. A single
// present-hop can cross several parked array slots at once -- that IS "moving a live panel across parked
// entries" (present = `!collapsible || live`, LivePanels.tsx's own filter).
// ---------------------------------------------------------------------------

test('movePanel: a live panel moved past its present-neighbor crosses every parked entry between them, and their OWN relative order is unchanged', () => {
  // present order (web only): [live1, live2]; p1/p2 sit physically between them in the array.
  const panels = park(makeExtraPanels('live1', 'p1', 'p2', 'live2'), 'p1', 'p2');
  const result = movePanel(panels, 'live1', 'right');
  assert.deepEqual(result.map((p) => p.id), ['p1', 'p2', 'live2', 'live1'], 'live1 crossed both parked entries in one hop, landing after live2');
  assert.deepEqual(result.filter((p) => !p.live).map((p) => p.id), ['p1', 'p2'], 'p1 still comes before p2 -- their own relative order never changed');
  assert.notEqual(result, panels, 'a real move returns a genuinely different array, never the same reference');
});

test('movePanel: the mirror direction (right-to-left) crosses the same parked block the other way', () => {
  const panels = park(makeExtraPanels('live1', 'p1', 'p2', 'live2'), 'p1', 'p2');
  const result = movePanel(panels, 'live2', 'left');
  assert.deepEqual(result.map((p) => p.id), ['live2', 'live1', 'p1', 'p2'], 'live2 crossed both parked entries, landing before live1');
  assert.deepEqual(result.filter((p) => !p.live).map((p) => p.id), ['p1', 'p2'], 'still p1 before p2');
});

test('movePanel: a collapsible:false entry (History) is rejected -- the array comes back byte-for-byte the same reference', () => {
  const panels = [createHistoryPanel(), ...makeExtraPanels('w1', 'w2')];
  assert.equal(movePanel(panels, HISTORY_PANEL_ID, 'right'), panels, 'no copy at all: History never reorders');
});

test('movePanel: a live panel immediately right of History moved left is a no-op -- the NEIGHBOR is checked, not just the dragged entry', () => {
  // History is always seeded leftmost (insertAt:'start'); the vulnerable direction is a live neighbor
  // swapping INTO History's slot, which the dragged-entry-only check above can never catch.
  const panels = [createHistoryPanel(), ...makeExtraPanels('live1', 'live2')];
  assert.equal(movePanel(panels, 'live1', 'left'), panels, 'History sits immediately left: no swap past a collapsible:false neighbor');
});

test('movePanel: an unknown id is a no-op -- same array reference back', () => {
  const panels = makeExtraPanels('w1', 'w2');
  assert.equal(movePanel(panels, 'nope', 'left'), panels);
});

test('movePanel: a panel already at the present edge in that direction is a no-op (no neighbor to cross)', () => {
  const panels = makeExtraPanels('w1', 'w2', 'w3');
  assert.equal(movePanel(panels, 'w1', 'left'), panels, 'w1 is already the leftmost present panel');
  assert.equal(movePanel(panels, 'w3', 'right'), panels, 'w3 is already the rightmost present panel');
});

test('movePanel: a PARKED panel is never a move source, even toward an available neighbor -- present excludes it, so it is a no-op', () => {
  const panels = park(makeExtraPanels('w1', 'w2', 'w3'), 'w2'); // w2 parked between two live panels
  assert.equal(movePanel(panels, 'w2', 'right'), panels, 'w2 is parked: never a drag source');
});

test('reorderStepsForOffset: an EXACT half-slot drag is one hop in BOTH directions -- the tie is symmetric around zero', () => {
  const slot = 406;
  assert.equal(reorderStepsForOffset(slot / 2, slot), 1, 'right, exactly at the midpoint: one hop');
  assert.equal(reorderStepsForOffset(-slot / 2, slot), -1, 'left, exactly at the midpoint: one hop (Math.round(-0.5) is -0 and would drop it)');
  assert.equal(reorderStepsForOffset(1.5 * slot, slot), 2);
  assert.equal(reorderStepsForOffset(-1.5 * slot, slot), -2, 'a second tie rounds away from zero too');
  for (const offset of [0.3, 0.49, 0.7, 1.2, 1.6, 2.5].map((f) => f * slot)) {
    assert.equal(reorderStepsForOffset(-offset, slot), 0 - reorderStepsForOffset(offset, slot), `mirror of ${offset}px`); // 0 - x: +0, not -0, when no hop
  }
  assert.ok(Object.is(reorderStepsForOffset(-0.3 * slot, slot), 0), 'short of the midpoint leftward is +0 (no hop), never -0');
  assert.ok(Object.is(reorderStepsForOffset(0, slot), 0));
});
