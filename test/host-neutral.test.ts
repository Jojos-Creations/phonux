/**
 * A host that is not a browser: no url on a panel, no history or phone members on the host, host-supplied labels
 * and default view, and nothing ambient behind any of it.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  HostProvider,
  Panel,
  PanelHeaderRow,
  PanelRow,
  useProvidePanels,
  type Host,
  type ProvidedPanels,
  type WorkspaceState,
  type WorkspaceStorage,
} from '../index.js';
import { createFakeHost } from '../fakeHost.js';
import { DEFAULT_LABELS, resolveLabels, type PhonuxLabels } from '../labels.js';
import { computeRowNumbers } from '../index.js';
import { panelKey } from '../panelSettings.js';
import { createHistoryPanel } from '../panelWindow.js';
import { placeholderFor } from '../viewRegistry.js';
import { cleanup, mount, plainTemplate, withHost, useSeededInput, StaticRow } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';

registerTestView('hn-view', ({ panel }) => React.createElement('i', { 'data-hn': panel.id }, panel.title));

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

const ROOT = 'root';
const NONE: ReadonlySet<string> = new Set();

function mountProvider(over: Partial<Parameters<typeof useSeededInput>[0]> = {}): { latest: () => ProvidedPanels; container: HTMLElement; host: () => Host } {
  let latest: ProvidedPanels | undefined;
  const hostOver = (): Partial<Host> => ({ ...(over.labels !== undefined ? { labels: over.labels } : {}) });
  function Probe(): React.ReactElement {
    const input = useSeededInput({ initialEntries: [createHistoryPanel(ROOT)], templates: [plainTemplate('hn-view')], ...over });
    latest = useProvidePanels(input);
    const host: Host = { ...createFakeHost({ panels: latest }), ...hostOver() };
    return withHost(React.createElement(PanelRow, { entries: latest.entries, rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE, rowNumbers: latest.rowNumbers, workspace: input.workspace }), host);
  }
  const mounted = mount(React.createElement(Probe));
  return { latest: () => latest!, container: mounted.container, host: () => createFakeHost() };
}

test('create() with no url reports an empty url, in the entry and in the summary a view reads', () => {
  const m = mountProvider();
  act(() => m.latest().create({ view: 'hn-view' }));
  const made = m.latest().entries.find((p) => p.id !== ROOT)!;
  assert.equal(made.url, '');
  assert.equal(m.latest().panelList.find((p) => p.id === panelKey(made))!.url, '');
});

test('create() with no view and no default view renders the unregistered-view placeholder without throwing', () => {
  const m = mountProvider();
  act(() => m.latest().create());
  const made = m.latest().entries.find((p) => p.id !== ROOT)!;
  assert.equal(made.view, '');
  assert.equal(m.container.querySelectorAll('[data-unregistered-panel-view]').length >= 1, true);
});

test('defaultView supplies the view of a create() without one, and an explicit view still wins', () => {
  const m = mountProvider({ defaultView: 'hn-view' });
  act(() => m.latest().create());
  act(() => m.latest().create({ view: 'hn-other' }));
  const made = m.latest().entries.filter((p) => p.id !== ROOT);
  assert.deepEqual(made.map((p) => p.view), ['hn-view', 'hn-other']);
  assert.equal(m.container.querySelectorAll('[data-hn]').length, 1);
  assert.equal(m.container.querySelectorAll('[data-unregistered-panel-view="hn-other"]').length, 1);
});

test('a saved file whose panels have no url keeps every panel', async () => {
  const file: WorkspaceState = {
    version: 1,
    panels: [1, 2, 3].map((n) => ({ id: `p${n}`, view: 'hn-view', live: true, anchor: { panel: ROOT, position: 'right' as const, priority: n } })) as unknown as WorkspaceState['panels'],
  };
  const storage: WorkspaceStorage = { load: () => Promise.resolve(file), save: () => {} };
  const m = mountProvider({ storage });
  await act(async () => {});
  const restored = m.latest().entries.filter((p) => p.id !== ROOT);
  assert.equal(restored.length, 3);
  assert.deepEqual(restored.map((p) => p.url), ['', '', '']);
});

test('a closed panel with no title reports an empty title for the host to replace', () => {
  const closed: { title: string; url: string }[] = [];
  const m = mountProvider({ onPanelsClosed: (entry) => void closed.push({ title: entry.title, url: entry.url }) });
  act(() => m.latest().create({ view: 'hn-view' }));
  const id = m.latest().entries.find((p) => p.id !== ROOT)!.id;
  act(() => m.latest().close(id));
  assert.equal(closed.length, 1);
  assert.deepEqual(closed[0], { title: DEFAULT_LABELS.panelTitle(id), url: '' });
});

test('a panel that has no title closes with an empty title, not a url or placeholder fallback', () => {
  const closed: { title: string; url: string }[] = [];
  const bare = { ...createHistoryPanel('bare'), title: '', locked: false, view: 'hn-view' };
  const m = mountProvider({ initialEntries: [createHistoryPanel(ROOT), bare], onPanelsClosed: (entry) => void closed.push({ title: entry.title, url: entry.url }) });
  act(() => m.latest().close('bare'));
  assert.deepEqual(closed, [{ title: '', url: '' }]);
});

test('a host holding only device.size and panels renders Panel and PanelRow', () => {
  const full = createFakeHost();
  const minimal = { settings: full.settings, panels: full.panels, device: { size: full.device.size } } satisfies Host;
  const panel = mount(
    React.createElement(HostProvider, { host: minimal, children: React.createElement(Panel, null, 'body-text') }),
  );
  assert.equal(panel.container.textContent?.includes('body-text'), true);
  const entry = { ...createHistoryPanel(ROOT), view: 'hn-view', title: 'root' };
  const rowNumbers = computeRowNumbers({ entries: [entry], phoneWidth: 390, containerWidth: 1000, gap: 16 });
  const row = mount(
    React.createElement(HostProvider, {
      host: minimal,
      children: React.createElement(StaticRow, { entries: [entry], rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE, rowNumbers }),
    }),
  );
  assert.equal(row.container.querySelectorAll('[data-hn]').length, 1);
});

test('labels overrides replace each default string', () => {
  const labels = {
    panelTitle: (id: string) => `Fenster ${id}`,
    untitledPanel: 'Ohne Titel',
    untitledHeader: 'Namenlos',
    historyTitle: 'Verlauf',
  };
  const m = mountProvider({ labels });
  act(() => m.latest().create({ view: 'hn-view' }));
  const id = m.latest().entries.find((p) => p.id !== ROOT)!.id;
  assert.equal(m.latest().entries.find((p) => p.id === id)!.title, `Fenster ${id}`);
  assert.equal(createHistoryPanel(ROOT, labels.historyTitle).title, 'Verlauf');

  const host: Host = { ...createFakeHost(), labels };
  const header = renderToStaticMarkup(React.createElement(HostProvider, { host, children: React.createElement(PanelHeaderRow, { title: '', actions: null }) }));
  assert.equal(header.includes('Namenlos'), true);
  const Untitled = placeholderFor('hn-nowhere');
  const placeholder = renderToStaticMarkup(
    React.createElement(HostProvider, { host, children: React.createElement(Untitled, { panel: { id: 'x', live: true, locked: false } }) }),
  );
  assert.equal(placeholder.includes('Ohne Titel'), true);
});

test('without labels every default string is the English text', () => {
  assert.equal(createHistoryPanel(ROOT).title, 'History');
  const Untitled = placeholderFor('hn-nowhere');
  assert.equal(renderToStaticMarkup(React.createElement(Untitled, { panel: { id: 'x', live: true, locked: false } })).includes('Untitled panel'), true);
});

test('the pin-refusal labels default to English and a host overrides them', () => {
  assert.equal(DEFAULT_LABELS.pinFailed, 'Could not pin this panel');
  assert.equal(DEFAULT_LABELS.unpinFailed, 'Could not unpin this panel');
  const labels = resolveLabels({ pinFailed: 'Anheften fehlgeschlagen' });
  assert.equal(labels.pinFailed, 'Anheften fehlgeschlagen');
  assert.equal(labels.unpinFailed, DEFAULT_LABELS.unpinFailed);
});

test('a label key given as undefined keeps its default', () => {
  const given = { historyTitle: undefined, untitledHeader: 'Namenlos' } as unknown as Partial<PhonuxLabels>;
  const labels = resolveLabels(given);
  assert.equal(labels.historyTitle, DEFAULT_LABELS.historyTitle);
  assert.equal(labels.untitledHeader, 'Namenlos');
  assert.equal(labels.panelTitle('x'), DEFAULT_LABELS.panelTitle('x'));
});
