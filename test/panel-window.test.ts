/**
 * desktop/panels/panelWindow.ts's pure panel-array helpers (append,
 * primary, dead-end staging, auto-collapse, promote). Split out of goal-
 * front-page.test.ts (plan step 6).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  type PanelWindow,
  appendPanel,
  autoCollapseOldest,
  computeDeadEndBatch,
  confirmDeadEndClose,
  promoteToLive,
  setPanelContentsId,
  setPanelTitle,
  setPrimaryUrl,
  stageDeadEnd,
  toggleDeadEndChecked,
  undoDeadEndClose,
} from '../client/src/desktop/panels/panelWindow.js';

test('appendPanel: appends a new LIVE extra panel carrying the source id and url, unstarted webContentsId', () => {
  const next = appendPanel([], { sourceWebContentsId: 7, url: 'https://example.com/new-tab' }, 'w1');
  assert.deepEqual(next, [
    { id: 'w1', kind: 'extra', url: 'https://example.com/new-tab', webContentsId: null, sourceWebContentsId: 7, live: true, checked: false, autoSwept: false },
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

// ---------------------------------------------------------------------------
// setPrimaryUrl (front-page-link-windows-primary-panel-unification): the
// primary session panel's own url is now slot 0 of the unified array,
// replacing the old, entirely separate `directUrl` state field.
// ---------------------------------------------------------------------------

test('setPrimaryUrl: a null url on an empty array stays empty -- nothing to remove', () => {
  assert.deepEqual(setPrimaryUrl([], null), []);
});

test('setPrimaryUrl: creates a new, live primary entry at the front, id "primary"', () => {
  const next = setPrimaryUrl([], 'https://example.com');
  assert.deepEqual(next, [
    { id: 'primary', kind: 'primary', url: 'https://example.com', webContentsId: null, sourceWebContentsId: -1, live: true, checked: false, autoSwept: false },
  ]);
});

test('setPrimaryUrl: prepends the primary ahead of any existing extra panels', () => {
  const extras = appendPanel([], { sourceWebContentsId: 1, url: 'https://extra.example' }, 'w1');
  const next = setPrimaryUrl(extras, 'https://example.com');
  assert.deepEqual(
    next.map((p) => p.id),
    ['primary', 'w1'],
  );
});

test('setPrimaryUrl: an existing primary entry is updated IN PLACE -- position, webContentsId, live, checked, autoSwept all preserved', () => {
  const withExtra = [
    { id: 'primary', kind: 'primary' as const, url: 'https://old.example', webContentsId: 42, sourceWebContentsId: -1, live: false, checked: true, autoSwept: false },
    ...appendPanel([], { sourceWebContentsId: 1, url: 'https://extra.example' }, 'w1'),
  ];
  const next = setPrimaryUrl(withExtra, 'https://new.example');
  assert.deepEqual(
    next.map((p) => p.id),
    ['primary', 'w1'],
    'still at the front, never re-appended',
  );
  assert.equal(next[0]!.url, 'https://new.example');
  assert.equal(next[0]!.webContentsId, 42, 'untouched by a url-only update');
  assert.equal(next[0]!.live, false, 'untouched -- this is not a revive');
  assert.equal(next[0]!.checked, true, 'untouched');
});

test('setPrimaryUrl: a falsy url removes the primary entry entirely, leaving extras untouched', () => {
  const withExtra = setPrimaryUrl(appendPanel([], { sourceWebContentsId: 1, url: 'https://extra.example' }, 'w1'), 'https://example.com');
  const next = setPrimaryUrl(withExtra, null);
  assert.deepEqual(
    next.map((p) => p.id),
    ['w1'],
  );
});

test('setPanelContentsId: sets webContentsId for the matching panel only, immutably, primary or extra alike', () => {
  const panels = appendPanel(
    setPrimaryUrl([], 'https://primary.example'),
    { sourceWebContentsId: 1, url: 'https://b.example' },
    'w2',
  );
  const next = setPanelContentsId(panels, 'w2', 42);
  assert.equal(next[0]!.webContentsId, null, 'the primary panel is untouched');
  assert.equal(next[1]!.webContentsId, 42);
  assert.notEqual(next, panels, 'a new array is returned, not the same reference');

  const nextPrimary = setPanelContentsId(panels, 'primary', 7);
  assert.equal(nextPrimary[0]!.webContentsId, 7);
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
    { id: 'w1', kind: 'extra', url: 'https://a.example', webContentsId: 5, sourceWebContentsId: 1, title: 'Example Domain', live: true, checked: false, autoSwept: false },
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

test('computeDeadEndBatch: dragging the oldest panel stages only itself, nothing auto-swept', () => {
  const panels = makeExtraPanels('w1', 'w2', 'w3');
  const batch = computeDeadEndBatch(panels, 'w1');
  assert.deepEqual(batch!.staged.map((p) => p.id), ['w1']);
  assert.deepEqual([...batch!.autoSweptIds], []);
});

test('computeDeadEndBatch: dragging a later panel auto-sweeps every earlier one, in order', () => {
  const panels = makeExtraPanels('w1', 'w2', 'w3', 'w4');
  const batch = computeDeadEndBatch(panels, 'w3');
  assert.deepEqual(batch!.staged.map((p) => p.id), ['w1', 'w2', 'w3']);
  assert.deepEqual([...batch!.autoSweptIds].sort(), ['w1', 'w2']);
  assert.ok(!batch!.autoSweptIds.has('w3'), 'the actually-dragged panel is never itself auto-swept');
});

test('computeDeadEndBatch: the primary panel is never draggable, so it never enters a batch even sitting first in the array', () => {
  const panels = appendPanel(setPrimaryUrl([], 'https://primary.example'), { sourceWebContentsId: 1, url: 'https://w1.example' }, 'w1');
  const batch = computeDeadEndBatch(panels, 'w1');
  assert.deepEqual(batch!.staged.map((p) => p.id), ['w1'], 'only the live EXTRA panel, never the primary ahead of it');
  assert.deepEqual([...batch!.autoSweptIds], []);
});

test('computeDeadEndBatch: an unknown draggedId returns null -- a stale drag, nothing to stage', () => {
  const panels = makeExtraPanels('w1', 'w2');
  assert.equal(computeDeadEndBatch(panels, 'nope'), null);
});

test('computeDeadEndBatch: a PARKED (non-live) extra panel is not draggable either -- an id match alone is not enough', () => {
  const panels = stageDeadEnd(makeExtraPanels('w1', 'w2'), 'w1')!;
  assert.equal(computeDeadEndBatch(panels, 'w1'), null);
});

test('stageDeadEnd: marks the dragged panel and its auto-swept siblings parked and checked, IN PLACE -- never removed from the array', () => {
  const panels = makeExtraPanels('w1', 'w2', 'w3', 'w4');
  const result = stageDeadEnd(panels, 'w2')!;
  assert.deepEqual(
    result.map((p) => p.id),
    ['w1', 'w2', 'w3', 'w4'],
    'every panel stays in the array -- parking is no longer a remove-and-append',
  );
  assert.deepEqual(
    result.filter((p) => p.live).map((p) => p.id),
    ['w3', 'w4'],
    'w1 and w2 leave the LIVE row',
  );
  assert.deepEqual(
    result.filter((p) => !p.live).map((p) => [p.id, p.checked, p.autoSwept]),
    [
      ['w1', true, true],
      ['w2', true, false],
    ],
  );
});

test('stageDeadEnd: a stale draggedId leaves the array untouched', () => {
  const panels = makeExtraPanels('w1');
  assert.equal(stageDeadEnd(panels, 'nope'), null);
});

test('toggleDeadEndChecked: flips one panel, leaves the rest alone', () => {
  const panels = makeExtraPanels('a', 'b').map((p) => ({ ...p, checked: true }));
  const next = toggleDeadEndChecked(panels, 'a');
  assert.equal(next[0]!.checked, false, 'the toggled panel flips');
  assert.equal(next[1]!.checked, true, 'the other panel is untouched');
});

test('toggleDeadEndChecked: an unknown id leaves panels unchanged', () => {
  const panels = makeExtraPanels('a');
  assert.equal(toggleDeadEndChecked(panels, 'nope'), panels);
});

test('confirmDeadEndClose: splits checked from unchecked -- unchecked panels stay put, checked ones (live or parked alike) close', () => {
  const panels: PanelWindow[] = [
    ...makeExtraPanels('a').map((p) => ({ ...p, checked: true })),
    ...makeExtraPanels('b'), // live, unchecked
    ...stageDeadEnd(makeExtraPanels('c'), 'c')!, // parked, checked
  ];
  const { toClose, remaining } = confirmDeadEndClose(panels);
  assert.deepEqual(
    toClose.map((p) => p.id),
    ['a', 'c'],
  );
  assert.deepEqual(
    remaining.map((p) => p.id),
    ['b'],
  );
});

test('undoDeadEndClose: restores the closed batch, always PARKED (live/webContentsId reset) regardless of how it looked when closed', () => {
  const remaining = makeExtraPanels('b');
  const closedBatch: PanelWindow[] = [
    { id: 'a', kind: 'extra', url: 'https://a.example', webContentsId: 9, sourceWebContentsId: 1, live: true, checked: true, autoSwept: true },
  ];
  const next = undoDeadEndClose(remaining, closedBatch);
  assert.deepEqual(
    next.map((p) => p.id),
    ['b', 'a'],
  );
  assert.equal(next[1]!.checked, true, 'restored checked, exactly as confirmDeadEndClose left it');
  assert.equal(next[1]!.live, false, 'restored PARKED, never magically live again from an undo');
  assert.equal(next[1]!.webContentsId, null, 'stale webContentsId reset -- its real webview was actually unmounted');
});

test('autoCollapseOldest: parks the single oldest LIVE panel, unchecked and never autoSwept (space management, not a dead end)', () => {
  const panels = makeExtraPanels('w1', 'w2', 'w3');
  const result = autoCollapseOldest(panels)!;
  assert.deepEqual(
    result.filter((p) => p.live).map((p) => p.id),
    ['w2', 'w3'],
  );
  const parked = result.find((p) => p.id === 'w1')!;
  assert.equal(parked.live, false);
  assert.equal(parked.checked, false, 'auto-collapse is space management, not a dead end');
  assert.equal(parked.autoSwept, false, 'never part of a drag');
});

test('autoCollapseOldest: the PRIMARY panel participates too -- if it is the oldest live panel, it collapses first', () => {
  // front-page-link-windows-primary-panel-unification's own headline fix:
  // before this entry, the primary panel was entirely exempt from
  // auto-collapse. Now it is index 0 of the SAME array, so it is the
  // "oldest" by construction whenever it is still live.
  const panels = appendPanel(setPrimaryUrl([], 'https://primary.example'), { sourceWebContentsId: 1, url: 'https://w1.example' }, 'w1');
  const result = autoCollapseOldest(panels)!;
  assert.deepEqual(
    result.filter((p) => p.live).map((p) => p.id),
    ['w1'],
    'the primary panel, not w1, was swept -- it was oldest by array position',
  );
  assert.equal(result.find((p) => p.kind === 'primary')!.live, false);
});

test('autoCollapseOldest: returns null when nothing is live to park', () => {
  assert.equal(autoCollapseOldest([]), null);
  const allParked = stageDeadEnd(makeExtraPanels('w1'), 'w1')!;
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
  const panels = stageDeadEnd(makeExtraPanels('w1', 'w2', 'w3'), 'w2')!; // w1,w2 parked; w3 live
  const result = promoteToLive(panels, 'w1', () => false)!;
  assert.deepEqual(
    result.map((p) => p.id),
    ['w1', 'w2', 'w3'],
    'same array order as before -- w1 did NOT jump to the end',
  );
  assert.equal(result[0]!.live, true);
  assert.equal(result[0]!.checked, false, 'reviving clears any pending close-checkbox state');
});

test('promoteToLive: when wouldOverflow says yes, demotes exactly one OTHER live panel -- the oldest, by array order', () => {
  const panels = stageDeadEnd(makeExtraPanels('w1', 'w2', 'w3'), 'w1')!; // w1 parked; w2,w3 live
  const result = promoteToLive(panels, 'w1', () => true)!;
  assert.deepEqual(
    result.filter((p) => p.live).map((p) => p.id),
    ['w1', 'w3'],
    'w2 (the oldest OTHER live panel) was demoted to keep exactly one swap',
  );
  const demoted = result.find((p) => p.id === 'w2')!;
  assert.equal(demoted.live, false);
  assert.equal(demoted.checked, false, 'a demotion is space management, never a dead end');
  assert.equal(demoted.autoSwept, false);
});

test('promoteToLive: wouldOverflow receives the live count counting the panel about to be promoted', () => {
  const panels = stageDeadEnd(makeExtraPanels('w1', 'w2'), 'w1')!; // w1 parked; w2 live (liveCount 1)
  let seen: number | undefined;
  promoteToLive(panels, 'w1', (liveCountAfter) => {
    seen = liveCountAfter;
    return false;
  });
  assert.equal(seen, 2, 'one currently live (w2) plus the one being promoted (w1)');
});

test('promoteToLive: a no-overflow prediction demotes nothing at all', () => {
  const panels = stageDeadEnd(makeExtraPanels('w1', 'w2'), 'w1')!;
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

test('promoteToLive: carries the staged screenshot through so LiveWebview can show it as a placeholder while the fresh webview reloads', () => {
  const panels: PanelWindow[] = [
    { id: 'a', kind: 'extra', url: 'https://a.example', webContentsId: null, sourceWebContentsId: -1, live: false, checked: false, autoSwept: false, screenshot: 'data:image/png;base64,AAAA' },
  ];
  const result = promoteToLive(panels, 'a', () => false)!;
  assert.equal(result[0]!.screenshot, 'data:image/png;base64,AAAA');
});

test('promoteToLive: the PRIMARY panel can be promoted back live too, same as any extra', () => {
  const panels = setPrimaryUrl([], 'https://primary.example').map((p) => ({ ...p, live: false }));
  const result = promoteToLive(panels, 'primary', () => false)!;
  assert.equal(result[0]!.live, true);
});
