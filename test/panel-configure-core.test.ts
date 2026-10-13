/**
 * configure(id), configureTemplate and configureTuning through the manager: the result object, the refusals, the
 * class laws, the writer's exact delta, the raw API in the same turn, conflicts and scope, and the turn rules.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act, createElement, useEffect, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import type { ConfigureResult, HeaderButton, PanelHandle, PanelResult, PanelSettings, PanelSummary, Pinning } from '../index.js';
import { applyConfigure } from '../panelConfigure.js';
import { panelKey, resolvePanelSettings } from '../panelSettings.js';
import type { PanelWindow } from '../panelWindow.js';
import { bindingOf } from '../workspaceCore.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { fire, TRIGGERS } from './support/ops-rig.js';
import { headerRig, type HeaderRig } from './support/header-rig.js';
import { pinRig, type PinRig } from './support/pin-rig.js';
import { markerTemplate } from './support/workspace-row.js';

/** A rig with a `multiple` template named m beside the panel a. */
const multiRig = (settings: PanelSettings): Promise<PinRig> => pinRig({ ids: ['a'], extra: [markerTemplate('m', { settings: { multiple: true, ...settings } })] });

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  cleanup();
});

type Done = Extract<ConfigureResult, { ok: true }>;
type Refused = Extract<ConfigureResult, { ok: false }>;

const done = (r: ConfigureResult): Done => {
  assert.equal(r.ok, true, r.ok ? '' : `${r.code}: ${r.message}`);
  return r as Done;
};
const refusedWith = (r: ConfigureResult, code: string): Refused => {
  assert.equal(r.ok, false, 'expected a refusal');
  assert.equal((r as Refused).code, code, (r as Refused).message);
  return r as Refused;
};

/** The entries of the row, by name, as the engine holds them now. */
const entriesOf = (r: PinRig): Map<string, PanelWindow> => new Map(r.m.latest().entries.filter((p) => p.marker !== true).map((p) => [panelKey(p), p]));

/** Every field of every entry reference-equal before and after, except those named for `except` on the entry `target`. */
function sameEntries(before: Map<string, PanelWindow>, after: Map<string, PanelWindow>, target?: string, except: readonly string[] = []): void {
  assert.deepEqual([...after.keys()], [...before.keys()], 'the same entries in the same order');
  for (const [name, was] of before) {
    const now = after.get(name)!;
    if (name !== target) {
      assert.equal(now === was, true, `entry ${name} is the same object`);
      continue;
    }
    for (const field of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (except.includes(field)) continue;
      assert.equal((now as unknown as Record<string, unknown>)[field] === (was as unknown as Record<string, unknown>)[field], true, `${name}.${field} is the same value`);
    }
  }
}

/** Runs `fn` in one turn and returns what the render counter, the snapshot version and the entries did. */
function watch<T>(r: PinRig, fn: () => T): { out: T; renders: number; version: number; before: Map<string, PanelWindow>; after: Map<string, PanelWindow> } {
  const before = entriesOf(r);
  const renders = r.m.renders();
  const version = r.ws.panels.getSnapshot().version;
  const out = r.turn(fn);
  return { out, renders: r.m.renders() - renders, version: r.ws.panels.getSnapshot().version - version, before, after: entriesOf(r) };
}

// ---------------------------------------------------------------------------
// The result object and the patched key's source
// ---------------------------------------------------------------------------

test('a success carries exactly ok, changed, shown, now, later, shadowed and notes', async () => {
  const r = await pinRig();
  const res = done(r.turn(() => r.h.b!.configure({ closable: false })));
  assert.deepEqual(Object.keys(res).sort(), ['changed', 'notes', 'now', 'later', 'ok', 'shadowed', 'shown'].sort());
  assert.deepEqual({ ...res }, { ok: true, changed: true, shown: false, now: ['closable'], later: [], shadowed: [], notes: [] });
});

test('a refusal carries ok false, code and message, and the setting at fault for a conflict and for a scope', async () => {
  const r = await pinRig();
  const conflict = refusedWith(r.turn(() => r.h.b!.configure({ closable: false, clearable: true })), 'settings-conflict');
  assert.deepEqual(Object.keys(conflict).sort(), ['code', 'message', 'ok', 'setting']);
  assert.equal(conflict.setting, 'clearable');
  const scope = refusedWith(r.turn(() => r.ws.panels.configure('b', { maxInstances: 2 } as never)), 'wrong-scope');
  assert.equal(scope.setting, 'maxInstances');
  const unknown = refusedWith(r.turn(() => r.ws.panels.configure('nope', { title: 'x' })), 'unknown-panel');
  assert.equal('setting' in unknown, false);
});

test('a patched key reads source instance in getSettings and the value is the patched one', async () => {
  const r = await pinRig();
  r.turn(() => r.h.b!.configure({ scrollOnOpen: 'center', closable: false }));
  const s = r.h.b!.getSettings();
  assert.equal(s.source.scrollOnOpen, 'instance');
  assert.equal(s.source.closable, 'instance');
  assert.equal(s.value.scrollOnOpen, 'center');
  assert.equal(r.h.a!.getSettings().source.scrollOnOpen, 'library', 'the other panel is untouched');
});

// ---------------------------------------------------------------------------
// Class laws
// ---------------------------------------------------------------------------

const REFUSALS: readonly [string, string, (r: PinRig) => ConfigureResult][] = [
  ['settings-conflict', 'a forced-rule conflict', (r) => r.h.b!.configure({ closable: false, clearable: true })],
  ['wrong-scope', 'a template key at the panel call', (r) => r.ws.panels.configure('b', { multiple: false } as never)],
  ['unknown-panel', 'a panel that does not exist', (r) => r.ws.panels.configure('zzz', { title: 'x' })],
  ['tier-not-allowed', 'formFactors that exclude the tier', (r) => r.ws.panels.configure('b', { formFactors: ['tablet'] })],
];

for (const [code, what, call] of REFUSALS) {
  test(`class law: a refusal (${what}) leaves the entries reference-equal, commits nothing and keeps the snapshot version`, async () => {
    const r = await pinRig();
    const seen = watch(r, () => call(r));
    refusedWith(seen.out, code);
    sameEntries(seen.before, seen.after);
    assert.equal(seen.renders, 0, 'no commit followed');
    assert.equal(seen.version, 0, 'the snapshot version did not move');
  });
}

test('class law: a NEXT key changes only that panel\'s stored settings and moves, parks and shows nothing', async () => {
  const r = await pinRig();
  const seen = watch(r, () => r.h.b!.configure({ scrollOnOpen: 'center' }));
  const res = done(seen.out);
  assert.deepEqual([res.now, res.later], [[], ['scrollOnOpen']]);
  sameEntries(seen.before, seen.after, 'b', ['settings', 'instance']);
  assert.equal(seen.after.get('b')!.settings!.scrollOnOpen, 'center');
  assert.deepEqual(r.order(), ['root', 'a', 'b', 'c']);
  assert.deepEqual(r.live(), ['root', 'a', 'b', 'c']);
});

test('class law: a NOW key changes only the fields it names', async () => {
  const r = await pinRig();
  const seen = watch(r, () => r.h.b!.configure({ closable: false }));
  done(seen.out);
  sameEntries(seen.before, seen.after, 'b', ['settings', 'instance', 'locked']);
  assert.equal(seen.after.get('b')!.locked, true);
  assert.equal(seen.before.get('b')!.locked, false);
});

test('class law: an equal patch is changed false and commits nothing', async () => {
  const r = await pinRig();
  r.turn(() => r.h.b!.configure({ scrollOnOpen: 'center' }));
  const seen = watch(r, () => [r.h.b!.configure({ scrollOnOpen: 'center' }), r.h.b!.configure({}), r.h.b!.configure({ hideStickiness: null })]);
  for (const res of seen.out) assert.deepEqual({ ...done(res) }, { ok: true, changed: false, shown: false, now: [], later: [], shadowed: [], notes: [] });
  sameEntries(seen.before, seen.after);
  assert.equal(seen.renders, 0);
  assert.equal(seen.version, 0);
});

test('class law: a two-key patch whose second key is refused applies neither', async () => {
  const r = await pinRig();
  const seen = watch(r, () => r.h.b!.configure({ scrollOnOpen: 'center', multiple: false } as never));
  refusedWith(seen.out, 'wrong-scope');
  sameEntries(seen.before, seen.after);
  assert.equal(r.h.b!.getSettings().value.scrollOnOpen, 'into-view');
  const conflict = watch(r, () => r.h.b!.configure({ scrollOnOpen: 'center', closable: false, clearable: true }));
  refusedWith(conflict.out, 'settings-conflict');
  sameEntries(conflict.before, conflict.after);
  assert.equal(r.h.b!.getSettings().value.scrollOnOpen, 'into-view');
});

test('class law: an entry changed between the call and the commit makes the update return prev', async () => {
  const r = await pinRig();
  const entries = r.m.latest().entries as PanelWindow[];
  const target = entries.find((p) => panelKey(p) === 'b')!;
  const next = { ...target, locked: true };
  assert.equal(applyConfigure(entries, target, next).find((p) => p.id === target.id), next, 'control: the entry the plan read is replaced');
  const replaced = entries.map((p) => (p === target ? { ...p } : p));
  assert.equal(applyConfigure(replaced, target, next), replaced, 'the row no longer holds that entry, so prev is returned');
  assert.equal(applyConfigure(entries.filter((p) => p !== target), target, next).length, entries.length - 1);
});

test('class law: a clearAll queued after the call removes the panel and the configure does not bring it back', async () => {
  const r = await pinRig();
  r.turn(() => {
    done(r.h.b!.configure({ closable: true, scrollOnOpen: 'center' }));
    r.provided().clearAll();
  });
  assert.deepEqual(r.order(), ['root']);
});

// ---------------------------------------------------------------------------
// The writer: applyTemplate(reconfigure), three keys per class, on a resized panel and on a dragged one
// ---------------------------------------------------------------------------

const UNTOUCHED = ['formFactor', 'size', 'anchor', 'live', 'hostData', 'key', 'overrides', 'applied'] as const;

const WRITER_KEYS: readonly [string, string, PanelSettings][] = [
  ['NOW', 'closable', { closable: false }],
  ['NOW', 'draggable', { draggable: false }],
  ['NOW', 'title', { title: 'Renamed' }],
  ['NEXT', 'scrollOnOpen', { scrollOnOpen: 'center' }],
  ['NEXT', 'hideStickiness', { hideStickiness: 'until-room' }],
  ['NEXT', 'undoWindowMs', { undoWindowMs: 9000 }],
  ['STATE', 'keepMounted', { keepMounted: true }],
  ['STATE', 'viewState', { viewState: 'reset-on-park' }],
  ['STATE', 'formFactors', { formFactors: ['phone', 'tablet'] }],
];

for (const kind of ['a person-resized tablet panel', 'a dragged panel'] as const) {
  for (const [cls, key, patch] of WRITER_KEYS) {
    test(`writer: ${cls} key ${key} on ${kind} leaves the tier, size, anchor, live, hostData, key, overrides and applied as they were`, async () => {
      const r = await pinRig();
      if (kind === 'a dragged panel') r.turn(() => r.h.c!.move('left', 'person'));
      else r.turn(() => r.h.c!.setFormFactor('tablet', 'person'));
      const before = r.entry('c');
      assert.ok(before.overrides !== undefined && Object.keys(before.overrides).length > 0, 'control: the person left an override');
      const res = done(r.turn(() => r.h.c!.configure(patch)));
      assert.equal(res.changed, true);
      const after = r.entry('c');
      for (const field of UNTOUCHED) assert.equal(after[field] === before[field], true, `${field} is the same value`);
      assert.notEqual(after.settings, before.settings);
      assert.equal(r.h.c!.getState().settings[key as 'closable'] !== undefined, true);
    });
  }
}

test('writer: a parkable flip to false on a hidden panel is refused under the default place-only, and under show it makes the panel live and a fixed column and writes nothing else of the tier', async () => {
  const refused = await pinRig();
  refused.turn(() => refused.h.c!.hide());
  assert.equal(refused.entry('c').live, false, 'control: the panel is parked');
  const kept = refused.m.latest().entries;
  refusedWith(refused.turn(() => refused.h.c!.configure({ parkable: false })), 'would-reshape-row');
  assert.equal(refused.m.latest().entries, kept, 'a refusal writes no entry');
  cleanup();
  const r = await pinRig({ settings: { c: { pinningWhenNotLive: 'show' } } });
  r.turn(() => r.h.c!.hide());
  assert.equal(r.entry('c').live, false, 'control: the panel is parked');
  const before = r.entry('c');
  done(r.turn(() => r.h.c!.configure({ parkable: false })));
  const after = r.entry('c');
  assert.equal(after.collapsible, false);
  assert.equal(after.live, true, 'a fixed column is never parked');
  for (const field of ['formFactor', 'size', 'anchor', 'hostData', 'key', 'overrides', 'applied'] as const) assert.equal(after[field] === before[field], true, `${field} is the same value`);
});

// ---------------------------------------------------------------------------
// The raw API in the same turn
// ---------------------------------------------------------------------------

test('raw setFormFactor then configure of formFactors is busy', async () => {
  const r = await pinRig();
  const out = r.turn(() => {
    r.provided().setFormFactor(r.entry('b').id, 'tablet');
    return r.h.b!.configure({ formFactors: ['phone'] });
  });
  refusedWith(out, 'busy');
});

test('configure then a raw setFormFactor: the raw call is a no-op and the tier stays', async () => {
  const r = await pinRig();
  r.turn(() => {
    done(r.h.b!.configure({ formFactors: ['phone', 'tablet'] }));
    r.provided().setFormFactor(r.entry('b').id, 'tablet');
  });
  assert.equal(r.entry('b').formFactor, 'phone');
});

test('raw close then configure of closable is busy', async () => {
  const r = await pinRig();
  const out = r.turn(() => {
    r.provided().close(r.entry('b').id);
    return r.h.b!.configure({ closable: false });
  });
  refusedWith(out, 'busy');
});

test('configure of closable then a raw close: nothing closes', async () => {
  const r = await pinRig();
  r.turn(() => {
    done(r.h.b!.configure({ closable: false }));
    r.provided().close(r.entry('b').id);
  });
  assert.deepEqual(r.order(), ['root', 'a', 'b', 'c']);
  assert.equal(r.entry('b').locked, true);
});

test('raw clearAll then configure of a removed id is busy', async () => {
  const r = await pinRig();
  const out = r.turn(() => {
    r.provided().clearAll();
    return r.h.b!.configure({ scrollOnOpen: 'center' });
  });
  refusedWith(out, 'busy');
  assert.deepEqual(r.order(), ['root']);
});

test('configure and manager calls on different panels combine in one turn', async () => {
  const r = await pinRig();
  const out = r.turn(() => [r.h.a!.configure({ scrollOnOpen: 'center' }), r.h.b!.configure({ closable: false }), r.h.c!.move('left')]);
  assert.deepEqual(out.map((o) => o.ok), [true, true, true]);
  assert.equal(r.h.a!.getSettings().value.scrollOnOpen, 'center');
  assert.equal(r.entry('b').locked, true);
  assert.deepEqual(r.order(), ['root', 'a', 'c', 'b']);
});

test('a configure after a close in the same turn is busy: a close is exclusive', async () => {
  const r = await pinRig();
  const out = r.turn(() => [r.h.a!.close(), r.h.b!.configure({ closable: false })]);
  assert.equal(out[0]!.ok, true);
  refusedWith(out[1] as ConfigureResult, 'busy');
});

test('a close after a configure in the same turn is busy too', async () => {
  const r = await pinRig();
  const out = r.turn(() => [r.h.b!.configure({ scrollOnOpen: 'center' }), r.h.a!.close()]);
  assert.equal(out[0]!.ok, true);
  assert.equal((out[1] as { ok: boolean; code?: string }).code, 'busy');
});

// ---------------------------------------------------------------------------
// Conflicts and scope
// ---------------------------------------------------------------------------

test('a forced-rule conflict on a named key refuses: closable false beside clearable true names clearable and rule C2 by closable', async () => {
  const r = await pinRig({ settings: { b: { clearable: true } } });
  const res = refusedWith(r.turn(() => r.h.b!.configure({ closable: false })), 'settings-conflict');
  assert.equal(res.setting, 'clearable');
  assert.match(res.message, /C2/);
  assert.match(res.message, /closable/);
});

test('a forced-rule conflict on an unnamed key refuses: reset-on-park beside keepMounted true names keepMounted, rule C6 by viewState', async () => {
  const r = await pinRig({ settings: { b: { keepMounted: true } } });
  const res = refusedWith(r.turn(() => r.h.b!.configure({ viewState: 'reset-on-park' })), 'settings-conflict');
  assert.equal(res.setting, 'keepMounted');
  assert.match(res.message, /C6/);
  assert.match(res.message, /viewState/);
});

test('a conflict that already existed before the call does not refuse', async () => {
  const r = await pinRig({ settings: { b: { closable: false, clearable: true } } });
  assert.equal(r.h.b!.getSettings().conflicts.length, 1, 'control: the stack already conflicts');
  done(r.turn(() => r.h.b!.configure({ scrollOnOpen: 'center' })));
  assert.equal(r.h.b!.getSettings().value.scrollOnOpen, 'center');
});

test('formFactors narrowed below the current tier is tier-not-allowed and widened is ok', async () => {
  const r = await pinRig();
  r.turn(() => r.h.b!.setFormFactor('tablet', 'person'));
  refusedWith(r.turn(() => r.h.b!.configure({ formFactors: ['phone'] })), 'tier-not-allowed');
  assert.deepEqual([...r.h.b!.getSettings().value.formFactors], ['phone', 'tablet', 'desktop']);
  done(r.turn(() => r.h.b!.configure({ formFactors: ['phone', 'tablet'] })));
  assert.deepEqual([...r.h.b!.getSettings().value.formFactors], ['phone', 'tablet']);
  done(r.turn(() => r.h.b!.configure({ formFactors: ['phone', 'tablet', 'desktop'] })));
});

test('a parkable flip to false needs the phone tier', async () => {
  const r = await pinRig();
  r.turn(() => r.h.b!.setFormFactor('tablet', 'person'));
  refusedWith(r.turn(() => r.h.b!.configure({ parkable: false })), 'tier-not-allowed');
  assert.equal(r.entry('b').collapsible, true);
});

test('multiple true to false with 2 instances is instance-limit and closes nothing, and a closed one still counts', async () => {
  const r = await multiRig({});
  r.turn(() => void [r.ws.addPanel('m', { id: 'm1' }), r.ws.addPanel('m', { id: 'm2' })]);
  await r.settle();
  const live = () => r.ws.panels.getSnapshot().panels.filter((p) => p.templateId === 'm' && p.status === 'live').length;
  assert.equal(live(), 2, 'control: two instances');
  const res = refusedWith(r.turn(() => r.ws.panels.configureTemplate('m', { multiple: false })), 'instance-limit');
  assert.equal(res.setting, 'multiple');
  assert.equal(live(), 2, 'nothing was closed');
  r.turn(() => r.ws.panels.get('m1')!.close());
  await r.settle();
  assert.match(refusedWith(r.turn(() => r.ws.panels.configureTemplate('m', { multiple: false })), 'instance-limit').message, /2 instances exist/);
});

test('maxInstances 5 to 1 with 3 live is instance-limit, and 1 to 5 is ok', async () => {
  const r = await multiRig({ maxInstances: 5 });
  r.turn(() => void [r.ws.addPanel('m', { id: 'm1' }), r.ws.addPanel('m', { id: 'm2' }), r.ws.addPanel('m', { id: 'm3' })]);
  await r.settle();
  const res = refusedWith(r.turn(() => r.ws.panels.configureTemplate('m', { maxInstances: 1 })), 'instance-limit');
  assert.equal(res.setting, 'maxInstances');
  assert.equal(r.ws.panels.getSnapshot().panels.filter((p) => p.templateId === 'm' && p.status === 'live').length, 3);
  done(r.turn(() => r.ws.panels.configureTemplate('m', { maxInstances: 8 })));
  done(r.turn(() => r.ws.panels.configureTemplate('m', { maxInstances: 3 })));
});

test('configureTemplate applies to future creations: a raised limit allows the next addPanel, a lowered one refuses it', async () => {
  const r = await multiRig({ maxInstances: 2 });
  r.turn(() => void [r.ws.addPanel('m', { id: 'm1' }), r.ws.addPanel('m', { id: 'm2' })]);
  await r.settle();
  assert.equal(r.ws.addPanel('m', { id: 'm3' }).getState().status, 'closed', 'control: at the limit of 2');
  r.turn(() => r.ws.panels.configureTemplate('m', { maxInstances: 4 }));
  const more = r.turn(() => r.ws.addPanel('m', { id: 'm4' }));
  await r.settle();
  assert.equal(more.getState().status, 'live');
  assert.equal(r.ws.panels.get('m1')!.getState().settings.maxInstances, 4, 'an existing panel reads the template change');
  refusedWith(r.turn(() => r.ws.panels.configureTemplate('m', { maxInstances: null })), 'instance-limit');
  assert.equal(r.ws.panels.get('m1')!.getState().settings.maxInstances, 4, 'null would restore the template\'s own 2, below the 3 that exist');
});

test('configureTuning applies to the workspace tuning, to every panel\'s resolved tuning and back with null', async () => {
  const r = await pinRig();
  done(r.turn(() => r.ws.panels.configureTuning({ slide: { durationSec: 0.2 }, hopFraction: 0.25 })));
  assert.equal(r.ws.tuning.slide.durationSec, 0.2);
  assert.equal(r.ws.tuning.hopFraction, 0.25);
  for (const id of ['a', 'b', 'c']) {
    const tuning = r.ws.panels.get(id)!.getSettings().value.tuning;
    assert.equal(tuning.slide.durationSec, 0.2, `panel ${id}`);
    assert.equal(tuning.hopFraction, 0.25, `panel ${id}`);
  }
  r.turn(() => r.h.b!.configure({ tuning: { slide: { durationSec: 0.9 } } }));
  assert.equal(r.h.b!.getSettings().value.tuning.slide.durationSec, 0.9, 'a panel\'s own leaf beats the workspace\'s');
  done(r.turn(() => r.ws.panels.configureTuning({ slide: null, hopFraction: null })));
  assert.equal(r.ws.tuning.slide.durationSec, 0.4);
  assert.equal(r.h.a!.getSettings().value.tuning.hopFraction, 0.5);
});

// ---------------------------------------------------------------------------
// Closed records: inside the undo window, past it, and an anonymous instance
// ---------------------------------------------------------------------------

/** The summaries of the panels the undo window holds, as the provider hands them out; they carry the engine id, not the name. */
const windowed = (r: PinRig): readonly PanelSummary[] => r.provided().recentlyClosed ?? [];

/** The result a configure of a closed panel answers: stored for the next open or undo, so nothing acts now. */
const stored = (...later: string[]) => ({ ok: true, changed: true, shown: false, now: [], later, shadowed: [], notes: [] });

test('closed inside the window: closable false then undoClose gives locked true, and close() is refused not-closable', async () => {
  const r = await pinRig();
  const id = r.entry('b').id;
  r.turn(() => r.h.b!.close());
  const held = windowed(r);
  assert.deepEqual([r.state('b').status, held.map((p) => p.id), held[0]!.locked], ['closed', [id], false]);
  assert.deepEqual({ ...done(r.turn(() => r.h.b!.configure({ closable: false }))) }, stored('closable'));
  assert.equal(windowed(r)[0] === held[0], true, 'the window still holds the very object it held');
  assert.equal(held[0]!.locked, false, 'and it was not edited');
  r.turn(() => r.provided().undoClose());
  await r.settle();
  assert.deepEqual([r.order().join(' '), r.entry('b').locked, r.state('b').settings.closable], ['root a b c', true, false]);
  assert.deepEqual({ ...r.turn(() => r.h.b!.close()) }, { ok: false, code: 'not-closable', message: "panel 'b' cannot be closed" });
  assert.equal(r.state('b').status, 'live');
});

test('closed inside the window: a title configured then undo restores the new title', async () => {
  const r = await pinRig({ settings: { b: { title: 'Bee' } } });
  assert.equal(r.state('b').title, 'Bee');
  r.turn(() => r.h.b!.close());
  assert.deepEqual({ ...done(r.turn(() => r.h.b!.configure({ title: 'Renamed' }))) }, stored('title'));
  assert.deepEqual([windowed(r)[0]!.title, r.state('b').status], ['Bee', 'closed']);
  r.turn(() => r.provided().undoClose());
  await r.settle();
  assert.deepEqual([r.entry('b').title, r.state('b').title, r.order().join(' ')], ['Renamed', 'Renamed', 'root a b c']);
});

test('closed inside the window: an undoPlacement configured then undo places by it, and without it the panel returns to its old slot', async () => {
  const control = await pinRig();
  control.turn(() => control.h.a!.close());
  control.turn(() => control.provided().undoClose());
  await control.settle();
  assert.equal(control.order().join(' '), 'root a b c', 'control: old-slot restores the recorded index');
  cleanup();
  const r = await pinRig();
  r.turn(() => r.h.a!.close());
  assert.deepEqual({ ...done(r.turn(() => r.h.a!.configure({ undoPlacement: 'row-end' }))) }, stored('undoPlacement'));
  r.turn(() => r.provided().undoClose());
  await r.settle();
  assert.equal(r.order().join(' '), 'root b c a');
});

test('closed inside the window: resetLayout then undo restores at the resolved placeOnAdd and the resolved tier, not where the person left it', async () => {
  const r = await pinRig();
  assert.deepEqual({ ...done(r.turn(() => r.h.c!.configure({ placeOnAdd: 'row-start', formFactor: 'tablet' }))) }, { ok: true, changed: true, shown: false, now: [], later: ['placeOnAdd', 'formFactor'], shadowed: [], notes: [] });
  r.turn(() => r.h.c!.setFormFactor('phone', 'person'));
  r.turn(() => r.h.c!.move('left', 'person'));
  assert.deepEqual([r.order().join(' '), r.entry('c').formFactor], ['root a c b', 'phone']);
  r.turn(() => r.h.c!.close());
  assert.deepEqual({ ...r.turn(() => r.ws.panels.resetLayout('c')) }, { ok: true, changed: true, panels: ['c'] });
  r.turn(() => r.provided().undoClose());
  await r.settle();
  assert.deepEqual([r.order().join(' '), r.entry('c').formFactor, r.entry('c').overrides], ['c root a b', 'tablet', {}]);
});

test('closed past the window: the edit is stored on the record and open() uses it', async () => {
  const r = await pinRig();
  mock.timers.enable({ apis: ['setTimeout'] });
  r.turn(() => r.h.b!.close());
  assert.equal(windowed(r).length, 1, 'control: the window is open');
  act(() => mock.timers.tick(10001));
  assert.deepEqual([windowed(r).length, r.state('b').status], [0, 'closed']);
  const res = done(r.turn(() => r.h.b!.configure({ closable: false, placeOnAdd: 'row-start', title: 'Late' })));
  assert.deepEqual({ ...res }, stored('closable', 'placeOnAdd', 'title'));
  assert.deepEqual({ ...r.turn(() => r.h.b!.open()) }, { ok: true, changed: true });
  await r.settle();
  assert.deepEqual([r.order().join(' '), r.entry('b').locked, r.entry('b').title], ['b root a c', true, 'Late']);
  assert.equal((r.turn(() => r.h.b!.close()) as { code?: string }).code, 'not-closable');
});

test('the undo window\'s panel objects are the same before and after every configure of a closed panel, accepted, equal or refused', async () => {
  const r = await pinRig();
  const ids = [r.entry('a').id, r.entry('c').id];
  r.turn(() => r.h.a!.close());
  r.turn(() => r.h.c!.close());
  const held = windowed(r);
  const snapshot = JSON.stringify(held);
  assert.deepEqual(held.map((p) => p.id), ids);
  const calls: [string, () => ConfigureResult][] = [
    ['a NOW key', () => r.h.a!.configure({ closable: false })],
    ['a NEXT key', () => r.h.a!.configure({ scrollOnOpen: 'center' })],
    ['an equal patch', () => r.h.a!.configure({ scrollOnOpen: 'center' })],
    ['a conflict', () => r.h.c!.configure({ closable: false, clearable: true })],
    ['a wrong scope', () => r.ws.panels.configure('c', { maxInstances: 2 } as never)],
    ['a null removal', () => r.h.a!.configure({ scrollOnOpen: null })],
  ];
  for (const [name, call] of calls) {
    r.turn(() => call());
    const now = windowed(r);
    assert.equal(now.length, held.length, name);
    for (const [k, p] of now.entries()) assert.equal(p === held[k], true, `${name}: window entry ${k} is the same object`);
    assert.equal(JSON.stringify(now), snapshot, `${name}: and holds the same fields`);
  }
});

test('an anonymous closed instance answers is-closed to configure, inside the window and past it', async () => {
  const r = await multiRig({});
  const refusal = (id: string) => ({ ok: false, code: 'is-closed', message: `panel '${id}' is closed and nothing can name it again` });
  const inside = r.turn(() => r.ws.addPanel('m'));
  await r.settle();
  assert.equal(inside.getState().status, 'live', 'control: the instance is live');
  r.turn(() => inside.close());
  assert.equal(windowed(r).length, 1, 'inside the window');
  assert.deepEqual({ ...r.turn(() => inside.configure({ title: 'x' })) }, refusal(inside.id));
  const past = r.turn(() => r.ws.addPanel('m'));
  await r.settle();
  mock.timers.enable({ apis: ['setTimeout'] });
  r.turn(() => past.close());
  act(() => mock.timers.tick(10001));
  assert.equal(windowed(r).length, 0, 'past the window');
  assert.equal(past.getState().status, 'closed');
  assert.deepEqual({ ...r.turn(() => past.configure({ title: 'y' })) }, refusal(past.id));
  assert.deepEqual({ ...r.turn(() => r.ws.panels.configure(past.id, { title: 'y' })) }, refusal(past.id));
});

// ---------------------------------------------------------------------------
// Notes, a change planted before the commit, and the rest of the writer
// ---------------------------------------------------------------------------

test('a configure that raises a runtime note carries it in the result and reports it once', async () => {
  const r = await pinRig();
  const lever = done(r.turn(() => r.h.b!.configure({ evictionRank: 3 })));
  assert.deepEqual([...lever.notes], [{ code: 'park-lever-inert', key: 'evictionRank', message: "evictionRank: only a panel whose overflow is 'park' is ever parked for room, so this has no effect here" }]);
  assert.deepEqual(r.m.notes.map((n) => n.code), ['park-lever-inert']);
  const unlists = done(r.turn(() => r.h.c!.configure({ pinning: { pinned: { parkable: false }, unpinned: { parkable: true } } })));
  assert.deepEqual([...unlists.notes], [{ code: 'pin-unlists', key: 'pinning', message: 'pinning: the pinned half makes the panel a fixed column, which is unlisted unless listed is set' }]);
  assert.deepEqual(r.m.notes.map((n) => n.code), ['park-lever-inert', 'pin-unlists']);
  const again = done(r.turn(() => r.h.b!.configure({ evictionRank: 3 })));
  assert.deepEqual([again.changed, [...again.notes]], [false, []]);
  assert.equal(r.m.notes.length, 2, 'an equal patch raises nothing more');
});

test('a state change planted between the call and the commit makes the updater return prev: a panel removed in between is not brought back', async () => {
  let plant: (() => void) | undefined;
  const r = await pinRig({ over: { onNote: () => plant?.() } });
  plant = () => r.provided().clearAll();
  const res = r.turn(() => r.h.b!.configure({ pinning: { pinned: { parkable: false }, unpinned: { parkable: true } } }));
  assert.deepEqual([res.ok, (res as Done).notes.length], [true, 1], 'control: the note ran the planted hook');
  assert.deepEqual(r.order(), ['root']);
});

for (const kind of ['declared', 'anonymous'] as const) {
  test(`a state change planted between the call and the commit on ${kind === 'declared' ? 'a declared' : 'an anonymous'} panel: the patch applies to the entry the other update left, and the resolver and the entry agree`, async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    let plant: (() => void) | undefined;
    const r = await pinRig({
      ids,
      width: 1000,
      settings: Object.fromEntries(ids.map((id) => [id, { overflow: 'park' } as PanelSettings])),
      extra: [markerTemplate('m', { settings: { multiple: true, overflow: 'park' } })],
      over: { onNote: () => plant?.() },
    });
    const anon = kind === 'anonymous' ? r.turn(() => r.ws.addPanel('m')) : undefined;
    await r.settle();
    const id = anon === undefined ? 'e' : anon.id;
    const handle = anon ?? r.h.e!;
    assert.equal(r.entry(id).live, true, 'control: it is the live park panel');
    plant = () => void r.h.a!.show();
    const before = r.entry(id);
    const res = r.turn(() => handle.configure({ closable: false, pinning: { pinned: { parkable: false }, unpinned: { parkable: true } } }));
    assert.deepEqual({ ok: (res as Done).ok, now: [...(res as Done).now] }, { ok: true, now: ['closable', 'pinning'] });
    const after = r.entry(id);
    assert.equal(after.live, false, 'control: the planted show of a parked neighbour parked it before the configure could commit');
    assert.deepEqual([after.settings === before.settings, after.locked, after.settings!.closable, after.settings!.pinning.pinned.parkable], [false, true, false, false], 'the entry carries the configure');
    assert.deepEqual([handle.getSettings().value.closable, handle.getSettings().source.closable], [false, 'instance'], 'and the resolver reads the same');
    assert.equal((r.turn(() => handle.close()) as { code?: string }).code, 'not-closable', 'and the restriction holds: close() is refused');
  });
}

test('writer: formFactor is a NEXT key, so the entry keeps its tier and size and the settings read the new one', async () => {
  const r = await pinRig();
  const before = r.entry('b');
  assert.deepEqual([before.formFactor, before.size?.formFactor], ['phone', 'phone']);
  const res = done(r.turn(() => r.h.b!.configure({ formFactor: 'tablet' })));
  assert.deepEqual([res.now, res.later], [[], ['formFactor']]);
  const after = r.entry('b');
  for (const field of UNTOUCHED) assert.equal(after[field] === before[field], true, `${field} is the same value`);
  assert.deepEqual([after.formFactor, r.state('b').formFactor, r.h.b!.getSettings().value.formFactor, r.h.b!.getSettings().source.formFactor], ['phone', 'phone', 'tablet', 'instance']);
});

test('maxInstances 1 to 5 with one instance is ok, and 5 to 1 with one is ok too', async () => {
  const r = await multiRig({ maxInstances: 1 });
  r.turn(() => r.ws.addPanel('m', { id: 'm1' }));
  await r.settle();
  assert.deepEqual({ ...done(r.turn(() => r.ws.panels.configureTemplate('m', { maxInstances: 5 }))) }, { ok: true, changed: true, shown: false, now: [], later: ['maxInstances'], shadowed: [], notes: [] });
  r.turn(() => void [r.ws.addPanel('m', { id: 'm2' }), r.ws.addPanel('m', { id: 'm3' })]);
  await r.settle();
  assert.equal(r.ws.panels.getSnapshot().panels.filter((p) => p.templateId === 'm' && p.status === 'live').length, 3, 'the raised limit lets two more in');
});

// ---------------------------------------------------------------------------
// The result object: 20 hand-written literals, the resolver's own answer, and null
// ---------------------------------------------------------------------------

const IDS5 = ['a', 'b', 'c', 'd', 'e'];
const PAIR_PIN = { pinned: { parkable: false }, unpinned: { parkable: true } } as const;

type Context = 'live' | 'parked' | 'hidden' | 'person tablet' | 'person pin';
/** A rig for each state a patch meets, and the panel the patch is for. */
async function contextRig(context: Context): Promise<{ r: PinRig; id: string }> {
  if (context === 'parked') return { r: await pinRig({ ids: IDS5, width: 1000, settings: Object.fromEntries(IDS5.map((id) => [id, { overflow: 'park' } as PanelSettings])) }), id: 'b' };
  if (context === 'person pin') {
    const r = await pinRig({ settings: { b: { pinning: PAIR_PIN } } });
    r.turn(() => r.h.b!.pin('person'));
    return { r, id: 'b' };
  }
  const r = await pinRig();
  if (context === 'hidden') r.turn(() => r.h.b!.hide());
  if (context === 'person tablet') r.turn(() => r.h.c!.setFormFactor('tablet', 'person'));
  return { r, id: context === 'person tablet' ? 'c' : 'b' };
}

/** [context, the status the panel is in, the patch, now, later, shadowed]: every expectation written from the class of each key. */
const SAMPLE: readonly [Context, string, Record<string, unknown>, string[], string[], string[]][] = [
  ['live', 'live', { closable: false }, ['closable'], [], []],
  ['live', 'live', { draggable: false }, ['draggable'], [], []],
  ['live', 'live', { title: 'Renamed' }, ['title'], [], []],
  ['live', 'live', { listed: false }, ['listed'], [], []],
  ['live', 'live', { layer: 'raised' }, ['layer'], [], []],
  ['live', 'live', { scrollOnOpen: 'center' }, [], ['scrollOnOpen'], []],
  ['live', 'live', { hideStickiness: 'until-room', hideWhenLast: 'refuse' }, [], ['hideStickiness', 'hideWhenLast'], []],
  ['live', 'live', { closable: false, scrollOnOpen: 'center' }, ['closable'], ['scrollOnOpen'], []],
  ['live', 'live', { keepMounted: true }, [], ['keepMounted'], []],
  ['live', 'live', { formFactors: ['phone', 'tablet'] }, ['formFactors'], [], []],
  ['live', 'live', { parkable: false }, ['parkable'], [], []],
  ['live', 'live', { tuning: { slide: { durationSec: 0.2 } } }, [], ['tuning.slide'], []],
  ['live', 'live', { headerButtons: { x: false } }, ['headerButtons'], [], []],
  ['live', 'live', { formFactor: 'tablet' }, [], ['formFactor'], []],
  ['parked', 'parked', { closable: false }, ['closable'], [], []],
  ['parked', 'parked', { layer: 'raised' }, [], ['layer'], []],
  ['parked', 'parked', { title: 'Parked title' }, ['title'], [], []],
  ['hidden', 'parked', { listed: false }, ['listed'], [], []],
  ['person tablet', 'live', { formFactor: 'phone' }, [], ['formFactor'], ['formFactor']],
  ['person pin', 'live', { parkable: true }, ['parkable'], [], ['parkable']],
];

test('the result of 20 patches over live, parked, hidden and person-shaped panels equals the literals written by hand', async () => {
  assert.equal(SAMPLE.length, 20);
  let executed = 0;
  for (const [context, status, patch, now, later, shadowed] of SAMPLE) {
    const { r, id } = await contextRig(context);
    assert.equal(r.state(id).status, status, `${context}: control, the status the row expects`);
    const res = done(r.turn(() => r.h[id]!.configure(patch as never)));
    assert.deepEqual({ ok: res.ok, changed: res.changed, shown: res.shown, now: [...res.now], later: [...res.later], shadowed: [...res.shadowed] }, { ok: true, changed: true, shown: false, now, later, shadowed }, `${context} ${JSON.stringify(patch)}`);
    executed += 1;
    cleanup();
  }
  assert.equal(executed, 20);
});

test('a person pin outvotes a configured parkable: the result lists it as shadowed and the panel stays a fixed column', async () => {
  const { r, id } = await contextRig('person pin');
  assert.equal(r.facts(id).parkable, false);
  const res = done(r.turn(() => r.h[id]!.configure({ parkable: true })));
  assert.deepEqual([[...res.now], [...res.later], [...res.shadowed]], [['parkable'], [], ['parkable']]);
  assert.equal(r.facts(id).parkable, false, 'the person\'s pin still wins');
  assert.equal(r.h.b!.getSettings().source.parkable, 'user');
});

test('getSettings after a configure deep-equals the resolver over the patched layers, with source instance for the patched keys', async () => {
  const slot = { icon: 'i', label: 'X', onClick: () => undefined };
  const cases: [string, Record<string, unknown>][] = [
    ['a NOW key', { closable: false, title: 'Eve' }],
    ['a NEXT key', { scrollOnOpen: 'center', hideWhenLast: 'refuse' }],
    ['a STATE key', { formFactors: ['phone', 'tablet'], keepMounted: true }],
    ['a tuning leaf', { tuning: { hopFraction: 0.3, slide: { durationSec: 0.2 } } }],
    ['a slot', { headerButtons: { x: slot } }],
    ['a pinning definition', { pinning: { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } } }],
  ];
  for (const [name, patch] of cases) {
    for (const person of [false, true]) {
      const r = await pinRig({ settings: { b: { scrollOnOpen: 'start' } } });
      if (person) r.turn(() => r.h.b!.setFormFactor('tablet', 'person'));
      const user = person ? r.entry('b').overrides : undefined;
      done(r.turn(() => r.h.b!.configure(patch as never)));
      const expected = resolvePanelSettings({ template: { scrollOnOpen: 'start', frame: 'none' }, instance: patch as PanelSettings, ...(user === undefined ? {} : { user }) }, { lenient: true });
      assert.deepEqual(r.h.b!.getSettings(), expected, `${name}${person ? ' with the person\'s tier' : ''}`);
      const flat = Object.keys(patch).flatMap((k) => (k === 'tuning' ? Object.keys(patch.tuning as object).map((leaf) => `tuning.${leaf}`) : [k]));
      for (const key of flat) assert.equal(r.h.b!.getSettings().source[key], 'instance', `${name}: ${key} reads source instance`);
      cleanup();
    }
  }
});

test('null removes the key and the cascade\'s value and source come back: library, workspace, template and the workspace tuning', async () => {
  const r = await pinRig({ settings: { b: { scrollOnOpen: 'start' } }, workspace: { defaults: { hideStickiness: 'until-room' }, tuning: { hopFraction: 0.25 } } });
  const read = (key: string): [unknown, string | undefined] => {
    const s = r.h.b!.getSettings();
    return [key === 'tuning.hopFraction' ? s.value.tuning.hopFraction : (s.value as unknown as Record<string, unknown>)[key], s.source[key]];
  };
  const rows: [string, Record<string, unknown>, Record<string, unknown>, [unknown, string], [unknown, string], [unknown, string]][] = [
    ['scrollOnOpen', { scrollOnOpen: 'center' }, { scrollOnOpen: null }, ['start', 'template'], ['center', 'instance'], ['start', 'template']],
    ['hideStickiness', { hideStickiness: 'sticky' }, { hideStickiness: null }, ['until-room', 'workspace'], ['sticky', 'instance'], ['until-room', 'workspace']],
    ['undoWindowMs', { undoWindowMs: 5000 }, { undoWindowMs: null }, [10000, 'library'], [5000, 'instance'], [10000, 'library']],
    ['tuning.hopFraction', { tuning: { hopFraction: 0.3 } }, { tuning: { hopFraction: null } }, [0.25, 'workspace'], [0.3, 'instance'], [0.25, 'workspace']],
  ];
  for (const [key, set, unset, was, during, back] of rows) {
    assert.deepEqual(read(key), was, `${key}: before`);
    done(r.turn(() => r.h.b!.configure(set as never)));
    assert.deepEqual(read(key), during, `${key}: configured`);
    assert.equal(done(r.turn(() => r.h.b!.configure(unset as never))).changed, true);
    assert.deepEqual(read(key), back, `${key}: after null`);
  }
  const slot = { icon: 'i', label: 'X', onClick: () => undefined };
  done(r.turn(() => r.h.b!.configure({ headerButtons: { x: slot } })));
  assert.deepEqual(Object.keys(r.h.b!.getSettings().value.headerButtons), ['x']);
  done(r.turn(() => r.h.b!.configure({ headerButtons: { x: null } } as never)));
  assert.deepEqual(Object.keys(r.h.b!.getSettings().value.headerButtons), [], 'null removes the slot the instance layer added');
  assert.deepEqual({ ...done(r.turn(() => r.h.b!.configure({ scrollOnOpen: null }))) }, { ok: true, changed: false, shown: false, now: [], later: [], shadowed: [], notes: [] }, 'a null for a key the layer never held changes nothing');
});

test('null on a key a view asked for at the Host-bag create brings the host\'s ask back with source host, for a template panel and a plain one', async () => {
  const r = await pinRig({ ids: ['a'], extra: [markerTemplate('m', { settings: { multiple: true, title: 'Template title' } })] });
  act(() => void r.provided().create({ view: 'm', title: 'Host title', listed: false, formFactor: 'tablet' }));
  act(() => void r.provided().create({ title: 'Plain host title' }));
  await r.settle();
  const templated = r.ws.panels.list().find((h) => h.templateId === 'm')!;
  const plain = r.ws.panels.list().find((h) => h.templateId !== 'm' && h.templateId !== 'a' && h.id !== r.ws.rootId)!;
  const read = (h: PanelHandle, key: 'title' | 'listed' | 'formFactor'): [unknown, string | undefined] => [h.getSettings().value[key], h.getSettings().source[key]];
  assert.deepEqual([read(templated, 'title')[0], read(templated, 'listed')[0], read(templated, 'formFactor')[0], read(plain, 'title')[0]], ['Host title', false, 'tablet', 'Plain host title'], 'control: the asks took effect');
  assert.deepEqual(read(templated, 'title'), ['Host title', 'host'], 'the ask reads as the host layer until a configure sets the key');
  done(r.turn(() => templated.configure({ title: 'Configured', listed: true })));
  assert.deepEqual([read(templated, 'title'), read(templated, 'listed')], [['Configured', 'instance'], [true, 'instance']]);
  const back = done(r.turn(() => templated.configure({ title: null, listed: null, formFactor: 'phone' })));
  assert.deepEqual([[...back.now], [...back.later], [...back.shadowed]], [['title', 'listed'], ['formFactor'], []]);
  assert.deepEqual([read(templated, 'title'), read(templated, 'listed'), read(templated, 'formFactor')], [['Host title', 'host'], [false, 'host'], ['phone', 'instance']], 'null shows the host\'s ask again, source host');
  done(r.turn(() => templated.configure({ formFactor: null })));
  assert.deepEqual(read(templated, 'formFactor'), ['tablet', 'host']);
  assert.equal(r.state(templated.id).title, 'Host title', 'and the panel\'s own title follows');
  done(r.turn(() => plain.configure({ title: 'Configured' })));
  done(r.turn(() => plain.configure({ title: null })));
  assert.deepEqual(read(plain, 'title'), ['Plain host title', 'host']);
});

// ---------------------------------------------------------------------------
// deferredPin and configure
// ---------------------------------------------------------------------------

const PLACE_FIRST: Pinning = { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } };
const FIX_FIRST: Pinning = { pinned: { placement: 'row-start', parkable: false }, unpinned: { placement: 'row-end', parkable: true } };
const FIX_AFTER_DOCK: Pinning = { pinned: { placement: { after: 'dock' }, parkable: false }, unpinned: { placement: 'row-end', parkable: true } };

/** Panels a, b, c and a dock in a roomy row, b hidden by code: a parked panel whose pin waits for its next show. */
async function hiddenRig(pinning: Pinning): Promise<PinRig> {
  const ids = ['a', 'b', 'c', 'dock'];
  const r = await pinRig({ ids, settings: Object.fromEntries(ids.map((id) => [id, { pinning, pinningWhenNotLive: 'apply-on-next-show' } as PanelSettings])) });
  r.turn(() => r.h.b!.hide());
  assert.deepEqual([r.state('b').status, r.state('b').held, r.order().join(' ')], ['parked', true, 'root a b c dock']);
  return r;
}

/** How many times the placement path asked the workspace to resolve a fixing or freeing half, which only a pin change that applies does. */
function spyOnPinLanding(r: PinRig): { calls: () => number; reset: () => void } {
  const binding = bindingOf(r.ws);
  const real = binding.resolveWith;
  let count = 0;
  binding.resolveWith = (...args) => {
    count += 1;
    return real(...args);
  };
  return { calls: () => count, reset: () => void (count = 0) };
}

test('deferredPin row 1: a parked panel holding { by: pin } then configure parkable true reads null, and the next show() applies no deferred pin', async () => {
  const control = await hiddenRig(FIX_FIRST);
  const seen = spyOnPinLanding(control);
  control.turn(() => control.h.b!.pin());
  assert.deepEqual([control.state('b').deferredPin, control.state('b').pinned, control.order().join(' ')], [{ by: 'pin' }, false, 'root a b c dock']);
  seen.reset();
  control.turn(() => control.h.b!.show());
  await control.settle();
  assert.deepEqual([control.state('b').deferredPin, control.state('b').pinned, control.order().join(' ')], [null, true, 'b root a c dock'], 'control: without the configure, show() applies the pin and lands b first');
  assert.equal(seen.calls() > 0, true, 'control: the spy sees the placement path resolve the fixing half');
  cleanup();

  const r = await hiddenRig(FIX_FIRST);
  const spy = spyOnPinLanding(r);
  r.turn(() => r.h.b!.pin());
  assert.deepEqual(r.state('b').deferredPin, { by: 'pin' });
  const res = r.turn(() => r.h.b!.configure({ parkable: true }));
  assert.deepEqual({ ...done(res) }, { ok: true, changed: true, shown: false, now: ['parkable'], later: [], shadowed: [], notes: [] });
  assert.equal(r.state('b').deferredPin, null, 'cancelled by the call, before the show');
  spy.reset();
  r.turn(() => r.h.b!.show());
  await r.settle();
  assert.deepEqual([r.state('b').status, r.state('b').deferredPin, r.state('b').pinned, r.order().join(' ')], ['live', null, false, 'root a b c dock'], 'after the show: nothing was applied, b is where it was');
  assert.equal(spy.calls(), 0, 'and the placement path never resolved a pin change');
});

test('deferredPin row 2: configure pinning on a parked panel holding { by: pin } keeps the stored direction, and the next show() applies the new definition', async () => {
  const r = await hiddenRig(PLACE_FIRST);
  r.turn(() => r.h.b!.pin());
  assert.deepEqual([r.state('b').deferredPin, r.state('b').status], [{ by: 'pin' }, 'parked']);
  const res = r.turn(() => r.h.b!.configure({ pinning: FIX_AFTER_DOCK }));
  assert.deepEqual({ ...done(res) }, {
    ok: true,
    changed: true,
    shown: false,
    now: ['pinning'],
    later: [],
    shadowed: [],
    notes: [{ code: 'pin-unlists', key: 'pinning', message: 'pinning: the pinned half makes the panel a fixed column, which is unlisted unless listed is set' }],
  });
  assert.deepEqual(r.state('b').deferredPin, { by: 'pin' }, 'the direction stays, the definition it applies is the new one');
  assert.equal(r.order().join(' '), 'root a b c dock', 'nothing moved');
  r.turn(() => r.h.b!.show());
  await r.settle();
  assert.deepEqual([r.state('b').deferredPin, r.state('b').pinned, r.order().join(' ')], [null, true, 'root a c dock b'], 'b lands right of dock, not first as the old definition placed it');
  assert.equal(r.order().indexOf('b'), r.order().indexOf('dock') + 1);
});

// ---------------------------------------------------------------------------
// configure({ headerButtons })
// ---------------------------------------------------------------------------

const slotB = (label = 'B'): HeaderButton => ({ icon: createElement('i', { 'data-icon': label }), label, onClick: () => undefined });
/** The element holding focus, as a tag and its tabindex attribute. */
const focused = (): { tag: string; tabindex: string | null; label: string | null } => {
  const el = document.activeElement as HTMLElement;
  return { tag: el.tagName, tabindex: el.getAttribute('tabindex'), label: el.getAttribute('aria-label') };
};
const labels = (rig: HeaderRig, id: string): (string | null)[] => rig.buttons(id).map((b) => b.getAttribute('aria-label'));

test('headerButtons row 1: removing the focused slot is NOW, the slot is gone in the same commit and focus is on the header row, never body', async () => {
  const rig = await headerRig({ ids: ['a'], slots: { b: slotB(), keep: slotB('Keep') } });
  assert.deepEqual(labels(rig, 'a'), ['B', 'Keep']);
  act(() => rig.buttons('a')[0]!.focus());
  assert.deepEqual(focused(), { tag: 'BUTTON', tabindex: '0', label: 'B' });
  const renders = rig.m.renders();
  const res = rig.turn(() => rig.h.a!.configure({ headerButtons: { b: false } }));
  assert.deepEqual({ ...(res as Done) }, { ok: true, changed: true, shown: false, now: ['headerButtons'], later: [], shadowed: [], notes: [] });
  assert.equal(rig.m.renders() - renders, 1, 'one commit');
  assert.deepEqual(labels(rig, 'a'), ['Keep'], 'the slot is gone in that commit');
  assert.deepEqual(focused(), { tag: 'DIV', tabindex: '-1', label: rig.row('a')!.getAttribute('aria-label') });
  assert.equal(document.activeElement === rig.row('a'), true, 'it is the panel\'s own header row, which is the toolbar and carries the title as its name');
  assert.equal(document.activeElement === document.body, false);
});

test('headerButtons row 2: replacing the only focused slot by a hidden one leaves focus on the header row, which carries tabindex -1', async () => {
  const rig = await headerRig({ ids: ['a'], slots: { b: slotB() } });
  const row = rig.row('a')!;
  act(() => rig.buttons('a')[0]!.focus());
  assert.deepEqual(focused(), { tag: 'BUTTON', tabindex: '0', label: 'B' });
  rig.turn(() => rig.h.a!.configure({ headerButtons: { b: { ...slotB(), hidden: true } } }));
  assert.deepEqual(labels(rig, 'a'), []);
  assert.deepEqual(focused(), { tag: 'DIV', tabindex: '-1', label: null });
  assert.equal(document.activeElement === row, true, 'the header row the button sat in');
});

test('headerButtons row 2b: removing the only declared slot while it holds focus leaves focus on that panel\'s header row, tabindex -1, never body', async () => {
  const rig = await headerRig({ ids: ['a', 'c'], slots: { b: slotB() } });
  const row = rig.row('a')!;
  act(() => rig.buttons('a')[0]!.focus());
  assert.deepEqual(focused(), { tag: 'BUTTON', tabindex: '0', label: 'B' });
  const renders = rig.m.renders();
  rig.turn(() => rig.h.a!.configure({ headerButtons: { b: false } }));
  assert.equal(rig.m.renders() - renders, 1, 'one commit');
  assert.deepEqual([labels(rig, 'a'), rig.row('a')], [[], null], 'no slot is declared any more, so the row carries no marker');
  assert.deepEqual(focused(), { tag: 'DIV', tabindex: '-1', label: null });
  assert.equal(document.activeElement === row, true, 'it is the header row the button sat in');
  assert.deepEqual(labels(rig, 'c'), ['B'], 'the other panel keeps its slot');
});

test('headerButtons row 2c: a focus that is elsewhere is left alone when a panel loses its last slot', async () => {
  const rig = await headerRig({ ids: ['a', 'c'], slots: { b: slotB() } });
  act(() => rig.buttons('c')[0]!.focus());
  rig.turn(() => rig.h.a!.configure({ headerButtons: { b: false } }));
  assert.deepEqual(focused(), { tag: 'BUTTON', tabindex: '0', label: 'B' });
  assert.equal(document.activeElement === rig.buttons('c')[0], true, 'still the other panel\'s button');
});

test('headerButtons row 2d: the same holds for a lone panel with one slot', async () => {
  const rig = await headerRig({ ids: ['a'], slots: { b: slotB() } });
  const row = rig.row('a')!;
  act(() => rig.buttons('a')[0]!.focus());
  rig.turn(() => rig.h.a!.configure({ headerButtons: { b: false } }));
  assert.deepEqual(focused(), { tag: 'DIV', tabindex: '-1', label: null });
  assert.equal(document.activeElement === row, true);
});

test('headerButtons row 3: a slot configured onto a panel with none appears in the same commit, and a changed label shows at the commit', async () => {
  const rig = await headerRig({ ids: ['a'] });
  assert.deepEqual([labels(rig, 'a'), rig.row('a')], [[], null]);
  const renders = rig.m.renders();
  rig.turn(() => rig.h.a!.configure({ headerButtons: { b: slotB('B') } }));
  assert.equal(rig.m.renders() - renders, 1, 'one commit');
  assert.deepEqual(labels(rig, 'a'), ['B']);
  assert.equal(rig.row('a')!.getAttribute('tabindex'), '-1');
  const second = rig.m.renders();
  rig.turn(() => rig.h.a!.configure({ headerButtons: { b: slotB('Renamed') } }));
  assert.equal(rig.m.renders() - second, 1, 'one commit for the label too');
  assert.deepEqual(labels(rig, 'a'), ['Renamed']);
});

test('headerButtons row 4: on a parked panel the value is stored, nothing is drawn for the layout, and the buttons draw when show() brings it back', async () => {
  const rig = await headerRig({ ids: ['a', 'b'] });
  rig.turn(() => rig.h.b!.hide());
  await advanceFrames(900);
  assert.deepEqual([rig.state('b').status, rig.row('b')], ['parked', null]);
  const res = rig.turn(() => rig.h.b!.configure({ headerButtons: { b: slotB() } }));
  assert.deepEqual({ ...(res as Done) }, { ok: true, changed: true, shown: false, now: [], later: ['headerButtons'], shadowed: [], notes: [] });
  assert.deepEqual(Object.keys(rig.h.b!.getSettings().value.headerButtons), ['b'], 'stored: the resolved settings have it');
  assert.deepEqual([rig.state('b').status, rig.row('b')], ['parked', null], 'and the layout drew nothing');
  rig.turn(() => rig.h.b!.show());
  await advanceFrames(900);
  assert.equal(rig.state('b').status, 'live');
  assert.deepEqual(labels(rig, 'b'), ['B'], 'the buttons draw once the panel is back');
});

// ---------------------------------------------------------------------------
// Turn and lifecycle: the same answers from every trigger, and no flushSync
// ---------------------------------------------------------------------------

type Answer = ConfigureResult | PanelResult;
/** An answer as a short literal: T accepted and changed, F accepted with nothing to do, or the refusal code. */
const letter = (a: Answer): string => (a.ok ? (a.changed ? 'T' : 'F') : a.code);

const LOCK_A = { closable: false } as const;
/** `locked` is A's lock afterwards, or null when the row closes A. */
const BUSY_ROWS: readonly { name: string; calls: (r: PinRig) => Answer[]; results: string[]; order: string; locked: boolean | null }[] = [
  { name: 'configure A + hide A', calls: (r) => [r.h.a!.configure(LOCK_A), r.h.a!.hide()], results: ['T', 'busy'], order: 'root a b c', locked: true },
  { name: 'configure A + close A', calls: (r) => [r.h.a!.configure(LOCK_A), r.h.a!.close()], results: ['T', 'busy'], order: 'root a b c', locked: true },
  { name: 'configure A + move A', calls: (r) => [r.h.a!.configure(LOCK_A), r.h.a!.move('right')], results: ['T', 'busy'], order: 'root a b c', locked: true },
  { name: 'configure A + setFormFactor A', calls: (r) => [r.h.a!.configure(LOCK_A), r.h.a!.setFormFactor('tablet')], results: ['T', 'busy'], order: 'root a b c', locked: true },
  { name: 'configure A + pin A', calls: (r) => [r.h.a!.configure(LOCK_A), r.h.a!.pin()], results: ['T', 'busy'], order: 'root a b c', locked: true },
  { name: 'hide A + configure A', calls: (r) => [r.h.a!.hide(), r.h.a!.configure(LOCK_A)], results: ['T', 'busy'], order: 'root a b c', locked: false },
  { name: 'move A + configure A', calls: (r) => [r.h.a!.move('right'), r.h.a!.configure(LOCK_A)], results: ['T', 'busy'], order: 'root b a c', locked: false },
  { name: 'setFormFactor A + configure A formFactors', calls: (r) => [r.h.a!.setFormFactor('tablet'), r.h.a!.configure({ formFactors: ['phone'] })], results: ['T', 'busy'], order: 'root a b c', locked: false },
  { name: 'configure A + configure A', calls: (r) => [r.h.a!.configure(LOCK_A), r.h.a!.configure({ title: 'again' })], results: ['T', 'busy'], order: 'root a b c', locked: true },
  { name: 'configure A + configure B', calls: (r) => [r.h.a!.configure(LOCK_A), r.h.b!.configure({ closable: false })], results: ['T', 'T'], order: 'root a b c', locked: true },
  { name: 'close A + configure B', calls: (r) => [r.h.a!.close(), r.h.b!.configure(LOCK_A)], results: ['T', 'busy'], order: 'root b c', locked: null },
  { name: 'configure A + close B', calls: (r) => [r.h.a!.configure(LOCK_A), r.h.b!.close()], results: ['T', 'busy'], order: 'root a b c', locked: true },
];

test('configure and any operation on the same panel give the same literal rows from a handler, a timer, a promise continuation and a passive effect', async () => {
  for (const trigger of TRIGGERS) {
    for (const row of BUSY_ROWS) {
      const r = await pinRig();
      const answers = await fire(trigger, () => row.calls(r).map(letter));
      assert.deepEqual(answers, row.results, `${trigger}: ${row.name}`);
      await fire('handler', () => undefined);
      assert.equal(r.order().join(' '), row.order, `${trigger}: ${row.name}: the row afterwards`);
      assert.equal(row.locked === null ? r.state('a').status : r.entry('a').locked, row.locked === null ? 'closed' : row.locked, `${trigger}: ${row.name}: A afterwards`);
      cleanup();
    }
  }
});

/** The ways code reaches a panel without a click: a layout effect, a passive effect, a timer and a promise continuation. */
const LIFECYCLES = ['layout effect', 'passive effect', 'timer', 'promise'] as const;

async function fromLifecycle(kind: (typeof LIFECYCLES)[number], fn: () => void): Promise<void> {
  if (kind === 'timer' || kind === 'promise') {
    await fire(kind, fn);
    return;
  }
  function Caller(): null {
    (kind === 'layout effect' ? useLayoutEffect : useEffect)(() => {
      fn();
    }, []);
    return null;
  }
  mount(createElement(Caller));
}

test('configure from a layout effect, a passive effect, a timer and a promise commits once and logs nothing; a flushSync from a lifecycle in the same harness is logged', async () => {
  const logged = mock.method(console, 'error', () => undefined);
  for (const kind of LIFECYCLES) {
    const r = await pinRig();
    const renders = r.m.renders();
    const version = r.ws.panels.getSnapshot().version;
    let out: ConfigureResult | undefined;
    await fromLifecycle(kind, () => {
      out = r.h.b!.configure({ closable: false, scrollOnOpen: 'center' });
    });
    assert.deepEqual({ ...done(out!) }, { ok: true, changed: true, shown: false, now: ['closable'], later: ['scrollOnOpen'], shadowed: [], notes: [] }, kind);
    assert.deepEqual([r.m.renders() - renders, r.ws.panels.getSnapshot().version - version, r.entry('b').locked], [1, 1, true], `${kind}: one commit, one snapshot, the lock applied`);
    cleanup();
  }
  assert.deepEqual(logged.mock.calls.map((c) => String(c.arguments[0])), [], 'no lifecycle logged a thing');
  function Offender(): null {
    useLayoutEffect(() => {
      flushSync(() => undefined);
    }, []);
    return null;
  }
  mount(createElement(Offender));
  assert.equal(logged.mock.calls.some((c) => /flushSync was called from inside a lifecycle method/.test(String(c.arguments[0]))), true, 'control: the capture sees a deliberate flushSync');
});

// ---------------------------------------------------------------------------
// configureTuning({ rowGap })
// ---------------------------------------------------------------------------

test('configureTuning rowGap is busy while any panel holds a token, and takes the whole row for the rest of the turn', async () => {
  const taken = await pinRig();
  assert.deepEqual(taken.turn(() => [letter(taken.h.a!.hide()), letter(taken.ws.panels.configureTuning({ rowGap: 30 }))]), ['T', 'busy']);
  assert.equal(taken.ws.tuning.rowGap, 16, 'nothing changed');
  cleanup();
  const raw = await pinRig();
  const afterRaw = raw.turn(() => {
    raw.provided().setFormFactor(raw.entry('c').id, 'tablet');
    return raw.ws.panels.configureTuning({ rowGap: 30 });
  });
  assert.equal(letter(afterRaw), 'busy', 'a raw token counts');
  cleanup();
  const first = await pinRig();
  assert.deepEqual(first.turn(() => [letter(first.ws.panels.configureTuning({ rowGap: 30 })), letter(first.h.b!.hide()), letter(first.h.c!.configure({ closable: false }))]), ['T', 'busy', 'busy']);
  assert.equal(first.ws.tuning.rowGap, 30);
  cleanup();
  const other = await pinRig();
  assert.deepEqual(other.turn(() => [letter(other.h.a!.hide()), letter(other.ws.panels.configureTuning({ hopFraction: 0.3 }))]), ['T', 'T'], 'a leaf that does not re-price is never busy');
});

test('configureTuning rowGap re-prices the row in one commit: the slots rest one new gap apart', async () => {
  const r = await pinRig();
  await r.settle();
  const slotX = (name: string): number => {
    const transform = (r.m.container.querySelector(`[data-slot="${name === 'root' ? name : r.entry(name).id}"]`)!.parentElement as HTMLElement).style.transform;
    return transform === 'none' ? 0 : Number(/translateX\((-?[\d.]+)px\)/.exec(transform)![1]);
  };
  assert.deepEqual(['root', 'a', 'b', 'c'].map(slotX), [0, 406, 812, 1218], 'before: 390 + 16 apart');
  const renders = r.m.renders();
  const res = done(r.turn(() => r.ws.panels.configureTuning({ rowGap: 40 })));
  assert.deepEqual({ ...res }, { ok: true, changed: true, shown: false, now: ['tuning.rowGap'], later: [], shadowed: [], notes: [] });
  assert.equal(r.m.renders() - renders, 1, 'one commit');
  assert.deepEqual([r.m.latest().tuning.rowGap, r.ws.tuning.rowGap, r.m.latest().rowNumbers.stripWidth], [40, 40, 4 * 390 + 3 * 40], 'priced in the commit of the call, not after it');
  await r.settle();
  assert.deepEqual(['root', 'a', 'b', 'c'].map(slotX), [0, 430, 860, 1290], 'after: 390 + 40 apart');
});

test('configureTuning rowGap in park mode: a smaller capacity parks the fewest park panels through the reconcile effect, then the live ones fit', async () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const r = await pinRig({ ids, width: 1950, workspace: { tuning: { rowGap: 0 } }, settings: Object.fromEntries(ids.map((id) => [id, { overflow: 'park' } as PanelSettings])) });
  await r.settle();
  const liveParkable = (): string[] => r.live().filter((id) => id !== 'root');
  assert.equal(liveParkable().length, 4, 'capacity at gap 0: (1950 - 390) / 390');
  const renders = r.m.renders();
  done(r.turn(() => r.ws.panels.configureTuning({ rowGap: 40 })));
  await r.settle();
  const capacity = Math.floor((1950 - 2 * 40 - 390) / (390 + 40));
  assert.equal(capacity, 3);
  assert.equal(liveParkable().length <= capacity, true, 'after the settled commit the live park panels fit');
  assert.equal(liveParkable().length, 3, 'and exactly one was parked: the fewest');
  assert.equal(r.m.renders() - renders >= 2, true, 'the re-price commits first and the reconcile effect parks in a later commit');
  const widths = r.m.latest().rowNumbers;
  assert.equal(widths.stripWidth <= widths.windowWidth, true, 'the live panels fit the window');
});

test('configureTuning rowGap in a scrolling row only re-prices: nothing is parked, and the farthest legal scrollLeft moves with the strip', async () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const r = await pinRig({ ids, width: 1000, workspace: { tuning: { rowGesture: 'free' } } });
  await r.settle();
  const numbers = () => {
    const n = r.m.latest().rowNumbers;
    return [n.stripWidth, n.windowWidth, n.stripWidth - n.windowWidth];
  };
  assert.deepEqual(numbers(), [4450, 968, 3482], 'eleven panels at gap 16: 11 x 390 + 10 x 16');
  const live = r.live();
  const renders = r.m.renders();
  done(r.turn(() => r.ws.panels.configureTuning({ rowGap: 0 })));
  await r.settle();
  assert.deepEqual(numbers(), [4290, 1000, 3290], 'at gap 0: 11 x 390, a window of 1000');
  assert.deepEqual(r.live(), live, 'nothing was parked');
  assert.equal(r.m.renders() - renders, 1, 'one commit');
  r.turn(() => r.h.j!.scrollTo('start'));
  await r.settle();
  assert.equal(r.m.container.scrollLeft, 3290, 'a scroll to the last panel stops at the new bound, not the old 3482');
});

test('configureTuning rowGap on a row that is not measured is stored: nothing is priced or parked', async () => {
  const r = await pinRig({ width: 0 });
  assert.equal(r.m.latest().maxLiveWidth, Number.POSITIVE_INFINITY, 'control: the row is unmeasured');
  const entries = r.m.latest().entries;
  const res = done(r.turn(() => r.ws.panels.configureTuning({ rowGap: 40 })));
  assert.deepEqual({ ...res }, { ok: true, changed: true, shown: false, now: ['tuning.rowGap'], later: [], shadowed: [], notes: [] });
  assert.deepEqual([r.ws.tuning.rowGap, r.m.latest().tuning.rowGap, r.m.latest().maxLiveWidth], [40, 40, Number.POSITIVE_INFINITY]);
  assert.deepEqual(r.live(), ['root', 'a', 'b', 'c']);
  assert.equal(r.m.latest().entries.every((p, k) => p === entries[k]), true, 'no entry was rewritten');
});
