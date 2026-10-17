/**
 * A panel has one public id, its key: the id a view's `panel.id`, `PanelsAPI`, `useActivePanel`, the snapshot trigger and
 * `tuning.initialScroll.panel` all name it by. The row's counter id still resolves where an id is read, with one warning.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createWorkspace, definePanel, useActivePanel, usePanelActive } from '../index.js';
import { warnCounterId } from '../panelIds.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { matrixRig, matrixTemplate } from './support/configure-matrix.js';
import { made, mountRow, panelsOf, rootEntry, row } from './support/scroll-row.js';
import { flush, markerTemplate, mountWorkspace, rowEntries } from './support/workspace-row.js';

afterEach(() => {
  mock.restoreAll();
  cleanup();
});

/** A row [root, s1..s4, parked s5] whose panels are keyed web~1..web~5: the counter id of each is its sN name. */
const keyedRow = () => row(rootEntry(), ...[1, 2, 3, 4].map((k) => made(`s${k}`, {}, { key: `web~${k}` })), made('s5', { overflow: 'park' }, { key: 'web~5', live: false }));
const slotsOf = (m: ReturnType<typeof mountRow>, counter: string): number | undefined => m.latest().entries.find((p) => p.id === counter)?.slots;

test('a template panel\'s view is given panel.id equal to handle.id, for a singleton and for each instance of a multiple template', async () => {
  const single = markerTemplate('single');
  const many = markerTemplate('many', { settings: { multiple: true } });
  const w = createWorkspace({ mount: false, templates: [single, many] });
  w.addPanel(single);
  const m = mountWorkspace(w);
  await flush();
  w.addPanel(many);
  w.addPanel(many);
  await flush();
  const nodes = [...m.container.querySelectorAll<HTMLElement>('[data-template]')];
  assert.equal(nodes.length, 3, 'positive control: all three rendered');
  for (const node of nodes) assert.equal(node.dataset.slot, node.dataset.handleId, `${node.dataset.template}: panel.id is handle.id`);
  assert.equal(nodes.filter((n) => n.dataset.slot!.includes('~')).length, 2, 'control: the instances have a key unlike the counter');
});

test('panelList and recentlyClosed list the panels by key', () => {
  const m = mountRow(keyedRow(), 4000);
  assert.deepEqual(m.latest().panelList.map((s) => s.id), ['web~1', 'web~2', 'web~3', 'web~4', 'web~5']);
  act(() => m.latest().close('web~2'));
  assert.deepEqual(m.latest().recentlyClosed?.map((s) => s.id), ['web~2']);
});

test('every PanelsAPI verb that names a panel takes its key', async () => {
  const m = mountRow(keyedRow(), 4000);
  act(() => m.latest().setSlots('web~3', 2));
  assert.equal(slotsOf(m, 's3'), 2, 'setSlots');
  const before = m.latest().entries.map((p) => p.id).join(',');
  act(() => m.latest().move('web~2', 'right'));
  assert.notEqual(m.latest().entries.map((p) => p.id).join(','), before, 'move');
  act(() => m.latest().close('web~4'));
  assert.equal(m.latest().entries.some((p) => p.id === 's4'), false, 'close');
  act(() => m.latest().activate('web~5'));
  await advanceFrames(100);
  assert.equal(m.latest().entries.find((p) => p.id === 's5')?.live, true, 'activate');
  assert.equal(typeof m.latest().scrollTo('web~1'), 'boolean', 'scrollTo');
});

test('a counter id still resolves where an id is read, with one warning naming the key', () => {
  const warn = mock.method(console, 'warn', () => undefined);
  const m = mountRow(keyedRow(), 4000);
  act(() => m.latest().setSlots('s1', 2));
  act(() => m.latest().setSlots('s1', 3));
  assert.equal(slotsOf(m, 's1'), 3, 'the counter id reached the panel');
  assert.equal(warn.mock.callCount(), 1, 'one warning for the id, however often it is used');
  assert.match(String(warn.mock.calls[0]!.arguments[0]), /'s1'.*'web~1'/);
});

test('an id that is a panel\'s key is not warned about, and a hand-built entry is its own key', () => {
  const warn = mock.method(console, 'warn', () => undefined);
  const m = mountRow(panelsOf(2), 4000);
  act(() => m.latest().setSlots('s2', 2));
  assert.equal(warn.mock.callCount(), 0);
  assert.equal(slotsOf(m, 's2'), 2);
  warnCounterId('probe-counter', 'probe-key');
  assert.equal(warn.mock.callCount(), 1, 'control: the warning machinery does warn');
});

test('tuning.initialScroll.panel takes a key, and a counter id lands in the same place', () => {
  const rowOf = () => row(rootEntry(), ...Array.from({ length: 10 }, (_, k) => made(`s${k + 1}`, {}, { key: `web~${k + 1}` })));
  const at = (panel: string): number => {
    const m = mountRow(rowOf(), 1000, { tuning: { initialScroll: { panel } } });
    const scrolled = m.container.scrollLeft;
    cleanup();
    return scrolled;
  };
  mock.method(console, 'warn', () => undefined);
  const byKey = at('web~7');
  assert.ok(byKey > 0, 'positive control: the strip scrolled to the key');
  assert.notEqual(byKey, at('web~2'), 'and to a different place for another key');
  assert.equal(at('s7'), byKey, 'a counter id lands where its key does');
});

test('useActivePanel reports and takes a key', async () => {
  const setters = new Map<string, (id: string | null) => void>();
  const many = definePanel({
    id: 'many',
    settings: { multiple: true },
    view: ({ handle }) => {
      const [active, setActive] = useActivePanel();
      const isActive = usePanelActive();
      setters.set(handle.id, setActive);
      return React.createElement('i', { 'data-own': handle.id, 'data-active': String(active), 'data-is-active': String(isActive) });
    },
  });
  const w = createWorkspace({ mount: false, templates: [many] });
  const m = mountWorkspace(w);
  await flush();
  const first = w.addPanel(many);
  const second = w.addPanel(many);
  await flush();
  const nodeOf = (id: string): HTMLElement => m.container.querySelector<HTMLElement>(`[data-own="${id}"]`)!;
  act(() => void setters.get(first.id)!(second.id));
  assert.equal(nodeOf(first.id).dataset.active, second.id, 'the active panel is reported by its key');
  assert.equal(nodeOf(second.id).dataset.isActive, 'true', 'and it is the panel the key names');
  assert.equal(nodeOf(first.id).dataset.isActive, 'false');
  act(() => void setters.get(first.id)!(null));
  assert.equal(nodeOf(first.id).dataset.active, 'null');
});

test('the snapshot trigger is given a panel\'s key', async () => {
  const r = await matrixRig({ extra: [matrixTemplate('multi', { settings: { multiple: true } })] });
  const one = r.ws.addPanel('multi');
  await r.settle();
  assert.ok(one.id.includes('~'), 'control: the key is not the counter');
  r.turn(() => one.hide());
  await r.settle();
  assert.deepEqual(r.capture.captured, [one.id], 'the park asked for a picture under the key');
  r.turn(() => one.show());
  await r.settle();
  r.turn(() => one.close());
  await r.settle();
  assert.ok(r.capture.captured.includes(one.id) && r.capture.captured.every((id) => id === one.id), 'a close asks under the key too');
});

test('useActivePanel\'s setter warns once for a counter id and names the release that removes it', async () => {
  const warn = mock.method(console, 'warn', () => undefined);
  const setters: Array<(id: string | null) => void> = [];
  const many = definePanel({
    id: 'many',
    settings: { multiple: true },
    view: () => {
      const [, setActive] = useActivePanel();
      setters.push(setActive);
      return React.createElement('i');
    },
  });
  const w = createWorkspace({ mount: false, templates: [many] });
  const m = mountWorkspace(w);
  await flush();
  const first = w.addPanel(many);
  await flush();
  const counter = rowEntries.current.find((p) => (p.key ?? p.id) === first.id)?.id;
  assert.ok(counter !== undefined && counter !== first.id, 'control: the counter id differs from the key');
  assert.ok(first.id.includes('~'), 'control: the key is not the counter');
  act(() => void setters[0]!(first.id));
  assert.equal(warn.mock.callCount(), 0, 'a key does not warn');
  act(() => void setters[0]!(counter));
  act(() => void setters[0]!(counter));
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0]!.arguments[0]), /0\.3\.0/);
});
