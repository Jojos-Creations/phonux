/**
 * A held panel through a mounted provider, Workspace and PanelRow: where it is drawn, what its view may do with it, and what a
 * drag beside it may cross. The literal numbers are in edge-hold-numbers.test.ts; the real layout is in edge-hold-chromium.test.ts.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { createElement } from 'react';
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

test('a left-held panel is drawn in the left edge element, out of the strip, and its view reads it as not movable', () => {
  // The row root, a (held left), b, c at 1000 px: the held panel is the second entry, the strip is root, b, c.
  const m = mountRow(row(rootEntry(), made('a', { edgeHold: 'left' }), made('b'), made('c')), 1000);
  const held = m.container.querySelector('[data-row-edge="left"] [data-row-id]');
  assert.ok(held, 'the held panel is in the left edge element');
  assert.equal(held.getAttribute('data-row-id'), m.latest().entries.find((p) => p.id !== ROOT && p.title === 'a')?.id);
  assert.equal(m.container.querySelector('[data-row-strip] [data-row-id="a"]'), null, 'not in the strip');
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

test('a panel that cannot fit lets go: a three-phone panel with edgeHold left draws in the strip, not the edge element', () => {
  const m = mountRow(row(rootEntry(), made('a', { edgeHold: 'left', slots: 3, maxSlots: 3 }), made('b')), 1000);
  assert.equal(m.container.querySelector('[data-row-edge="left"] [data-row-id]'), null, 'nothing is held');
  assert.ok(m.container.querySelector('[data-row-strip] [data-row-id]'), 'the strip draws the row');
  assert.ok(slotOf(m.container, 'a'), 'the panel is drawn, in the strip');
});

test('the edge elements sit at the row ends as sticky items: left at 0, right at the gap', () => {
  // Two holds need room for both groups (see the numbers test at 1400), so the row is wide enough for them.
  const m = mountRow(row(rootEntry(), made('a', { edgeHold: 'left' }), made('b'), made('c', { edgeHold: 'right' })), 1400);
  const left = m.container.querySelector<HTMLElement>('[data-row-edge="left"]');
  const right = m.container.querySelector<HTMLElement>('[data-row-edge="right"]');
  assert.ok(left && right);
  assert.equal(left.style.position, 'sticky');
  assert.equal(left.style.left, '0px');
  assert.equal(right.style.position, 'sticky');
  assert.equal(right.style.right, '16px');
});
