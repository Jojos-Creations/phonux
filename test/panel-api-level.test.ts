/**
 * Panel API levels: the `api` key on a template, the table that says which levels are served, the adapter that gives an
 * older level the props it promised, the warning for a level that is not the newest, and the frozen level-1 fixture panel.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { PANEL_API, PanelManagerError, createWorkspace, definePanel } from '../index.js';
import type { PanelTemplate } from '../index.js';
import { NEWEST_SHAPE, SHIPPED_LEVELS, checkPanelApi, levelCoverageProblem, shapeMismatches, type LevelEntry, type LevelTable, type NewestViewProps, type PropsShape } from '../panelApiLevel.js';
import { templateViewFor } from '../templateView.js';
import { PanelFooterContext } from '../panelFooter.js';
import { PanelViewContextValue } from '../panelViewContext.js';
import { cleanup, mount, withHost } from './support/mount-harness.js';
import { flush, markerTemplate, mountWorkspace } from './support/workspace-row.js';
import { readFileSync } from 'node:fs';
import { PANEL_SETTINGS_CATALOG } from '../panelSettings.js';
import { levelOneFramedPanel, levelOnePanel } from './fixtures/panel-api-1/panel.js';

afterEach(() => cleanup());

const View = (): null => null;

/** A shipped-shaped table with a second level as the newest, and a level-1 adapter that hands the view the old prop names. */
const TWO_LEVELS: LevelTable = {
  newest: 2,
  levels: new Map([
    [1, { adapt: ({ panel, handle, manager }: NewestViewProps) => ({ panel, handle, reader: manager }), shape: { panel: NEWEST_SHAPE.panel, handle: NEWEST_SHAPE.handle, reader: NEWEST_SHAPE.manager }, droppedIn: '3.0.0' }],
    [2, {}],
  ]),
};

function refusal(make: () => unknown): PanelManagerError {
  try {
    make();
  } catch (error) {
    assert.ok(error instanceof PanelManagerError, `expected a PanelManagerError, got ${String(error)}`);
    return error;
  }
  return assert.fail('the call accepted an api it should have refused');
}

// ---------------------------------------------------------------------------
// The key and its check
// ---------------------------------------------------------------------------

test('PANEL_API is the newest level and a template may leave api out or name it', () => {
  assert.equal(PANEL_API, 1);
  const bare = { id: 'bare', view: View };
  assert.equal(definePanel(bare), bare);
  const named = { id: 'named', api: 1 as const, view: View };
  assert.equal(definePanel(named), named);
});

test('definePanel refuses an api the library does not serve', () => {
  for (const api of [0, 2, 2.5, 99, -1, NaN, '1', null, true]) {
    const error = refusal(() => definePanel({ id: 'x', api, view: View } as unknown as PanelTemplate));
    assert.equal(error.code, 'invalid-template', `api ${String(api)}`);
    assert.match(error.message, /api must be one of 1/);
  }
});

test('every door that takes a template refuses an api the library does not serve', () => {
  const bad = { id: 'bad', api: 99, view: View } as unknown as PanelTemplate;
  assert.equal(refusal(() => createWorkspace({ mount: false, templates: [bad] })).code, 'invalid-template');
  assert.equal(refusal(() => createWorkspace({ mount: false, root: bad })).code, 'invalid-template');
  const w = createWorkspace({ mount: false });
  assert.equal(refusal(() => w.registerTemplate(bad)).code, 'invalid-template');
  w.registerTemplate({ id: 'bad', view: View });
});

test('the table decides: a level it serves is accepted, one it does not still throws', () => {
  checkPanelApi('x', undefined, TWO_LEVELS);
  checkPanelApi('x', 1, TWO_LEVELS);
  checkPanelApi('x', 2, TWO_LEVELS);
  assert.equal(refusal(() => checkPanelApi('x', 3, TWO_LEVELS)).code, 'invalid-template');
  assert.equal(refusal(() => checkPanelApi('x', 2)).code, 'invalid-template', 'the shipped table has no level 2');
});

test('every level from 1 to the newest is served or recorded as dropped, and nothing else', () => {
  assert.equal(levelCoverageProblem(SHIPPED_LEVELS), undefined);
  const gone = new Map([[2, '4.0.0']]);
  assert.equal(levelCoverageProblem({ newest: 3, levels: new Map([[1, {}], [3, {}]]), dropped: gone }), undefined, 'served plus dropped covers 1 to 3');
  assert.match(levelCoverageProblem({ newest: 2, levels: new Map([[1, {}], [2, {}], [3, {}]]) })!, /level 3 is outside 1 to 2/);
  assert.match(levelCoverageProblem({ newest: 3, levels: new Map([[1, {}], [3, {}]]) })!, /level 2 is neither served nor dropped/);
  assert.match(levelCoverageProblem({ newest: 3, levels: new Map([[1, {}], [2, {}], [3, {}]]), dropped: gone })!, /level 2 is both served and dropped/);
  assert.match(levelCoverageProblem({ newest: 2, levels: new Map([[1, {}]]), dropped: new Map([[2, '3.0.0']]) })!, /newest level 2 is not served/);
});

test('a dropped level answers with the release that dropped it, not the generic list', () => {
  const table: LevelTable = { newest: 3, levels: new Map([[1, {}], [3, {}]]), dropped: new Map([[2, '4.0.0']]) };
  const error = refusal(() => checkPanelApi('x', 2, table));
  assert.equal(error.code, 'invalid-template');
  assert.match(error.message, /level 2 was dropped in 4\.0\.0/);
  assert.doesNotMatch(error.message, /must be one of/);
  assert.match(refusal(() => checkPanelApi('x', 5, table)).message, /must be one of 1, 3/);
});

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

type Seen = { keys: string[]; footerKeys: string[]; panelId?: string };

/** Renders a template's adapted view and footer with a stub handle and manager, and reports the props each received. */
function renderAdapted(t: PanelTemplate, table: LevelTable, seen: Seen[]): void {
  const manager = { list: () => [], get: () => undefined, getSnapshot: () => ({ version: 0, status: 'ready', panels: [] }), subscribe: () => () => undefined };
  const handle = { id: 'p1', templateId: t.id };
  const footerKeys: string[] = [];
  const probe: PanelTemplate = {
    id: t.id,
    ...(t.api === undefined ? {} : { api: t.api }),
    view: ((props: Record<string, unknown>) => {
      seen.push({ keys: Object.keys(props).sort(), footerKeys: [], panelId: (props.panel as { id: string }).id });
      // The footer is drawn by the frame from this context; reading it here is how a test sees the footer's props.
      return React.useContext(PanelFooterContext);
    }) as unknown as PanelTemplate['view'],
    footer: ((props: Record<string, unknown>) => {
      footerKeys.push(...Object.keys(props).sort());
      return null;
    }) as unknown as PanelTemplate['footer'],
  };
  const Probed = templateViewFor(probe, table);
  const ctx = { handleFor: () => handle as never, manager: manager as never };
  mount(withHost(React.createElement(PanelViewContextValue.Provider, { value: ctx }, React.createElement(Probed, { panel: { id: 'p1', live: true, locked: false } }))));
  if (seen[0] !== undefined) seen[0].footerKeys = [...new Set(footerKeys)].sort();
}

test('an older level gets the props it promised, the newest gets today\'s', () => {
  const old: Seen[] = [];
  renderAdapted({ id: 'old-adapter', api: 1, view: View } as PanelTemplate, TWO_LEVELS, old);
  assert.deepEqual(old[0]?.keys, ['handle', 'panel', 'reader']);
  assert.equal(old[0]?.panelId, 'p1');
  assert.deepEqual(old[0]?.footerKeys, ['handle', 'panel', 'reader'], 'the footer gets the adapted props too');
  const current: Seen[] = [];
  renderAdapted({ id: 'new-adapter', view: View }, TWO_LEVELS, current);
  assert.deepEqual(current[0]?.keys, ['handle', 'manager', 'panel']);
  assert.deepEqual(current[0]?.footerKeys, ['handle', 'manager', 'panel']);
  const named: Seen[] = [];
  renderAdapted({ id: 'new-named', api: 2 as never, view: View }, TWO_LEVELS, named);
  assert.deepEqual(named[0]?.keys, ['handle', 'manager', 'panel']);
});

test('one adapter component per template object, so a rerender never remounts the panel', () => {
  const t: PanelTemplate = { id: 'cached', view: View };
  assert.equal(templateViewFor(t), templateViewFor(t));
  assert.notEqual(templateViewFor(t), templateViewFor(t, TWO_LEVELS), 'a different table is a different adapter');
});

test('registering an id again with another level uses the new template\'s adapter', () => {
  const first: PanelTemplate = { id: 'again', api: 1 as never, view: View };
  const second: PanelTemplate = { id: 'again', view: View };
  assert.notEqual(templateViewFor(first, TWO_LEVELS), templateViewFor(second, TWO_LEVELS));
});

// ---------------------------------------------------------------------------
// The warning
// ---------------------------------------------------------------------------

function capturingWarn<T>(run: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(' '));
  try {
    return { result: run(), warnings };
  } finally {
    console.warn = original;
  }
}

test('a template on an older level warns once, by template id, naming the level, the newest and the release that drops it', () => {
  const { warnings } = capturingWarn(() => {
    for (let i = 0; i < 3; i++) templateViewFor({ id: 'warned-a', api: 1 as never, view: View }, TWO_LEVELS);
    templateViewFor({ id: 'warned-a', api: 1 as never, view: View }, { ...TWO_LEVELS });
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /'warned-a'/);
  assert.match(warnings[0]!, /level 1/);
  assert.match(warnings[0]!, /newest is 2/);
  assert.match(warnings[0]!, /3\.0\.0/);
});

test('a level with no removal release warns without naming one', () => {
  const served: LevelTable = { newest: 2, levels: new Map([[1, {}], [2, {}]]) };
  const { warnings } = capturingWarn(() => templateViewFor({ id: 'warned-served', api: 1 as never, view: View }, served));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /'warned-served'/);
  assert.match(warnings[0]!, /level 1/);
  assert.match(warnings[0]!, /newest is 2/);
  assert.doesNotMatch(warnings[0]!, /undefined|later release|removed|deprecated|stops/);
});

test('a second template on the same older level warns for itself, and the newest level warns for nobody', () => {
  const { warnings } = capturingWarn(() => {
    templateViewFor({ id: 'warned-b', api: 1 as never, view: View }, TWO_LEVELS);
    templateViewFor({ id: 'warned-c', api: 1 as never, view: View }, TWO_LEVELS);
    templateViewFor({ id: 'warned-d', view: View }, TWO_LEVELS);
    templateViewFor({ id: 'warned-e', api: 2 as never, view: View }, TWO_LEVELS);
  });
  assert.equal(warnings.length, 2);
  assert.match(warnings[0]!, /'warned-b'/);
  assert.match(warnings[1]!, /'warned-c'/);
});

test('the shipped table has no older level, so a template never warns today', () => {
  const { warnings } = capturingWarn(() => {
    templateViewFor({ id: 'warned-f', api: 1, view: View });
    templateViewFor({ id: 'warned-g', view: View });
  });
  assert.deepEqual(warnings, []);
});

test('production is silent', () => {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const { warnings } = capturingWarn(() => templateViewFor({ id: 'warned-h', api: 1 as never, view: View }, TWO_LEVELS));
    assert.deepEqual(warnings, []);
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
});

// ---------------------------------------------------------------------------
// In a real workspace
// ---------------------------------------------------------------------------

test('a template with api: 1 and one with no api render side by side and receive the same props', () => {
  const named = markerTemplate('named', { api: 1 });
  const bare = markerTemplate('bare');
  const w = createWorkspace({ mount: false, templates: [named, bare] });
  w.addPanel(named);
  w.addPanel(bare);
  const m = mountWorkspace(w);
  const nodes = [...m.container.querySelectorAll<HTMLElement>('[data-template]')];
  assert.equal(nodes.length, 2, 'positive control: both views rendered');
  assert.equal(nodes[0]!.dataset.handleKeys, nodes[1]!.dataset.handleKeys);
  assert.equal(nodes[0]!.dataset.managerKeys, nodes[1]!.dataset.managerKeys);
});

test('the frozen level-1 fixture panel renders in a workspace with everything it was written against', () => {
  const w = createWorkspace({ mount: false, templates: [levelOnePanel] });
  w.addPanel(levelOnePanel);
  const m = mountWorkspace(w);
  const views = [...m.container.querySelectorAll<HTMLElement>('[data-fixture-view]')];
  assert.equal(views.length, 1, 'the fixture view rendered');
  const view = views[0]!;
  assert.match(view.dataset.fixtureHandle!, /^[^:]+:fixture-level-1:(pending|live)$/);
  assert.equal(view.dataset.fixtureView, view.dataset.fixtureHandle!.split(':')[0], 'panel.id is handle.id');
  assert.equal(view.dataset.fixtureManager, `${w.panels.getSnapshot().panels.map((p) => p.id).join(',')}|1`);
  assert.equal(view.dataset.fixturePinned, 'false');
  assert.equal(view.dataset.fixtureGap, 'number');
  assert.equal(view.dataset.fixtureCount, '0');
  assert.equal(view.dataset.fixtureHost, '1', 'useHost().panels.panelList');
  assert.equal(view.dataset.fixtureWsmanager, '1', 'useWorkspaceManager');
  assert.equal(view.dataset.fixtureWorkspace, 'true', 'useWorkspace().panels.get(handle.id)');
  assert.equal(view.dataset.fixtureStates, '1', 'usePanelStates');
  assert.equal(view.dataset.fixtureOwn, 'true', 'usePanelState(handle.id)');
  assert.equal(view.dataset.fixtureActive, 'true', 'useActivePanel');
  assert.equal(view.dataset.fixturePhone, 'number:number', 'usePhoneSize');
  act(() => void view.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  assert.equal(view.dataset.fixtureMoved, 'true', 'handle.move(-3) answers a PanelResult');
  const footers = [...m.container.querySelectorAll<HTMLElement>('[data-fixture-footer]')];
  assert.ok(footers.length >= 1, 'the fixture footer rendered');
  assert.equal(footers[0]!.textContent, '1');
  assert.ok(m.container.querySelector('[aria-label="Note"]'), 'the template\'s header button rendered');
});

test('the frozen level-1 framed fixture draws its own frame from the frame components', () => {
  const w = createWorkspace({ mount: false, templates: [levelOneFramedPanel] });
  w.addPanel(levelOneFramedPanel);
  const m = mountWorkspace(w);
  assert.ok(m.container.querySelector('[data-fixture-framed]'), 'the framed view rendered');
  assert.equal(m.container.querySelector<HTMLElement>('[data-fixture-grab]')?.dataset.fixtureGrab, 'function', 'DragToClose hands its children the handle');
  assert.ok(m.container.querySelector('[data-panel-size-box]'), 'PanelSizeBox drew its box');
  assert.equal(m.container.querySelectorAll('[data-fixture-footer]').length, 1, 'PanelFooter drew the template footer');
});

test('DESIGN lists every workspace-scope tuning row as not covered by a level', () => {
  const rows = PANEL_SETTINGS_CATALOG.filter((d) => d.scope === 'workspace').map((d) => d.name.replace(/^tuning\./, ''));
  assert.equal(rows.length, 14);
  const line = readFileSync(new URL('../DESIGN.md', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith('| `useHost().panels`'));
  assert.ok(line, 'the level table row naming the workspace-only options');
  const notCovered = line.split('|')[2]!;
  for (const name of rows) assert.ok(notCovered.includes(`\`${name}\``), `${name} is named in the not-covered column`);
});

// ---------------------------------------------------------------------------
// Levels added over time
// ---------------------------------------------------------------------------

/** The name `manager` had at each level below the newest; every adapter is written from the newest props. */
const MANAGER_NAMES = ['store', 'reader', 'source'] as const;
const withoutGetSettings = (handle: object): object => Object.fromEntries(Object.entries(handle).filter(([key]) => key !== 'getSettings'));
const HANDLE_BEFORE_SETTINGS: PropsShape[string] = Object.fromEntries(Object.entries(NEWEST_SHAPE.handle).filter(([key]) => key !== 'getSettings'));

/** A table of `newest` levels in which `manager` was `store`, then `reader`, then `source`, and level 1's handle predates `getSettings`. */
function chainTable(newest: 2 | 3 | 4): LevelTable {
  const levels = new Map<number, LevelEntry>();
  for (let level = 1; level < newest; level += 1) {
    const name = MANAGER_NAMES[level - 1]!;
    levels.set(level, {
      adapt: ({ panel, handle, manager }: NewestViewProps) => ({ panel, handle: level === 1 ? withoutGetSettings(handle) : handle, [name]: manager }),
      shape: { panel: NEWEST_SHAPE.panel, handle: level === 1 ? HANDLE_BEFORE_SETTINGS : NEWEST_SHAPE.handle, [name]: NEWEST_SHAPE.manager },
    });
  }
  levels.set(newest, {});
  return { newest, levels };
}

const FULL_HANDLE: Record<string, unknown> = Object.fromEntries(Object.keys(NEWEST_SHAPE.handle).map((key) => [key, key === 'id' || key === 'templateId' ? key : () => undefined]));
const FULL_MANAGER: Record<string, unknown> = Object.fromEntries(Object.keys(NEWEST_SHAPE.manager).map((key) => [key, () => undefined]));
const PANEL = { id: 'p1', live: true, locked: false };

/** The props a view and its footer receive from `table`, rendered with whole stub handle and manager. */
function received(id: string, api: number | undefined, table: LevelTable, handle: Record<string, unknown> = FULL_HANDLE): { view: Record<string, unknown>; footer: Record<string, unknown> } {
  const out = { view: {} as Record<string, unknown>, footer: {} as Record<string, unknown> };
  const probe: PanelTemplate = {
    id,
    ...(api === undefined ? {} : { api: api as never }),
    view: ((props: Record<string, unknown>) => {
      out.view = props;
      return React.useContext(PanelFooterContext);
    }) as unknown as PanelTemplate['view'],
    footer: ((props: Record<string, unknown>) => {
      out.footer = props;
      return null;
    }) as unknown as PanelTemplate['footer'],
  };
  const Probed = templateViewFor(probe, table);
  const ctx = { handleFor: () => handle as never, manager: FULL_MANAGER as never };
  mount(withHost(React.createElement(PanelViewContextValue.Provider, { value: ctx }, React.createElement(Probed, { panel: PANEL }))));
  return out;
}

test('a view on a level receives the same props however many levels the library adds after it', () => {
  let serial = 0;
  for (const level of [1, 2, 3] as const) {
    const base = received(`grown-${level}-${serial++}`, level, chainTable((level + 1) as 2 | 3 | 4));
    for (let newest = level + 2; newest <= 4; newest += 1) {
      const grown = received(`grown-${level}-${serial++}`, level, chainTable(newest as 3 | 4));
      assert.deepEqual(Object.keys(grown.view).sort(), Object.keys(base.view).sort(), `level ${level} keys under ${newest} levels`);
      for (const key of Object.keys(base.view)) {
        if (key === 'handle') assert.deepEqual(Object.keys(grown.view[key] as object), Object.keys(base.view[key] as object), `level ${level} handle members`);
        else assert.equal(grown.view[key], base.view[key], `level ${level} ${key} under ${newest} levels`);
      }
    }
  }
});

test('raising a template\'s api from 1 to 2 to 3 changes exactly what its view and footer receive', () => {
  const table = chainTable(3);
  const one = received('raised-1', 1, table);
  const two = received('raised-2', 2, table);
  const three = received('raised-3', 3, table);
  assert.deepEqual(Object.keys(one.view).sort(), ['handle', 'panel', 'store']);
  assert.deepEqual(Object.keys(two.view).sort(), ['handle', 'panel', 'reader']);
  assert.deepEqual(Object.keys(three.view).sort(), ['handle', 'manager', 'panel']);
  assert.equal(one.view.store, FULL_MANAGER);
  assert.equal(two.view.reader, FULL_MANAGER);
  assert.equal(three.view.manager, FULL_MANAGER);
  assert.ok(!('getSettings' in (one.view.handle as object)), 'level 1 predates getSettings');
  assert.ok('getSettings' in (two.view.handle as object) && 'getSettings' in (three.view.handle as object), 'the higher levels see it');
  assert.deepEqual(received('raised-omitted', undefined, table).view, three.view, 'an omitted api is the newest level');
  for (const props of [one, two, three]) assert.deepEqual(Object.keys(props.footer).sort(), Object.keys(props.view).sort(), 'the footer receives what the view does');
});

// ---------------------------------------------------------------------------
// The shape of a level's props
// ---------------------------------------------------------------------------

function capturingError<T>(run: () => T): { result: T; errors: string[] } {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.join(' '));
  try {
    return { result: run(), errors };
  } finally {
    console.error = original;
  }
}

/** Level 1 of a table whose adapter hands a view a handle with no `show`, a `getState` that is not a function and a missing manager. */
const BROKEN_ADAPTER: LevelTable = {
  newest: 2,
  levels: new Map([
    [1, { adapt: ({ panel, handle }: NewestViewProps) => ({ panel, handle: { ...handle, show: undefined, getState: 'nope' } }), shape: { panel: NEWEST_SHAPE.panel, handle: NEWEST_SHAPE.handle, store: NEWEST_SHAPE.manager } }],
    [2, {}],
  ]),
};

test('a level whose adapter hands back the wrong shape logs one error naming the template, the level and every member', () => {
  const { errors } = capturingError(() => {
    received('shape-broken', 1, BROKEN_ADAPTER);
    received('shape-broken', 1, BROKEN_ADAPTER);
  });
  assert.equal(errors.length, 1, 'once per template, with every mismatch in it');
  assert.match(errors[0]!, /'shape-broken'/);
  assert.match(errors[0]!, /level 1/);
  assert.match(errors[0]!, /handle\.show is missing/);
  assert.match(errors[0]!, /handle\.getState should be a function, got a string/);
  assert.match(errors[0]!, /store is missing/);
});

test('a correct level logs nothing, for any of its levels', () => {
  const { errors } = capturingError(() => {
    for (const level of [undefined, 1, 2, 3]) received(`shape-fine-${String(level)}`, level, chainTable(3));
  });
  assert.deepEqual(errors, []);
});

test('the shape check is silent in production, and a second template is checked for itself', () => {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.deepEqual(capturingError(() => received('shape-prod', 1, BROKEN_ADAPTER)).errors, []);
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
  assert.equal(capturingError(() => received('shape-second', 1, BROKEN_ADAPTER)).errors.length, 1);
});

test('the shape check never runs a getter or a method and never throws', () => {
  let ran = 0;
  const props = {
    panel: { get id() { ran += 1; return 'p'; }, live: true, locked: false },
    handle: new Proxy({}, { has: () => { ran += 1; return true; } }),
    manager: { get: () => { ran += 1; }, list: () => { ran += 1; }, getSnapshot: () => { ran += 1; }, subscribe: () => { ran += 1; } },
  };
  assert.doesNotThrow(() => shapeMismatches(props, NEWEST_SHAPE));
  assert.equal(ran, 0);
  assert.doesNotThrow(() => shapeMismatches({ panel: null, handle: 3 }, NEWEST_SHAPE));
});

test('optional members may be absent and a present one of the wrong kind is reported', () => {
  const base = { panel: { id: 'p', live: true, locked: false }, handle: FULL_HANDLE, manager: FULL_MANAGER };
  assert.deepEqual(shapeMismatches(base, NEWEST_SHAPE), []);
  assert.deepEqual(shapeMismatches({ ...base, panel: null }, NEWEST_SHAPE), ['panel is null']);
  assert.deepEqual(shapeMismatches({ ...base, handle: undefined }, NEWEST_SHAPE), ['handle is missing']);
  assert.deepEqual(shapeMismatches({ ...base, panel: { ...base.panel, url: 'u', title: 't', params: { a: 1 }, slots: 2, size: { width: 1 } } }, NEWEST_SHAPE), []);
  assert.deepEqual(shapeMismatches({ ...base, panel: { ...base.panel, slots: '2' } }, NEWEST_SHAPE), ['panel.slots should be a number, got a string']);
  assert.deepEqual(shapeMismatches({ ...base, panel: { ...base.panel, live: undefined } }, NEWEST_SHAPE), ['panel.live is missing']);
});

/** The members the frozen level-1 fixture reads, by prop and kind (test/fixtures/panel-api-1/types.ts). */
const FIXTURE_READS: [string, string, string][] = [
  ['panel', 'id', 'string'], ['panel', 'title', 'string'], ['panel', 'live', 'boolean'], ['panel', 'params', 'any'],
  ['handle', 'id', 'string'], ['handle', 'templateId', 'string'], ['handle', 'getState', 'function'], ['handle', 'subscribe', 'function'], ['handle', 'move', 'function'],
  ['manager', 'list', 'function'], ['manager', 'getSnapshot', 'function'],
];

test('the shipped level-1 shape lists every member the frozen fixture reads', () => {
  const shape: PropsShape = SHIPPED_LEVELS.levels.get(1)?.shape ?? NEWEST_SHAPE;
  for (const [prop, member, kind] of FIXTURE_READS) assert.equal(shape[prop]?.[member]?.kind, kind, `${prop}.${member}`);
});

test('real props in many panel states have the shape the table describes', async () => {
  const seen: string[][] = [];
  const probe = definePanel({
    id: 'real-shape',
    view: (props) => {
      seen.push(shapeMismatches(props, NEWEST_SHAPE));
      return null;
    },
    footer: (props) => {
      seen.push(shapeMismatches(props, NEWEST_SHAPE));
      return null;
    },
  });
  const w = createWorkspace({ mount: false, templates: [probe, levelOnePanel] });
  const bare = w.addPanel(probe);
  const titled = w.addPanel(probe, { params: { page: 2 }, url: 'https://example.test/a' });
  const parked = w.addPanel(probe);
  w.addPanel(levelOnePanel);
  const m = capturingError(() => mountWorkspace(w));
  await flush();
  titled.setSlots(2);
  parked.hide();
  bare.pin();
  await flush();
  parked.show();
  await flush();
  assert.ok(seen.length >= 2, `positive control: the view and footer rendered (${seen.length})`);
  assert.deepEqual(seen.filter((problems) => problems.length > 0), []);
  assert.deepEqual(m.errors, [], 'no shape error from a real workspace');
  assert.ok(m.result.container.querySelector('[data-fixture-view]'), 'the fixture rendered too');
});
