/**
 * `tuning.maxLivePanels`: how many unpinned parkable panels are live. A scrolling row keeps exactly N whatever the
 * window, a row that does not scroll keeps the smaller of the window's fit and N, the cap holds before the row is
 * measured, and a new value at run time parks at once. Rows are written as the rig writes them: names in array order,
 * `*` after a parked panel.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { createWorkspace, resolvePanelSettings, useProvidePanels } from '../index.js';
import type { PanelWindow, ProvidedPanels, WorkspaceTuning } from '../index.js';
import { differential, differentialsCovered } from './support/differential.js';
import { cleanup, mount, panelsInput } from './support/mount-harness.js';
import { capRig, liveRightOfRoot, rowOf } from './support/cap-rig.js';
import { markerTemplate } from './support/workspace-row.js';

afterEach(() => cleanup());

const thrownCode = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// A scrolling row
// ---------------------------------------------------------------------------

test('scrolling row: N unpinned panels are live at 600, 1280 and 1920 and the leftmost is parked, where the window alone leaves two', async () => {
  for (const width of [600, 1280, 1920]) {
    const r = await capRig({ count: 6, cap: 5, width });
    assert.equal(r.provided().rowScroll, true, `${width}: the row scrolls, History being a scroll entry`);
    assert.equal(r.row(), 'root w1* w2 w3 w4 w5 w6', `${width}: the leftmost is the one parked`);
    cleanup();
  }
  const unset = await capRig({ count: 6, width: 1280 });
  assert.equal(unset.row(), 'root w1* w2* w3* w4* w5 w6', 'control: with the key unset the window decides, and fits two');
});

test('differential tuning.maxLivePanels: six panels in one window park three under a cap of 3 and one under a cap of 5', async () => {
  const rows = new Map<number, string>();
  for (const cap of [3, 5]) {
    rows.set(cap, (await capRig({ count: 6, cap, width: 1280 })).row());
    cleanup();
  }
  differential('tuning.maxLivePanels', (run) => {
    run(3, () => rows.get(3));
    run(5, () => rows.get(5));
  });
  assert.deepEqual([...rows], [[3, 'root w1* w2* w3* w4 w5 w6'], [5, 'root w1* w2 w3 w4 w5 w6']]);
});

test('scrolling row: a cap of 1 and a cap above the panel count both hold the row exact', async () => {
  const one = await capRig({ count: 4, cap: 1, width: 4000 });
  assert.equal(one.row(), 'root w1* w2* w3* w4');
  const roomy = await capRig({ count: 4, cap: 9, width: 600 });
  assert.equal(roomy.row(), 'root w1 w2 w3 w4', 'a cap larger than the row parks nothing, and the narrow window no longer parks either');
});

test('scrolling row: opening a seventh panel parks the leftmost live unpinned panel and never the one just opened', async () => {
  const r = await capRig({ count: 8, initial: 6, cap: 5 });
  assert.equal(r.row(), 'root w1* w2 w3 w4 w5 w6');
  r.add('w7');
  await r.settle();
  assert.equal(r.row(), 'root w1* w2* w3 w4 w5 w6 w7');
  r.add('w8');
  await r.settle();
  assert.equal(r.row(), 'root w1* w2* w3* w4 w5 w6 w7 w8', 'the next open parks the next leftmost, the new panel stays');
});

test('scrolling row: the cap holds under React.StrictMode too', async () => {
  const r = await capRig({ count: 8, initial: 7, cap: 5, strict: true });
  assert.equal(r.row(), 'root w1* w2* w3 w4 w5 w6 w7');
  r.add('w8');
  await r.settle();
  assert.equal(r.row(), 'root w1* w2* w3* w4 w5 w6 w7 w8');
});

test('scrolling row: a panel that scrolls instead of parking is neither counted nor parked', async () => {
  const r = await capRig({ count: 5, cap: 2, own: { w3: { overflow: 'scroll' } } });
  assert.equal(r.row(), 'root w1* w2* w3 w4 w5', 'w3 stays live beside the two parkable panels the cap keeps');
});

test('a workspace made with a value that is not an integer of 1 or more starts with no cap, as its other tuning leaves do', () => {
  for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, '3', true]) {
    const ws = createWorkspace({ root: markerTemplate('root'), templates: [], tuning: { maxLivePanels: bad as never } });
    assert.equal(ws.tuning.maxLivePanels, null, String(bad));
  }
  assert.equal(createWorkspace({ root: markerTemplate('root'), templates: [], tuning: { maxLivePanels: 3 } }).tuning.maxLivePanels, 3);
  assert.equal(createWorkspace({ root: markerTemplate('root'), templates: [] }).tuning.maxLivePanels, null, 'left out, there is none');
});

test('null is a value of its own: a workspace takes it as no cap, and the instance layer reports it wrong-scope as it does any other value of this leaf', () => {
  assert.equal(createWorkspace({ root: markerTemplate('root'), templates: [], tuning: { maxLivePanels: null } }).tuning.maxLivePanels, null);
  const asked = resolvePanelSettings({ instance: { tuning: { maxLivePanels: null } } as never });
  assert.deepEqual(asked.conflicts.map((c) => [c.key, c.kind]), [['tuning.maxLivePanels', 'wrong-scope']]);
});

// ---------------------------------------------------------------------------
// A row that does not scroll
// ---------------------------------------------------------------------------

const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({ id, url: `https://${id}.example`, title: id.toUpperCase(), live: true, locked: false, view: 'web', collapsible: true, listed: true, ...over });
const historyEntry = (): PanelWindow => entry('root', { url: '', title: 'History', locked: true, collapsible: false, listed: false });

/** Hand-built entries, which carry no settings and so give a row with no scroll entry. `rows` collects the row of every committed render. */
function handBuilt(entries: PanelWindow[], width: number, tuning?: WorkspaceTuning, rows?: string[], strict = false): { now: () => ProvidedPanels; row: () => string } {
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(panelsInput({ initialEntries: entries, containerWidth: width, ...(tuning === undefined ? {} : { tuning }) }));
    const seen = latest;
    React.useLayoutEffect(() => {
      rows?.push(rowOf(seen.entries));
    });
    return React.createElement('output');
  }
  mount(strict ? React.createElement(React.StrictMode, null, React.createElement(Probe)) : React.createElement(Probe));
  return { now: () => latest!, row: () => rowOf(latest!.entries) };
}
const six = (): PanelWindow[] => [historyEntry(), entry('a'), entry('b'), entry('c'), entry('d'), entry('e'), entry('f')];

test('row that does not scroll: the live count is the smaller of the window fit and N, at a fit below N, equal to N and above N', () => {
  // With N = 3 the window fits two, three and four panels beside History at these widths.
  const cases: ReadonlyArray<readonly [width: number, unset: string, capped: string]> = [
    [1300, 'root a* b* c* d* e f', 'root a* b* c* d* e f'],
    [1700, 'root a* b* c* d e f', 'root a* b* c* d e f'],
    [2100, 'root a* b* c d e f', 'root a* b* c* d e f'],
  ];
  for (const [width, unset, capped] of cases) {
    const off = handBuilt(six(), width);
    assert.equal(off.now().rowScroll, false, `${width}: nothing in the row scrolls`);
    assert.equal(off.row(), unset, `${width}: with the key unset the window alone decides`);
    cleanup();
    assert.equal(handBuilt(six(), width, { maxLivePanels: 3 }).row(), capped, `${width}: N = 3`);
    cleanup();
  }
});

test('row that does not scroll: a window that fits the whole row still shows only N', () => {
  assert.equal(handBuilt(six(), 3000).row(), 'root a b c d e f', 'control: the unset key leaves every panel live');
  cleanup();
  assert.equal(handBuilt(six(), 3000, { maxLivePanels: 3 }).row(), 'root a* b* c* d e f');
});

test('row that does not scroll: a hand-built row whose tuning value is not an integer of 1 or more has no cap', () => {
  for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(handBuilt(six(), 3000, { maxLivePanels: bad }).row(), 'root a b c d e f', String(bad));
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Before the row is measured
// ---------------------------------------------------------------------------

test('unmeasured row: with the key unset nothing parks, as before', async () => {
  const r = await capRig({ count: 4, width: 0 });
  assert.equal(r.row(), 'root w1 w2 w3 w4');
});

test('unmeasured row: with N = 2 the leftmost two panels are parked when the row first shows them', async () => {
  const r = await capRig({ count: 4, cap: 2, width: 0 });
  assert.equal(r.row(), 'root w1* w2* w3 w4');
});

test('unmeasured row: the first measure changes the live set by 0 and no committed row holds more than N unpinned live panels', async () => {
  const r = await capRig({ count: 4, cap: 2, width: 0, record: true });
  assert.equal(r.row(), 'root w1* w2* w3 w4');
  const settledAt = r.commits.length;
  r.m.setWidth(1280);
  await r.settle();
  assert.equal(r.row(), 'root w1* w2* w3 w4', 'the measure moved no panel');
  assert.ok(r.commits.length > settledAt, 'the probe saw the render the measure caused');
  assert.ok(r.commits.some((row) => row.includes('w1')), 'the probe saw the row that first holds the panels');
  assert.deepEqual(r.commits.filter((row) => liveRightOfRoot(row) > 2), [], 'no committed row, the first included, held a third live panel');
});

test('unmeasured row: the render probe does see a row that holds more than N when there is one', async () => {
  const r = await capRig({ count: 4, width: 0, record: true });
  r.m.setWidth(1280);
  await r.settle();
  assert.ok(Math.max(...r.commits.map(liveRightOfRoot)) >= 4, 'control: with the key unset the probe records the four live panels');
});

// ---------------------------------------------------------------------------
// Committed rows
// ---------------------------------------------------------------------------

/** The first committed row that holds a panel besides History. */
const firstWithPanels = (commits: readonly string[]): string | undefined => commits.find((row) => row !== 'root');

test('committed rows: panels added before the mount arrive with the leftmost two already parked, and no row holds more than N', async () => {
  const r = await capRig({ count: 7, cap: 5, record: true });
  assert.equal(firstWithPanels(r.commits), 'root w1* w2* w3 w4 w5 w6 w7');
  assert.deepEqual(r.commits.filter((row) => liveRightOfRoot(row) > 5), [], 'no committed row held a sixth live panel');
  cleanup();
  const control = await capRig({ count: 7, record: true });
  assert.equal(liveRightOfRoot(firstWithPanels(control.commits)!), 7, 'control: with the key unset the probe sees the seven live panels');
});

test('committed rows: the same under StrictMode', async () => {
  const r = await capRig({ count: 7, cap: 5, record: true, strict: true });
  assert.equal(firstWithPanels(r.commits), 'root w1* w2* w3 w4 w5 w6 w7');
  assert.deepEqual(r.commits.filter((row) => liveRightOfRoot(row) > 5), [], 'no committed row held a sixth live panel');
  assert.equal(r.row(), 'root w1* w2* w3 w4 w5 w6 w7');
});

test('committed rows: two pinned panels arrive live and the leftmost two unpinned ones arrive parked', async () => {
  const r = await capRig({ count: 9, cap: 5, pinned: ['w1', 'w2'], record: true });
  assert.equal(firstWithPanels(r.commits), 'w1 w2 root w3* w4* w5 w6 w7 w8 w9');
  assert.deepEqual(r.commits.filter((row) => liveRightOfRoot(row) > 5), [], 'no committed row held a sixth live unpinned panel');
});

test('committed rows: hand-built entries arrive in the first commit with the excess parked', () => {
  const rows: string[] = [];
  handBuilt(six(), 3000, { maxLivePanels: 3 }, rows);
  assert.equal(rows[0], 'root a* b* c* d e f', 'the first committed row');
  assert.deepEqual(rows.filter((row) => liveRightOfRoot(row) > 3), []);
  cleanup();
  const control: string[] = [];
  handBuilt(six(), 3000, undefined, control);
  assert.equal(control[0], 'root a b c d e f', 'control: with the key unset the first row holds all six');
  cleanup();
  const strict: string[] = [];
  handBuilt(six(), 3000, { maxLivePanels: 3 }, strict, true);
  assert.deepEqual(strict.filter((row) => liveRightOfRoot(row) > 3), [], 'under StrictMode too');
});

test('committed rows: a lower value of the cap is in the first row that renders it', async () => {
  const r = await capRig({ count: 4, width: 4000, record: true });
  const before = r.commits.length;
  r.turn(() => r.ws.panels.configureTuning({ maxLivePanels: 2 }));
  await r.settle();
  const after = r.commits.slice(before);
  assert.equal(after[0], 'root w1* w2* w3 w4');
  assert.deepEqual(after.filter((row) => liveRightOfRoot(row) > 2), [], 'no committed row held a third live panel');
});

test('committed rows: the panels parked before the first row is shown are parks for room, so under auto the latest comes back first', async () => {
  const r = await capRig({ count: 7, cap: 5, returns: 'auto', record: true });
  assert.equal(firstWithPanels(r.commits), 'root w1* w2* w3 w4 w5 w6 w7');
  r.turn(() => r.h.w7!.close());
  await r.settle();
  assert.equal(r.row(), 'root w1* w2 w3 w4 w5 w6', 'closing a live panel returned the latest parked, w2');
  r.turn(() => r.h.w6!.close());
  await r.settle();
  assert.equal(r.row(), 'root w1 w2 w3 w4 w5', 'and the next closing returned the one parked before it');
});

test('committed rows: under auto a panel parked before the first row is shown reads as parked, not hidden', async () => {
  const r = await capRig({ count: 7, cap: 5, returns: 'auto', own: { w1: { pinningWhenNotLive: { parked: 'place-only', hidden: 'refuse' } } } });
  assert.equal(r.row(), 'root w1* w2* w3 w4 w5 w6 w7');
  assert.equal(r.turn(() => r.h.w1!.pin()).ok, true, 'a pin change that a hidden panel refuses is placed for a parked one');
});

test('committed rows: under manual the panels parked before the first row is shown stay hidden until shown', async () => {
  const r = await capRig({ count: 7, cap: 5, record: true });
  r.turn(() => r.h.w7!.close());
  await r.settle();
  assert.equal(r.row(), 'root w1* w2* w3 w4 w5 w6', 'closing a live panel returned nothing');
  r.turn(() => r.h.w1!.show());
  await r.settle();
  assert.equal(r.row(), 'root w1 w2* w3 w4 w5 w6', 'showing one brings back that one alone');
});

// ---------------------------------------------------------------------------
// A new value at run time
// ---------------------------------------------------------------------------

test('run time: a lower N parks the leftmost excess, with the same park as a narrower window', async () => {
  const r = await capRig({ count: 4, width: 4000 });
  assert.equal(r.row(), 'root w1 w2 w3 w4', 'before: no cap');
  const result = r.turn(() => r.ws.panels.configureTuning({ maxLivePanels: 2 }));
  assert.equal(result.ok, true);
  await r.settle();
  assert.equal(r.row(), 'root w1* w2* w3 w4');
  assert.equal(r.ws.tuning.maxLivePanels, 2);
});

test('run time: under capacityReturn manual a higher N and null return no panel', async () => {
  const r = await capRig({ count: 4, width: 4000, cap: 2 });
  assert.equal(r.row(), 'root w1* w2* w3 w4');
  r.turn(() => r.ws.panels.configureTuning({ maxLivePanels: 4 }));
  await r.settle();
  assert.equal(r.row(), 'root w1* w2* w3 w4', 'N = 4 leaves two free slots, and nothing fills them');
  r.turn(() => r.ws.panels.configureTuning({ maxLivePanels: null }));
  await r.settle();
  assert.equal(r.row(), 'root w1* w2* w3 w4', 'no cap returns nothing either');
  assert.equal(r.ws.tuning.maxLivePanels, null);
});

test('run time: under capacityReturn auto a higher N returns the most recently parked first, and null returns them all', async () => {
  const r = await capRig({ count: 4, width: 4000, returns: 'auto', cap: 2 });
  assert.equal(r.row(), 'root w1* w2* w3 w4');
  r.turn(() => r.ws.panels.configureTuning({ maxLivePanels: 3 }));
  await r.settle();
  assert.equal(r.row(), 'root w1* w2 w3 w4', 'one slot opens, and w2, parked after w1, returns into it');
  r.turn(() => r.ws.panels.configureTuning({ maxLivePanels: null }));
  await r.settle();
  assert.equal(r.row(), 'root w1 w2 w3 w4');
});

test('run time: a value that is not an integer of 1 or more is refused and changes nothing', async () => {
  const r = await capRig({ count: 4, width: 4000, cap: 2 });
  for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, '3', true]) {
    assert.equal(thrownCode(() => r.ws.panels.configureTuning({ maxLivePanels: bad } as never)), 'invalid-settings', String(bad));
  }
  await r.settle();
  assert.equal(r.ws.tuning.maxLivePanels, 2);
  assert.equal(r.row(), 'root w1* w2* w3 w4');
});

test('run time: lowering N with a pinned panel present parks unpinned panels only', async () => {
  const r = await capRig({ count: 5, width: 4000, pinned: ['w1'] });
  assert.equal(r.row(), 'w1 root w2 w3 w4 w5');
  r.turn(() => r.ws.panels.configureTuning({ maxLivePanels: 2 }));
  await r.settle();
  assert.equal(r.row(), 'w1 root w2* w3* w4 w5', 'the pinned panel is not among the parked and not among the two kept');
});

test('differential coverage: the names the differential above completed are exactly the one this file owns', () => {
  assert.ok(differentialsCovered().length > 0, 'no differential completed, so the equality below would prove nothing');
  assert.deepEqual(differentialsCovered(), ['tuning.maxLivePanels']);
});
