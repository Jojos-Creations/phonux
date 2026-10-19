/**
 * The nineteen per-panel settings this version removed: their fixed behaviour, what a template or a saved file that
 * still names one gets, and the list of settings that stay.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { LIBRARY_PANEL_DEFAULTS, PANEL_SETTINGS_CATALOG, createWorkspace, definePanel } from '../index.js';
import * as barrel from '../index.js';
import { FIXED, resolvePanelSettings } from '../panelSettings.js';
import { PanelManagerError } from '../panelManagerError.js';
import type { PanelSettings } from '../index.js';

/** The value each removed setting had as its default, written out so a changed constant fails here. */
const FROZEN = {
  hideWhenLast: 'allow',
  returnPriority: 0,
  evictionRank: 0,
  evictionOrder: 'farthest',
  scrollOnDrag: 'edge',
  viewState: 'keep',
  keepMounted: false,
  frame: 'auto',
  placeOnReturn: 'in-place',
  placeFallback: 'row-end',
  undoPlacement: 'old-slot',
  exitTo: 'auto',
  closeExit: 'down',
  animated: true,
  persist: 'saved',
  rememberLayout: true,
  undoWindowMs: 10000,
  reportClose: true,
  snapshot: 'both',
} as const;

const REMOVED = Object.keys(FROZEN);

/** The settings that stay: what the app sets, what a verb or a view patch reads, and the two template and clear-all readers. */
const KEPT = [
  'multiple', 'hostCreatable', 'hollowDot', 'pinningWhenNotLive', 'restoreVisibility', 'overflow', 'capacityReturn', 'revealOnScroll', 'headerButtons', 'title', 'listed', 'layer', 'resizable', 'closable', 'scrollOnMove',
  'parkable', 'pinning', 'slots', 'maxSlots', 'movable', 'crossable', 'hideStickiness', 'startVisibility', 'placeOnAdd', 'placeOnShow', 'scrollOnOpen', 'showWhenClosed', 'toggleWhenClosed', 'afterClose', 'enterFrom',
  'clearable', 'maxInstances',
];

function silenceConsole<T>(run: () => T): { result: T; errors: string[] } {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.map(String).join(' '));
  try {
    return { result: run(), errors };
  } finally {
    console.error = original;
  }
}

test('the fixed behaviour of every removed setting is its 0.1.0 default', () => {
  assert.deepEqual({ ...FIXED }, FROZEN);
  assert.equal(Object.isFrozen(FIXED), true);
});

test('the catalog and the library defaults hold the kept settings and none of the removed ones', () => {
  const names = PANEL_SETTINGS_CATALOG.map((d) => d.name).filter((n) => !n.startsWith('tuning.'));
  assert.deepEqual([...names].sort(), [...KEPT].sort());
  for (const key of REMOVED) {
    assert.equal((names as string[]).includes(key), false, `${key} is not in the catalog`);
    assert.equal(Object.hasOwn(LIBRARY_PANEL_DEFAULTS, key), false, `${key} is not a library default`);
  }
});

test('every kept setting still resolves at its default; title has none', () => {
  const base = resolvePanelSettings({});
  for (const key of KEPT.filter((k) => k !== 'title')) assert.ok(key in base.value, `${key} resolves`);
  assert.equal(resolvePanelSettings({ template: { title: 'T' } }).value.title, 'T');
  assert.equal(base.conflicts.length, 0);
});

test('a template that sets a kept setting still takes effect', () => {
  assert.equal(resolvePanelSettings({ template: { listed: false } }).value.listed, false);
});

test('a template that names a removed setting is ignored, told once per key in development, and does not throw', () => {
  const { result, errors } = silenceConsole(() => {
    const first = resolvePanelSettings({ template: { animated: false, undoWindowMs: 0, snapshot: 'never' } as unknown as PanelSettings });
    resolvePanelSettings({ template: { animated: false } as unknown as PanelSettings });
    return first;
  });
  for (const key of ['animated', 'undoWindowMs', 'snapshot']) {
    assert.equal(key in result.value, false, `${key} is not in the resolved settings`);
    assert.equal(errors.filter((e) => e.includes(`'${key}'`)).length, 1, `${key} is reported once`);
  }
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.notes, []);
});

test('a removed setting at the instance and host layers is ignored the same way and changes no kept value', () => {
  const plain = resolvePanelSettings({});
  const { result } = silenceConsole(() =>
    resolvePanelSettings({
      instance: { persist: 'session', keepMounted: true } as unknown as PanelSettings,
      host: { frame: 'none' } as unknown as PanelSettings,
    }),
  );
  assert.deepEqual(result.value, plain.value);
  assert.deepEqual(result.conflicts, []);
});

test('a saved instance layer holding a removed setting loads, drops it with a note, and keeps every other value', () => {
  const res = resolvePanelSettings({ instance: { reportClose: false, closable: false, title: 'Mine' } as unknown as PanelSettings }, { lenient: true });
  assert.equal(res.value.closable, false);
  assert.equal(res.value.title, 'Mine');
  assert.equal('reportClose' in res.value, false);
  assert.deepEqual(
    res.notes.filter((n) => n.code === 'invalid-saved-setting').map((n) => [n.key, n.message]),
    [['reportClose', 'instance.reportClose: a setting this version no longer has; dropped']],
  );
});

test('resolvePanelSettings, mergePatch, PanelSettingsLayers and ResolveOptions are not on the package barrel', () => {
  assert.equal('resolvePanelSettings' in barrel, false);
  assert.equal('mergePatch' in barrel, false);
});

test('tuning.shrinkOutOfView: Off is the only behaviour; visible and hidden warn once each, name the value as removed, and act as off', () => {
  const view = () => React.createElement('i');
  const templates = [definePanel({ id: 'a', view })];
  const { errors } = silenceConsole(() => {
    for (const value of ['off', 'visible', 'visible', 'hidden', 'hidden']) {
      const ws = createWorkspace({ templates, mount: false, tuning: { rowGesture: 'step', shrinkOutOfView: value } as never });
      assert.equal('shrinkOutOfView' in ws.tuning, false, `${value}: the resolved tuning has no such key`);
      assert.equal(ws.tuning.rowGesture, 'step', `${value}: the other leaves still apply`);
      ws.dispose();
    }
  });
  assert.equal(errors.length, 2, `one warning per removed value: ${errors.join(' | ')}`);
  for (const value of ['visible', 'hidden']) {
    assert.equal(errors.filter((e) => e.includes(`'${value}' was removed`) && e.includes('shrinkOutOfView')).length, 1, `${value} is named once`);
  }
});

test('tuning.shrinkOutOfView: configureTuning and a settings layer treat a removed value as off, change nothing, and still refuse a bad value', () => {
  const view = () => React.createElement('i');
  const ws = createWorkspace({ templates: [definePanel({ id: 'a', view })], mount: false });
  try {
    const { result } = silenceConsole(() => ws.panels.configureTuning({ shrinkOutOfView: 'hidden' } as never));
    assert.equal(result.ok, true);
    assert.equal((result as { changed?: boolean }).changed, false, 'a removed setting is not a change');
    assert.equal('shrinkOutOfView' in ws.tuning, false);
    for (const bad of ['on', 1, true]) {
      assert.throws(() => ws.panels.configureTuning({ shrinkOutOfView: bad } as never), (e: unknown) => e instanceof PanelManagerError && e.code === 'invalid-settings', `${String(bad)} throws`);
    }
  } finally {
    ws.dispose();
  }
  const plain = resolvePanelSettings({});
  const layered = resolvePanelSettings({ instance: { tuning: { shrinkOutOfView: 'off' } } as unknown as PanelSettings }, { lenient: true });
  assert.deepEqual(layered.value, plain.value);
  assert.deepEqual(layered.notes.map((n) => [n.code, n.key]), [['invalid-saved-setting', 'tuning']], 'a saved panel layer holding any tuning loads with one note');
});
