/**
 * The two forms of a header button: the icon form (an `icon` key) and the text form (no `icon` key, the label drawn as
 * the text). Their types, validator, listing, drawing, long labels and the chrome fade.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { MotionConfig } from 'motion/react';
import { act, createElement, type ReactElement } from 'react';
import { PanelHeaderButtons, resolvePanelSettings, usePanelHeaderButtons } from '../index.js';
import type { HeaderButton, PanelHeaderButtonItem } from '../index.js';
import { CHROME_ATTRIBUTE } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { headerRig } from './support/header-rig.js';

afterEach(() => cleanup());

const icon = (name: string): ReactElement => createElement('i', { 'data-icon': name });
const iconSlot = (label: string, extra: Partial<HeaderButton> = {}): HeaderButton => ({ icon: icon(label), label, onClick: () => undefined, ...extra }) as HeaderButton;
const textSlot = (label: string, extra: Partial<HeaderButton> = {}): HeaderButton => ({ label, onClick: () => undefined, ...extra }) as HeaderButton;

/** MUI opens a tooltip after a real-time enter delay, which the frame clock does not advance. */
const tipDelay = (): Promise<void> => act(async () => void (await new Promise((r) => setTimeout(r, 250))));

const resolveWith = (headerButtons: Record<string, unknown>) => () => resolvePanelSettings({ template: { headerButtons: headerButtons as never } } as never);

test('types: either form is a button, and a second text field or a missing label is rejected at compile time', () => {
  const asIcon: HeaderButton = { icon: icon('x'), label: 'X', onClick: () => undefined };
  const asText: HeaderButton = { label: 'X', onClick: () => undefined };
  // @ts-expect-error the label is the text; there is no second text field
  const extra: HeaderButton = { label: 'X', text: 'x', onClick: () => undefined };
  // @ts-expect-error a button with neither a label nor an onClick is not a button
  const neither: HeaderButton = { icon: icon('x') };
  const narrowed = (item: PanelHeaderButtonItem): undefined => (item.form === 'text' ? item.icon : undefined);
  assert.ok(asIcon && asText && extra && neither && narrowed);
});

test('validator: the text form is accepted, and an icon key set to undefined is rejected with the same error shape', () => {
  assert.doesNotThrow(resolveWith({ t: textSlot('Save') }));
  assert.doesNotThrow(resolveWith({ i: iconSlot('Save'), t: textSlot('Save text') }));
  assert.throws(resolveWith({ t: { icon: undefined, label: 'Save', onClick: () => undefined } }), /slot 't': icon must not be undefined; leave it out for a text button/);
  assert.throws(resolveWith({ t: textSlot('') }), /slot 't': label must be a non-empty string or a function/);
  assert.throws(resolveWith({ t: { label: 'Save' } }), /slot 't': onClick must be a function/);
});

test('listing: each item names its form, and the text form has no icon', async () => {
  const seen: PanelHeaderButtonItem[][] = [];
  function Custom(): ReactElement {
    seen.push([...usePanelHeaderButtons()]);
    return createElement('span');
  }
  const rig = await headerRig({ ids: ['a'], slots: { i: iconSlot('Icon one'), t: textSlot('Text one'), n: iconSlot('Null icon', { icon: () => null }) }, body: createElement(Custom) });
  const items = seen[seen.length - 1]!;
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId.i!.form, 'icon');
  assert.equal(byId.i!.icon !== undefined, true);
  assert.equal(byId.t!.form, 'text');
  assert.equal(byId.t!.icon, undefined);
  assert.equal(byId.n!.form, 'icon', 'an icon function that returns null is still the icon form');
  assert.equal(byId.n!.icon, null);
  assert.equal(rig.buttons('a').length, 3);
});

test('drawn: a text button shows its label as text and as its accessible name, and an icon button shows no text', async () => {
  const rig = await headerRig({ ids: ['a'], slots: { i: iconSlot('Pin panel', { order: 0 }), t: textSlot('Save draft', { order: 1 }) } });
  const [pin, save] = rig.buttons('a');
  assert.equal(pin!.getAttribute('aria-label'), 'Pin panel');
  assert.equal(pin!.textContent, '');
  assert.equal(save!.getAttribute('aria-label'), 'Save draft');
  assert.equal(save!.textContent, 'Save draft');
  assert.equal(save!.querySelector('i'), null);
});

test('drawn: a text button is at least 24 px high and keeps its case', async () => {
  const rig = await headerRig({ ids: ['a'], slots: { t: textSlot('Save draft') } });
  const style = getComputedStyle(rig.buttons('a')[0]!);
  assert.equal(style.minHeight, '24px');
  assert.equal(style.textTransform, 'none');
});

test('behaviour: press, pressed, disabled, description, side, order and the roving tab stop work for a text button as for an icon button', async () => {
  const presses: string[] = [];
  const rig = await headerRig({
    ids: ['a'],
    slots: {
      m: iconSlot('Menu', { side: 'start', onClick: () => void presses.push('m') }),
      t: textSlot('Edit', { pressed: () => true, description: 'Edits the draft', order: 2, onClick: () => void presses.push('t') }),
      d: textSlot('Locked', { disabled: true, order: 3, onClick: () => void presses.push('d') }),
      i: iconSlot('Info', { order: 1 }),
    },
  });
  assert.deepEqual(rig.buttons('a').map((b) => b.getAttribute('aria-label')), ['Menu', 'Info', 'Edit', 'Locked']);
  const [, , edit, locked] = rig.buttons('a');
  assert.equal(edit!.getAttribute('aria-pressed'), 'true');
  assert.equal(rig.m.container.ownerDocument.getElementById(edit!.getAttribute('aria-describedby')!)!.textContent, 'Edits the draft');
  act(() => edit!.click());
  act(() => locked!.click());
  assert.deepEqual(presses, ['t'], 'a disabled text button takes a press and does nothing');
  assert.equal(locked!.getAttribute('aria-disabled'), 'true');
  assert.deepEqual(rig.buttons('a').map((b) => b.tabIndex), [0, -1, -1, -1], 'one tab stop in the cluster');
  act(() => edit!.focus());
  assert.deepEqual(rig.buttons('a').map((b) => b.tabIndex), [-1, -1, 0, -1]);
  act(() => void edit!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, rig.buttons('a')[1], 'arrow keys rove across both forms');
});

test('long label: the text is clipped with an ellipsis, capped in width, and the full label becomes the tooltip only when clipped', async () => {
  const long = 'A very long header button label that cannot fit';
  const span = (rig: Awaited<ReturnType<typeof headerRig>>): HTMLElement => rig.buttons('a')[0]!.querySelector<HTMLElement>('[data-header-button-text]')!;
  const proto = HTMLElement.prototype;
  const widths = { scroll: 0, client: 0 };
  Object.defineProperty(proto, 'scrollWidth', { configurable: true, get() { return (this as HTMLElement).hasAttribute('data-header-button-text') ? widths.scroll : 0; } });
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return (this as HTMLElement).hasAttribute('data-header-button-text') ? widths.client : 0; } });
  try {
    widths.scroll = 100;
    widths.client = 100;
    const fits = await headerRig({ ids: ['a'], slots: { t: textSlot(long) } });
    act(() => void fits.buttons('a')[0]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    await tipDelay();
    assert.equal(document.querySelector('[role="tooltip"]'), null, 'a label that fits gets no tooltip');
    cleanup();
    widths.scroll = 500;
    widths.client = 100;
    const clipped = await headerRig({ ids: ['a'], slots: { t: textSlot(long) } });
    const style = getComputedStyle(span(clipped));
    assert.equal(style.textOverflow, 'ellipsis');
    assert.equal(style.overflow, 'hidden');
    assert.equal(style.whiteSpace, 'nowrap');
    assert.equal(getComputedStyle(clipped.buttons('a')[0]!).maxWidth, '9em');
    act(() => void clipped.buttons('a')[0]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    await tipDelay();
    assert.equal(document.querySelector('[role="tooltip"]')?.textContent, long);
    assert.equal(clipped.buttons('a')[0]!.getAttribute('aria-label'), long, 'the accessible name stays the label');
    cleanup();
    const declared = await headerRig({ ids: ['a'], slots: { t: textSlot(long, { tooltip: 'Own tip' }) } });
    act(() => void declared.buttons('a')[0]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    await tipDelay();
    assert.equal(document.querySelector('[role="tooltip"]')?.textContent, 'Own tip', 'a declared tooltip wins');
  } finally {
    delete (proto as unknown as Record<string, unknown>).scrollWidth;
    delete (proto as unknown as Record<string, unknown>).clientWidth;
  }
});

test('long label: the title truncates before a button does, so the cluster never shrinks', async () => {
  const rig = await headerRig({ ids: ['a'], title: 'A panel title that is far too long for a phone wide header', slots: { t: textSlot('Save draft'), i: iconSlot('Pin') } });
  const row = rig.row('a')!;
  const title = [...row.children].find((c) => getComputedStyle(c).textOverflow === 'ellipsis')!;
  assert.equal(getComputedStyle(title).minWidth, '0');
  assert.equal(getComputedStyle(rig.buttons('a')[0]!.parentElement!).flexShrink, '0', 'the button cluster does not shrink');
});

test('chrome fade: a text button sits in the header part and fades with an icon button, at 0, partway and 1', async () => {
  const rig = await headerRig({ ids: ['a'], slots: { i: iconSlot('Pin', { order: 0 }), t: textSlot('Save', { order: 1 }) }, workspace: { tuning: { chrome: { mode: 'hover-or-active', fadeMs: 400 } } } });
  const header = rig.m.container.querySelector<HTMLElement>(`[${CHROME_ATTRIBUTE}="header"]`)!;
  assert.ok(rig.buttons('a').every((b) => header.contains(b)), 'both forms are inside the faded header part');
  assert.equal(header.style.opacity, '0');
  const panelRoot = header.parentElement!;
  act(() => void panelRoot.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, relatedTarget: document.body })));
  await advanceFrames(100);
  const mid = Number(header.style.opacity);
  assert.ok(mid > 0 && mid < 1, `partway through the fade (${mid})`);
  await advanceFrames(800);
  assert.equal(header.style.opacity, '1');
  act(() => void panelRoot.dispatchEvent(new MouseEvent('pointerout', { bubbles: true })));
  await advanceFrames(800);
  assert.equal(header.style.opacity, '0');
});

test('chrome fade: Reduce Motion snaps the header with both forms inside', async () => {
  const rig = await headerRig({ ids: ['a'], slots: { i: iconSlot('Pin'), t: textSlot('Save') }, workspace: { tuning: { chrome: { mode: 'hover-or-active', fadeMs: 400 } } }, wrap: (tree) => createElement(MotionConfig, { reducedMotion: 'always' }, tree) });
  const header = rig.m.container.querySelector<HTMLElement>(`[${CHROME_ATTRIBUTE}="header"]`)!;
  const panelRoot = header.parentElement!;
  act(() => void panelRoot.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, relatedTarget: document.body })));
  assert.equal(header.style.opacity, '1', 'no time under Reduce Motion');
});

test('PanelHeaderButtons draws both forms in a custom header', async () => {
  function Custom(): ReactElement {
    return createElement('div', { 'data-custom': '' }, createElement(PanelHeaderButtons));
  }
  const rig = await headerRig({ ids: ['a'], slots: { i: iconSlot('Pin'), t: textSlot('Save') }, panelHeaderButtons: false, body: createElement(Custom) });
  const custom = rig.m.container.querySelector('[data-custom]')!;
  assert.deepEqual([...custom.querySelectorAll('button')].map((b) => b.textContent), ['', 'Save']);
});
