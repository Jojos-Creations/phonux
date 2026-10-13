/**
 * The restore and the creation helpers behind it, with no React: the template registry, the recorders of the person's
 * gestures, and reconcileWorkspace over literal saved files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PanelManagerError } from '../panelManagerError.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import type { PanelSettings } from '../panelSettings.js';
import { definePanel } from '../panelTemplate.js';
import type { PanelTemplate } from '../panelTemplate.js';
import { appendPanel, clearOverrides, createHistoryPanel, recordOverride, type PanelWindow } from '../panelWindow.js';
import { computeRowOrder } from '../panelRowOrder.js';
import { assertTemplateIdFree, registerView, resolveView, resolveViewIn } from '../viewRegistry.js';
import { reconcileWorkspace, type ReconcileInput } from '../workspacePlan.js';
import { projectWorkspaceState, type WorkspacePanelState, type WorkspaceState } from '../workspaceState.js';

const ROOT = 'root';
const View = (): null => null;
const tpl = (id: string, settings: PanelSettings = {}): PanelTemplate => definePanel({ id, view: View, settings });

/** A freshId counting n1, n2, ... and recording how many were drawn. */
const counter = (): (() => string) & { drawn: () => number } => {
  let n = 0;
  return Object.assign(() => `n${++n}`, { drawn: () => n });
};

const run = (over: Partial<ReconcileInput> = {}): ReturnType<typeof reconcileWorkspace> =>
  reconcileWorkspace({ saved: null, templates: [], declared: undefined, rootId: ROOT, current: [], freshId: counter(), ...over });

const savedEntry = (id: string, more: Partial<WorkspacePanelState> = {}): WorkspacePanelState => ({
  id,
  view: 'web',
  url: `https://${id}.example`,
  title: id,
  live: true,
  anchor: { panel: ROOT, position: 'right', priority: 0 },
  ...more,
});
const file = (panels: WorkspacePanelState[], more: Partial<WorkspaceState> = {}): WorkspaceState => ({ version: 1, panels, ...more });
/** Saved entries in file order, each right of the root at its own priority. */
const line = (...entries: WorkspacePanelState[]): WorkspacePanelState[] => entries.map((e, k) => ({ ...e, anchor: { panel: ROOT, position: 'right', priority: k } }));
const titles = (entries: readonly PanelWindow[]): (string | undefined)[] => entries.map((p) => p.title);

/** A panel as a creation path builds it, carrying settings. */
const made = (id: string, layer: PanelSettings = {}, over: Partial<PanelWindow> = {}): PanelWindow => {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id }, id, ROOT)[0]!;
  return applyTemplate({ ...skeleton, ...over }, resolvePanelSettings({ template: layer }).value, 'create');
};
const rowOf = (...entries: PanelWindow[]): PanelWindow[] => computeRowOrder([createHistoryPanel(ROOT), ...entries], ROOT);

// ---------------------------------------------------------------------------
// The view registry
// ---------------------------------------------------------------------------

test('registry: a template id that is a registered view key throws template-collision', () => {
  registerView('reg-c', View);
  assert.throws(() => assertTemplateIdFree('reg-c'), (e) => e instanceof PanelManagerError && e.code === 'template-collision');
  assert.doesNotThrow(() => assertTemplateIdFree('reg-c-free'), 'control: an id with no plain view is free');
});

test('registry: the view registered under a key wins over the template of a workspace that holds the same id', () => {
  const t = tpl('history');
  const Rendered = (): null => null;
  registerView('history', Rendered);
  assert.equal(resolveViewIn((id) => (id === 'history' ? t : undefined), 'history'), Rendered);
});

test('registry: a template resolves through the workspace that holds it only, and resolveView alone never sees one', () => {
  const t = tpl('reg-d');
  const found = resolveViewIn((id) => (id === 'reg-d' ? t : undefined), 'reg-d');
  assert.notEqual(found, resolveView('reg-d'), 'control: the workspace resolve found the template view');
  assert.equal(resolveViewIn(() => undefined, 'reg-d'), resolveView('reg-d'), 'a workspace without the template renders the placeholder');
  assert.equal(typeof resolveView('reg-d'), 'function');
});

// ---------------------------------------------------------------------------
// recordOverride and clearOverrides
// ---------------------------------------------------------------------------

test('recordOverride anchor copies each listed entry\'s current anchor, and a second call with nothing new returns the same array', () => {
  const row = rowOf(made('a'), made('b'));
  const recorded = recordOverride(row, 'anchor', ['a', 'b'], ROOT);
  assert.deepEqual(recorded.find((p) => p.id === 'a')!.overrides, { anchor: { panel: ROOT, position: 'right', priority: 0 } });
  assert.deepEqual(recorded.find((p) => p.id === 'b')!.overrides, { anchor: { panel: ROOT, position: 'right', priority: 1 } });
  assert.equal(recordOverride(recorded, 'anchor', ['a', 'b'], ROOT), recorded);
});

test('recordOverride formFactor copies the tier of the listed id only', () => {
  const row = rowOf(made('a', { formFactor: 'tablet' }), made('b', { formFactor: 'desktop' }));
  const recorded = recordOverride(row, 'formFactor', ['a'], ROOT);
  assert.deepEqual(recorded.map((p) => p.overrides), [undefined, { formFactor: 'tablet' }, undefined]);
});

test('recordOverride parkable copies collapsible as parkable', () => {
  const row = rowOf(made('a'), made('b', { parkable: false }));
  const recorded = recordOverride(row, 'parkable', ['a', 'b'], ROOT);
  assert.deepEqual(recorded.map((p) => p.overrides), [undefined, { parkable: true }, { parkable: false }]);
});

test('recordOverride skips the root, a marker, an entry with no settings and one whose rememberLayout is false', () => {
  const marker: PanelWindow = { ...made('m'), marker: true };
  const handBuilt: PanelWindow = { id: 'h', url: '', live: true, locked: false, view: 'web', collapsible: true, listed: true };
  const rooted = applyTemplate(createHistoryPanel(ROOT), resolvePanelSettings({}, { root: true }).value, 'create');
  const row = computeRowOrder([rooted, marker, handBuilt, made('r', { rememberLayout: false }), made('ok')], ROOT);
  const ids = row.map((p) => p.id);
  const recorded = recordOverride(row, 'anchor', ids, ROOT);
  assert.deepEqual(recorded.filter((p) => p.overrides !== undefined).map((p) => p.id), ['ok']);
  assert.equal(recordOverride(row, 'anchor', ids.filter((id) => id !== 'ok'), ROOT), row, 'with only the skipped ids nothing changes');
});

test('recordOverride keeps what other keys already hold', () => {
  const row = rowOf(made('a', {}, { overrides: { formFactor: 'tablet' } }));
  assert.deepEqual(recordOverride(row, 'anchor', ['a'], ROOT)[1]!.overrides, { formFactor: 'tablet', anchor: { panel: ROOT, position: 'right', priority: 0 } });
});

test('clearOverrides sets {} on each listed entry that carries settings and leaves the rest', () => {
  const handBuilt: PanelWindow = { id: 'h', url: '', live: true, locked: false, view: 'web', collapsible: true, listed: true };
  const row = computeRowOrder([createHistoryPanel(ROOT), made('a', {}, { overrides: { formFactor: 'tablet' } }), made('b', {}, { overrides: { parkable: false } }), handBuilt], ROOT);
  const cleared = clearOverrides(row, ['a', 'h']);
  assert.deepEqual(cleared.map((p) => p.overrides), [undefined, {}, { parkable: false }, undefined]);
});

test('clearOverrides returns the same array only when every listed entry already holds {}', () => {
  const row = rowOf(made('a', {}, { overrides: {} }), made('b', {}, { overrides: {} }));
  assert.equal(clearOverrides(row, ['a', 'b']), row);
  const mixed = rowOf(made('a', {}, { overrides: {} }), made('b'));
  assert.notEqual(clearOverrides(mixed, ['a', 'b']), mixed, 'an entry with settings and no overrides does not hold {}');
});

// ---------------------------------------------------------------------------
// reconcileWorkspace
// ---------------------------------------------------------------------------

test('reconcile with no file creates each declared panel in declaration order, with {} overrides, applied and no instance', () => {
  const next = counter();
  const result = run({ templates: [tpl('t')], declared: [{ id: 'a', templateId: 't' }, { id: 'b', templateId: 't', url: 'https://b.example' }], freshId: next });
  assert.deepEqual(result.entries.map((p) => p.key), ['a', 'b']);
  assert.deepEqual(result.entries.map((p) => p.id), ['n1', 'n2']);
  assert.deepEqual(result.entries.map((p) => p.declared), [true, true]);
  assert.deepEqual(result.entries.map((p) => p.overrides), [{}, {}]);
  assert.deepEqual(result.entries.map((p) => p.applied), [{ placeOnAdd: 'row-end' }, { placeOnAdd: 'row-end' }]);
  assert.equal('instance' in result.entries[0]!, false);
  assert.equal(result.entries[1]!.url, 'https://b.example');
  assert.equal(result.entries[1]!.view, 't');
});

test('reconcile creates a declared panel from the template layer under the declaration\'s own settings', () => {
  const result = run({ templates: [tpl('t', { formFactor: 'tablet', title: 'From template' })], declared: [{ id: 'a', templateId: 't', settings: { title: 'From declaration' } }] });
  assert.equal(result.entries[0]!.title, 'From declaration');
  assert.equal(result.entries[0]!.formFactor, 'tablet');
});

test('reconcile does not create a declared panel whose key is dismissed, and keeps the tombstone', () => {
  const result = run({ saved: file([], { dismissed: ['b'] }), templates: [tpl('t')], declared: [{ id: 'a', templateId: 't' }, { id: 'b', templateId: 't' }] });
  assert.deepEqual(result.entries.map((p) => p.key), ['a']);
  assert.deepEqual(result.dismissed, ['b']);
});

test('reconcile says so when a declaration names a template that is not registered, and creates nothing for it', () => {
  const result = run({ templates: [], declared: [{ id: 'a', templateId: 'missing' }] });
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.notes.map((n) => n.code), ['unknown-template']);
});

test('reconcile claims the unkeyed 0.1.0 entry of a declared template, so the singleton is not made twice', () => {
  const result = run({ saved: file([savedEntry('x', { view: 't', title: 'old' })]), templates: [tpl('t')], declared: [{ id: 'a', templateId: 't' }] });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]!.key, 'a');
  assert.equal(result.entries[0]!.declared, true);
  assert.equal(result.entries[0]!.title, 'old');
});

test('reconcile claims the entry that carries a declaration\'s key before any unkeyed one', () => {
  const saved = file(line(savedEntry('x', { view: 't', title: 'unkeyed' }), savedEntry('y', { view: 't', title: 'keyed', key: 'a', overrides: {} })));
  const result = run({ saved, templates: [tpl('t', { multiple: true })], declared: [{ id: 'a', templateId: 't' }] });
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries.map((p) => [p.title, p.declared]), [['unkeyed', undefined], ['keyed', true]]);
});

test('reconcile draws every saved id before it draws any other, and the new ids are all distinct from the saved ones', () => {
  const next = counter();
  const saved = file(line(savedEntry('1'), savedEntry('2'), savedEntry('3')));
  const result = run({ saved, templates: [tpl('t')], declared: [{ id: 'a', templateId: 't' }], freshId: next });
  assert.deepEqual(result.entries.map((p) => p.id).sort(), ['n1', 'n2', 'n3', 'n4']);
  assert.equal(result.entries.find((p) => p.key === 'a')!.id, 'n4', 'the declared panel is drawn after the three saved entries');
  assert.equal(next.drawn(), 4);
});

test('reconcile returns only the new entries and skips a saved entry whose key a current entry already holds', () => {
  const current = rowOf(made('keep', {}, { key: 'dup' }));
  const saved = file(line(savedEntry('x', { view: 't', key: 'dup', overrides: {} }), savedEntry('y', { view: 't', key: 'other', overrides: {} })));
  const result = run({ saved, templates: [tpl('t')], current });
  assert.deepEqual(result.entries.map((p) => p.key), ['other']);
});

test('reconcile says a file that is not version 1 was ignored and restores nothing', () => {
  const result = run({ saved: { version: 2, panels: [] }, templates: [tpl('t')], declared: [{ id: 'a', templateId: 't' }] });
  assert.deepEqual(result.notes.map((n) => n.code), ['workspace-ignored']);
  assert.deepEqual(result.entries.map((p) => p.key), ['a'], 'the declared panel is still made');
});

test('reconcile with no settings anywhere hydrates a 0.1.0 entry: no settings, no key, parkable', () => {
  const result = run({ saved: file(line(savedEntry('x'), savedEntry('y', { permanent: true, live: false }))) });
  assert.deepEqual(result.entries.map((p) => p.settings), [undefined, undefined]);
  assert.deepEqual(result.entries.map((p) => [p.collapsible, p.live, p.key]), [[true, true, undefined], [false, true, undefined]]);
});

test('reconcile of a 0.1.0 entry under workspace defaults keeps its saved tier, live flag and anchor, with no overrides to own', () => {
  const saved = file([savedEntry('x', { formFactor: 'tablet', live: false }), savedEntry('y', { anchor: { panel: 'x', position: 'left', priority: 0 } })]);
  const result = run({ saved, workspaceDefaults: {} });
  const byTitle = Object.fromEntries(result.entries.map((p) => [p.title, p]));
  assert.equal(byTitle.x!.formFactor, 'tablet');
  assert.equal(byTitle.x!.live, false);
  assert.deepEqual(titles(result.entries), ['y', 'x'], 'y was saved left of x');
  assert.equal(byTitle.x!.overrides, undefined, 'a 0.1.0 entry owns its anchor and tier');
  assert.equal(byTitle.x!.applied, undefined);
});

// Who owns the place.

const twoTemplates = (first: PanelSettings): PanelTemplate[] => [tpl('t1', first), tpl('t2')];
const placedTwice = (): WorkspacePanelState[] => [
  savedEntry('p1', { view: 't2', overrides: {}, applied: { placeOnAdd: 'row-end' }, anchor: { panel: ROOT, position: 'right', priority: 0 } }),
  savedEntry('p2', { view: 't1', overrides: {}, applied: { placeOnAdd: 'row-end' }, anchor: { panel: ROOT, position: 'right', priority: 1 } }),
];

test('an untouched entry whose default is unchanged keeps its saved place', () => {
  const result = run({ saved: file(placedTwice()), templates: twoTemplates({}) });
  assert.deepEqual(titles(result.entries), ['p1', 'p2']);
});

test('an untouched entry whose default changed follows the new default, and the one whose default did not change keeps its slot', () => {
  const result = run({ saved: file(placedTwice()), templates: twoTemplates({ placeOnAdd: 'row-start' }) });
  assert.deepEqual(titles(result.entries), ['p2', 'p1']);
  assert.deepEqual(result.entries.map((p) => p.applied), [{ placeOnAdd: 'row-start' }, { placeOnAdd: 'row-end' }]);
});

test('an entry that owns its anchor through overrides keeps it when the default changed', () => {
  const owned = placedTwice();
  owned[1] = { ...owned[1]!, overrides: { anchor: { panel: ROOT, position: 'right', priority: 1 } } };
  const result = run({ saved: file(owned), templates: twoTemplates({ placeOnAdd: 'row-start' }) });
  assert.deepEqual(titles(result.entries), ['p1', 'p2']);
  assert.deepEqual(result.entries[1]!.overrides, { anchor: { panel: result.entries[1]!.anchor!.panel, position: 'right', priority: 1 } });
  assert.deepEqual(result.entries[1]!.applied, { placeOnAdd: 'row-end' }, 'the default that placed it is the one it was saved with');
});

test('an overrides.anchor naming another saved entry is re-pointed at that entry\'s fresh id', () => {
  const owned = placedTwice();
  owned[1] = { ...owned[1]!, overrides: { anchor: { panel: 'p1', position: 'left', priority: 0 } } };
  const result = run({ saved: file(owned), templates: twoTemplates({}) });
  assert.deepEqual(titles(result.entries), ['p2', 'p1']);
  assert.equal(result.entries.find((p) => p.title === 'p2')!.overrides!.anchor!.panel, result.entries.find((p) => p.title === 'p1')!.id);
});

// Permission settings gate gestures, not restoring.

test('overrides.formFactor tablet restores at tablet although the template now says resizable false', () => {
  const saved = file([savedEntry('p', { view: 't', overrides: { formFactor: 'tablet' } })]);
  const result = run({ saved, templates: [tpl('t', { resizable: false })] });
  assert.equal(result.entries[0]!.formFactor, 'tablet');
  assert.equal(result.entries[0]!.size?.formFactor, 'tablet');
});

test('an overrides.anchor restores although draggable and placeable are false', () => {
  const saved = file([
    savedEntry('a', { view: 't', overrides: { anchor: { panel: 'b', position: 'right', priority: 0 } } }),
    savedEntry('b', { view: 't', overrides: {}, anchor: { panel: ROOT, position: 'right', priority: 0 } }),
  ]);
  const result = run({ saved, templates: [tpl('t', { draggable: false, placeable: false })] });
  assert.deepEqual(titles(result.entries), ['b', 'a']);
});

test('a tier outside formFactors is dropped with a note and is absent from the overrides that survive', () => {
  const saved = file([savedEntry('p', { view: 't', overrides: { formFactor: 'desktop', anchor: { panel: ROOT, position: 'right', priority: 0 } } })]);
  const result = run({ saved, templates: [tpl('t', { formFactors: ['phone', 'tablet'] })] });
  assert.equal(result.entries[0]!.formFactor, 'phone');
  assert.deepEqual(result.notes.filter((n) => n.code === 'override-dropped').map((n) => n.key), ['formFactor']);
  assert.deepEqual(Object.keys(result.entries[0]!.overrides!), ['anchor']);
  assert.deepEqual(Object.keys(projectWorkspaceState([createHistoryPanel(ROOT), ...result.entries], ROOT).panels[0]!.overrides!), ['anchor'], 'and so absent from the next save');
});

test('rememberLayout false applies none of the stored overrides and carries them through two saves unchanged', () => {
  const overrides = { formFactor: 'tablet' as const, anchor: { panel: ROOT, position: 'right' as const, priority: 0 }, parkable: false };
  const saved = file([savedEntry('p', { view: 't', overrides, applied: { placeOnAdd: 'row-end' } })]);
  const first = run({ saved, templates: [tpl('t', { rememberLayout: false })] });
  assert.equal(first.entries[0]!.formFactor, 'phone');
  assert.equal(first.entries[0]!.collapsible, true);
  const once = projectWorkspaceState([createHistoryPanel(ROOT), ...first.entries], ROOT);
  const second = run({ saved: JSON.parse(JSON.stringify(once)), templates: [tpl('t', { rememberLayout: false })] });
  const twice = projectWorkspaceState([createHistoryPanel(ROOT), ...second.entries], ROOT);
  assert.deepEqual(twice.panels[0]!.overrides, overrides);
});

test('flipping rememberLayout back to true applies the stored overrides', () => {
  const saved = file([savedEntry('p', { view: 't', overrides: { formFactor: 'tablet' } })]);
  assert.equal(run({ saved, templates: [tpl('t', { rememberLayout: false })] }).entries[0]!.formFactor, 'phone');
  assert.equal(run({ saved, templates: [tpl('t', { rememberLayout: true })] }).entries[0]!.formFactor, 'tablet');
});

// overrides.parkable

test('a hand-written overrides.parkable false restores a declared and an anonymous panel fixed: live, phone, the C1 values', () => {
  const saved = file(
    line(
      savedEntry('d', { view: 't', key: 'd', overrides: { parkable: false }, live: false }),
      savedEntry('x', { view: 't', key: 't~x', overrides: { parkable: false }, formFactor: 'tablet', live: false }),
    ),
  );
  const result = run({ saved, templates: [tpl('t', { parkable: true, multiple: true })], declared: [{ id: 'd', templateId: 't' }] });
  assert.equal(result.entries.length, 2);
  for (const p of result.entries) {
    assert.deepEqual([p.collapsible, p.live, p.formFactor, p.settings!.overflow, p.settings!.restoreVisibility], [false, true, 'phone', 'scroll', 'live'], p.key);
  }
});

test('overrides.parkable under rememberLayout false is carried dormant: the panel stays parkable and the file keeps it', () => {
  const saved = file([savedEntry('p', { view: 't', overrides: { parkable: false } })]);
  const result = run({ saved, templates: [tpl('t', { rememberLayout: false })] });
  assert.equal(result.entries[0]!.collapsible, true);
  assert.deepEqual(result.entries[0]!.overrides, { parkable: false });
});

test('overrides.parkable false on a panel whose tier resolves to tablet is dropped with a note', () => {
  const saved = file([savedEntry('p', { view: 't', overrides: { parkable: false, formFactor: 'tablet' } })]);
  const result = run({ saved, templates: [tpl('t')] });
  assert.equal(result.entries[0]!.collapsible, true);
  assert.deepEqual(result.notes.filter((n) => n.code === 'override-dropped').map((n) => n.key), ['parkable']);
  assert.deepEqual(result.entries[0]!.overrides, { formFactor: 'tablet' });
});

test('a malformed overrides.parkable is dropped by the sanitizer and the saved parkable never lands in instance', () => {
  const saved = file([savedEntry('p', { view: 't', overrides: { parkable: 'no' } as never }), savedEntry('q', { view: 't', overrides: { parkable: false } })]);
  const result = run({ saved, templates: [tpl('t')] });
  assert.equal(result.entries[0]!.collapsible, true);
  assert.deepEqual(result.entries[0]!.overrides, {});
  const projected = projectWorkspaceState([createHistoryPanel(ROOT), ...result.entries], ROOT).panels;
  assert.deepEqual(projected.map((p) => p.instance), [{}, {}]);
  assert.deepEqual(projected[1]!.overrides, { parkable: false });
});

// restoreVisibility

for (const restoreVisibility of ['saved', 'live', 'parked'] as const) {
  for (const wasLive of [true, false]) {
    const expected = restoreVisibility === 'saved' ? wasLive : restoreVisibility === 'live';
    test(`restoreVisibility ${restoreVisibility} on a saved ${wasLive ? 'live' : 'parked'} panel restores it ${expected ? 'live' : 'parked'}`, () => {
      const result = run({ saved: file([savedEntry('p', { view: 't', live: wasLive, overrides: {} })]), templates: [tpl('t', { restoreVisibility })] });
      assert.equal(result.entries[0]!.live, expected);
    });
  }
}

test('restoreVisibility live returns a 0.1.0 entry that was saved parked', () => {
  const result = run({ saved: file([savedEntry('p', { live: false })]), workspaceDefaults: { restoreVisibility: 'live' } });
  assert.equal(result.entries[0]!.live, true);
});

test('a fixed column is live whatever it was saved as', () => {
  const result = run({ saved: file([savedEntry('p', { view: 't', live: false, overrides: {} })]), templates: [tpl('t', { parkable: false })] });
  assert.equal(result.entries[0]!.live, true);
});

// closable

test('a saved closable false restores locked for a view no template rebuilds, and a template that says closable true wins over it', () => {
  const unregistered = run({ saved: file([savedEntry('p', { view: 'nobody', closable: false, overrides: {} })]), workspaceDefaults: {} });
  assert.equal(unregistered.entries[0]!.locked, true);
  const registered = run({ saved: file([savedEntry('p', { view: 't', closable: false, overrides: {} })]), templates: [tpl('t', { closable: true })] });
  assert.equal(registered.entries[0]!.locked, false);
  const locked = run({ saved: file([savedEntry('p', { view: 't', overrides: {} })]), templates: [tpl('t', { closable: false })] });
  assert.equal(locked.entries[0]!.locked, true);
});

// lenient restore

test('one entry\'s instance layer holding an unknown key, a wrong type, tuning.rowGap 999 and the removed evictable restores with the valid keys and notes', () => {
  const instance = { title: 'Kept', bogus: 1, listed: 'maybe', tuning: { rowGap: 999 }, evictable: true } as never;
  const saved = file(line(savedEntry('a', { view: 't', instance, overrides: {} }), savedEntry('b', { view: 't', overrides: {} })));
  const result = run({ saved, templates: [tpl('t')] });
  assert.equal(result.entries.length, 2, 'every panel restored');
  assert.equal(result.entries[0]!.title, 'Kept');
  assert.deepEqual(result.entries[0]!.instance, { title: 'Kept' }, 'what was invalid is not carried into the next save');
  const notes = result.notes.filter((n) => n.code === 'invalid-saved-setting');
  assert.deepEqual(notes.map((n) => n.key).sort(), ['bogus', 'evictable', 'listed', 'tuning.rowGap']);
  assert.ok(notes.every((n) => n.panelId === result.entries[0]!.id));
});

test('a wrong-scope key in the instance layer is ignored and leaves the template\'s value', () => {
  const saved = file([savedEntry('a', { view: 't', instance: { maxInstances: 1 } as never, overrides: {} })]);
  const result = run({ saved, templates: [tpl('t', { maxInstances: 3 })] });
  assert.equal(result.entries[0]!.settings!.maxInstances, 3);
});

const settled: { name: string; more: Partial<WorkspacePanelState>; top?: Record<string, unknown>; check: (r: ReturnType<typeof run>) => void }[] = [
  { name: "malformed overrides ('x')", more: { overrides: 'x' as never }, check: (r) => assert.equal(r.entries[0]!.overrides, undefined) },
  { name: 'a malformed applied', more: { overrides: {}, applied: 'row-end' as never }, check: (r) => assert.deepEqual(r.entries[0]!.applied, { placeOnAdd: 'row-end' }) },
  { name: 'a duplicate key', more: { key: 'same', overrides: {} }, check: (r) => assert.equal(r.entries.length, 2) },
  { name: 'dismissed as an object', more: { overrides: {} }, top: { dismissed: {} }, check: (r) => assert.deepEqual(r.dismissed, []) },
  { name: 'a 300-entry dismissed', more: { overrides: {} }, top: { dismissed: Array.from({ length: 300 }, (_, k) => `k${k}`) }, check: (r) => assert.equal(r.dismissed.length, 256) },
];
for (const { name, more, top, check } of settled) {
  test(`${name} ends restored with the row intact`, () => {
    const saved = { ...file(line(savedEntry('a', { view: 't', ...more }), savedEntry('b', { view: 't', key: 'same', overrides: {} }))), ...top };
    const result = run({ saved, templates: [tpl('t', { multiple: true })] });
    assert.deepEqual(titles(result.entries), ['a', 'b']);
    check(result);
  });
}

test('session anchor re-derived: a projected file keeps A, B, C order', () => {
  const session = made('s', { persist: 'session' });
  const row = rowOf(
    session,
    made('A', {}, { anchor: { panel: 's', position: 'right', priority: 0 } }),
    made('B', {}, { anchor: { panel: 's', position: 'right', priority: 1 } }),
    made('C', {}, { anchor: { panel: 's', position: 'right', priority: 2 } }),
    made('D', {}, { anchor: { panel: ROOT, position: 'right', priority: 1 } }),
    made('E', {}, { anchor: { panel: ROOT, position: 'right', priority: 2 } }),
  );
  assert.deepEqual(row.map((p) => p.title ?? p.id), ['History', 's', 'A', 'B', 'C', 'D', 'E'], 'control: the row runs through the session panel');
  const projected = JSON.parse(JSON.stringify(projectWorkspaceState(row, ROOT))) as WorkspaceState;
  assert.equal(projected.panels.some((p) => p.id === 's'), false, 'the session panel is not in the file');
  const result = run({ saved: projected, workspaceDefaults: {} });
  assert.deepEqual(titles(result.entries), ['A', 'B', 'C', 'D', 'E']);
});
