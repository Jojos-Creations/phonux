/**
 * A sticky panel through a mounted provider, Workspace and PanelRow: where it is drawn, what its view may do with it, and what a
 * drag beside it may cross. The literal numbers are in sticky-numbers.test.ts; the real layout is in sticky-rendered.test.ts.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act, createElement } from 'react';
import type { PanelSettings, PanelWindow } from '../index.js';
import { usePanelCapabilities, usePanelNeighborWidths, useViewState } from '../index.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { appendPanel } from '../panelWindow.js';
import { registerTestView } from './support/test-views.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
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

test('a drag beside a sticky panel does not cross it: the strip panel next to the sticky one reads no width on that side', () => {
  const sticky = mountRow(row(rootEntry(), made('a', { sticky: 'start' }), made('b'), made('c')), 1000);
  const stickyLeft = probeOf(sticky.container, 'b').dataset.left;
  cleanup();
  const plain = mountRow(row(rootEntry(), made('a'), made('b'), made('c')), 1000);
  const plainLeft = probeOf(plain.container, 'b').dataset.left;
  assert.equal(stickyLeft, '', 'b cannot cross the sticky a, so nothing lies to its left');
  assert.equal(plainLeft, '390,390', 'with no sticky panel, b can cross a and the root');
});

test('a panel as wide as the window is not sticky: a three-phone panel with sticky start is a plain strip panel', () => {
  const m = mountRow(row(rootEntry(), made('a', { sticky: 'start', slots: 3, maxSlots: 3 }), made('b')), 1000);
  assert.ok(slotOf(m.container, 'a'), 'the panel is drawn, in the strip');
  assert.equal(slotOf(m.container, 'a')!.closest('[data-row-sticky]'), null, 'it is in no sticky group');
  assert.equal(m.latest().rowNumbers.held.length, 0);
});

test('a sticky panel is never inert and never draggable: its slot is in the group and its view reads movable false', () => {
  const m = mountRow(row(rootEntry(), made('a', { sticky: 'start' }), made('b'), made('c')), 1000);
  const a = slotOf(m.container, 'a')!;
  assert.ok(a.closest('[data-row-sticky="start"]') !== null, 'control: a is in the start group');
  assert.equal(a.closest('[inert]'), null, 'nothing above it is inert');
  assert.equal(a.dataset.movable, 'false', 'a sticky panel cannot be dragged away from its end');
});

/** A view with a value only its state remembers: the host keeps it by panel id, so it outlives the panel being drawn in the other place. */
function Remembers({ panel }: { panel: { id: string } }): React.ReactElement {
  const [text, setText] = useViewState('text', 'first');
  return createElement('button', { 'data-slot': panel.id, 'data-text': text, onClick: () => setText('second') });
}
registerTestView('sticky-remembers', Remembers as never);

test('a panel that turns sticky, and stops being sticky, is drawn in the other place and keeps its view state', async () => {
  const m = mountRow(row(rootEntry(), made('a', {}, { view: 'sticky-remembers' }), made('b'), made('c')), 1000);
  await advanceFrames(64);
  const button = (): HTMLElement => slotOf(m.container, 'a')!;
  act(() => button().click());
  assert.equal(button().dataset.text, 'second', 'control: the view changed its state');
  assert.equal(button().closest('[data-row-sticky]'), null, 'control: a starts in the strip');
  await act(async () => {
    m.workspace.panels.configure('a', { sticky: 'start' });
  });
  await advanceFrames(64);
  assert.ok(button().closest('[data-row-sticky="start"]') !== null, 'a is drawn in the start group');
  assert.equal(button().dataset.text, 'second', 'and still holds what the view set');
  await act(async () => {
    m.workspace.panels.configure('a', { sticky: 'off' });
  });
  await advanceFrames(64);
  assert.equal(button().closest('[data-row-sticky]'), null, 'back in the strip');
  assert.equal(button().dataset.text, 'second', 'with its state through both moves');
});

test('a panel that goes back into the row for room, and returns when the room does, is sticky again with its state, and its setting never changed', async () => {
  const entries = [rootEntry(), made('a', { sticky: 'start' }, { view: 'sticky-remembers' }), made('b'), made('c')];
  const m = mountRow(row(...entries), 1400);
  await advanceFrames(64);
  const a = (): HTMLElement => slotOf(m.container, 'a')!;
  act(() => a().click());
  assert.ok(a().closest('[data-row-sticky="start"]') !== null, 'control: sticky at 1400');
  m.rerender(390);
  await advanceFrames(64);
  assert.equal(a().closest('[data-row-sticky]'), null, 'a phone-wide window has no sticky panel');
  assert.equal(m.latest().entries.find((p) => p.id === 'a')?.settings?.sticky, 'start', 'the setting did not change');
  m.rerender(1400);
  await advanceFrames(64);
  assert.ok(a().closest('[data-row-sticky="start"]') !== null, 'sticky again when the room returns');
  assert.equal(a().dataset.text, 'second', 'with the state it had');
});
