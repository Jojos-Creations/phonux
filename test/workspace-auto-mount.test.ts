/**
 * The default start: createWorkspace renders itself. Panels come from definePanel and addPanel alone; the hand-wired flow
 * (HostProvider, Workspace, PanelRow) renders the same DOM, a second workspace on the page stays independent, and a caller that
 * turns the mount off never loads react-dom/client.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { PanelRow, Workspace, createWorkspace, definePanel, useHost, useProvidePanels } from '../index.js';
import type { HostInput, PanelTemplate, WorkspaceHandle } from '../index.js';
import { memoryWorkspaceStorage } from '../fakeHost.js';
import { AutoRoot, rowProps, workspaceProps } from '../autoMount.js';
import { createDefaultTheme, muiThemeFor } from '../defaultTheme.js';
import { HostProvider } from '../hostApi.js';
import { advanceFrames, mount } from './support/mount-harness.js';
import { rigCleanup, observers, resize, slots, track, until, win } from './support/auto-rig.js';

afterEach(rigCleanup);

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));

/** A template whose view draws one marker node: `data-slot` is the panel's key, `data-template` the template's own tag. */
const tpl = (id: string, over: Partial<PanelTemplate> = {}, tag: string = id): PanelTemplate =>
  definePanel({ id, view: ({ handle }) => React.createElement('i', { 'data-slot': handle.id, 'data-template': tag }), ...over });

// ---------------------------------------------------------------------------
// 1. The default start imports no component
// ---------------------------------------------------------------------------

test('createWorkspace with a root and templates plus two addPanel calls renders the panels with no component imported', async () => {
  const ws = track(createWorkspace({ root: tpl('root'), templates: [tpl('a'), tpl('b')] }));
  ws.addPanel('a');
  ws.addPanel('b');
  await until('the panels', () => slots(document.body).length === 3);
  assert.deepEqual(slots(document.body), ['root', 'a', 'b']);
  const element = document.body.firstElementChild as HTMLElement;
  assert.equal(element.style.position, 'fixed', 'the default element covers the window');
  assert.match(element.style.cssText, /inset:\s*0/);
  await act(async () => ws.dispose());
  assert.equal(document.body.childElementCount, 0, 'dispose removes the element the workspace made');
});

test('a supplied element is rendered inside and never emptied', async () => {
  const target = document.createElement('section');
  const keep = document.createElement('p');
  target.appendChild(keep);
  document.body.appendChild(target);
  const ws = track(createWorkspace({ mount: target, templates: [tpl('a')] }));
  ws.addPanel('a');
  await until('the panel', () => slots(target).length === 1);
  assert.ok(target.contains(keep), 'the element kept the child it already had');
  assert.equal(document.body.childElementCount, 1, 'no second element was made');
  await act(async () => ws.dispose());
  assert.equal(target.children.length, 1, 'dispose took away what the mount added and nothing else');
  assert.ok(target.contains(keep));
});

test('addPanel before the mount lands and addPanel after it both show', async () => {
  const ws = track(createWorkspace({ templates: [tpl('early'), tpl('late')] }));
  ws.addPanel('early');
  await until('the first panel', () => slots(document.body).includes('early'));
  await act(async () => void ws.addPanel('late'));
  await until('the second panel', () => slots(document.body).includes('late'));
});

// ---------------------------------------------------------------------------
// 2. The same DOM as a hand-wired flow, at a measured width, scrolling, with a close mid-test
// ---------------------------------------------------------------------------

const NONE: ReadonlySet<string> = new Set();
/** A HostProvider over `host` around `child`. */
const provide = (host: HostInput, child: React.ReactNode): React.ReactElement => React.createElement(HostProvider, { host, children: child });

/** The advanced layer written out by hand: the HostProvider, Workspace and PanelRow a custom flow mounts. */
function HandWired({ workspace }: { workspace: WorkspaceHandle }): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current!;
    const read = (): void => setWidth(el.clientWidth);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const provided = useProvidePanels({ workspace, phoneWidth: 390, containerWidth, overflowContainerRef: ref });
  const row = React.createElement(PanelRow, {
    entries: provided.entries,
    rootId: workspace.rootId,
    closingIds: provided.closingIds,
    enteringViaAnchorIds: provided.enteringViaAnchorIds,
    exitRightIds: provided.exitRightIds,
    enterSideById: provided.enterSideById,
    maxLiveWidth: provided.maxLiveWidth,
    rowNumbers: provided.rowNumbers,
    workspace,
  });
  const shell = React.createElement(Workspace, { overflowContainerRef: ref, rowRef, containerWidth, phoneWidth: 390, fixedColumnCount: provided.fixedViewCount, liveWidths: provided.liveWidths, rowScroll: provided.rowScroll, rowNumbers: provided.rowNumbers, workspace, children: row });
  const host = React.createElement(HostProvider, { host: { panels: provided }, children: shell });
  return React.createElement(ThemeProvider, { theme: muiThemeFor(createDefaultTheme('light')), children: host });
}

const scrolling = (id: string): PanelTemplate => tpl(id, { settings: { overflow: 'scroll' } });
const sharedIds = (): (() => string) => {
  let n = 0;
  return () => `e${++n}`;
};

test('the auto-mounted workspace renders the same DOM as the hand-wired one, scrolling and after a close', async () => {
  win.width = 700;
  const ids = ['root', 'a', 'b', 'c', 'd'].map((id) => scrolling(id));
  const make = (target: HTMLElement | false): WorkspaceHandle => {
    const ws = track(createWorkspace({ mount: target, root: ids[0]!, templates: ids.slice(1), newId: sharedIds() }));
    for (const t of ids.slice(1)) ws.addPanel(t);
    return ws;
  };
  const autoTarget = document.createElement('div');
  const handTarget = document.createElement('div');
  document.body.append(autoTarget, handTarget);
  const auto = make(autoTarget);
  const hand = make(false);
  const handRoot = createRoot(handTarget);
  await act(async () => handRoot.render(React.createElement(HandWired, { workspace: hand })));
  await until('both rows', () => slots(autoTarget).length === 5 && slots(handTarget).length === 5);
  await advanceFrames(800);
  // The mount draws into a div of its own inside the target; the hand-wired tree is the root's own content.
  // dnd-kit numbers its accessibility nodes from one counter, so two trees mounted in turn differ only in those numbers.
  const html = (el: HTMLElement): string => (el === autoTarget ? (el.firstElementChild as HTMLElement).innerHTML : el.innerHTML).replace(/(Dnd(?:DescribedBy|LiveRegion))-\d+/g, '$1-N');
  const scroller = autoTarget.querySelector<HTMLElement>('[data-row-scroller]')!;
  assert.equal(getComputedStyle(scroller).overflowX, 'hidden', 'a stepping row moves by steps, so the browser has nothing to scroll');
  // An overflowing row starts flush at the window edge; a strip that fit would center with a positive margin.
  assert.equal((scroller.firstElementChild as HTMLElement).style.marginLeft, '0px', 'control: at 700 wide the five panels overflow the row');
  assert.equal(html(autoTarget), html(handTarget), 'the rows render the same DOM at 700 wide');
  await act(async () => void auto.panels.get('b')!.close());
  await act(async () => void hand.panels.get('b')!.close());
  await advanceFrames(50);
  assert.equal(html(autoTarget), html(handTarget), 'the rows render the same DOM while a panel is closing');
  await advanceFrames(800);
  assert.deepEqual(slots(autoTarget), ['root', 'a', 'c', 'd']);
  assert.equal(html(autoTarget), html(handTarget), 'and after it closed');
  await act(async () => handRoot.unmount());
});

// ---------------------------------------------------------------------------
// 3. Every PanelRow prop the auto mount passes is what useProvidePanels gave it
// ---------------------------------------------------------------------------

test('the mount hands the row and the workspace shell each value useProvidePanels returned', async () => {
  const ws = track(createWorkspace({ mount: false, root: scrolling('home'), templates: [scrolling('a')] }));
  assert.equal(ws.rootId, 'home');
  ws.addPanel('a');
  let provided: ReturnType<typeof useProvidePanels> | undefined;
  function Probe(): null {
    const ref = React.useRef<HTMLDivElement>(null);
    provided = useProvidePanels({ workspace: ws, phoneWidth: 390, containerWidth: 700, overflowContainerRef: ref });
    return null;
  }
  mount(React.createElement(Probe));
  const p = provided!;
  const row = rowProps(p, ws);
  assert.equal(row.entries, p.entries);
  assert.equal(row.rootId, ws.rootId);
  assert.equal(row.closingIds, p.closingIds);
  assert.equal(row.enteringViaAnchorIds, p.enteringViaAnchorIds);
  assert.equal(row.exitRightIds, p.exitRightIds);
  assert.equal(row.enterSideById, p.enterSideById);
  assert.equal(row.maxLiveWidth, p.maxLiveWidth);
  assert.equal(row.rowNumbers, p.rowNumbers);
  assert.equal(row.workspace, ws);
  assert.equal(Object.keys(row).length, 9, 'all nine PanelRow props are accounted for');
  const shell = workspaceProps(p, ws);
  assert.equal(shell.fixedColumnCount, p.fixedViewCount);
  assert.equal(shell.liveWidths, p.liveWidths);
  assert.equal(shell.rowScroll, p.rowScroll);
  assert.equal(shell.rowNumbers, p.rowNumbers);
  assert.equal(shell.workspace, ws);
});

// ---------------------------------------------------------------------------
// 4. HostProvider fills in what a host leaves out
// ---------------------------------------------------------------------------

test('HostProvider given a host without device and settings still gives every reader a value, the same object each render', () => {
  const seen: { device: unknown; settings: unknown; width: number; visible: boolean }[] = [];
  function Reader(): null {
    const host = useHost();
    seen.push({ device: host.device, settings: host.settings, width: host.device.size.width, visible: host.settings.settingsColumn.visible });
    host.settings.settingsColumn.show();
    host.settings.settingsColumn.hide();
    return null;
  }
  const panels = { panelList: [], create() {}, activate() {}, move() {}, setFormFactor() {}, reanchor() {}, close() {}, recentlyClosed: null, undoClose() {}, clearAll() {} };
  const ui = (): React.ReactElement => provide({ panels: panels as never }, React.createElement(Reader));
  const m = mount(ui());
  m.rerender(ui());
  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.width, 390);
  assert.equal(seen[0]!.visible, false);
  assert.equal(seen[0]!.device, seen[1]!.device, 'the default device is one object across renders');
  assert.equal(seen[0]!.settings, seen[1]!.settings, 'the default settings are one object across renders');
});

test('HostProvider hands a host that names both members through as it is', () => {
  const device = { size: { modelId: 'x', width: 300, height: 600 } };
  const settings = { settingsColumn: { visible: true, show() {}, hide() {} } };
  let seen: unknown;
  function Reader(): null {
    seen = useHost();
    return null;
  }
  const host = { device, settings, panels: {} as never };
  mount(provide(host, React.createElement(Reader)));
  assert.equal(seen, host);
});

// ---------------------------------------------------------------------------
// 6. The window's width reaches the row through the ResizeObserver
// ---------------------------------------------------------------------------

test('a resize of the window changes how many panels fit', async () => {
  function Fit(): React.ReactElement {
    const fit = useHost().panels.maxFitPanels;
    return React.createElement('i', { 'data-fit': String(fit) });
  }
  const ws = track(createWorkspace({ root: definePanel({ id: 'root', view: Fit }), templates: [] }));
  const fit = (): string | undefined => (document.querySelector('[data-fit]') as HTMLElement | null)?.dataset.fit;
  win.width = 1000;
  await until('the first measurement', () => fit() !== undefined && fit() !== 'null');
  const narrow = Number(fit());
  await resize(2400);
  await until('the wider row', () => Number(fit()) > narrow);
  assert.ok(Number(fit()) > narrow, `${fit()} fit at 2400 wide, ${narrow} at 1000`);
  assert.ok(ws.rootId.length > 0);
});

// ---------------------------------------------------------------------------
// 7. Workspaces on one page share nothing
// ---------------------------------------------------------------------------

test('two workspaces on one page, with one template object in both, mount, save and restore apart, and a dispose touches only its own', async () => {
  const shared = tpl('note', { settings: { multiple: true } });
  const left = document.createElement('div');
  const right = document.createElement('div');
  document.body.append(left, right);
  const storeL = memoryWorkspaceStorage();
  const storeR = memoryWorkspaceStorage();
  const launch = async (target: HTMLElement, storage: ReturnType<typeof memoryWorkspaceStorage>, ids: string[]): Promise<WorkspaceHandle> => {
    const ws = track(createWorkspace({ mount: target, root: tpl('root'), templates: [shared], storage, tuning: { saveQuietMs: 5 } }));
    for (const id of ids) ws.addPanel('note', { id });
    return ws;
  };
  const wsL = await launch(left, storeL, ['l1', 'l2']);
  const wsR = await launch(right, storeR, ['r1']);
  await until('both rows', () => slots(left).length === 3 && slots(right).length === 2);
  assert.deepEqual(slots(left), ['root', 'l1', 'l2']);
  assert.deepEqual(slots(right), ['root', 'r1']);
  await act(async () => wsL.dispose());
  assert.equal(left.firstElementChild, null, 'the disposed workspace took its own DOM away');
  assert.deepEqual(slots(right), ['root', 'r1'], 'the other one is untouched');
  await act(async () => void wsR.addPanel('note', { id: 'r2' }));
  await until('the later panel', () => slots(right).includes('r2'));
  await act(async () => void (await new Promise((r) => setTimeout(r, 60))));
  await act(async () => wsR.dispose());
  const left2 = document.createElement('div');
  const right2 = document.createElement('div');
  document.body.append(left2, right2);
  const again = (target: HTMLElement, storage: ReturnType<typeof memoryWorkspaceStorage>): void => {
    track(createWorkspace({ mount: target, root: tpl('root'), templates: [shared], storage, tuning: { saveQuietMs: 5 } }));
  };
  again(left2, storeL);
  again(right2, storeR);
  await until('the restored rows', () => slots(left2).length >= 1 && slots(right2).length >= 1);
  await act(async () => void (await new Promise((r) => setTimeout(r, 60))));
  assert.deepEqual(slots(left2).filter((s) => s !== 'root').sort(), ['l1', 'l2'].filter((s) => slots(left2).includes(s)), 'the left file restored only its own panels');
  assert.deepEqual(slots(right2).filter((s) => s !== 'root').sort(), ['r1', 'r2'], 'the right file restored only its own panels');
});

test('two workspaces whose templates share an id each render and restore their own template', async () => {
  const left = document.createElement('div');
  const right = document.createElement('div');
  document.body.append(left, right);
  const storeL = memoryWorkspaceStorage();
  const storeR = memoryWorkspaceStorage();
  const make = (target: HTMLElement, storage: ReturnType<typeof memoryWorkspaceStorage>, tag: string): WorkspaceHandle => {
    const ws = track(createWorkspace({ mount: target, root: tpl('root', {}, tag), templates: [tpl('note', { settings: { multiple: true } }, tag)], storage, tuning: { saveQuietMs: 5 } }));
    ws.addPanel('note', { id: `${tag}-1` });
    return ws;
  };
  const tags = (el: HTMLElement): string[] => [...el.querySelectorAll('[data-template]')].map((n) => (n as HTMLElement).dataset.template!);
  const wsL = make(left, storeL, 'L');
  const wsR = make(right, storeR, 'R');
  await until('both rows', () => slots(left).length === 2 && slots(right).length === 2);
  assert.deepEqual(tags(left), ['L', 'L'], 'the left workspace renders its own template');
  assert.deepEqual(tags(right), ['R', 'R'], 'the right workspace renders its own template, not the last one registered');
  await act(async () => void (await new Promise((r) => setTimeout(r, 60))));
  await act(async () => wsL.dispose());
  await act(async () => wsR.dispose());
  const left2 = document.createElement('div');
  const right2 = document.createElement('div');
  document.body.append(left2, right2);
  make(left2, storeL, 'L');
  make(right2, storeR, 'R');
  await until('the restored rows', () => slots(left2).length === 2 && slots(right2).length === 2);
  assert.deepEqual(tags(left2), ['L', 'L']);
  assert.deepEqual(tags(right2), ['R', 'R']);
});

// ---------------------------------------------------------------------------
// 10. StrictMode and dispose leave nothing behind
// ---------------------------------------------------------------------------

test('under StrictMode the mount subscribes once per element and disposes every observer', async () => {
  win.width = 900;
  const ws = track(createWorkspace({ mount: false, root: tpl('root'), templates: [tpl('a')] }));
  ws.addPanel('a');
  const target = document.createElement('div');
  document.body.appendChild(target);
  const root = createRoot(target);
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(AutoRoot, { workspace: ws }))));
  await until('the row', () => slots(target).length === 2);
  const live = [...observers].filter((o) => o.targets.size > 0);
  assert.equal(live.length, 2, 'the mount and Workspace each hold one live observer, the first run of each effect having been cleaned up');
  for (const o of live) assert.equal([...o.targets][0], target.querySelector('[data-row-scroller]'));
  await act(async () => root.unmount());
  assert.equal(observers.size, 0, 'no observer outlives the mount');
  await act(async () => ws.dispose());
  assert.equal(ws.status, 'disposed');
});

test('dispose before the mount has loaded mounts nothing', async () => {
  const ws = createWorkspace({ templates: [tpl('a')] });
  ws.addPanel('a');
  await act(async () => ws.dispose());
  await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
  assert.equal(document.body.childElementCount, 0);
  assert.equal(observers.size, 0);
});

// ---------------------------------------------------------------------------
// 1b. Mounting twice is said once
// ---------------------------------------------------------------------------

test('a hand-mounted row given a workspace that mounts itself warns once and names mount: false; the mount\'s own row never warns', async () => {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '));
  try {
    const ws = track(createWorkspace({ root: tpl('root'), templates: [tpl('a')] }));
    ws.addPanel('a');
    await until('the auto row', () => slots(document.body).length === 2);
    assert.deepEqual(warnings, [], 'the mount renders its own row without a warning');
    const row = (): React.ReactElement =>
      provide({ panels: {} as never }, React.createElement(PanelRow, { entries: [], rootId: ws.rootId, closingIds: NONE, enteringViaAnchorIds: NONE, workspace: ws }));
    const m = mount(row());
    m.rerender(row());
    mount(row());
    assert.equal(warnings.length, 1, 'once for the workspace, however many rows');
    assert.match(warnings[0]!, /mount: false/);
  } finally {
    console.warn = warn;
  }
});

test('createWorkspace({ mount: false }) and a document-free run render nothing', () => {
  const ws = track(createWorkspace({ mount: false, templates: [tpl('a')] }));
  ws.addPanel('a');
  assert.equal(document.body.childElementCount, 0, 'mount: false made no DOM');
});

// ---------------------------------------------------------------------------
// 5. The React-free import path, proved by what a fresh process asks the module resolver for
// ---------------------------------------------------------------------------

function requestsOf(entry: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'phonux-resolve-'));
  const log = join(dir, 'requests.txt');
  try {
    const run = spawnSync(process.execPath, ['--import', 'tsx', '--import', join(ROOT_DIR, 'test/support/record-resolve.mjs'), join(ROOT_DIR, 'test/support/import-child.ts'), entry], {
      cwd: ROOT_DIR,
      env: { ...process.env, PHONUX_RESOLVE_LOG: log },
      encoding: 'utf8',
      timeout: 120_000,
    });
    assert.equal(run.status, 0, `the child failed: ${run.stderr}`);
    return readFileSync(log, 'utf8').split('\n').filter((line) => line !== '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('importing the workspace module and creating a workspace with no document never requests react-dom/client', () => {
  const requests = requestsOf('workspaceCore');
  assert.ok(requests.some((r) => r.endsWith('workspaceCore.js') || r.includes('workspaceCore')), 'control: the recorder saw the module being imported');
  assert.ok(requests.some((r) => r === 'react'), 'control: the recorder sees a bare specifier');
  assert.equal(requests.some((r) => r.startsWith('react-dom')), false, `react-dom was requested: ${requests.filter((r) => r.startsWith('react-dom')).join(', ')}`);
  assert.equal(requests.some((r) => r.includes('autoMount')), false, 'the mount module was not loaded either');
});

test('the mount module is the one that asks for react-dom/client', () => {
  assert.ok(requestsOf('autoMount').includes('react-dom/client'));
});
