/** The share pieces render under the library's own theme, whose palette values are CSS variables rather than colors. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act, createElement as h } from 'react';
import { OfferCard, PhonuxThemeProvider, ShareSheet, SharedList, createDefaultTheme } from '../index.js';
import type { ShareMember } from '../index.js';
import { cleanup, mount } from './support/mount-harness.js';

afterEach(() => cleanup());

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const CODE = '19896 56652 89711 42431 13353 29651 69207 07134 80072 66512 41361 36167';

const text = (el: ParentNode): string => el.textContent ?? '';
const byText = (root: ParentNode, label: string): HTMLButtonElement | undefined => [...root.querySelectorAll('button')].find((b) => text(b) === label);
const styles = (): string =>
  [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n') +
  [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join('\n');

const members: ShareMember[] = [
  { id: 'owner', name: 'Dana', role: 'owner' },
  { id: 'me', name: 'Me', role: 'view', you: true },
  { id: 'p', name: 'Priya', role: 'edit', safety: { state: 'changed', code: CODE } },
  { id: 'g', name: 'Gone Person', role: 'edit', status: 'declined', since: NOW - 3 * DAY },
  { id: 'l', name: 'Left Person', role: 'view', status: 'left', since: NOW - 2 * DAY },
];

for (const mode of ['light', 'dark'] as const) {
  const themed = (child: React.ReactNode) => h(PhonuxThemeProvider, { theme: createDefaultTheme(mode) }, child);

  test(`${mode}: the share sheet draws every tab, the gone group and the safety page under the library's theme`, () => {
    const calls: string[] = [];
    const props = { item: { kind: 'space' as const, name: 'Trip' }, qr: h('i'), members, people: [], onSend: () => {}, onCopyLink: () => {}, onInviteAgain: () => {}, onRemove: () => {}, onSafetyCodeOpen: (id: string) => calls.push(id), now: NOW };
    const m = mount(themed(h(ShareSheet, { ...props, defaultTab: 'people' })));
    assert.match(text(m.container), /Dana/);
    assert.match(text(m.container), /Declined/);
    assert.ok(byText(m.container, 'Invite again'));
    assert.ok(byText(m.container, 'Review'));
    act(() => byText(m.container, 'Review')!.click());
    assert.deepEqual(calls, ['p']);
    assert.match(text(m.container), /The sharing key for Priya changed/, 'the safety page and its warning box are drawn');
  });

  test(`${mode}: the offer card and the shared list draw under the library's theme`, () => {
    const card = mount(themed(h(OfferCard, { from: 'Sam', file: { name: 'Trip.zip', type: 'ZIP', size: 1000 }, expiresAt: NOW + DAY, onAccept: () => {}, onNotNow: () => {}, onDecline: () => {}, onReport: () => {}, now: NOW })));
    assert.match(text(card.container), /Sam shared a file with you/);
    const shared = mount(themed(h(SharedList, { byYou: [{ id: 'l1', kind: 'link', name: 'Trip.zip', detail: 'Link' }], withYou: [], onRenew: () => {}, onCopyLink: () => {}, onShowQr: () => {}, onChangeEnd: () => {}, onStopSharing: () => {} })));
    assert.match(text(shared.container), /Trip\.zip/);
  });
}

test('the tints are written against the palette variable, not as a color the library cannot parse', () => {
  mount(h(PhonuxThemeProvider, { theme: createDefaultTheme('light') }, h(ShareSheet, { item: { kind: 'space', name: 'Trip' }, qr: h('i'), members, people: [], onSend: () => {}, onCopyLink: () => {}, defaultTab: 'people', now: NOW })));
  assert.match(styles(), /oklch\(from var\(--phonux-primary\) l c h \/ 0\.12\)|oklch\(from var\(--phonux-primary\) l c h \/ 0\.16\)/);
});
