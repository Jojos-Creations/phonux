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
  promoteToLive,
  restorePanel,
  setPanelContentsId,
  setPanelTitle,
} from '../client/src/desktop/panels/panelWindow.js';

test('appendPanel: appends a new LIVE extra panel carrying the source id and url, unstarted webContentsId', () => {
  const next = appendPanel([], { sourceWebContentsId: 7, url: 'https://example.com/new-tab' }, 'w1');
  assert.deepEqual(next, [
    { id: 'w1', url: 'https://example.com/new-tab', webContentsId: null, sourceWebContentsId: 7, live: true },
  ]);
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

test('setPanelContentsId: sets webContentsId for the matching panel only, immutably', () => {
  const panels = appendPanel(
    appendPanel([], { sourceWebContentsId: 1, url: 'https://a.example' }, 'w1'),
    { sourceWebContentsId: 1, url: 'https://b.example' },
    'w2',
  );
  const next = setPanelContentsId(panels, 'w2', 42);
  assert.equal(next[0]!.webContentsId, null, 'the other panel is untouched');
  assert.equal(next[1]!.webContentsId, 42);
  assert.notEqual(next, panels, 'a new array is returned, not the same reference');

  // The FIRST panel updates too (before the primary kind was cut, this case checked exactly that: a first panel updated by id), and only it.
  const nextFirst = setPanelContentsId(panels, 'w1', 7);
  assert.equal(nextFirst[0]!.webContentsId, 7, 'the first panel is updated');
  assert.equal(nextFirst[1]!.webContentsId, null, 'and the second is untouched');
  assert.equal(panels[0]!.webContentsId, null, 'the input array was not mutated');
});

test('setPanelContentsId: an unknown id leaves panels unchanged', () => {
  const panels = appendPanel([], { sourceWebContentsId: 1, url: 'https://a.example' }, 'w1');
  assert.equal(setPanelContentsId(panels, 'nope', 42), panels);
});

test('setPanelTitle: sets the title the first time a real one arrives', () => {
  const panels = appendPanel([], { sourceWebContentsId: 1, url: 'https://a.example' }, 'w1');
  const next = setPanelTitle(panels, 'w1', 'Example Domain');
  assert.equal(next[0]!.title, 'Example Domain');
});

test('setPanelTitle: a panel that already has a title is never overwritten by a later one', () => {
  // Mirrors updateSessionPageTitle's own reasoning: later in-page navigation
  // must not silently rename a panel already named from its first real page.
  const panels: PanelWindow[] = [
    { id: 'w1', url: 'https://a.example', webContentsId: 5, sourceWebContentsId: 1, title: 'Example Domain', live: true },
  ];
  const next = setPanelTitle(panels, 'w1', 'Some Other Page');
  assert.equal(next[0]!.title, 'Example Domain');
});

test('setPanelTitle: an unknown id leaves panels unchanged', () => {
  const panels = appendPanel([], { sourceWebContentsId: 1, url: 'https://a.example' }, 'w1');
  assert.equal(setPanelTitle(panels, 'nope', 'X'), panels);
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
