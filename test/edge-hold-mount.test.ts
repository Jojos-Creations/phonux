/**
 * A held panel through a mounted provider, Workspace and PanelRow: where it is drawn, what its view may do with it, and what a
 * drag beside it may cross. The literal numbers are in edge-hold-numbers.test.ts; the real layout is in edge-hold-chromium.test.ts.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { createElement, useEffect } from 'react';
import type { PanelSettings, PanelWindow } from '../index.js';
import { usePanelCapabilities, usePanelNeighborWidths } from '../index.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { appendPanel } from '../panelWindow.js';
import { registerTestView } from './support/test-views.js';
import { cleanup } from './support/mount-harness.js';
import { mountRow, rootEntry, row } from './support/scroll-row.js';

afterEach(() => cleanup());

/** What a view reads of its own capabilities and of the widths a drag may cross, written onto the slot. */
function Probe({ panel }: { panel: { id: string } }): React.ReactElement {
  const caps = usePanelCapabilities();
  const neighbours = usePanelNeighborWidths();
  return createElement('i', { 'data-slot': panel.id, 'data-movable': String(caps.movable), 'data-left': neighbours.left.join(','), 'data-right': neighbours.right.join(',') });
}
registerTestView('edge-probe', Probe as never);

/** A view that counts its own mounts by panel id: one increment per mount, so a remount shows as a second one. */
const counted = new Map<string, number>();
function Counted({ panel }: { panel: { id: string } }): React.ReactElement {
  useEffect(() => {
    counted.set(panel.id, (counted.get(panel.id) ?? 0) + 1);
  }, [panel.id]);
  return createElement('i', { 'data-slot': panel.id });
}
registerTestView('edge-count', Counted as never);

const ROOT = 'root';
function made(id: string, layer: PanelSettings = {}, over: Partial<PanelWindow> = {}): PanelWindow {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'edge-probe' }, id, ROOT)[0]!;
  return { ...applyTemplate({ ...skeleton, ...over }, resolvePanelSettings({ template: layer }).value, 'create'), instance: layer };
}

const slotOf = (container: HTMLElement, id: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-slot="${id}"]`);
const probeOf = (container: HTMLElement, id: string): HTMLElement => {
  const node = slotOf(container, id);
  if (node === null) throw new Error(`no slot for ${id}`);
  return node;
};

test('a left-held panel is drawn in the strip, pinned by its own host, and its view reads it as not movable', () => {
  // The row root, a (held left), b, c at 1000 px: the held panel is the second entry, in its React place in the strip.
  const m = mountRow(row(rootEntry(), made('a', { edgeHold: 'left' }), made('b'), made('c')), 1000);
  const aId = m.latest().entries.find((p) => p.id !== ROOT && p.title === 'a')?.id;
  const slot = m.container.querySelector<HTMLElement>(`[data-row-strip] [data-row-id="${aId}"]`);
  assert.ok(slot, 'the held panel is in the strip, at its React place');
  const host = slot.closest<HTMLElement>('[data-row-hold]');
  assert.equal(host?.style.position, 'relative', 'the host holds it at its edge');
  assert.equal(host?.dataset.holdLeft, '0px', 'the left hold is its offset in the left group');
  assert.equal(probeOf(m.container, 'a').dataset.movable, 'false', 'a held panel cannot be moved by a person');
  assert.equal(probeOf(m.container, 'b').dataset.movable, 'true', 'a strip panel still can');
});

test('a drag beside a held panel does not cross it: the strip panel next to the held one reads no width on that side', () => {
  const held = mountRow(row(rootEntry(), made('a', { edgeHold: 'left' }), made('b'), made('c')), 1000);
  const heldLeft = probeOf(held.container, 'b').dataset.left;
  cleanup();
  const plain = mountRow(row(rootEntry(), made('a'), made('b'), made('c')), 1000);
  const plainLeft = probeOf(plain.container, 'b').dataset.left;
  assert.equal(heldLeft, '', 'b cannot cross the held a, so nothing lies to its left');
  assert.equal(plainLeft, '390,390', 'with no hold, b can cross a and the root');
});

test('a panel that cannot fit lets go: a three-phone panel with edgeHold left is a plain strip panel, not held', () => {
  const m = mountRow(row(rootEntry(), made('a', { edgeHold: 'left', slots: 3, maxSlots: 3 }), made('b')), 1000);
  assert.ok(slotOf(m.container, 'a'), 'the panel is drawn, in the strip');
  assert.equal(slotOf(m.container, 'a')!.closest<HTMLElement>('[data-row-hold]')?.style.position, '', 'nothing is held');
  assert.equal(m.latest().rowNumbers.held.length, 0);
});

test('the edge elements are spacers as wide as their groups, and the held panels are pinned by their hosts', () => {
  // Two holds need room for both groups (see the numbers test at 1400), so the row is wide enough for them.
  const m = mountRow(row(rootEntry(), made('a', { edgeHold: 'left' }), made('b'), made('c', { edgeHold: 'right' })), 1400);
  const left = m.container.querySelector<HTMLElement>('[data-row-edge="left"]');
  const right = m.container.querySelector<HTMLElement>('[data-row-edge="right"]');
  assert.ok(left && right);
  assert.equal(left.style.width, '406px', 'the left group and its gap');
  assert.equal(right.style.width, '406px', 'the right group and its gap');
  assert.equal(left.style.position, '', 'a spacer, not a held element');
  const aHost = slotOf(m.container, 'a')!.closest<HTMLElement>('[data-row-hold]');
  const cHost = slotOf(m.container, 'c')!.closest<HTMLElement>('[data-row-hold]');
  assert.equal(aHost?.dataset.holdLeft, '0px');
  assert.equal(cHost?.dataset.holdRight, '16px', 'the right group: its gap, less the panel offset and width');
});

test('a held panel keeps its view when its hold starts and when it lets go, for left, right and both', () => {
  const cases: [string, PanelSettings, string][] = [
    ['left', { edgeHold: 'left' }, 'a'],
    ['right', { edgeHold: 'right' }, 'c'],
    ['both', { edgeHold: 'both' }, 'a'],
  ];
  for (const [name, layer, id] of cases) {
    const entries = [rootEntry(), made(`${name}-a`, name === 'left' || name === 'both' ? layer : {}, { view: 'edge-count' }), made(`${name}-b`, {}, { view: 'edge-count' }), made(`${name}-c`, name === 'right' ? layer : {}, { view: 'edge-count' })];
    const m = mountRow(row(...entries), 1000);
    const key = id === 'a' ? `${name}-a` : `${name}-c`;
    assert.equal(m.latest().rowNumbers.held.length + m.latest().rowNumbers.stuck.length, 1, `${name}: held at 1000`);
    const first = counted.get(entries[id === 'a' ? 1 : 3]!.id);
    assert.ok(first !== undefined, `${key} mounted`);
    m.rerender(300);
    assert.equal(m.latest().rowNumbers.held.length + m.latest().rowNumbers.stuck.length, 0, `${name}: released at 300`);
    m.rerender(1000);
    m.rerender(600);
    m.rerender(1000);
    assert.equal(counted.get(entries[id === 'a' ? 1 : 3]!.id), first, `${name}: the view is the same instance through the hold changes`);
    cleanup();
  }
});

test('two both panels stack: each host is pinned at its stacked inset, and neither view remounts as the stack starts or lets go', () => {
  const entries = [rootEntry(), made('stack-a', { edgeHold: 'both' }, { view: 'edge-count' }), made('stack-b', {}, { view: 'edge-count' }), made('stack-c', { edgeHold: 'both' }, { view: 'edge-count' }), made('stack-d', {}, { view: 'edge-count' })];
  const m = mountRow(row(...entries), 1400);
  const stuck = m.latest().rowNumbers.stuck;
  assert.deepEqual(stuck.map((s) => s.id), [entries[1]!.id, entries[3]!.id], 'both panels stick, in row order');
  const hostOf = (id: string) => slotOf(m.container, id)!.closest<HTMLElement>('[data-row-hold]');
  const outer = hostOf(entries[1]!.id);
  const inner = hostOf(entries[3]!.id);
  assert.equal(outer?.dataset.holdLeft, `${stuck[0]!.left}px`, 'the outer panel is pinned at the window edge');
  assert.equal(inner?.dataset.holdLeft, `${stuck[1]!.left}px`, 'the inner panel is pinned a panel and a gap in');
  assert.equal(inner?.dataset.holdLeft, '406px');
  assert.equal(outer?.dataset.holdRight, `${stuck[0]!.right}px`);
  const first = [counted.get(entries[1]!.id), counted.get(entries[3]!.id)];
  assert.ok(first.every((n) => n !== undefined), 'both views mounted');
  m.rerender(300);
  assert.equal(m.latest().rowNumbers.stuck.length, 0, 'at 300 there is no room for the stack: both let go');
  m.rerender(1400);
  assert.equal(m.latest().rowNumbers.stuck.length, 2, 'at 1400 the stack is back');
  assert.deepEqual([counted.get(entries[1]!.id), counted.get(entries[3]!.id)], first, 'the views are the same instances through the stack starting and letting go');
});
