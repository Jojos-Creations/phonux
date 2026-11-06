/**
 * `PanelManager.swap` and `showPanels` over it: the hides and the shows of a set change land in one update, priced against the
 * row without the hides, so the leaving slots shrink into their centers while the arriving ones grow from theirs, in the same
 * frames. A refusal is whole: nothing changes when one panel cannot take its part.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { showPanels } from '../index.js';
import type { PanelResult } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { capRig, type CapRig } from './support/cap-rig.js';

afterEach(() => cleanup());

/** Four park panels under a cap of two: two live, two parked by the cap. */
async function rig(): Promise<{ r: CapRig; live: string[]; parked: string[] }> {
  const r = await capRig({ count: 4, cap: 2 });
  const live = r.unpinnedLive();
  const parked = r.parked();
  assert.equal(live.length, 2, `control: two live (${r.row()})`);
  assert.equal(parked.length, 2, `control: two parked (${r.row()})`);
  return { r, live, parked };
}

const slotOf = (r: CapRig, name: string): HTMLElement | null => r.m.container.querySelector<HTMLElement>(`[data-row-id="${r.entry(name).id}"]`);
const scaleOf = (el: HTMLElement): number => {
  const match = /scale\(([\d.]+)/.exec(el.style.transform);
  return match ? Number(match[1]) : 1;
};

test('swap: the hides and the shows land in one update, the shows priced without the hides', async () => {
  const { r, live, parked } = await rig();
  const result = r.turn(() => r.ws.panels.swap(parked, live));
  assert.deepEqual(result, { ok: true, changed: true });
  assert.deepEqual(r.unpinnedLive(), parked, `the parked pair is live at once, with no second turn (${r.row()})`);
  assert.deepEqual(r.parked(), live, 'and the live pair is parked');
});

test('swap: the leaving slots shrink into their centers while the arriving ones grow from theirs, in the same frames', async () => {
  const { r, live, parked } = await rig();
  r.turn(() => r.ws.panels.swap(parked, live));
  await advanceFrames(200);
  const leaving = slotOf(r, live[0]!);
  const arriving = slotOf(r, parked[0]!);
  assert.ok(leaving !== null && arriving !== null, 'control: a leaving slot is still drawn while an arriving one is');
  assert.ok(scaleOf(leaving) > 0 && scaleOf(leaving) < 1, `the leaving slot is mid-shrink (scale ${scaleOf(leaving)})`);
  assert.match(leaving.style.transformOrigin, /^50% 50%/, `it shrinks about its center, as a close does (${leaving.style.transformOrigin})`);
  assert.ok(scaleOf(arriving) > 0 && scaleOf(arriving) < 1, `the arriving slot is mid-grow in the same frame (scale ${scaleOf(arriving)})`);
  assert.doesNotMatch(arriving.style.transformOrigin, /^(0|100)%/, `it grows about its center, as an open does (${arriving.style.transformOrigin})`);
});

test('swap: a show may carry its place, and a live show or a parked hide is left as it is', async () => {
  const { r, live, parked } = await rig();
  const [l1, l2] = live as [string, string];
  const [p1, p2] = parked as [string, string];
  const result = r.turn(() => r.ws.panels.swap([{ id: p1, place: { before: l1 } }, l2], [l1, p2]));
  assert.deepEqual(result, { ok: true, changed: true });
  assert.deepEqual(r.unpinnedLive(), [p1, l2], `${p1} lands before ${l1} and ${l2} stays live (${r.row()})`);
  assert.equal(r.row().indexOf(p1) < r.row().indexOf(l1), true, `${p1} sits before ${l1}`);
});

test('swap: refused as a whole for an unknown panel and for a panel with an operation this turn', async () => {
  const { r, live, parked } = await rig();
  const [l1] = live as [string, string];
  const [p1, p2] = parked as [string, string];
  let unknown: PanelResult | undefined;
  let busy: PanelResult | undefined;
  r.turn(() => {
    unknown = r.ws.panels.swap([p1, 'nope'], [l1]);
    assert.deepEqual(r.unpinnedLive(), live, 'nothing changed');
    assert.deepEqual(r.ws.panels.swap([p1], [l1]), { ok: true, changed: true });
    busy = r.ws.panels.swap([p2], [l1]);
  });
  assert.equal(unknown?.ok === false && unknown.code, 'unknown-panel');
  assert.equal(busy?.ok === false && busy.code, 'busy', 'a panel with an operation this turn refuses a second');
  assert.deepEqual(new Set(r.unpinnedLive()), new Set([p1, live[1]!]), r.row());
});

test('showPanels: one swap, resolved once the shown panels are live', async () => {
  const { r, live, parked } = await rig();
  const result = await showPanels(r.ws.panels, parked, live);
  assert.deepEqual(result, { ok: true, changed: true });
  assert.deepEqual(r.unpinnedLive(), parked, r.row());
});
