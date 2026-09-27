/**
 * desktop/panels/panelWindow.ts's pure panel-array helpers (append, close/restore, the row's edge and side
 * helpers, promote). Closing a view removes it completely (closePanel) and undo puts it back (restorePanel).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PHONE_SIZE, type PanelSize } from 'phonux';
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
  panelWidthOf,
  promoteToLive,
  reorderStepsForOffset,
  restorePanel,
  rightmostLiveIndex,
  setFormFactor,
  sideOfLiveRange,
  summarisePanel,
  TIER_SIZES,
} from '../client/src/desktop/panels/panelWindow.js';
import { GAP } from '../client/src/desktop/panels/LivePanelSlot.js';
import { computeMaxLiveWidth } from '../src/panel-layout.js';

/** Every entry's own default tier/size (panelWindow.ts's DEFAULT_PANEL_SIZE, reconstructed here from the same
 * shared phonux constant rather than a second 390/700 literal, so this file cannot drift from panelWindow.ts's
 * own derivation). */
const DEFAULT_PANEL_SIZE: PanelSize = { formFactor: 'phone', width: DEFAULT_PHONE_SIZE.width, height: DEFAULT_PHONE_SIZE.height };

test('appendPanel: appends a new LIVE extra panel carrying the source id and url, unstarted webContentsId', () => {
  const next = appendPanel([], { sourceWebContentsId: 7, url: 'https://example.com/new-tab' }, 'w1');
  assert.deepEqual(next, [
    {
      id: 'w1', url: 'https://example.com/new-tab', webContentsId: null, sourceWebContentsId: 7, live: true, locked: false, view: 'web', collapsible: true, listed: true, insertAt: 'end', layer: 'base', anchoredEnter: false,
      formFactor: 'phone', size: DEFAULT_PANEL_SIZE,
    },
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
    {
      id: 'c1', url: 'about:blank', webContentsId: null, sourceWebContentsId: -1, live: true, locked: false, view: 'test-custom', collapsible: true, listed: false, params: { a: 1 }, insertAt: 'end', layer: 'raised', anchoredEnter: true,
      formFactor: 'phone', size: DEFAULT_PANEL_SIZE,
    },
  ]);
});

test('appendPanel: permanent:true forces collapsible:false and listed:false, even when `listed:true` is ALSO passed -- the forced-false precedence; locked stays false', () => {
  const next = appendPanel([], { sourceWebContentsId: -1, url: 'about:blank', view: 'test-custom', permanent: true, listed: true }, 'p1');
  assert.deepEqual(
    [next[0]!.collapsible, next[0]!.listed, next[0]!.locked],
    [false, false, false],
    'permanent wins over the caller\'s own listed:true',
  );
});

test('appendPanel: permanent:true with `view` OMITTED (the single most obvious create({ permanent: true }) call) still defaults to the built-in "web" view, collapsible:false -- the exact combination LivePanel.tsx must render with no framework close handle', () => {
  const next = appendPanel([], { sourceWebContentsId: -1, url: 'about:blank', permanent: true }, 'p1');
  assert.deepEqual([next[0]!.view, next[0]!.collapsible], ['web', false], 'permanent:true alone reaches the built-in view, not just a caller-supplied custom one');
});

// ---------------------------------------------------------------------------
// formFactor/size: the SAME default lands on every entry (a plain web panel, a permanent column, and
// History alike); a permanent column differs only in whether its tier may change, never in carrying one.
// summarisePanel forwards both fields into PanelSummary unchanged.
// ---------------------------------------------------------------------------

test('appendPanel: formFactor/size default to "phone"/DEFAULT_PANEL_SIZE for a plain panel AND a permanent:true one alike -- the default applies uniformly regardless of collapsible', () => {
  const plain = appendPanel([], { sourceWebContentsId: -1, url: 'about:blank' }, 'w1')[0]!;
  const permanent = appendPanel([], { sourceWebContentsId: -1, url: 'about:blank', permanent: true }, 'p1')[0]!;
  assert.deepEqual([plain.formFactor, plain.size], ['phone', DEFAULT_PANEL_SIZE]);
  assert.deepEqual([permanent.formFactor, permanent.size], ['phone', DEFAULT_PANEL_SIZE], 'a permanent column gets the SAME default -- only setFormFactor\'s later eligibility differs, not the default itself');
});

test('createHistoryPanel: formFactor/size default the same way as any other entry', () => {
  const history = createHistoryPanel();
  assert.deepEqual([history.formFactor, history.size], ['phone', DEFAULT_PANEL_SIZE]);
});

test('summarisePanel: forwards formFactor and size from PanelWindow into PanelSummary unchanged -- red if summarisePanel drops the fields', () => {
  const tabletSize: PanelSize = { formFactor: 'tablet', width: 800, height: 1100 };
  const [tablet] = appendPanel([], { sourceWebContentsId: -1, url: 'https://t.example' }, 't1').map((p) => ({ ...p, formFactor: 'tablet' as const, size: tabletSize }));
  const summary = summarisePanel(tablet!);
  assert.deepEqual([summary.formFactor, summary.size], ['tablet', tabletSize], 'a panel set to tablet reads tablet back through summarisePanel, not the "phone" it was created with');
});

test('summarisePanel: round-trip through create -> panelList for the DEFAULT tier too (a panel created with no override reads "phone" back, not undefined)', () => {
  const created = appendPanel([], { sourceWebContentsId: -1, url: 'https://d.example' }, 'd1')[0]!;
  const summary = summarisePanel(created);
  assert.deepEqual([summary.formFactor, summary.size], ['phone', DEFAULT_PANEL_SIZE]);
});

test('summarisePanel: every entry this file creates (History, a plain panel, a permanent column) summarises to exactly the PanelSummary keys -- formFactor/size included, no desktop-only field', () => {
  const entries = [
    createHistoryPanel(),
    appendPanel([], { sourceWebContentsId: 3, url: 'https://w.example', title: 'W', params: { a: 1 } }, 'w1')[0]!,
    appendPanel([], { sourceWebContentsId: -1, url: 'about:blank', permanent: true }, 'p1')[0]!,
  ];
  const keys = ['formFactor', 'id', 'live', 'locked', 'params', 'size', 'title', 'url'];
  assert.deepEqual(entries.map((p) => Object.keys(summarisePanel(p)).sort()), [keys, keys, keys]);
});

test('summarisePanel: a record that carries no formFactor/size summarises with those keys ABSENT, not present as undefined', () => {
  const bare: PanelWindow = { id: 'b1', url: 'https://b.example', webContentsId: null, sourceWebContentsId: -1, live: true, locked: false, view: 'web', collapsible: true, listed: true };
  assert.deepEqual(Object.keys(summarisePanel(bare)).sort(), ['id', 'live', 'locked', 'params', 'title', 'url']);
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

test('movePanel: with TWO collapsible:false entries (History + a permanent column) present, BOTH reject as a move source, and a live neighbor cannot swap past either -- exercised on more than just the single-History case', () => {
  const perm = appendPanel([], { sourceWebContentsId: -1, url: 'about:blank', view: 'perm-view', permanent: true }, 'perm')[0]!;
  const panels = [createHistoryPanel(), perm, ...makeExtraPanels('live1', 'live2')];
  assert.equal(movePanel(panels, HISTORY_PANEL_ID, 'right'), panels, 'History still never reorders with a second fixed column present');
  assert.equal(movePanel(panels, 'perm', 'right'), panels, 'the permanent column itself is also rejected as a move source');
  assert.equal(movePanel(panels, 'perm', 'left'), panels, 'and in the other direction too');
  assert.equal(movePanel(panels, 'live1', 'left'), panels, 'live1 sits immediately right of perm: no swap past a collapsible:false neighbor');
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

test('reorderStepsForOffset: with equal neighbours an EXACT half-slot drag is one hop in BOTH directions -- the tie is symmetric around zero', () => {
  const slot = 406;
  const row = { left: [390, 390, 390], right: [390, 390, 390] };
  assert.equal(reorderStepsForOffset(slot / 2, row, GAP), 1, 'right, exactly at the midpoint: one hop');
  assert.equal(reorderStepsForOffset(-slot / 2, row, GAP), -1, 'left, exactly at the midpoint: one hop');
  assert.equal(reorderStepsForOffset(1.5 * slot, row, GAP), 2);
  assert.equal(reorderStepsForOffset(-1.5 * slot, row, GAP), -2, 'a second tie rounds away from zero too');
  for (const offset of [0.3, 0.49, 0.7, 1.2, 1.6, 2.4].map((f) => f * slot)) {
    assert.equal(reorderStepsForOffset(-offset, row, GAP), 0 - reorderStepsForOffset(offset, row, GAP), `mirror of ${offset}px`); // 0 - x: +0, not -0, when no hop
    assert.equal(reorderStepsForOffset(offset, row, GAP), Math.round(offset / slot), `equal widths reduce to one hop per slot (${offset}px)`);
  }
  assert.ok(Object.is(reorderStepsForOffset(-0.3 * slot, row, GAP), 0), 'short of the midpoint leftward is +0 (no hop), never -0');
  assert.ok(Object.is(reorderStepsForOffset(0, row, GAP), 0));
  assert.equal(reorderStepsForOffset(10 * slot, row, GAP), 3, 'never more hops than there are neighbours to cross');
});

test('reorderStepsForOffset: crossing a DIFFERENTLY-sized neighbour hops exactly once, at half of THAT neighbour\'s own span -- never at the dragged panel\'s own width', () => {
  // A phone (390) dragged right past a tablet (768): the hop lands at (768 + 16) / 2 = 392, not at 406 / 2 = 203.
  const phoneBesideTablet = { left: [], right: [768, 390] };
  assert.equal(reorderStepsForOffset(391, phoneBesideTablet, GAP), 0, 'one px short of the tablet\'s own half-span: no hop (a divide-by-406 rule already hops at 203)');
  assert.equal(reorderStepsForOffset(392, phoneBesideTablet, GAP), 1, 'exactly at half the tablet\'s span: one hop');
  assert.equal(reorderStepsForOffset(700, phoneBesideTablet, GAP), 1, 'still one hop at 700 (a divide-by-406 rule says 2)');
  assert.equal(reorderStepsForOffset(784 + 203, phoneBesideTablet, GAP), 2, 'the second hop lands half-way across the NEXT neighbour (the phone), after the tablet\'s whole span');
  // A tablet (768) dragged left past a phone (390): the hop lands at 203, not at (768 + 16) / 2 = 392.
  const tabletBesidePhone = { left: [390], right: [] };
  assert.equal(reorderStepsForOffset(-202, tabletBesidePhone, GAP), 0);
  assert.equal(reorderStepsForOffset(-203, tabletBesidePhone, GAP), -1, 'half the PHONE neighbour\'s span: one hop (a divide-by-own-784 rule rounds 203/784 to 0)');
  assert.equal(reorderStepsForOffset(203, tabletBesidePhone, GAP), 0, 'nothing to its right: no hop, however far');
});

test('panelWidthOf: a "phone" panel (explicit or omitted formFactor) ALWAYS uses the live phoneWidth argument, never its own stored size', () => {
  const phonePanel = createHistoryPanel(); // formFactor 'phone', size DEFAULT_PANEL_SIZE (390x700)
  assert.equal(panelWidthOf(phonePanel, 430, Number.POSITIVE_INFINITY), 430, 'the LIVE phoneWidth (430), not the stored 390 placeholder');
  const omitted: PanelWindow = { ...phonePanel, formFactor: undefined };
  assert.equal(panelWidthOf(omitted, 430, Number.POSITIVE_INFINITY), 430, 'an omitted formFactor defaults to "phone", same as explicit');
});

test('panelWidthOf: a "tablet"/"desktop" panel uses its OWN stored size.width, never the live phoneWidth argument', () => {
  const tablet: PanelWindow = { ...createHistoryPanel(), formFactor: 'tablet', size: { formFactor: 'tablet', width: 820, height: 1180 } };
  assert.equal(panelWidthOf(tablet, 430, Number.POSITIVE_INFINITY), 820, 'reads its own stored size.width, ignoring the live phoneWidth entirely');
  const desktop: PanelWindow = { ...createHistoryPanel(), formFactor: 'desktop', size: { formFactor: 'desktop', width: 1200, height: 800 } };
  assert.equal(panelWidthOf(desktop, 430, Number.POSITIVE_INFINITY), 1200);
});

test('panelWidthOf: a "tablet"/"desktop" panel with no stored size falls back to the live phoneWidth, never a second hardcoded literal', () => {
  const noSize: PanelWindow = { ...createHistoryPanel(), formFactor: 'desktop', size: undefined };
  assert.equal(panelWidthOf(noSize, 430, Number.POSITIVE_INFINITY), 430, 'size?.width ?? phoneWidth: a missing size means the live phoneWidth, not a hardcoded fallback');
});

test('panelWidthOf caps a tablet/desktop panel at maxLiveWidth, the widest one live panel can be: the tier width is a maximum. History alone, phone 390: 842 at the default 1280 window (never 1200), exactly 1200 at 1920, and a tablet is capped at the 844 minimum', () => {
  const [desktop] = setFormFactor(appendPanel([], { sourceWebContentsId: -1, url: 'about:blank' }, 'd'), 'd', 'desktop');
  const [tablet] = setFormFactor(appendPanel([], { sourceWebContentsId: -1, url: 'about:blank' }, 't'), 't', 'tablet');
  const cap = (containerWidth: number) => computeMaxLiveWidth({ containerWidth, phoneWidth: 390, gap: GAP, fixedItemCount: 1 });
  assert.equal(cap(1280), 842, 'precondition: the budget beside History in the default window');
  assert.equal(panelWidthOf(desktop!, 390, cap(1280)), 842, 'a desktop panel in the default window is the budget, never its 1200 tier width');
  assert.equal(panelWidthOf(tablet!, 390, cap(1280)), 768, 'a tablet fits under that cap: its own tier width');
  assert.equal(panelWidthOf(desktop!, 390, cap(1920)), 1200, 'at 1920 the cap (1482) does not bind: exactly the tier width');
  assert.equal(cap(844), 406, 'precondition: the budget at the window minimum');
  assert.equal(panelWidthOf(tablet!, 390, cap(844)), 406, 'a tablet at the window minimum is capped too');
  assert.equal(panelWidthOf(desktop!, 390, cap(844)), 406);
  assert.equal(panelWidthOf(desktop!, 390, Number.POSITIVE_INFINITY), 1200, 'unmeasured (no cap): the tier width');
});

test('panelWidthOf never caps a phone panel: it is always the live phone width, whatever maxLiveWidth says', () => {
  const phone = createHistoryPanel();
  assert.equal(panelWidthOf(phone, 430, 300), 430, 'a cap below the phone width leaves a phone panel alone');
  assert.equal(panelWidthOf({ ...phone, formFactor: undefined }, 390, 100), 390);
});

// ---------------------------------------------------------------------------
// setFormFactor: one panel's own tier and size, replaced in place.
// ---------------------------------------------------------------------------

const webEntry = (id: string, more: Partial<PanelWindow> = {}): PanelWindow => ({ ...appendPanel([], { sourceWebContentsId: -1, url: `https://${id}.example` }, id)[0]!, ...more });

test('setFormFactor: changes ONLY the named panel\'s tier and size, grow and shrink alike; every other entry is the same object, in the same place', () => {
  const start = [createHistoryPanel(), webEntry('a'), webEntry('b'), webEntry('c', { live: false })];
  const grown = setFormFactor(start, 'b', 'desktop');
  assert.deepEqual(grown.map((p) => p.id), ['history', 'a', 'b', 'c'], 'order unchanged');
  assert.deepEqual([grown[2]!.formFactor, grown[2]!.size], ['desktop', { formFactor: 'desktop', width: 1200, height: 'fill' }]);
  assert.equal(grown[2]!.live, true, 'still live: a resize is never a park');
  for (const i of [0, 1, 3]) assert.equal(grown[i], start[i], `entry ${start[i]!.id} is untouched (same object)`);
  const shrunk = setFormFactor(grown, 'b', 'tablet');
  assert.deepEqual([shrunk[2]!.formFactor, shrunk[2]!.size], ['tablet', { formFactor: 'tablet', width: 768, height: 'fill' }]);
  const back = setFormFactor(shrunk, 'b', 'phone');
  assert.deepEqual([back[2]!.formFactor, back[2]!.size], ['phone', DEFAULT_PANEL_SIZE], 'back to phone: the phone placeholder size again');
  for (const i of [0, 1, 3]) assert.equal(back[i], start[i], `entry ${start[i]!.id} is still the same object after three resizes`);
});

test('setFormFactor: REPLACES size with a fresh object every time -- the shared default and the tier table are never mutated', () => {
  const history = createHistoryPanel();
  const shared = history.size!; // the one DEFAULT_PANEL_SIZE object every entry is created with
  const start = [history, webEntry('a')];
  assert.equal(start[1]!.size, shared, 'precondition: a new panel references the shared default object');
  const tablet = setFormFactor(start, 'a', 'tablet');
  assert.notEqual(tablet[1]!.size, shared);
  assert.notEqual(tablet[1]!.size, TIER_SIZES.tablet, 'a copy of the table entry, not the entry itself');
  const phone = setFormFactor(tablet, 'a', 'phone');
  assert.notEqual(phone[1]!.size, shared, 'even back to phone: a copy, never the shared object');
  assert.notEqual(phone[1]!.size, tablet[1]!.size);
  assert.deepEqual(shared, DEFAULT_PANEL_SIZE, 'the shared default still reads 390x700 phone');
  assert.deepEqual(TIER_SIZES.tablet, { formFactor: 'tablet', width: 768, height: 'fill' });
  assert.ok(Object.isFrozen(shared) && Object.isFrozen(TIER_SIZES.tablet) && Object.isFrozen(TIER_SIZES.desktop), 'the shared objects are frozen, so a mutation throws instead of resizing every panel at once');
});

test('setFormFactor: a no-op (the SAME array back) for History, a permanent column, an unknown id, and a panel already at that tier', () => {
  const permanent = appendPanel([], { sourceWebContentsId: -1, url: 'about:blank', permanent: true }, 'perm')[0]!;
  const start = [createHistoryPanel(), permanent, webEntry('a')];
  assert.equal(setFormFactor(start, 'history', 'desktop'), start, 'History (collapsible:false) never changes tier');
  assert.equal(setFormFactor(start, 'perm', 'tablet'), start, 'nor does a permanent column');
  assert.equal(setFormFactor(start, 'nope', 'tablet'), start, 'an unknown id');
  assert.equal(setFormFactor(start, 'a', 'phone'), start, 'already phone');
  const tablet = setFormFactor(start, 'a', 'tablet');
  assert.equal(setFormFactor(tablet, 'a', 'tablet'), tablet, 'already tablet');
});

test('setFormFactor: a PARKED panel may change tier and stays parked', () => {
  const start = [createHistoryPanel(), webEntry('a', { live: false })];
  const next = setFormFactor(start, 'a', 'tablet');
  assert.deepEqual([next[1]!.formFactor, next[1]!.live], ['tablet', false]);
});

test('appendPanel: formFactor lands on a new panel with that tier\'s size; a permanent column ignores it and stays phone', () => {
  const tablet = appendPanel([], { sourceWebContentsId: -1, url: 'about:blank', formFactor: 'tablet' }, 't1')[0]!;
  assert.deepEqual([tablet.formFactor, tablet.size], ['tablet', { formFactor: 'tablet', width: 768, height: 'fill' }]);
  assert.notEqual(tablet.size, TIER_SIZES.tablet, 'a copy, not the shared table entry');
  const permanent = appendPanel([], { sourceWebContentsId: -1, url: 'about:blank', permanent: true, formFactor: 'desktop' }, 'p1')[0]!;
  assert.deepEqual([permanent.formFactor, permanent.size], ['phone', DEFAULT_PANEL_SIZE], 'a permanent column is always phone');
});
