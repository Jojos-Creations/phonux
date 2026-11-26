/**
 * The share sheet's People tab for people who left or declined, and for the safety code check: what each new prop
 * draws with its callback, what it hides without it, and the words on the page.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act, createElement as h } from 'react';
import { ShareSheet } from '../index.js';
import type { ShareItem, ShareMember, ShareSheetProps } from '../index.js';
import { cleanup, mount } from './support/mount-harness.js';

afterEach(() => cleanup());

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;
const space: ShareItem = { kind: 'space', name: 'Trip to Lisbon', subtitle: 'Space, 3 tabs' };
const playlist: ShareItem = { kind: 'playlist', name: 'Road trip songs' };

const text = (el: ParentNode): string => el.textContent ?? '';
const buttons = (root: ParentNode): HTMLButtonElement[] => [...root.querySelectorAll('button')];
const byText = (root: ParentNode, label: string): HTMLButtonElement | undefined => buttons(root).find((b) => text(b) === label);
const click = (el: Element | undefined): void => {
  assert.ok(el, 'the element to click exists');
  act(() => (el as HTMLElement).click());
};
const title = (root: ParentNode): string | undefined => root.querySelector('h2')?.textContent ?? undefined;
const rowOf = (root: ParentNode, label: string): HTMLElement => {
  const row = root.querySelector<HTMLElement>(`li[aria-label^="${label}"]`);
  assert.ok(row, `a row named ${label}`);
  return row;
};

const CODE = '19896 56652 89711 42431 13353 29651 69207 07134 80072 66512 41361 36167';
const NEW_CODE = '40217 88130 05946 71352 29864 13075 66291 80443 17509 32688 95120 04731';

const base: ShareMember[] = [
  { id: 'me', name: 'You', role: 'owner', you: true },
  { id: 'priya', name: 'priya@fastmail.com', role: 'edit' },
];
const gone: ShareMember[] = [
  { id: 'dana', name: 'Dana Okafor', role: 'edit', status: 'left', since: NOW - 3 * DAY },
  { id: 'marcus', name: 'marcus@me.com', role: 'view', status: 'declined', since: NOW - 5 * DAY },
];

function sheet(over: Partial<ShareSheetProps> = {}, item: ShareItem = space) {
  const calls: string[] = [];
  const props: ShareSheetProps = {
    item,
    qr: h('i'),
    defaultTab: 'people',
    members: [...base, ...gone],
    people: [],
    onSend: () => {},
    onCopyLink: () => {},
    onRemove: (id) => calls.push(`remove:${id}`),
    onInviteAgain: (id, role) => calls.push(`again:${id}:${role}`),
    now: NOW,
    ...over,
  };
  return { m: mount(h(ShareSheet, props)), calls };
}

// ---- People who left or declined ----

test('left and declined people sit under their own heading, with a tag, their old access and the time', () => {
  const { m } = sheet();
  assert.match(text(m.container), /No longer in this space/);
  const dana = rowOf(m.container, 'Dana Okafor');
  assert.match(text(dana), /Dana Okafor.*Can edit.*Left, 3 days ago.*Left/);
  const marcus = rowOf(m.container, 'marcus@me.com');
  assert.match(text(marcus), /marcus@me\.com.*Can view.*Declined, 5 days ago.*Declined/);
  const groups = [...m.container.querySelectorAll('ul')];
  assert.equal(groups.length, 2, 'members and the gone group are separate lists');
  assert.ok(groups[1]?.contains(dana), 'the gone group holds them');
  assert.ok(!groups[0]?.contains(dana), 'the members list does not');
});

test('the gone heading and note say the playlist for a playlist', () => {
  const { m } = sheet({}, playlist);
  assert.match(text(m.container), /No longer in this playlist/);
  assert.match(text(m.container), /Removing gives the playlist new keys\./);
});

test('the note under the group says they stay until removed, and only when Remove exists', () => {
  const { m } = sheet();
  assert.match(text(m.container), /They stay here until you remove them\. Removing gives the space new keys\./);
  const bare = sheet({ onRemove: undefined });
  assert.doesNotMatch(text(bare.m.container), /They stay here/);
});

test('the group is not drawn when nobody left or declined', () => {
  const { m } = sheet({ members: base });
  assert.doesNotMatch(text(m.container), /No longer in this/);
  assert.doesNotMatch(text(m.container), /They stay here/);
  assert.equal(m.container.querySelectorAll('ul').length, 1);
});

test('a person with a status has no role menu and no more button, and the joined flag is ignored', () => {
  const { m } = sheet({ members: [...base, { id: 'x', name: 'x@y.com', role: 'edit', status: 'left', joined: true }] });
  const row = rowOf(m.container, 'x@y.com');
  assert.equal(row.querySelectorAll('[aria-haspopup]').length, 0);
  assert.equal(row.querySelectorAll('[aria-label^="Change access"]').length, 0);
  assert.doesNotMatch(text(row), /Invited, not joined yet/);
  assert.equal(m.container.querySelectorAll('[aria-label^="Change access or remove"]').length, 1, 'only the active member keeps one');
});

test('Invite again reports the id and the access they had, and Remove reports the id', () => {
  const { m, calls } = sheet();
  click(m.container.querySelector('[aria-label="Invite again, Dana Okafor"]') ?? undefined);
  click(m.container.querySelector('[aria-label="Invite again, marcus@me.com"]') ?? undefined);
  click(m.container.querySelector('[aria-label="Remove Dana Okafor"]') ?? undefined);
  assert.deepEqual(calls, ['again:dana:edit', 'again:marcus:view', 'remove:dana']);
});

test('on an item others cannot edit, Invite again carries view', () => {
  const { m, calls } = sheet({}, { kind: 'page', name: 'Guide' });
  click(m.container.querySelector('[aria-label="Invite again, Dana Okafor"]') ?? undefined);
  assert.deepEqual(calls, ['again:dana:view']);
});

test('Invite again is not drawn without its callback, and Remove not without onRemove', () => {
  const noAgain = sheet({ onInviteAgain: undefined });
  assert.equal(byText(noAgain.m.container, 'Invite again'), undefined);
  assert.ok(byText(noAgain.m.container, 'Remove'));
  const noRemove = sheet({ onRemove: undefined });
  assert.equal(byText(noRemove.m.container, 'Remove'), undefined);
  assert.ok(byText(noRemove.m.container, 'Invite again'));
});

test('a person with no name says Unknown account and has Remove only', () => {
  const { m } = sheet({ members: [...base, { id: 'ghost', name: '', role: 'edit', status: 'left', since: NOW - DAY }] });
  const row = rowOf(m.container, 'Unknown account');
  assert.match(text(row), /Unknown account/);
  assert.equal(byText(row, 'Invite again'), undefined);
  assert.ok(byText(row, 'Remove'));
});

test('canInviteAgain false hides Invite again for that person only', () => {
  const { m } = sheet({ members: [...base, { ...gone[0]!, canInviteAgain: false }, gone[1]!] });
  assert.equal(byText(rowOf(m.container, 'Dana Okafor'), 'Invite again'), undefined);
  assert.ok(byText(rowOf(m.container, 'marcus@me.com'), 'Invite again'));
});

test('the row is named by who left or declined and how long ago, and says no time when none is known', () => {
  const { m } = sheet({ members: [...base, { id: 'a', name: 'Amy', role: 'edit', status: 'left' }, { id: 'b', name: 'Bob', role: 'edit', status: 'declined', since: NOW - 2 * 3_600_000 }, { id: 'c', name: 'Cy', role: 'edit', status: 'left', since: NOW - DAY }, ...gone] });
  assert.equal(rowOf(m.container, 'Dana Okafor').getAttribute('aria-label'), 'Dana Okafor left 3 days ago');
  assert.equal(rowOf(m.container, 'marcus@me.com').getAttribute('aria-label'), 'marcus@me.com declined 5 days ago');
  assert.equal(rowOf(m.container, 'Amy').getAttribute('aria-label'), 'Amy left');
  assert.equal(rowOf(m.container, 'Bob').getAttribute('aria-label'), 'Bob declined today');
  assert.equal(rowOf(m.container, 'Cy').getAttribute('aria-label'), 'Cy left 1 day ago');
  assert.doesNotMatch(text(rowOf(m.container, 'Amy')), /ago/);
});

test('the gone row buttons are 44 px tall and its copy has no dash', () => {
  const { m } = sheet();
  const css = [...document.styleSheets].flatMap((s) => [...s.cssRules].map((r) => r.cssText)).join('\n');
  assert.ok(/min-height: 44px/.test(css));
  assert.ok(!text(m.container).includes('—'));
});

test('the sheet words for the gone group come from the labels it is given', () => {
  const { m } = sheet({ labels: { shareGoneHeading: () => 'Ya no estan', shareLeft: 'Salio', shareInviteAgain: 'Invitar otra vez' } });
  assert.match(text(m.container), /Ya no estan/);
  assert.match(text(m.container), /Salio/);
  assert.ok(byText(m.container, 'Invitar otra vez'));
});

// ---- The safety code ----

const withSafety = (state: 'unchecked' | 'checked' | 'changed', code?: string): ShareMember[] => [...base, { id: 'maya', name: 'Maya', role: 'edit', safety: { state, ...(code === undefined ? {} : { code }) } }];

function safety(state: 'unchecked' | 'checked' | 'changed', code: string | undefined = state === 'changed' ? NEW_CODE : CODE, over: Partial<ShareSheetProps> = {}) {
  const calls: string[] = [];
  const out = sheet({
    members: withSafety(state, code),
    onSafetyCodeOpen: (id) => calls.push(`open:${id}`),
    onSafetyCodeMatch: (id) => calls.push(`match:${id}`),
    onSafetyCodeMismatch: (id) => calls.push(`mismatch:${id}`),
    onAcceptNewKey: (id) => calls.push(`accept:${id}`),
    ...over,
  });
  return { ...out, calls };
}

const checkButton = (root: ParentNode): HTMLButtonElement | undefined => root.querySelector<HTMLButtonElement>('[aria-label="Check safety code, Maya"]') ?? undefined;
const groupsOf = (root: ParentNode): string[] => [...root.querySelectorAll('[data-group]')].map((g) => text(g));

test('a joined person with an unchecked code says so and has a small Check button', () => {
  const { m } = safety('unchecked');
  assert.match(text(rowOfPlain(m.container, 'Maya')), /Can edit, safety code not checked/);
  assert.equal(text(checkButton(m.container) as HTMLElement), 'Check');
});

function rowOfPlain(root: ParentNode, name: string): HTMLElement {
  const row = [...root.querySelectorAll<HTMLElement>('li')].find((li) => text(li).includes(name));
  assert.ok(row, `a row for ${name}`);
  return row;
}

test('nothing about the safety code is drawn without the callback, nor for the user, the owner or a pending invite', () => {
  const { m } = safety('unchecked', CODE, { onSafetyCodeOpen: undefined });
  assert.equal(checkButton(m.container), undefined);
  assert.doesNotMatch(text(m.container), /safety code/i);
  const odd = safety('unchecked', CODE, {
    members: [{ id: 'me', name: 'You', role: 'owner', you: true, safety: { state: 'unchecked' } }, { id: 'p', name: 'Pat', role: 'edit', joined: false, safety: { state: 'unchecked' } }],
  });
  assert.equal(odd.m.container.querySelectorAll('[aria-label^="Check safety code"]').length, 0);
  const none = sheet({ members: base, onSafetyCodeOpen: () => {} });
  assert.equal(none.m.container.querySelectorAll('[aria-label^="Check safety code"]').length, 0, 'no safety prop, no Check');
});

test('Check reports the id and opens the page with the 60 digits as 12 numbered groups', () => {
  const { m, calls } = safety('unchecked');
  click(checkButton(m.container));
  assert.deepEqual(calls, ['open:maya']);
  assert.equal(title(m.container), 'Safety code');
  const groups = groupsOf(m.container);
  assert.equal(groups.length, 12);
  assert.equal(groups[0], '119896');
  assert.equal(groups[11], '1236167');
  assert.equal(text(m.container.querySelector('[data-group="7"]') as HTMLElement), '769207');
  assert.equal(m.container.querySelector('[role="tablist"]') === null, false);
  assert.equal(m.container.querySelector('[role="tab"][aria-selected="true"]')?.textContent, 'Numbers');
  assert.equal(m.container.querySelector('[role="tab"][aria-selected="false"]')?.textContent, 'Show QR');
  assert.equal(m.container.querySelectorAll('[role="tab"][id*="tab-link"]').length, 0, 'the page replaces the tabs');
});

test('Show QR swaps the digits for a QR code of the 60 digits with no spaces, and Numbers swaps back', () => {
  const { m } = safety('unchecked');
  click(checkButton(m.container));
  click([...m.container.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => text(t) === 'Show QR'));
  assert.equal(groupsOf(m.container).length, 0);
  const qr = m.container.querySelector('svg[data-phonux-qr]');
  assert.ok(qr);
  assert.equal(qr.getAttribute('aria-label'), 'QR code of the safety code with Maya');
  assert.match(text(m.container), /Let Maya scan this/);
  click([...m.container.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => text(t) === 'Numbers'));
  assert.equal(groupsOf(m.container).length, 12);
  assert.equal(m.container.querySelector('svg[data-phonux-qr]'), null);
});

test('the QR holds exactly the digits: it matches the code a QR made of the digits draws', async () => {
  const { QrCode } = await import('../index.js');
  const mine = safety('unchecked');
  click(checkButton(mine.m.container));
  click([...mine.m.container.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => text(t) === 'Show QR'));
  const drawn = mine.m.container.querySelector('svg[data-phonux-qr] path')?.getAttribute('d');
  const ref = mount(h(QrCode, { value: CODE.replace(/ /g, ''), label: 'ref' }));
  assert.ok(drawn !== undefined && drawn !== null && drawn.length > 100);
  assert.equal(drawn, ref.container.querySelector('svg path')?.getAttribute('d'));
  const spaced = mount(h(QrCode, { value: CODE, label: 'spaced' }));
  assert.notEqual(drawn, spaced.container.querySelector('svg path')?.getAttribute('d'), 'the spaces would make another code');
});

test('They match reports the id, leaves the page and the person can then show as checked', () => {
  const { m, calls } = safety('unchecked');
  click(checkButton(m.container));
  click(byText(m.container, 'They match'));
  assert.deepEqual(calls, ['open:maya', 'match:maya']);
  assert.equal(title(m.container), 'Share', 'back on the sheet');
  m.rerender(h(ShareSheet, { item: space, qr: h('i'), defaultTab: 'people', members: withSafety('checked'), people: [], onSend: () => {}, onCopyLink: () => {}, onSafetyCodeOpen: () => {}, now: NOW }));
  assert.ok(m.container.querySelector('[data-phonux-shield="checked"]'), 'the green shield is on the avatar');
  assert.match(text(rowOfPlain(m.container, 'Maya')), /Can edit, safety code checked/);
  assert.equal(checkButton(m.container), undefined);
});

test('They do not match reports it, says not to share anything private, and Back returns', () => {
  const { m, calls } = safety('unchecked');
  click(checkButton(m.container));
  click(byText(m.container, 'They do not match'));
  assert.deepEqual(calls, ['open:maya', 'mismatch:maya']);
  assert.match(text(m.container), /Do not share anything private with Maya until you check again in person\./);
  assert.equal(groupsOf(m.container).length, 0, 'the digits are gone');
  assert.equal(byText(m.container, 'They match'), undefined, 'no way to mark checked from here');
  click(byText(m.container, 'Back'));
  assert.equal(title(m.container), 'Share');
  assert.deepEqual(calls, ['open:maya', 'mismatch:maya'], 'Back reports nothing');
});

test('They match and They do not match are drawn only with their callbacks', () => {
  const noMatch = safety('unchecked', CODE, { onSafetyCodeMatch: undefined });
  click(checkButton(noMatch.m.container));
  assert.equal(byText(noMatch.m.container, 'They match'), undefined);
  assert.ok(byText(noMatch.m.container, 'They do not match'));
  cleanup();
  const noMis = safety('unchecked', CODE, { onSafetyCodeMismatch: undefined });
  click(checkButton(noMis.m.container));
  assert.equal(byText(noMis.m.container, 'They do not match'), undefined);
  assert.ok(byText(noMis.m.container, 'They match'));
});

test('the back button on the page returns to the list without reporting a match', () => {
  const { m, calls } = safety('unchecked');
  click(checkButton(m.container));
  click(m.container.querySelector('button[aria-label="Back"]') ?? undefined);
  assert.deepEqual(calls, ['open:maya']);
  assert.ok(checkButton(m.container));
});

test('the page waits while the host has not given the code, and offers no match until it does', () => {
  const { m } = safety('unchecked', '');
  click(checkButton(m.container));
  assert.match(text(m.container), /Getting the safety code\./);
  assert.equal(groupsOf(m.container).length, 0);
  assert.equal(byText(m.container, 'They match')?.disabled, true);
  m.rerender(h(ShareSheet, { item: space, qr: h('i'), defaultTab: 'people', members: withSafety('unchecked', CODE), people: [], onSend: () => {}, onCopyLink: () => {}, onSafetyCodeOpen: () => {}, onSafetyCodeMatch: () => {}, now: NOW }));
  assert.equal(groupsOf(m.container).length, 12);
});

test('a changed key shows a Review button, and its page has the warning, the new code, Accept new key and Not now', () => {
  const { m, calls } = safety('changed');
  assert.match(text(rowOfPlain(m.container, 'Maya')), /Can edit, sharing key changed/);
  assert.equal(checkButton(m.container), undefined, 'it is not a first check');
  click(m.container.querySelector('[aria-label="Review new safety code, Maya"]') ?? undefined);
  assert.equal(title(m.container), 'New safety code');
  assert.match(m.container.querySelector('[role="alert"]')?.textContent ?? '', /The sharing key for Maya changed.*Sharing to Maya is paused until you decide\./);
  assert.equal(groupsOf(m.container)[0], '140217');
  assert.match(text(m.container), /Not now keeps sharing to Maya paused\./);
  assert.equal(byText(m.container, 'They match'), undefined, 'a changed key is accepted, not matched');
  click(byText(m.container, 'Accept new key'));
  assert.deepEqual(calls, ['open:maya', 'accept:maya']);
  assert.equal(title(m.container), 'Share');
});

test('Not now leaves the page and reports nothing, and Accept new key is drawn only with its callback', () => {
  const { m, calls } = safety('changed');
  click(m.container.querySelector('[aria-label="Review new safety code, Maya"]') ?? undefined);
  click(byText(m.container, 'Not now'));
  assert.deepEqual(calls, ['open:maya']);
  cleanup();
  const bare = safety('changed', NEW_CODE, { onAcceptNewKey: undefined });
  click(bare.m.container.querySelector('[aria-label="Review new safety code, Maya"]') ?? undefined);
  assert.equal(byText(bare.m.container, 'Accept new key'), undefined);
  assert.ok(byText(bare.m.container, 'Not now'));
});

test('a checked person shows the shield even without callbacks, and no Check button', () => {
  const { m } = sheet({ members: withSafety('checked') });
  assert.ok(m.container.querySelector('[data-phonux-shield="checked"]'));
  assert.equal(m.container.querySelectorAll('[aria-label^="Check safety code"]').length, 0);
});

test('the safety page never mentions passkeys or a recovery copy, and its copy has no dash or colon', () => {
  const { m } = safety('changed');
  click(m.container.querySelector('[aria-label="Review new safety code, Maya"]') ?? undefined);
  const all = text(m.container);
  assert.doesNotMatch(all, /passkey|recovery/i);
  assert.ok(!/[—–:]/.test(all), 'only periods and commas');
});

test('the safety page words come from the labels it is given', () => {
  const { m } = safety('unchecked', CODE, { labels: { shareSafetyTitle: 'Codigo de seguridad', shareSafetyMatch: 'Coinciden', shareSafetyCheck: 'Revisar' } });
  assert.equal(text(checkButton(m.container) as HTMLElement), 'Revisar');
  click(checkButton(m.container));
  assert.equal(title(m.container), 'Codigo de seguridad');
  assert.ok(byText(m.container, 'Coinciden'));
});
