/**
 * Panel API levels: the `api` key on a template, the table that says which levels are served, the adapter that gives an
 * older level the props it promised, the warning for a level that is not the newest, and the frozen level-1 fixture panel.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { PANEL_API, PanelManagerError, createWorkspace, definePanel } from '../index.js';
import type { PanelTemplate } from '../index.js';
import { checkPanelApi, type LevelTable, type NewestViewProps } from '../panelApiLevel.js';
import { templateViewFor } from '../templateView.js';
import { PanelFooterContext } from '../panelFooter.js';
import { PanelViewContextValue } from '../panelViewContext.js';
import { cleanup, mount, withHost } from './support/mount-harness.js';
import { markerTemplate, mountWorkspace } from './support/workspace-row.js';
import { levelOnePanel } from './fixtures/panel-api-1/panel.js';

afterEach(() => cleanup());

const View = (): null => null;

/** A shipped-shaped table with a second level as the newest, and a level-1 adapter that hands the view the old prop names. */
const TWO_LEVELS: LevelTable = {
  newest: 2,
  levels: new Map([
    [1, { adapt: ({ panel, handle, manager }: NewestViewProps) => ({ panel, handle, reader: manager }), droppedIn: '3.0.0' }],
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
  assert.equal(view.dataset.fixtureManager, `${w.panels.getSnapshot().panels.map((p) => p.id).join(',')}|1`);
  assert.equal(view.dataset.fixturePinned, 'false');
  assert.equal(view.dataset.fixtureGap, 'number');
  assert.equal(view.dataset.fixtureCount, '0');
  const footers = [...m.container.querySelectorAll<HTMLElement>('[data-fixture-footer]')];
  assert.ok(footers.length >= 1, 'the fixture footer rendered');
  assert.equal(footers[0]!.textContent, '1');
  assert.ok(m.container.querySelector('[aria-label="Note"]'), 'the template\'s header button rendered');
});
