/**
 * The two checks that tie a template to its panel API level: settings and header button members newer than the template's
 * level, and the shape of the header button items a view lists. Both log one console.error per template and never throw.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { createWorkspace, definePanel, usePanelHeaderButtons } from '../index.js';
import type { PanelTemplate } from '../index.js';
import type { LevelTable, NewestViewProps } from '../panelApiLevel.js';
import { HEADER_ITEM_SHAPE, SHIPPED_SINCE, itemProblems, levelTieProblems, reportItemShapeOnce, reportLevelTieOnce, type LevelSince } from '../panelLevelChecks.js';
import { PANEL_SETTINGS_CATALOG } from '../panelSettings.js';
import { PanelLevelContext } from '../panelLevelContext.js';
import { PanelViewContextValue } from '../panelViewContext.js';
import { templateViewFor } from '../templateView.js';
import { cleanup, mount, withHost } from './support/mount-harness.js';
import { flush, mountWorkspace } from './support/workspace-row.js';
import { levelOnePanel } from './fixtures/panel-api-1/panel.js';

afterEach(() => cleanup());

const View = (): null => null;
const onClick = (): void => undefined;

/** A two-level description in which `frame`, `tuning.rowGap` and the header button `tooltip` arrived with level 2. */
const FAKE_SINCE: LevelSince = {
  settings: { closable: 1, frame: 2, 'tuning.rowGap': 2, headerButtons: 1, deprecatedAlias: 1 },
  headerButton: { label: 1, onClick: 1, tooltip: 2 },
};

const NEWER_SETTINGS = { closable: true, frame: 'none', tuning: { rowGap: 12 }, headerButtons: { note: { label: 'Note', tooltip: 'Tip', onClick } } };

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

function inProduction<T>(run: () => T): T {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    return run();
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
}

// ---------------------------------------------------------------------------
// Members newer than the template's level
// ---------------------------------------------------------------------------

test('a template on level 1 is told which settings and header button members arrived with level 2', () => {
  assert.deepEqual(levelTieProblems(NEWER_SETTINGS, 1, FAKE_SINCE), [
    "setting 'frame' was added in level 2",
    "setting 'tuning.rowGap' was added in level 2",
    "header button member 'tooltip' was added in level 2",
  ]);
});

test('a template on level 2, a member of level 1, an alias and a name the table does not know all pass', () => {
  assert.deepEqual(levelTieProblems(NEWER_SETTINGS, 2, FAKE_SINCE), []);
  assert.deepEqual(levelTieProblems({ closable: true, deprecatedAlias: 1, unheardOf: 1, headerButtons: { a: false, b: { label: 'B', onClick } } }, 1, FAKE_SINCE), []);
  assert.deepEqual(levelTieProblems(undefined, 1, FAKE_SINCE), []);
  assert.deepEqual(levelTieProblems({ tuning: 3, headerButtons: [] }, 1, FAKE_SINCE), []);
});

test('the report is one console.error per template naming the template, the level and every member', () => {
  const { errors } = capturingError(() => {
    reportLevelTieOnce('tie-a', 1, NEWER_SETTINGS, FAKE_SINCE);
    reportLevelTieOnce('tie-a', 1, NEWER_SETTINGS, FAKE_SINCE);
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /'tie-a'/);
  assert.match(errors[0]!, /level 1/);
  for (const member of ['frame', 'tuning.rowGap', 'tooltip']) assert.ok(errors[0]!.includes(`'${member}'`), member);
  assert.equal(capturingError(() => reportLevelTieOnce('tie-b', 1, NEWER_SETTINGS, FAKE_SINCE)).errors.length, 1, 'a second template is told for itself');
});

test('an omitted level is the newest, so nothing is newer; production is silent', () => {
  assert.deepEqual(capturingError(() => reportLevelTieOnce('tie-c', undefined, { frame: 'none' }, { ...FAKE_SINCE, settings: { frame: 9 } })).errors, ['phonux: template \'tie-c\' is on panel API level 1 but uses members of a newer level: setting \'frame\' was added in level 9.']);
  assert.deepEqual(capturingError(() => inProduction(() => reportLevelTieOnce('tie-d', 1, NEWER_SETTINGS, FAKE_SINCE))).errors, []);
});

test('the check never throws, even for settings it cannot read', () => {
  const hostile = new Proxy({}, { ownKeys: () => { throw new Error('no'); } });
  assert.doesNotThrow(() => capturingError(() => reportLevelTieOnce('tie-e', 1, hostile, FAKE_SINCE)));
});

test('every shipped setting and header button member is named with the level that introduced it, and with one level nothing is newer', () => {
  const names = PANEL_SETTINGS_CATALOG.map((row) => row.name).sort();
  assert.deepEqual(Object.keys(SHIPPED_SINCE.settings).sort(), names);
  assert.deepEqual(Object.keys(SHIPPED_SINCE.headerButton).sort(), ['description', 'disabled', 'hidden', 'icon', 'label', 'onClick', 'order', 'pressed', 'side', 'sx', 'tooltip']);
  for (const level of [...Object.values(SHIPPED_SINCE.settings), ...Object.values(SHIPPED_SINCE.headerButton)]) assert.equal(level, 1);
  const everything = Object.fromEntries(names.filter((n) => !n.startsWith('tuning.')).map((n) => [n, true]));
  assert.deepEqual(levelTieProblems(everything, 1, SHIPPED_SINCE), []);
});

/** Makes `frame` newer than level 1 for the shipped description while `run` is going, to show a door reaches the check. */
function withFrameNewer<T>(run: () => T): T {
  const settings = SHIPPED_SINCE.settings as Record<string, number>;
  const before = settings.frame;
  settings.frame = 2;
  try {
    return run();
  } finally {
    settings.frame = before!;
  }
}

test('every door that takes a template reports a member newer than its level, and none of them throws', () => {
  const raw = (id: string, api?: 1): PanelTemplate => ({ id, ...(api === undefined ? {} : { api }), view: View, settings: { frame: 'none' } });
  const doors: [string, (id: string) => void][] = [
    ['definePanel', (id) => void definePanel(raw(id, 1))],
    ['createWorkspace templates', (id) => void createWorkspace({ mount: false, templates: [raw(id, 1)] })],
    ['createWorkspace root', (id) => void createWorkspace({ mount: false, root: raw(id, 1) })],
    ['workspace.registerTemplate', (id) => void createWorkspace({ mount: false }).registerTemplate(raw(id, 1))],
  ];
  doors.forEach(([name, door], index) => {
    const { errors } = capturingError(() => withFrameNewer(() => door(`door-${index}`)));
    assert.equal(errors.length, 1, name);
    assert.match(errors[0]!, new RegExp(`'door-${index}'.*'frame'`), name);
  });
});

test('the shipped description reports nothing for templates that use every kind of member today', () => {
  const { errors } = capturingError(() => {
    definePanel({ id: 'tie-today', view: View, api: 1, settings: { closable: true, frame: 'none', headerButtons: { a: { label: 'A', onClick, tooltip: 't', order: 1 } } } });
    createWorkspace({ mount: false, templates: [levelOnePanel] });
  });
  assert.deepEqual(errors, []);
});

// ---------------------------------------------------------------------------
// The level a view renders at
// ---------------------------------------------------------------------------

test('a view reads the level of its template from context', () => {
  const table: LevelTable = { newest: 2, levels: new Map([[1, { adapt: (p: NewestViewProps) => p, shape: { panel: {}, handle: {}, manager: {} } }], [2, {}]]) };
  const seen: (number | undefined)[] = [];
  for (const [id, api] of [['ctx-old', 1], ['ctx-new', undefined]] as const) {
    const Probe = (): null => {
      seen.push(React.useContext(PanelLevelContext));
      return null;
    };
    const Probed = templateViewFor({ id, ...(api === undefined ? {} : { api: api as never }), view: Probe } as PanelTemplate, table);
    const ctx = { handleFor: () => ({}) as never, manager: {} as never };
    mount(withHost(React.createElement(PanelViewContextValue.Provider, { value: ctx }, React.createElement(Probed, { panel: { id: 'p', live: true, locked: false } }))));
  }
  assert.deepEqual([...new Set(seen)], [1, 2]);
});

// ---------------------------------------------------------------------------
// The shape of the header button items
// ---------------------------------------------------------------------------

const item = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'a', label: 'A', side: 'end', order: 0, pressed: undefined, disabled: false, hidden: false, description: undefined, tooltip: undefined, sx: undefined, press: onClick, form: 'icon', icon: null, ...over,
});

test('a well-formed icon item and text item report nothing, whatever their optional members are', () => {
  assert.deepEqual(itemProblems([item(), item({ id: 'b', form: 'text', icon: undefined }), item({ id: 'c', pressed: true, description: 'd', tooltip: 't', sx: { color: 'red' }, icon: 'x' })]), []);
  assert.deepEqual(itemProblems([]), []);
});

test('a member that is missing, of the wrong kind, or in the wrong form is reported with the item named', () => {
  const broken = { ...item(), press: undefined, order: 'first' };
  assert.deepEqual(itemProblems([broken]), ["item 'a'.order should be a number, got a string", "item 'a'.press is missing"]);
  assert.deepEqual(itemProblems([item({ form: 'chip' })]), ["item 'a'.form should be 'icon' or 'text'"]);
  assert.deepEqual(itemProblems([item({ form: 'text', icon: 'x' })]), ["item 'a'.icon should be undefined in the text form"]);
  assert.deepEqual(itemProblems([null]), ['item 0 is not an object']);
});

test('the description names the same members for both forms and a member added to an item type must be described', () => {
  assert.deepEqual(Object.keys(HEADER_ITEM_SHAPE.icon).sort(), Object.keys(HEADER_ITEM_SHAPE.text).sort());
});

test('the item report is one console.error per template, skips an empty list, and is silent in production', () => {
  const bad = [{ ...item(), press: undefined }, { ...item({ id: 'b' }), label: 3 }];
  const { errors } = capturingError(() => {
    reportItemShapeOnce('items-a', 1, []);
    reportItemShapeOnce('items-a', 1, bad);
    reportItemShapeOnce('items-a', 1, bad);
  });
  assert.equal(errors.length, 1, 'the empty list did not use up the one report');
  assert.match(errors[0]!, /'items-a'/);
  assert.match(errors[0]!, /level 1/);
  assert.match(errors[0]!, /item 'a'\.press is missing/);
  assert.match(errors[0]!, /item 'b'\.label should be a string/);
  assert.deepEqual(capturingError(() => inProduction(() => reportItemShapeOnce('items-b', 1, bad))).errors, []);
});

test('real header button items in every state have the shape the description gives', async () => {
  const lists: unknown[][] = [];
  const Probe = (): null => {
    lists.push([...usePanelHeaderButtons()]);
    return null;
  };
  const buttons = definePanel({
    id: 'items-real',
    view: Probe,
    settings: {
      frame: 'none',
      headerButtons: {
        iconic: { icon: 'i', label: 'Icon', onClick },
        texty: { label: 'Text', onClick, side: 'start', order: 2, description: 'd', tooltip: 't' },
        pressed: { label: 'Pressed', onClick, pressed: () => true, sx: { color: 'red' } },
        off: { icon: null, label: 'Off', onClick, disabled: true },
        gone: { label: 'Gone', onClick, hidden: () => true },
      },
    },
  });
  const none = definePanel({ id: 'items-none', view: Probe, settings: { frame: 'none' } });
  const w = createWorkspace({ mount: false, templates: [buttons, none] });
  w.addPanel(buttons);
  w.addPanel(none);
  const { errors } = capturingError(() => mountWorkspace(w));
  await flush();
  const all = lists.flat();
  assert.ok(all.length >= 5, `positive control: the items were listed (${all.length})`);
  assert.ok(lists.some((l) => l.length === 0), 'positive control: a panel with no buttons lists none');
  assert.deepEqual(itemProblems(all), []);
  assert.deepEqual(errors, [], 'no item error from a real workspace');
  assert.deepEqual(capturingError(() => reportItemShapeOnce('items-real', 1, [{}])).errors, [], 'the hook already used the one report of this template');
});
