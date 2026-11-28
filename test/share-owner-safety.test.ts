/** The share sheet draws the safety code of the owner's row for a person the owner shared with, and for nobody's own row. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act, createElement as h } from 'react';
import { ShareSheet } from '../index.js';
import type { ShareMember, ShareSheetProps } from '../index.js';
import { cleanup, mount } from './support/mount-harness.js';

afterEach(() => cleanup());

const text = (el: ParentNode): string => el.textContent ?? '';
const byText = (root: ParentNode, label: string): HTMLButtonElement | undefined => [...root.querySelectorAll('button')].find((b) => text(b) === label);

const CODE = '19896 56652 89711 42431 13353 29651 69207 07134 80072 66512 41361 36167';

function props(members: ShareMember[], calls: string[] = []): ShareSheetProps {
  return {
    item: { kind: 'space', name: 'Trip' },
    qr: h('i'),
    defaultTab: 'people',
    members,
    people: [],
    onSend: () => {},
    onCopyLink: () => {},
    onSafetyCodeOpen: (id) => calls.push(`open:${id}`),
  };
}

const me: ShareMember = { id: 'me', name: 'Me', role: 'view', you: true };

test('control: a changed key on an ordinary member draws the warning line and a Review button', () => {
  const m = mount(h(ShareSheet, props([me, { id: 'p', name: 'Priya', role: 'edit', safety: { state: 'changed', code: CODE } }])));
  assert.ok(byText(m.container, 'Review'));
  assert.match(text(m.container), /sharing key changed/);
});

test('a changed key on the owner row draws the warning line and a Review button that opens the page', () => {
  const calls: string[] = [];
  const m = mount(h(ShareSheet, props([{ id: 'owner', name: 'Dana', role: 'owner', safety: { state: 'changed', code: CODE } }, me], calls)));
  assert.match(text(m.container), /Owner, sharing key changed/);
  act(() => byText(m.container, 'Review')!.click());
  assert.deepEqual(calls, ['open:owner']);
});

test('an unchecked owner can be checked, and the Owner word is drawn once', () => {
  const m = mount(h(ShareSheet, props([{ id: 'owner', name: 'Dana', role: 'owner', safety: { state: 'unchecked', code: CODE } }, me])));
  assert.ok(byText(m.container, 'Check'));
  assert.equal(text(m.container).match(/Owner/g)?.length, 1);
});

test('a checked owner draws the shield and the checked line', () => {
  const m = mount(h(ShareSheet, props([{ id: 'owner', name: 'Dana', role: 'owner', safety: { state: 'checked', code: CODE } }, me])));
  assert.ok(m.container.querySelector('[data-phonux-shield="checked"]'));
  assert.match(text(m.container), /Owner, safety code checked/);
});

test('an owner row with no safety prop, or without the callback, keeps only the Owner word', () => {
  const plain = mount(h(ShareSheet, props([{ id: 'owner', name: 'Dana', role: 'owner' }, me])));
  assert.equal(byText(plain.container, 'Check'), undefined);
  assert.doesNotMatch(text(plain.container), /safety code/i);
  assert.match(text(plain.container), /Owner/);
});

test('the user\'s own row never draws a safety code, even as the owner', () => {
  const m = mount(h(ShareSheet, props([{ id: 'me', name: 'Me', role: 'owner', you: true, safety: { state: 'changed', code: CODE } }])));
  assert.equal(byText(m.container, 'Review'), undefined);
  assert.doesNotMatch(text(m.container), /changed/);
});
