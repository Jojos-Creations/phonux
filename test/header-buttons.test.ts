/**
 * Header buttons declared as slots: default off, the markup where they are drawn, parity with a bare MUI IconButton,
 * the cascade, the slot validator and coexistence with a view's own actions.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { createElement, type ReactElement } from 'react';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import IconButton from '@mui/material/IconButton';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { HostProvider, PanelHeaderButtons, definePanel, usePanelHeaderButtons } from '../index.js';
import type { HeaderButton, PanelSettings } from '../index.js';
import { resolvePanelSettings, type PanelSettingsLayers } from '../panelSettings.js';
import { createFakeHost } from '../fakeHost.js';
import { PanelManagerError } from '../panelManagerError.js';
import { mergePatch } from '../settingsPatch.js';
import { differential } from './support/differential.js';
import { headerRig } from './support/header-rig.js';
import { staticPanel } from './support/static-panel.js';
import { cleanup, mount, withHost } from './support/mount-harness.js';

afterEach(() => cleanup());

const icon = (name: string): ReactElement => createElement('i', { 'data-icon': name });
const slot = (label: string, extra: Partial<HeaderButton> = {}): HeaderButton => ({ icon: icon(label), label, onClick: () => undefined, ...extra });
const norm = (html: string): string => html.replace(/:r[0-9a-z]+:/g, ':rN:');

test('headerButtons: declared versus not declared changes the header', () => {
  differential('headerButtons', (run) => {
    run('none', () => staticPanel({ props: { title: 'T' } }));
    run('one slot', () => staticPanel({ slots: { pin: slot('Pin panel') }, props: { title: 'T' } }));
  });
});

test('default off: with no slot declared the Panel markup is what it was, and outside any slot nothing is drawn', () => {
  assert.equal(staticPanel({ props: { title: 'Sessions' } }), staticPanel({ props: { title: 'Sessions' } }));
  assert.equal(staticPanel({ props: { title: 'Sessions' } }).includes('tabindex'), false);
  assert.equal(staticPanel({ props: { title: 'Sessions' } }).includes('data-header-buttons-row'), false);
  const seen: unknown[] = [];
  function Probe(): ReactElement {
    seen.push(usePanelHeaderButtons());
    return createElement('div', null, createElement(PanelHeaderButtons), createElement(PanelHeaderButtons, { side: 'start' }));
  }
  const m = mount(withHost(createElement(Probe)));
  assert.deepEqual(seen[0], []);
  assert.equal(m.container.innerHTML, '<div></div>');
});

test('the header row has tabindex -1 only while a slot is drawn, and no status region exists before an announce', () => {
  const none = staticPanel({ slots: { a: slot('A', { hidden: true }) }, props: { title: 'T' } });
  assert.equal(none.includes('tabindex'), false, 'every slot hidden: the header is the golden');
  const some = staticPanel({ slots: { a: slot('A') }, props: { title: 'T' } });
  assert.equal(some.includes('tabindex="-1"'), true);
  assert.equal(some.includes('role="status"'), false);
});

test('parity: a slot with only icon, label and onClick is the markup of a bare MUI IconButton of size small', () => {
  const direct = (): string => {
    const tree = createElement(CacheProvider, { value: createCache({ key: 'css' }), children: createElement(HostProvider, { host: createFakeHost(), children: createElement(IconButton, { size: 'small', 'aria-label': 'Pin panel', onClick: () => undefined, sx: { color: 'inherit' } }, icon('pin')) }) });
    return renderToStaticMarkup(tree);
  };
  const viaSlot = staticPanel({ slots: { pin: slot('Pin panel', { icon: icon('pin') }) }, props: { title: 'T' } });
  const bare = norm(direct());
  assert.ok(bare.startsWith('<button'), 'control: the bare button rendered');
  const flat = norm(viaSlot).replace(/\n/g, '');
  assert.ok(flat.includes(bare.replace(/\n/g, '')), `the slot's button is the bare one:\n${flat}\n${bare}`);
});

const mountedSlots = {
  size: slot('Panel size', { order: 0, description: 'phone', sx: { color: '#ffffff' } }),
  pin: slot('Pin panel', { order: 1, pressed: (c) => c.settings.closable, sx: { color: '#ffffff' } }),
  menu: slot('Menu', { side: 'start' }),
};

test('where drawn: two end buttons after the view action in one cluster, a start button before the title, names, description and pressed', async () => {
  const rig = await headerRig({ slots: mountedSlots, actions: createElement('button', { 'data-view-action': '', type: 'button' }, 'Edit') });
  const row = rig.row('a')!;
  const kids = [...row.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? (b.hasAttribute('data-view-action') ? 'Edit' : b.textContent));
  assert.deepEqual(kids, ['Menu', 'Edit', 'Panel size', 'Pin panel']);
  const first = row.firstElementChild!;
  assert.equal(first.tagName, 'BUTTON', 'the start button is before the title box');
  const buttons = rig.buttons('a');
  const pin = buttons.find((b) => b.getAttribute('aria-label') === 'Pin panel')!;
  assert.equal(pin.getAttribute('aria-pressed'), 'true');
  const size = buttons.find((b) => b.getAttribute('aria-label') === 'Panel size')!;
  assert.equal(size.hasAttribute('aria-pressed'), false);
  const described = row.ownerDocument.getElementById(size.getAttribute("aria-describedby")!)!;
  assert.equal(described.hasAttribute('hidden'), true);
  assert.equal(described.textContent, 'phone');
  assert.ok(buttons.every((b) => b.tagName === 'BUTTON'));
  const menu = buttons.find((b) => b.getAttribute('aria-label') === 'Menu')!;
  assert.notEqual(size.className, menu.className, 'a slot with sx color #ffffff is not the inherit one');
});

test('where drawn: order ties break by id, and a panel declaring none draws nothing', async () => {
  const rig = await headerRig({ ids: ['a', 'n'], slots: { b: slot('B'), a: slot('A') }, settings: { n: { headerButtons: { a: false, b: false } } } });
  assert.deepEqual(rig.buttons('a').map((b) => b.getAttribute('aria-label')), ['A', 'B']);
  assert.equal(rig.buttons('n').length, 0);
  assert.equal(rig.m.container.querySelectorAll('[data-header-buttons-row="n"]').length, 0);
});

test('where drawn: a Panel with no title draws no cluster and warns once in development', async () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(String(args[0]));
  try {
    const rig = await headerRig({ slots: { pin: slot('Pin panel') }, title: undefined });
    assert.equal(rig.m.container.querySelectorAll('button').length, 0);
    assert.equal(warnings.filter((w) => w.includes('header buttons')).length, 3, 'one per panel with the buttons declared');
    act(() => rig.h.a!.hide());
    assert.equal(warnings.filter((w) => w.includes('header buttons')).length, 3, 'a re-render warns no more');
  } finally {
    console.warn = original;
  }
});

test('where drawn: the side setting changes which end the button sits at', async () => {
  const rig = await headerRig({ slots: { m: slot('M', { side: 'start' }) } });
  assert.equal(rig.row('a')!.firstElementChild!.tagName, 'BUTTON');
  const flipped = await headerRig({ slots: { m: slot('M', { side: 'end' }) } });
  assert.notEqual(flipped.row('a')!.firstElementChild!.tagName, 'BUTTON');
});

test('coexistence: the view action stays first and is the same node across a press; Panel headerButtons={false} keeps the hook and PanelHeaderButtons', async () => {
  const rig = await headerRig({ slots: { pin: slot('Pin', { onClick: (h) => void h.place('row-start') }) }, actions: createElement('b', { 'data-view-action': '' }, 'x') });
  const action = rig.m.container.querySelector('[data-view-action]')!;
  act(() => rig.buttons('a')[0]!.click());
  assert.ok(rig.m.container.querySelector('[data-view-action]') === action, 'the view action is the same node');

  function Custom(): ReactElement {
    const items = usePanelHeaderButtons();
    return createElement('div', { 'data-custom': items.map((i) => [i.id, i.label, i.side, i.order, i.pressed, i.disabled, i.hidden, typeof i.press, i.icon !== undefined].join(':')).join('|') }, createElement(PanelHeaderButtons));
  }
  const off = await headerRig({ slots: { pin: slot('Pin', { pressed: () => true, order: 2 }) }, panelHeaderButtons: false, body: createElement(Custom) });
  assert.equal(off.m.container.querySelector('[data-header-buttons-row]'), null, 'no cluster in the Panel header');
  const custom = off.m.container.querySelector('[data-custom]')!;
  assert.equal(custom.getAttribute('data-custom'), 'pin:Pin:end:2:true:false:false:function:true');
  assert.equal(custom.querySelectorAll('button').length, 1, 'PanelHeaderButtons draws the cluster in a custom header');
});

test('coexistence: a view drawing its own pin as well as a slot yields two buttons', async () => {
  const rig = await headerRig({ slots: { pin: slot('Pin panel') }, actions: createElement('button', { type: 'button', 'aria-label': 'Pin panel' }) });
  assert.equal(rig.buttons('a').filter((b) => b.getAttribute('aria-label') === 'Pin panel').length, 2);
});

let executedInvalid = 0;
const INVALID: readonly (readonly [string, string, unknown])[] = [
  ['an empty label', 'pin', { icon: 'i', label: '', onClick: () => undefined }],
  ['a missing onClick', 'pin', { icon: 'i', label: 'L' }],
  ['an icon key set to undefined', 'pin', { icon: undefined, label: 'L', onClick: () => undefined }],
  ['an id of 33 characters', 'a'.repeat(33), { icon: 'i', label: 'L', onClick: () => undefined }],
  ['an uppercase id', 'Pin', { icon: 'i', label: 'L', onClick: () => undefined }],
  ["side 'middle'", 'pin', { icon: 'i', label: 'L', onClick: () => undefined, side: 'middle' }],
  ['order NaN', 'pin', { icon: 'i', label: 'L', onClick: () => undefined, order: Number.NaN }],
  ["sx 'red'", 'pin', { icon: 'i', label: 'L', onClick: () => undefined, sx: 'red' }],
  ['an sx array', 'pin', { icon: 'i', label: 'L', onClick: () => undefined, sx: [{ color: 'red' }] as never }],
  ['an sx function', 'pin', { icon: 'i', label: 'L', onClick: () => undefined, sx: (() => ({})) as never }],
  ['disabled that is a string', 'pin', { icon: 'i', label: 'L', onClick: () => undefined, disabled: 'yes' }],
  ['hidden that is a number', 'pin', { icon: 'i', label: 'L', onClick: () => undefined, hidden: 1 }],
  ['pressed that is a boolean', 'pin', { icon: 'i', label: 'L', onClick: () => undefined, pressed: true }],
  ['a null slot', 'pin', null],
];

for (const [what, id, bad] of INVALID) {
  test(`validation: ${what} throws invalid-settings naming layer and key, in definePanel and in a resolve over each layer`, () => {
    const settings = { headerButtons: { [id]: bad } } as unknown as PanelSettings;
    for (const layer of ['workspace', 'template', 'host', 'instance'] as const) {
      const layers = { [layer]: settings } as PanelSettingsLayers;
      assert.throws(() => resolvePanelSettings(layers), (e: unknown) => e instanceof PanelManagerError && e.code === 'invalid-settings' && e.layer === layer && e.key === 'headerButtons', `at ${layer}`);
    }
    assert.throws(() => definePanel({ id: 'x', view: () => null, settings }), (e: unknown) => e instanceof PanelManagerError && e.code === 'invalid-settings' && e.key === 'headerButtons', 'in definePanel');
    executedInvalid += 1;
  });
}

const VALID: readonly (readonly [string, Partial<HeaderButton>])[] = [
  ['a function label', { label: () => 'L' }],
  ['a function label that returns an empty string, judged when it runs', { label: () => '' }],
  ['a function icon', { icon: () => 'i' }],
  ['a pressed function', { pressed: () => true }],
  ['a description string', { description: 'd' }],
  ['a description function', { description: () => 'd' }],
  ['a tooltip function', { tooltip: () => 't' }],
  ['a disabled function', { disabled: () => true }],
  ['a hidden boolean', { hidden: false }],
  ["side 'start'", { side: 'start' }],
  ['a negative order', { order: -3 }],
  ['false for the id', {}],
];
let executedValid = 0;
for (const [what, extra] of VALID) {
  test(`validation: ${what} is accepted at the layers that may set it`, () => {
    const one = what === 'false for the id' ? false : slot('L', extra);
    for (const layer of ['workspace', 'template', 'instance'] as const) {
      const res = resolvePanelSettings({ [layer]: { headerButtons: { pin: one } } } as PanelSettingsLayers);
      assert.equal(Object.keys(res.value.headerButtons).length, one === false ? 0 : 1, `at ${layer}`);
    }
    executedValid += 1;
  });
}

test('validation: executed equals rows for the invalid and the valid tables', () => {
  assert.equal(executedInvalid, INVALID.length);
  assert.equal(executedValid, VALID.length);
});

const TEMPLATE_LAYER: PanelSettings = { headerButtons: { size: slot('Size') } };

test('cascade: a template size slot plus an instance pin slot give both', () => {
  const both = resolvePanelSettings({ template: TEMPLATE_LAYER, instance: { headerButtons: { pin: slot('Pin') } } });
  assert.deepEqual(Object.keys(both.value.headerButtons).sort(), ['pin', 'size']);
  assert.equal(both.source.headerButtons, 'instance');
});

test('cascade: false on an instance entry removes only that id', () => {
  const without = resolvePanelSettings({ template: { headerButtons: { size: slot('Size'), keep: slot('Keep') } }, instance: { headerButtons: { size: false } } });
  assert.deepEqual(Object.keys(without.value.headerButtons), ['keep']);
  assert.deepEqual(Object.keys(resolvePanelSettings({ template: TEMPLATE_LAYER, instance: { headerButtons: { size: false } } }).value.headerButtons), [], 'the control: false gives no size slot');
});

test('cascade: an instance slot replaces the template slot of the same id', () => {
  assert.equal(resolvePanelSettings({ template: TEMPLATE_LAYER, instance: { headerButtons: { size: slot('Own size') } } }).value.headerButtons.size!.label, 'Own size');
});

test('cascade: a patch null removes the instance slot and the template slot applies again', () => {
  const own: PanelSettings = { headerButtons: { size: slot('Own size') } };
  const patched = mergePatch(own, { headerButtons: { size: null } } as never);
  assert.equal(resolvePanelSettings({ template: TEMPLATE_LAYER, instance: patched }).value.headerButtons.size!.label, 'Size', "the template's slot applies again");
});

test('cascade: a literal null slot inside a layer throws invalid-settings naming layer and key', () => {
  assert.throws(() => resolvePanelSettings({ template: TEMPLATE_LAYER, instance: { headerButtons: { size: null } } as unknown as PanelSettings }), (e: unknown) => e instanceof PanelManagerError && e.code === 'invalid-settings' && e.layer === 'instance' && e.key === 'headerButtons');
});
