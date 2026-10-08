/**
 * configure(id), configureTemplate and configureTuning through the manager: the result object, the refusals, the
 * class laws, the writer's exact delta, the raw API in the same turn, conflicts and scope, and the turn rules.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import type { ConfigureResult, PanelSettings } from '../index.js';
import { applyConfigure } from '../panelConfigure.js';
import { panelKey } from '../panelSettings.js';
import type { PanelWindow } from '../panelWindow.js';
import { cleanup } from './support/mount-harness.js';
import { pinRig, type PinRig } from './support/pin-rig.js';
import { markerTemplate } from './support/workspace-row.js';

/** A rig with a `multiple` template named m beside the panel a. */
const multiRig = (settings: PanelSettings): Promise<PinRig> => pinRig({ ids: ['a'], extra: [markerTemplate('m', { settings: { multiple: true, ...settings } })] });

afterEach(() => cleanup());

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

test('writer: a parkable flip to false makes the panel live and a fixed column, and writes nothing else of the tier', async () => {
  const r = await pinRig();
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

test('multiple true to false with 2 instances is instance-limit and closes nothing; with 1 it is ok', async () => {
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
  assert.equal(done(r.turn(() => r.ws.panels.configureTemplate('m', { multiple: false }))).changed, true);
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
