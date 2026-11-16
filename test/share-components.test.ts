/**
 * The three share components: the share sheet's tabs and sends, the offer card's choices and its refusal to draw a
 * picture, and the shared list's tabs, Renew and row menu, in the default words and in a host's.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act, createElement as h } from 'react';
import { OfferCard, ShareSheet, SharedList } from '../index.js';
import type { OfferCardProps, SharedListProps, ShareSheetProps } from '../index.js';
import { cleanup, mount } from './support/mount-harness.js';

afterEach(() => cleanup());

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

const text = (el: ParentNode): string => el.textContent ?? '';
const buttons = (root: ParentNode): HTMLButtonElement[] => [...root.querySelectorAll('button')];
const byText = (root: ParentNode, label: string): HTMLButtonElement | undefined => buttons(root).find((b) => text(b) === label);
const tab = (root: ParentNode, label: string): HTMLButtonElement => {
  const t = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => text(b) === label);
  assert.ok(t, `a tab named ${label}`);
  return t;
};
const click = (el: Element | undefined): void => {
  assert.ok(el, 'the element to click exists');
  act(() => (el as HTMLElement).click());
};

function sheet(over: Partial<ShareSheetProps> = {}) {
  const calls: string[] = [];
  const props: ShareSheetProps = {
    file: { name: 'Trip photos.zip', size: 48_000_000 },
    qr: h('i', { 'data-qr': '' }),
    people: [
      { id: 'sam', name: 'Sam' },
      { id: 'mom', name: 'Mom' },
      { id: 'riley', name: 'Riley' },
    ],
    sentTo: ['mom'],
    onSend: (id) => calls.push(`send:${id}`),
    onAddPerson: () => calls.push('add'),
    link: { expiresAt: NOW + 7 * DAY, maxOpens: 20 },
    onCopyLink: () => calls.push('copy'),
    onMoreApps: () => calls.push('more'),
    onChangeLink: () => calls.push('change'),
    onClose: () => calls.push('close'),
    now: NOW,
    ...over,
  };
  return { m: mount(h(ShareSheet, props)), calls };
}

test('the share sheet names the file with its size', () => {
  const { m } = sheet();
  assert.match(text(m.container), /Trip photos\.zip, 48 MB/);
});

test('sizes are written in decimal units with at most one decimal', () => {
  const sizes: [number, string][] = [
    [0, '0 B'],
    [999, '999 B'],
    [2_000, '2 KB'],
    [1_500_000, '1.5 MB'],
    [48_000_000, '48 MB'],
    [2_500_000_000, '2.5 GB'],
  ];
  for (const [size, want] of sizes) {
    const { m } = sheet({ file: { name: 'f', size } });
    assert.ok(text(m.container).includes(`f, ${want}`), want);
    m.unmount();
  }
});

test('the tabs switch what the sheet shows', () => {
  const { m } = sheet({ defaultTab: 'nearby' });
  assert.equal(tab(m.container, 'In person').getAttribute('aria-selected'), 'true');
  assert.ok(m.container.querySelector('[data-qr]'), 'the QR code is on the In person tab');
  assert.match(text(m.container), /Show this to someone next to you/);
  assert.equal(byText(m.container, 'Copy link'), undefined, 'control: the link tab is not shown');
  click(tab(m.container, 'People'));
  assert.equal(m.container.querySelector('[data-qr]'), null);
  assert.match(text(m.container), /Add someone you trust/);
  click(tab(m.container, 'Link'));
  assert.ok(byText(m.container, 'Copy link'));
  assert.equal(tab(m.container, 'Link').getAttribute('aria-selected'), 'true');
});

test('a tab list has one tab in the tab order, and the arrow keys move it', () => {
  const { m } = sheet();
  const tabs = [...m.container.querySelectorAll<HTMLElement>('[role="tab"]')];
  assert.deepEqual(tabs.map((t) => t.tabIndex), [-1, 0, -1]);
  act(() => void tab(m.container, 'People').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  assert.equal(tab(m.container, 'Link').getAttribute('aria-selected'), 'true');
});

test('a controlled tab follows the prop and reports the pick', () => {
  const picked: string[] = [];
  const { m } = sheet({ tab: 'people', onTabChange: (t) => picked.push(t) });
  click(tab(m.container, 'Link'));
  assert.deepEqual(picked, ['link']);
  assert.equal(tab(m.container, 'People').getAttribute('aria-selected'), 'true', 'the prop, not the click, decides');
});

test('Send fires with the person id, and a person already sent to shows Sent with no button', () => {
  const { m, calls } = sheet();
  assert.ok(byText(m.container, 'Sent') === undefined && /Sent/.test(text(m.container)), 'Sent is text, not a button');
  const sendButtons = buttons(m.container).filter((b) => text(b) === 'Send');
  assert.equal(sendButtons.length, 2, 'Sam and Riley, not Mom');
  click(sendButtons[1]);
  click(sendButtons[0]);
  assert.deepEqual(calls, ['send:riley', 'send:sam']);
  assert.ok(m.container.querySelector('[aria-label="Send to Sam"]'), 'the Send button names the person');
});

test('Add someone, back, Copy link, More apps and Change call back', () => {
  const { m, calls } = sheet();
  click(byText(m.container, 'Add someone you trust') ?? m.container.querySelector('button:not([role="tab"]):not([aria-label])') ?? undefined);
  click(m.container.querySelector('[aria-label="Back"]') ?? undefined);
  click(tab(m.container, 'Link'));
  click(byText(m.container, 'Copy link'));
  click(byText(m.container, 'More apps'));
  click(byText(m.container, 'Change'));
  assert.deepEqual(calls, ['add', 'close', 'copy', 'more', 'change']);
});

test('the link line says when it ends, and leaves out what is unset', () => {
  const { m } = sheet({ defaultTab: 'link' });
  assert.match(text(m.container), /Link ends in 7 days or after 20 opens\./);
  m.unmount();
  const days = sheet({ defaultTab: 'link', link: { expiresAt: NOW + 3 * DAY } });
  assert.match(text(days.m.container), /Link ends in 3 days\./);
  days.m.unmount();
  const none = sheet({ defaultTab: 'link', link: undefined, onMoreApps: undefined });
  assert.doesNotMatch(text(none.m.container), /Link ends/);
  assert.equal(byText(none.m.container, 'More apps'), undefined);
});

test('the sheet speaks in the labels it is given', () => {
  const { m } = sheet({ labels: { shareTitle: 'Compartir', shareSend: 'Enviar', shareTabPeople: 'Personas' } });
  assert.match(text(m.container), /Compartir/);
  assert.ok(byText(m.container, 'Enviar'));
  tab(m.container, 'Personas');
});

function offer(over: Partial<OfferCardProps> = {}) {
  const calls: string[] = [];
  const props: OfferCardProps = {
    from: 'Sam',
    file: { name: 'Trip photos.zip', type: 'ZIP archive', size: 48_000_000 },
    expiresAt: NOW + 7 * DAY,
    onAccept: () => calls.push('accept'),
    onDecline: () => calls.push('decline'),
    onReport: () => calls.push('report'),
    now: NOW,
    ...over,
  };
  return { m: mount(h(OfferCard, props)), calls };
}

test('the offer card says who, what and for how long, in the mockup words', () => {
  const { m } = offer();
  const t = text(m.container);
  assert.match(t, /Sam wants to send you a file/);
  assert.match(t, /Sam is on your trusted list/);
  assert.match(t, /Trip photos\.zip/);
  assert.match(t, /ZIP archive, 48 MB/);
  assert.match(t, /Nothing downloads until you accept\. The offer goes away in 7 days\./);
  assert.equal(m.container.querySelector('[aria-hidden="true"]')?.textContent, 'S', 'the avatar is the first letter');
});

test('Accept and save, Decline and Report each fire once', () => {
  const { m, calls } = offer();
  click(byText(m.container, 'Accept and save'));
  click(byText(m.container, 'Decline'));
  click(byText(m.container, 'Report'));
  assert.deepEqual(calls, ['accept', 'decline', 'report']);
});

test('the offer card draws no image of the file or the sender', () => {
  const { m } = offer({ from: '<img src=x onerror=alert(1)>' });
  assert.equal(m.container.querySelectorAll('img, picture, canvas, video, [style*="background-image"]').length, 0);
  assert.ok(text(m.container).includes('<img src=x'), 'control: the sender name is shown as text');
});

test('the offer card speaks in the labels it is given', () => {
  const { m } = offer({ labels: { offerTitle: (f) => `${f} te envía un archivo`, offerAccept: 'Aceptar y guardar', offerNote: (d) => `Caduca en ${d}` } });
  assert.match(text(m.container), /Sam te envía un archivo/);
  assert.match(text(m.container), /Caduca en 7/);
  assert.ok(byText(m.container, 'Aceptar y guardar'));
});

function list(over: Partial<SharedListProps> = {}) {
  const calls: string[] = [];
  const props: SharedListProps = {
    byYou: [
      { id: 'l1', kind: 'link', name: 'Trip photos.zip', detail: 'Link, opened 3 times, ends Nov 23' },
      { id: 'p1', kind: 'person', name: 'Trip photos.zip', person: 'Mom', detail: 'Sent to Mom, ends Nov 23' },
      { id: 'e1', kind: 'link', name: 'Old mixtape.mp3', detail: 'Link ended after 20 opens', ended: true },
    ],
    withYou: [{ id: 'w1', kind: 'person', name: 'Lease.pdf', person: 'Riley', detail: 'From Riley, yesterday' }],
    onRenew: (id) => calls.push(`renew:${id}`),
    onCopyLink: (id) => calls.push(`copy:${id}`),
    onShowQr: (id) => calls.push(`qr:${id}`),
    onChangeEnd: (id) => calls.push(`change:${id}`),
    onStopSharing: (id) => calls.push(`stop:${id}`),
    ...over,
  };
  return { m: mount(h(SharedList, props)), calls };
}

test('the shared list tabs switch between the two lists', () => {
  const { m } = list();
  assert.match(text(m.container), /Old mixtape\.mp3/);
  assert.doesNotMatch(text(m.container), /Lease\.pdf/);
  click(tab(m.container, 'With you'));
  assert.match(text(m.container), /From Riley, yesterday/);
  assert.doesNotMatch(text(m.container), /Old mixtape/);
  assert.equal(m.container.querySelectorAll('[aria-label^="More for"]').length, 0, 'With you rows carry no menu');
});

test('an ended row shows Renew in the error color, and Renew fires with its id', () => {
  const { m, calls } = list();
  const line = (want: string): Element | undefined => [...m.container.querySelectorAll('p')].find((p) => text(p) === want);
  const color = (el: Element | undefined): string => (el === undefined ? '' : window.getComputedStyle(el).color);
  assert.notEqual(color(line('Link ended after 20 opens')), '', 'control: the ended line is found and has a color');
  assert.notEqual(color(line('Link ended after 20 opens')), color(line('Sent to Mom, ends Nov 23')), 'the ended detail is not in the ordinary color');
  assert.equal(buttons(m.container).filter((b) => text(b) === 'Renew').length, 1, 'only the ended row has Renew');
  assert.equal(m.container.querySelectorAll('[aria-label^="More for"]').length, 2, 'the ended row has no menu');
  click(byText(m.container, 'Renew'));
  assert.deepEqual(calls, ['renew:e1']);
});

test('the row menu offers four entries on a link row, and each calls back with the id', () => {
  const { m, calls } = list();
  const open = (name: string): void => click(m.container.querySelector(`[aria-label="${name}"]`) ?? undefined);
  const item = (label: string): HTMLElement | undefined => [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => text(i) === label);
  open('More for Trip photos.zip');
  assert.deepEqual([...document.body.querySelectorAll('[role="menuitem"]')].map(text), ['Copy link again', 'Show QR code', 'Change when it ends', 'Stop sharing']);
  click(item('Copy link again'));
  open('More for Trip photos.zip');
  click(item('Show QR code'));
  open('More for Trip photos.zip');
  click(item('Change when it ends'));
  open('More for Trip photos.zip');
  click(item('Stop sharing'));
  assert.deepEqual(calls, ['copy:l1', 'qr:l1', 'change:l1', 'stop:l1']);
});

test('a person row menu leaves out the link entries', () => {
  const { m } = list();
  const buttonsMore = m.container.querySelectorAll('[aria-label^="More for"]');
  click(buttonsMore[1]);
  assert.deepEqual([...document.body.querySelectorAll('[role="menuitem"]')].map(text), ['Change when it ends', 'Stop sharing']);
});

test('an empty tab says so, and the labels replace the words', () => {
  const { m } = list({ byYou: [], labels: { sharedEmpty: 'Nada aún', sharedWithYou: 'Contigo' } });
  assert.match(text(m.container), /Nada aún/);
  tab(m.container, 'Contigo');
});
