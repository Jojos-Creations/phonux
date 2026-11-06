/**
 * What pressing a header button does: the handle the function receives, the person's gesture versus code, the
 * refusals, and what a failing function, label, icon or press leaves behind.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act, createElement, type ReactElement } from 'react';
import type { HeaderButton, PanelResult, SettingNote } from '../index.js';
import { memoryWorkspaceStorage } from '../fakeHost.js';
import { cleanup } from './support/mount-harness.js';
import { headerRig, type HeaderRig } from './support/header-rig.js';

afterEach(() => {
  mock.restoreAll();
  cleanup();
  cycleAt.clear();
});

const quiet = { tuning: { saveQuietMs: 5 } };
const wait = (): Promise<void> => act(async () => void (await new Promise((done) => setTimeout(done, 80))));
const icon = (name: string): ReactElement => createElement('i', { 'data-icon': name });
const slot = (label: string, extra: Partial<HeaderButton> = {}): HeaderButton => ({ icon: icon(label), label, onClick: () => undefined, ...extra });
const press = (rig: HeaderRig, panel: string, label: string): void => void act(() => rig.buttons(panel).find((b) => b.getAttribute('aria-label') === label)!.click());
/** A storage holding a file with one unchanged panel under `key`, so a test that expects no override reads a file that exists. */
const fileWith = (key: string): ReturnType<typeof memoryWorkspaceStorage> =>
  memoryWorkspaceStorage({
    version: 1,
    root: 'root',
    panels: [{ id: '1', uid: 'u_00000000000000000000000000000001', key, view: key, url: '', live: true, anchor: { panel: 'root', position: 'right', priority: 0 }, instance: {}, overrides: {}, applied: { placeOnAdd: 'row-end' } }],
  });

const overridesOf = async (store: ReturnType<typeof memoryWorkspaceStorage>): Promise<Array<Record<string, unknown>>> => ((await store.load())?.panels ?? []).map((p) => p.overrides as Record<string, unknown>);
/** Where each panel's size button stands, since a handle does not report its slot count: one, two, three, then one again. */
const cycleAt = new Map<string, number>();
const cycle = (h: { id: string; setSlots(n: number): PanelResult }): PanelResult => {
  const next = ((cycleAt.get(h.id) ?? 1) % 3) + 1;
  const result = h.setSlots(next);
  if (result.ok) cycleAt.set(h.id, next);
  return result;
};

test('click: onClick gets this panel\'s handle and nothing else', async () => {
  const seen: Array<{ keys: string[]; id: string; ctxKeys: string[] }> = [];
  const rig = await headerRig({ slots: { probe: slot('Probe', { onClick: (h, c) => void seen.push({ keys: Object.keys(h), id: h.id, ctxKeys: Object.keys(c).sort() }) }) } });
  press(rig, 'b', 'Probe');
  assert.deepEqual(seen[0]!.keys, Object.keys(rig.ws.panels.get('b')!), "the keys of the handle the panel's own view receives");
  assert.equal(seen[0]!.keys.includes('manager'), false);
  assert.equal(seen[0]!.id, 'b');
  assert.deepEqual(seen[0]!.ctxKeys, ['announce', 'settings', 'state']);
});

test('click: a size slot cycles one, two, three, one slots as one resize per press and never parks the panel', async () => {
  let resizes = 0;
  const rig = await headerRig({ ids: ['a'], slots: { size: slot('Size', { onClick: (h) => void cycle(h) }) }, over: { onPanelResize: () => void (resizes += 1) } });
  const widths: number[] = [rig.entry('a').slots ?? 1];
  for (let i = 0; i < 3; i += 1) {
    press(rig, 'a', 'Size');
    widths.push(rig.entry('a').slots ?? 1);
    assert.equal(rig.state('a').status, 'live', 'the resized panel is not parked');
  }
  assert.deepEqual(widths, [1, 2, 3, 1]);
  assert.equal(resizes, 3, 'one resize per press');
});

test('click: a refused verb returns its typed code to the function, the library renders nothing for it, and announce writes a polite status', async () => {
  const records: PanelResult[] = [];
  const notes: SettingNote[] = [];
  const rig = await headerRig({
    ids: ['a'],
    settings: { a: { resizable: false } },
    onNote: (n) => void notes.push(n),
    slots: { size: slot('Size', { onClick: (h, c) => { const r = cycle(h); records.push(r); if (!r.ok) c.announce(`cannot: ${r.code}`); } }) },
  });
  assert.equal(rig.m.container.querySelector('[role="status"]'), null, 'no status region before an announce');
  const before = rig.buttons('a').length;
  press(rig, 'a', 'Size');
  assert.equal(records[0]!.ok, false);
  assert.equal(records[0]!.ok === false && records[0]!.code, 'not-resizable');
  assert.equal(rig.buttons('a').length, before);
  assert.deepEqual(notes, []);
  const status = rig.m.container.querySelector('[role="status"]')!;
  assert.equal(status.textContent, 'cannot: not-resizable');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.equal(status.parentElement!.lastElementChild, status, "the cluster's last child");
});

test('click: a second press in one turn gets busy from the verb', async () => {
  const results: PanelResult[] = [];
  const rig = await headerRig({ ids: ['a'], slots: { size: slot('Size', { onClick: (h) => void results.push(cycle(h)) }) } });
  const button = rig.buttons('a')[0]!;
  act(() => {
    button.click();
    button.click();
  });
  assert.deepEqual(results.map((r) => (r.ok ? 'ok' : r.code)), ['ok', 'busy']);
});

test('person: a press records the person\'s anchor and form factor; a place after an await and a place from code record nothing', async () => {
  const pin = (extra: Partial<HeaderButton> = {}): HeaderButton => slot('Pin', { onClick: (h) => void h.place('row-start'), ...extra });
  const store = memoryWorkspaceStorage();
  const rig = await headerRig({ ids: ['c', 'd'], workspace: { storage: store, ...quiet }, slots: { pin: pin(), size: slot('Size', { onClick: (h) => void cycle(h) }) } });
  press(rig, 'c', 'Pin');
  press(rig, 'd', 'Size');
  await wait();
  const [saved, sized] = (await overridesOf(store)) as [{ anchor?: unknown }, { slots?: number }];
  assert.ok(saved.anchor !== undefined, 'overrides.anchor');
  assert.equal(sized.slots, 2, 'overrides.slots');

  cleanup();
  const later = fileWith('c');
  const after = await headerRig({ ids: ['c'], workspace: { storage: later, ...quiet }, slots: { pin: slot('Pin', { onClick: async (h) => { await Promise.resolve(); h.place('row-start'); } }) } });
  press(after, 'c', 'Pin');
  await wait();
  assert.equal(after.entry('c').anchor?.position, 'left', 'the place itself still ran');
  assert.deepEqual(await overridesOf(later), [{}], 'a verb after an await is code');

  cleanup();
  const code = fileWith('c');
  const fromCode = await headerRig({ ids: ['c'], workspace: { storage: code, ...quiet }, slots: { pin: pin() } });
  fromCode.turn(() => fromCode.h.c!.place('row-start'));
  await wait();
  assert.deepEqual(await overridesOf(code), [{}], 'handle.place() from code');
});

test('safety: a throwing onClick and a rejecting promise reach onError with the row unchanged; without onError it is console.error', async () => {
  const errors: unknown[] = [];
  const boom = new Error('boom');
  const rig = await headerRig({ slots: { bad: slot('Bad', { onClick: () => { throw boom; } }), late: slot('Late', { onClick: () => Promise.reject(boom) }) }, workspace: { onError: (e) => void errors.push(e) } });
  const before = rig.m.latest().entries;
  press(rig, 'a', 'Bad');
  press(rig, 'a', 'Late');
  await act(async () => void (await Promise.resolve()));
  assert.deepEqual(errors, [boom, boom]);
  const after = rig.m.latest().entries;
  assert.equal(before.length, after.length);
  assert.ok(before.every((e, i) => e === after[i]), 'every entry is reference-equal');

  cleanup();
  const spy = mock.method(console, 'error', () => {});
  const plain = await headerRig({ slots: { bad: slot('Bad', { onClick: () => { throw boom; } }) } });
  press(plain, 'a', 'Bad');
  assert.ok(spy.mock.calls.some((c) => c.arguments[0] === boom), 'console.error when onError is unset');
});

function Throwing(): ReactElement {
  throw new Error('icon render failed');
}

const FAILING: readonly (readonly [string, string, Partial<HeaderButton>])[] = [
  ['a throwing icon function', 'iconfn', { icon: () => { throw new Error('icon fn'); } }],
  ['a throwing label function', 'labelfn', { label: () => { throw new Error('label fn'); } }],
  ['an icon element whose component throws in its own render', 'element', { icon: createElement(Throwing) }],
  ['a label function returning an empty string', 'empty', { label: () => '' }],
];
for (const [what, id, extra] of FAILING) {
  test(`safety: ${what} hides only that slot and delivers one header-button-error note`, async () => {
    mock.method(console, 'error', () => {});
    const notes: SettingNote[] = [];
    const rig = await headerRig({ ids: ['a'], onNote: (n) => void notes.push(n), slots: { [id]: slot('Broken', extra), fine: slot('Fine') } });
    assert.deepEqual(rig.buttons('a').map((b) => b.getAttribute('aria-label')), ['Fine'], 'the panel and the other slot render');
    act(() => void rig.h.a!.setSlots(2));
    await wait();
    assert.equal(notes.length, 1, 'once per slot per failure');
    assert.equal(notes[0]!.code, 'header-button-error');
    assert.equal(notes[0]!.panelId, 'a');
    assert.equal(notes[0]!.key, 'headerButtons');
    assert.ok(notes[0]!.message.includes(`'${id}'`));
  });
}

test('safety: a disabled slot stays focusable with aria-disabled and its press calls nothing; a hidden slot is not rendered', async () => {
  const calls: string[] = [];
  const rig = await headerRig({ ids: ['a'], slots: { off: slot('Off', { disabled: true, onClick: () => void calls.push('off') }), gone: slot('Gone', { hidden: () => true, onClick: () => void calls.push('gone') }), on: slot('On', { onClick: () => void calls.push('on') }) } });
  const labels = rig.buttons('a').map((b) => b.getAttribute('aria-label'));
  assert.deepEqual(labels, ['Off', 'On']);
  const off = rig.buttons('a')[0]!;
  assert.equal(off.getAttribute('aria-disabled'), 'true');
  assert.equal(off.hasAttribute('disabled'), false);
  assert.equal(off.getAttribute('tabindex'), '-1', 'the one tab stop is the first enabled button');
  act(() => off.focus());
  assert.equal(off.ownerDocument.activeElement, off, 'a disabled button still takes focus');
  act(() => off.click());
  assert.deepEqual(calls, []);
  press(rig, 'a', 'On');
  assert.deepEqual(calls, ['on']);
});

test('safety: the slot of a panel that is leaving is inert and its press reaches no verb', async () => {
  const calls: string[] = [];
  const rig = await headerRig({ ids: ['a'], slots: { go: slot('Go', { onClick: (h) => void calls.push(`go:${String(h.hide().ok)}`) }) } });
  const button = rig.buttons('a')[0]!;
  act(() => void rig.h.a!.hide());
  assert.ok(button.isConnected, 'the exit is still running');
  act(() => button.click());
  assert.deepEqual(calls, []);
});
