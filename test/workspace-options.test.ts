/**
 * The options an auto-mounted workspace takes in place of a hand-built Host, `wrap`, and `workspace.update`: each option
 * reaches a view the way `useHost()` read it before, an update changes only what it names, and an app that rebuilds its
 * objects every render does not loop.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { PANEL_SETTINGS_CATALOG, PanelManagerError, PanelRow, Workspace, createWorkspace, definePanel, useHost, useProvidePanels } from '../index.js';
import type { HistoryAPI, PanelTemplate, PhoneDeviceAPI, SettingsAPI, SnapshotsAPI, WorkspaceHandle, WorkspaceLive, WorkspaceWrapProps } from '../index.js';
import { createDefaultTheme, muiThemeFor } from '../defaultTheme.js';
import { HostProvider } from '../hostApi.js';
import { ThemeProvider } from '@mui/material/styles';
import { advanceFrames, mount } from './support/mount-harness.js';
import { rigCleanup, slots, track, until, win } from './support/auto-rig.js';

afterEach(rigCleanup);

// ---------------------------------------------------------------------------
// What a view sees
// ---------------------------------------------------------------------------

const device = (width: number, height = 700): PhoneDeviceAPI => ({ size: { width, height, modelId: 'custom' } });
const settings = (visible: boolean): SettingsAPI => ({ settingsColumn: { visible, show: () => undefined, hide: () => undefined } });
const history = (entries: number, close: () => void = () => undefined): HistoryAPI => ({
  loadClosedPages: async () => [],
  closedPagesViewer: { isOpen: false, loading: false, entries: Array.from({ length: entries }, (_, i) => ({ id: `e${i}`, title: `t${i}`, url: '', closedAt: '' })), open: () => undefined, close: () => undefined },
  locked: true,
  closed: false,
  close,
});
const snapshots = (): SnapshotsAPI => ({ get: () => null, subscribe: () => () => undefined });

/** What the probe view read from `useHost()` at each of its renders. */
const seen: string[] = [];
const hostRead = (): string => {
  const h = useHost();
  return JSON.stringify({ size: h.device.size, column: h.settings.settingsColumn.visible, entries: h.history?.closedPagesViewer.entries.length ?? null, snapshots: h.snapshots !== undefined, labels: h.labels ?? null });
};
const probe = (id = 'probe'): PanelTemplate =>
  definePanel({
    id,
    view: ({ handle }) => {
      const read = hostRead();
      seen.push(read);
      return React.createElement('i', { 'data-slot': handle.id, 'data-host': read });
    },
  });

const hostOf = (): Record<string, unknown> => JSON.parse(document.querySelector<HTMLElement>('[data-host]')!.dataset.host!) as Record<string, unknown>;

async function started(over: Parameters<typeof createWorkspace>[0] = {}, width = 1000): Promise<WorkspaceHandle> {
  win.width = width;
  seen.length = 0;
  const ws = track(createWorkspace({ templates: [probe()], ...over }));
  ws.addPanel('probe');
  await until('the probe', () => slots(document.body).includes('probe'));
  return ws;
}

// ---------------------------------------------------------------------------
// 1. Each option reaches the view the way useHost() read it before
// ---------------------------------------------------------------------------

test('device reaches the view, and the row is priced from its width', async () => {
  const ws = await started({ device: device(500, 640) });
  assert.deepEqual(hostOf().size, { width: 500, height: 640, modelId: 'custom' });
  assert.equal(seen.every((s) => (JSON.parse(s) as { size: { width: number } }).size.width === 500), true, 'the first render already had it');
  const slotWidth = (document.querySelector('[data-row-slot]:has([data-host])') as HTMLElement).style.width;
  assert.equal(slotWidth, '500px');
  assert.equal(ws.status === 'disposed', false);
});

test('settings reaches the view as the settings column', async () => {
  await started({ settings: settings(true) });
  assert.equal(hostOf().column, true);
});

test('history reaches the view', async () => {
  await started({ history: history(3) });
  assert.equal(hostOf().entries, 3);
});

test('snapshots reach the view', async () => {
  await started({ snapshots: snapshots() });
  assert.equal(hostOf().snapshots, true);
});

test('labels reach the view', async () => {
  await started({ labels: { untitledPanel: 'Nameless' } });
  assert.deepEqual(hostOf().labels, { untitledPanel: 'Nameless' });
});

test('with none of them a view reads the defaults a bare HostProvider gives', async () => {
  await started();
  assert.deepEqual(hostOf(), { size: { width: 390, height: 700, modelId: 'default' }, column: false, entries: null, snapshots: false, labels: null });
});

test('topInset is the clearance above the row, and an update moves it', async () => {
  win.height = 800;
  const ws = await started({ topInset: 200 });
  const padding = (): string => getComputedStyle(document.querySelector<HTMLElement>('[data-row-scroller]')!).paddingTop;
  assert.equal(padding(), '200px');
  await act(async () => ws.update({ topInset: 0 }));
  assert.equal(padding(), '0px');
});

test('panels.onPanelsClosed hears each close, and the callback an update gave is the one a later close calls', async () => {
  const first: string[] = [];
  const second: string[] = [];
  const ws = track(createWorkspace({ templates: [probe('a'), probe('b')], panels: { onPanelsClosed: (e) => void first.push(e.id) } }));
  win.width = 1000;
  ws.addPanel('a');
  ws.addPanel('b');
  await until('both panels', () => slots(document.body).length === 2);
  await act(async () => void ws.panels.get('a')!.close());
  assert.equal(first.length, 1);
  await act(async () => ws.update({ panels: { onPanelsClosed: (e) => void second.push(e.id) } }));
  await act(async () => void ws.panels.get('b')!.close());
  assert.equal(first.length, 1, 'the old callback is not called again');
  assert.equal(second.length, 1, 'the new one is');
});

test('panels.defaultView is what a create that names no view opens, and an update changes it for the next create', async () => {
  let host: ReturnType<typeof useHost> | undefined;
  const opener = definePanel({
    id: 'opener',
    view: ({ handle }) => {
      host = useHost();
      return React.createElement('i', { 'data-slot': handle.id });
    },
  });
  const a = definePanel({ id: 'a', settings: { hostCreatable: true, multiple: true }, view: ({ handle }) => React.createElement('i', { 'data-slot': handle.id, 'data-view': 'a' }) });
  const b = definePanel({ id: 'b', settings: { hostCreatable: true, multiple: true }, view: ({ handle }) => React.createElement('i', { 'data-slot': handle.id, 'data-view': 'b' }) });
  win.width = 1400;
  const ws = track(createWorkspace({ templates: [opener, a, b], panels: { defaultView: 'a' } }));
  ws.addPanel('opener');
  await until('the opener', () => host !== undefined);
  await act(async () => void host!.panels.create());
  await until('a panel of a', () => document.querySelectorAll('[data-view="a"]').length === 1);
  await act(async () => ws.update({ panels: { defaultView: 'b' } }));
  await act(async () => void host!.panels.create());
  await until('a panel of b', () => document.querySelectorAll('[data-view="b"]').length === 1);
  assert.equal(document.querySelectorAll('[data-view="a"]').length, 1);
});

test('the other panels members are accepted', async () => {
  const ws = await started({ panels: { onPanelsRestored: () => undefined, resetHostDataOnRestore: (d) => d, defaultHostData: () => ({ made: true }), onPanelResize: () => undefined, capture: { capture: () => undefined, evict: () => undefined } } });
  assert.ok(ws.panels.get('probe') !== undefined);
});

// ---------------------------------------------------------------------------
// 2. wrap
// ---------------------------------------------------------------------------

const Theme = React.createContext('none');

test('wrap renders inside the host and around the row, with the workspace, and keeps one identity', async () => {
  const log: string[] = [];
  let wrapMounts = 0;
  function Wrap({ children, workspace }: WorkspaceWrapProps): React.ReactElement {
    const h = useHost();
    React.useEffect(() => {
      wrapMounts += 1;
    }, []);
    log.push(`wrap ${h.device.size.width} ${workspace.rootId}`);
    return React.createElement('div', { 'data-wrap': '' }, React.createElement('b', { 'data-beside': '' }), React.createElement(Theme.Provider, { value: 'dark', children }));
  }
  function Themed(): React.ReactElement {
    return React.createElement('i', { 'data-slot': 'themed', 'data-theme': React.useContext(Theme) });
  }
  const themed = definePanel({ id: 'themed', view: Themed });
  win.width = 1000;
  const ws = track(createWorkspace({ templates: [themed], wrap: Wrap, device: device(450) }));
  ws.addPanel('themed');
  await until('the panel', () => slots(document.body).includes('themed'));
  assert.equal(document.querySelector('[data-theme]')!.getAttribute('data-theme'), 'dark', 'a context wrap provides reaches every panel');
  assert.ok(document.querySelector('[data-wrap] [data-row-scroller]'), 'the row is wrap\'s child');
  assert.ok(document.querySelector('[data-beside]'), 'a sibling of the children is drawn beside the row');
  assert.ok(log[0]!.startsWith('wrap 450 '), 'useHost() works inside wrap and reads the options');
  for (let i = 0; i < 3; i += 1) await act(async () => ws.update({ device: device(450 + i + 1) }));
  assert.equal(wrapMounts, 1, 'updates re-render wrap and never remount it');
});

// ---------------------------------------------------------------------------
// 3. update
// ---------------------------------------------------------------------------

test('a hook in wrap that calls update with new device, settings, history and snapshot values re-renders every reader with them', async () => {
  let push: ((live: WorkspaceLive) => void) | undefined;
  function Wrap({ children, workspace }: WorkspaceWrapProps): React.ReactElement {
    push = (live) => workspace.update(live);
    return React.createElement(React.Fragment, null, children);
  }
  const ws = await started({ wrap: Wrap, device: device(400), settings: settings(false), history: history(1) });
  assert.deepEqual(hostOf(), { size: { width: 400, height: 700, modelId: 'custom' }, column: false, entries: 1, snapshots: false, labels: null });
  await act(async () => push!({ device: device(520), settings: settings(true), history: history(4), snapshots: snapshots() }));
  assert.deepEqual(hostOf(), { size: { width: 520, height: 700, modelId: 'custom' }, column: true, entries: 4, snapshots: true, labels: null });
  assert.equal(ws.status === 'ready' || ws.status === 'loading', true);
});

test('an update changes nothing it did not name', async () => {
  const ws = await started({ device: device(400), settings: settings(true), history: history(2), labels: { untitledPanel: 'X' } });
  await act(async () => ws.update({ device: device(480) }));
  assert.deepEqual(hostOf(), { size: { width: 480, height: 700, modelId: 'custom' }, column: true, entries: 2, snapshots: false, labels: { untitledPanel: 'X' } });
  await act(async () => ws.update({ history: undefined }));
  assert.equal(hostOf().entries, null, 'a member named with undefined is taken away');
  assert.equal(hostOf().column, true);
});

test('update refuses root, templates, storage, mount and wrap with invalid-options and changes nothing', async () => {
  const ws = await started({ device: device(410) });
  const before = seen.length;
  for (const key of ['root', 'templates', 'storage', 'mount', 'wrap', 'tuning', 'nonsense']) {
    assert.throws(
      () => ws.update({ device: device(999), [key]: undefined } as WorkspaceLive),
      (e: unknown) => e instanceof PanelManagerError && e.code === 'invalid-options' && e.message.includes(key),
      key,
    );
  }
  await act(async () => undefined);
  assert.equal(hostOf().size && (hostOf().size as { width: number }).width, 410, 'the device named beside the refused key was not applied either');
  assert.equal(seen.length, before, 'and nothing re-rendered');
});

test('update after dispose throws disposed', async () => {
  const ws = await started();
  await act(async () => ws.dispose());
  assert.throws(() => ws.update({ topInset: 1 }), (e: unknown) => e instanceof PanelManagerError && e.code === 'disposed');
});

test('a hook that hands update fresh objects with fresh closures every render, from an effect, does not loop', async () => {
  let wraps = 0;
  function Wrap({ children, workspace }: WorkspaceWrapProps): React.ReactElement {
    wraps += 1;
    const fresh = { ...history(2, () => undefined), loadClosedPages: async () => [] };
    const dev: PhoneDeviceAPI = { size: { width: 430, height: 700, modelId: 'custom' }, chooseModel: async () => undefined };
    React.useEffect(() => {
      workspace.update({ device: dev, history: fresh, panels: { onPanelsClosed: () => undefined } });
    });
    return React.createElement(React.Fragment, null, children);
  }
  await started({ wrap: Wrap });
  const settled = wraps;
  await advanceFrames(400);
  assert.ok(settled <= 4, `wrap rendered ${settled} times before it settled`);
  assert.equal(wraps, settled, 'and no more after');
  assert.equal(hostOf().entries, 2);
});

test('an update from a layout effect in wrap lands in the task that rendered the row, before the browser can paint', async () => {
  const order: string[] = [];
  function Wrap({ children, workspace }: WorkspaceWrapProps): React.ReactElement {
    const first = React.useRef(true);
    if (first.current) {
      first.current = false;
      setTimeout(() => order.push('next task'), 0);
    }
    React.useLayoutEffect(() => {
      workspace.update({ device: device(470) });
    }, [workspace]);
    return React.createElement(React.Fragment, null, children);
  }
  const view = definePanel({
    id: 'probe',
    view: ({ handle }) => {
      const width = useHost().device.size.width;
      React.useLayoutEffect(() => {
        order.push(`layout ${width}`);
      });
      return React.createElement('i', { 'data-slot': handle.id });
    },
  });
  win.width = 1000;
  const ws = track(createWorkspace({ templates: [view], wrap: Wrap }));
  ws.addPanel('probe');
  await until('the update', () => order.includes('layout 470') && order.includes('next task'));
  assert.ok(order.indexOf('layout 470') < order.indexOf('next task'), `the view had the new size in the same task: ${order.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 4. An option and the same value in a hand-built Host
// ---------------------------------------------------------------------------

test('an option and the same value in a hand-built Host give the same view result', async () => {
  const values = { device: device(460, 650), settings: settings(true), history: history(2), snapshots: snapshots(), labels: { untitledPanel: 'Same' } };
  const ws = await started(values);
  const byOption = JSON.parse(seen[seen.length - 1]!);
  document.body.replaceChildren();
  await act(async () => ws.dispose());
  seen.length = 0;
  const hand = track(createWorkspace({ mount: false, templates: [probe()] }));
  hand.addPanel('probe');
  function HandWired(): React.ReactElement {
    const ref = React.useRef<HTMLDivElement>(null);
    const rowRef = React.useRef<HTMLDivElement>(null);
    const provided = useProvidePanels({ workspace: hand, phoneWidth: 460, containerWidth: 1000, overflowContainerRef: ref, labels: values.labels });
    const row = React.createElement(PanelRow, { entries: provided.entries, rootId: hand.rootId, closingIds: provided.closingIds, enteringViaAnchorIds: provided.enteringViaAnchorIds, exitRightIds: provided.exitRightIds, enterSideById: provided.enterSideById, maxLiveWidth: provided.maxLiveWidth, rowNumbers: provided.rowNumbers, workspace: hand });
    const shell = React.createElement(Workspace, { overflowContainerRef: ref, rowRef, containerWidth: 1000, phoneWidth: 460, fixedColumnCount: provided.fixedViewCount, liveWidths: provided.liveWidths, rowScroll: provided.rowScroll, rowNumbers: provided.rowNumbers, workspace: hand, children: row });
    return React.createElement(ThemeProvider, { theme: muiThemeFor(createDefaultTheme('light')), children: React.createElement(HostProvider, { host: { panels: provided, ...values }, children: shell }) });
  }
  mount(React.createElement(HandWired));
  await advanceFrames(400);
  const byHand = JSON.parse(seen[seen.length - 1]!);
  assert.deepEqual(byOption, byHand);
});

// ---------------------------------------------------------------------------
// 5. The row settles as the app's shell did
// ---------------------------------------------------------------------------

test('the mount does not pass rowResizeSettled: Workspace settles the row from tuning.resizeSettleSlides, as the app\'s own shell did', () => {
  const source = readFileSync(fileURLToPath(new URL('../autoMount.tsx', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /rowResizeSettled/);
  assert.match(readFileSync(fileURLToPath(new URL('../Workspace.tsx', import.meta.url)), 'utf8'), /resizeSettleDelayMs\(resolved\.slide, resolved\.resizeSettleSlides\)/);
});

// ---------------------------------------------------------------------------
// 6. The catalog's tuning leaves
// ---------------------------------------------------------------------------

test('the catalog holds 22 tuning leaves, and DESIGN.md says so', () => {
  const leaves = PANEL_SETTINGS_CATALOG.filter((d) => d.name.startsWith('tuning.'));
  assert.equal(leaves.length, 22);
  const design = readFileSync(fileURLToPath(new URL('../DESIGN.md', import.meta.url)), 'utf8');
  const start = design.indexOf('## Workspace options, wrap and update');
  assert.ok(start >= 0);
  assert.match(design.slice(start, design.indexOf('\n## ', start + 1)), /holds 22 tuning leaves/);
});
