/**
 * desktop/panels/panelWindow.ts's pure panel-array helpers (append,
 * close/restore, auto-collapse, promote). Split out of goal-
 * front-page.test.ts (plan step 6). Owner, 2026-09-20: closing a view removes
 * it completely (closePanel) and undo puts it back (restorePanel); staging and
 * the checked/autoSwept marks are gone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  type PanelWindow,
  appendPanel,
  autoCollapseOldest,
  closePanel,
  createHistoryPanel,
  HISTORY_PANEL_ID,
  promoteToLive,
  restorePanel,
} from '../client/src/desktop/panels/panelWindow.js';

test('appendPanel: appends a new LIVE extra panel carrying the source id and url, unstarted webContentsId', () => {
  const next = appendPanel([], { sourceWebContentsId: 7, url: 'https://example.com/new-tab' }, 'w1');
  assert.deepEqual(next, [
    { id: 'w1', url: 'https://example.com/new-tab', webContentsId: null, sourceWebContentsId: 7, live: true, locked: false, view: 'web', collapsible: true, listed: true },
  ]);
});

test('createHistoryPanel: an always-shown, unlisted, locked, live entry -- never a plain web panel', () => {
  const history = createHistoryPanel();
  assert.deepEqual(
    [history.id, history.view, history.collapsible, history.listed, history.locked, history.live],
    [HISTORY_PANEL_ID, 'history', false, false, true, true],
  );
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

/** Parks the given ids in place, as auto-collapse would (the tests below need parked panels without going through any close flow). */
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

test('autoCollapseOldest: parks the single oldest LIVE panel and keeps it in the array (space management, not a close)', () => {
  const panels = makeExtraPanels('w1', 'w2', 'w3');
  const result = autoCollapseOldest(panels)!;
  assert.deepEqual(
    result.filter((p) => p.live).map((p) => p.id),
    ['w2', 'w3'],
  );
  const parked = result.find((p) => p.id === 'w1')!;
  assert.equal(parked.live, false);
  assert.equal(result.length, 3, 'parked, never removed: only closePanel drops a panel');
});

test('autoCollapseOldest: returns null when nothing is live to park', () => {
  assert.equal(autoCollapseOldest([]), null);
  const allParked = park(makeExtraPanels('w1'), 'w1');
  assert.equal(autoCollapseOldest(allParked), null);
});

test('autoCollapseOldest: never parks a collapsible:false entry (History) even though it is live and oldest by array order', () => {
  const panels = [createHistoryPanel(), ...makeExtraPanels('w1', 'w2')];
  const result = autoCollapseOldest(panels)!;
  assert.equal(result.find((p) => p.id === HISTORY_PANEL_ID)!.live, true, 'History is oldest by array order but exempt: collapsible is false');
  assert.equal(result.find((p) => p.id === 'w1')!.live, false, 'the oldest COLLAPSIBLE entry is the one actually parked');
});

test('autoCollapseOldest: flipping collapsible on ONE entry changes only whether IT can be picked -- nothing else about the array', () => {
  const base = makeExtraPanels('w1', 'w2', 'w3');
  const exempt = base.map((p) => (p.id === 'w1' ? { ...p, collapsible: false } : p));
  const result = autoCollapseOldest(exempt)!;
  assert.equal(result.find((p) => p.id === 'w1')!.live, true, 'w1 is oldest by array order but now exempt');
  assert.equal(result.find((p) => p.id === 'w2')!.live, false, 'w2 (the oldest still-collapsible entry) is parked instead');
  assert.deepEqual(result.find((p) => p.id === 'w3'), base.find((p) => p.id === 'w3'), 'a third, untouched entry is unaffected');
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
// promoteToLive (front-page-link-windows-primary-panel-unification, parts 2
// + the owner-added "click any adventure-list row" requirement): replaces
// the old reviveDeadEndEntry, which used to re-append a revived entry at the
// row's newest slot and never demoted anything (the bug evidence bullet 5
// was written against). Now: flips `live` IN PLACE (never reorders), and
// demotes at most one OTHER live panel (the oldest, by array order) when
// the caller's own `wouldOverflow` predicate says so.
// ---------------------------------------------------------------------------

test('promoteToLive: makes a parked panel live IN PLACE -- array order is unchanged, nothing is appended', () => {
  const panels = park(makeExtraPanels('w1', 'w2', 'w3'), 'w1', 'w2'); // w1,w2 parked; w3 live
  const result = promoteToLive(panels, 'w1', () => false)!;
  assert.deepEqual(
    result.map((p) => p.id),
    ['w1', 'w2', 'w3'],
    'same array order as before -- w1 did NOT jump to the end',
  );
  assert.equal(result[0]!.live, true);
});

test('promoteToLive: when wouldOverflow says yes, demotes exactly one OTHER live panel -- the oldest, by array order', () => {
  const panels = park(makeExtraPanels('w1', 'w2', 'w3'), 'w1'); // w1 parked; w2,w3 live
  const result = promoteToLive(panels, 'w1', () => true)!;
  assert.deepEqual(
    result.filter((p) => p.live).map((p) => p.id),
    ['w1', 'w3'],
    'w2 (the oldest OTHER live panel) was demoted to keep exactly one swap',
  );
  const demoted = result.find((p) => p.id === 'w2')!;
  assert.equal(demoted.live, false);
});

test('promoteToLive: wouldOverflow receives the live count counting the panel about to be promoted', () => {
  const panels = park(makeExtraPanels('w1', 'w2'), 'w1'); // w1 parked; w2 live (liveCount 1)
  let seen: number | undefined;
  promoteToLive(panels, 'w1', (liveCountAfter) => {
    seen = liveCountAfter;
    return false;
  });
  assert.equal(seen, 2, 'one currently live (w2) plus the one being promoted (w1)');
});

test('promoteToLive: a no-overflow prediction demotes nothing at all', () => {
  const panels = park(makeExtraPanels('w1', 'w2'), 'w1');
  const result = promoteToLive(panels, 'w1', () => false)!;
  assert.deepEqual(
    result.filter((p) => p.live).map((p) => p.id).sort(),
    ['w1', 'w2'],
    'both live now -- there was room, nothing needed to leave',
  );
});

test('promoteToLive: an already-live panel is a no-op (null) -- "keep it live" needs nothing applied', () => {
  const panels = makeExtraPanels('w1');
  assert.equal(promoteToLive(panels, 'w1', () => true), null);
});

test('promoteToLive: an unknown id returns null -- nothing to promote', () => {
  assert.equal(promoteToLive(makeExtraPanels('w1'), 'nope', () => false), null);
});

test('promoteToLive: demotion never targets a collapsible:false entry (History) -- a manual activation must not bump an always-shown column', () => {
  const panels = park([createHistoryPanel(), ...makeExtraPanels('w1')], 'w1'); // History live; w1 parked
  const result = promoteToLive(panels, 'w1', () => true)!; // wouldOverflow says yes: something should demote
  assert.equal(result.find((p) => p.id === HISTORY_PANEL_ID)!.live, true, 'History stays live: it is the only OTHER live entry, but it is exempt');
  assert.equal(result.find((p) => p.id === 'w1')!.live, true, 'w1 was promoted -- nothing was left to demote');
});
