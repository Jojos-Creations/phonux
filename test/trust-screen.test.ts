/** The trust screen's code exchange from both sides, its errors, its pick-up of an open exchange, and the QR code it draws. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act, createElement as h } from 'react';
import { QrCode, TrustScreen } from '../index.js';
import type { TrustExchange, TrustExchanges, TrustFailure, TrustProgress, TrustScreenProps } from '../index.js';
import { cleanup, mount } from './support/mount-harness.js';

afterEach(() => cleanup());

const text = (el: ParentNode): string => el.textContent ?? '';
const title = (root: ParentNode): string => text(root.querySelector('h2')!);
const button = (root: ParentNode, label: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find((b) => text(b) === label);
  assert.ok(found, `a button named ${label}; buttons: ${[...root.querySelectorAll('button')].map(text).join(' | ')}`);
  return found;
};
const field = (root: ParentNode, label: string): HTMLInputElement => {
  const found = [...root.querySelectorAll('label')].find((l) => text(l).replace(/\s*\*$/, '') === label);
  assert.ok(found, `a field named ${label}`);
  return root.querySelector<HTMLInputElement>(`#${CSS.escape(found.htmlFor)}`)!;
};
const tick = (ms = 30): Promise<void> => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const press = async (el: HTMLElement): Promise<void> => {
  act(() => el.click());
  await tick();
};
const type = async (input: HTMLInputElement, value: string): Promise<void> => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await tick();
};
const until = async (why: string, ok: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !ok(); i++) await tick(10);
  assert.ok(ok(), why);
};

class Failure extends Error {
  constructor(readonly why: TrustFailure) {
    super(why);
  }
}

interface FakeExchange extends TrustExchange {
  progress: TrustProgress;
  checks: number;
  calls: string[];
  ended: boolean;
}

function exchange(role: 'maker' | 'joiner', calls: string[]): FakeExchange {
  let answered = false;
  const ex: FakeExchange = {
    role,
    code: 'KW-7Q4M-ZX2P',
    endsAt: Date.now() + 5.5 * 3_600_000,
    progress: { theirName: null, answered: false, canSendToThem: false },
    checks: 0,
    calls,
    ended: false,
    check: async () => {
      ex.checks += 1;
      if (ex.ended) throw new Failure('ended');
      return { ...ex.progress };
    },
    allow: async (o) => {
      answered = true;
      calls.push(`allow:${role}:${o.name}:${o.expiresAt === undefined ? 'no-end' : 'ends'}`);
    },
    decline: async () => {
      answered = true;
      calls.push(`decline:${role}`);
    },
    close: () => calls.push(`close:${role}`),
    answered: () => answered,
  };
  return ex;
}

function service(over: Partial<TrustExchanges> = {}): { trust: TrustExchanges; calls: string[]; made: FakeExchange[] } {
  const calls: string[] = [];
  const made: FakeExchange[] = [];
  const trust: TrustExchanges = {
    invite: async (name) => {
      calls.push(`invite:${name}`);
      const ex = exchange('maker', calls);
      made.push(ex);
      return ex;
    },
    join: async (code, name) => {
      calls.push(`join:${code}:${name}`);
      if (!code.startsWith('KW-')) throw new Failure('not-a-code');
      const ex = exchange('joiner', calls);
      ex.progress = { theirName: 'Sam', answered: false, canSendToThem: false };
      made.push(ex);
      return ex;
    },
    pending: () => null,
    failureOf: (e) => (e instanceof Failure ? e.why : 'other'),
    ...over,
  };
  return { trust, calls, made };
}

function screen(trust: TrustExchanges, over: Partial<TrustScreenProps> = {}) {
  const events: string[] = [];
  const m = mount(h(TrustScreen, { trust, pollMs: 20, onDone: () => events.push('done'), onClose: () => events.push('close'), onChanged: () => events.push('changed'), ...over }));
  return { m, events };
}

test('the maker makes a code, sees it as text and as a QR code, waits, and allows the one who joined for a week', async () => {
  const { trust, calls, made } = service();
  const { m, events } = screen(trust);
  assert.equal(title(m.container), 'Add someone you trust');
  assert.ok(button(m.container, 'Make a code').disabled, 'no code is made without a name');
  await type(field(m.container, 'What you call yourself'), '  Joe ');
  await press(button(m.container, 'Make a code'));
  assert.deepEqual(calls, ['invite:Joe'], 'the name is trimmed');
  assert.equal(text(m.container.querySelector('[data-phonux-trust-code]')!), 'KW-7Q4M-ZX2P');
  assert.equal(m.container.querySelector('svg[role="img"]')?.getAttribute('aria-label'), 'QR code for the code below');
  await press(button(m.container, 'Done, wait for them'));
  assert.equal(title(m.container), 'Waiting for them');
  assert.match(text(m.container), /6 more hours on this code\./);
  made[0]!.progress = { theirName: 'Sam', answered: true, canSendToThem: false };
  await until('the screen asks again and sees the answer', () => title(m.container) === 'Sam wants to be able to send you files');
  assert.equal(field(m.container, 'Save them as').value, 'Sam', 'the save-as name starts as theirs');
  await press(button(m.container, '1 week'));
  await press(button(m.container, 'Allow'));
  assert.deepEqual(calls.slice(1), ['allow:maker:Sam:ends']);
  assert.deepEqual(events, ['changed', 'done'], 'an answer from the maker ends the exchange');
});

test('the joiner takes a code, lets them send, and hears the answer', async () => {
  const { trust, calls, made } = service();
  const { m, events } = screen(trust);
  await press(button(m.container, 'I have a code'));
  assert.equal(title(m.container), 'Join with a code');
  await type(field(m.container, 'Code'), 'KW-7Q4M-ZX2P');
  await type(field(m.container, 'What you call yourself'), 'Joe');
  await press(button(m.container, 'Join'));
  assert.equal(title(m.container), 'Let Sam send you files');
  await press(button(m.container, 'Let them'));
  assert.deepEqual(calls, ['join:KW-7Q4M-ZX2P:Joe', 'allow:joiner:Sam:no-end']);
  assert.equal(title(m.container), 'Waiting for Sam');
  made[0]!.progress = { theirName: 'Sam', answered: true, canSendToThem: true };
  await until('the maker\'s yes is shown', () => title(m.container) === 'Sam said yes');
  await press(button(m.container, 'Done'));
  assert.ok(events.includes('done'));
});

test('Done on the result closes the exchange the screen joined, and pending() is read only on mount', async () => {
  let reads = 0;
  const { trust, calls, made } = service({
    pending: () => {
      reads += 1;
      return null;
    },
  });
  const { m } = screen(trust);
  await press(button(m.container, 'I have a code'));
  await type(field(m.container, 'Code'), 'KW-7Q4M-ZX2P');
  await type(field(m.container, 'What you call yourself'), 'Joe');
  await press(button(m.container, 'Join'));
  await press(button(m.container, 'Let them'));
  made[0]!.progress = { theirName: 'Sam', answered: true, canSendToThem: true };
  await until('the result shows', () => title(m.container) === 'Sam said yes');
  await press(button(m.container, 'Done'));
  assert.equal(calls.at(-1), 'close:joiner', 'the joined exchange is closed');
  assert.equal(reads, 1, 'pending() is not read again on Done');
});

test('text that is no code says so, and a code that ended says so', async () => {
  const { trust } = service();
  const { m } = screen(trust);
  await press(button(m.container, 'I have a code'));
  await type(field(m.container, 'Code'), 'hello');
  await type(field(m.container, 'What you call yourself'), 'Joe');
  await press(button(m.container, 'Join'));
  assert.equal(text(m.container.querySelector('[role="alert"]')!), 'That is not a code. Check what they sent you.');
  const ended = service({ join: async () => Promise.reject(new Failure('ended')) });
  const again = screen(ended.trust);
  await press(button(again.m.container, 'I have a code'));
  await type(field(again.m.container, 'Code'), 'KW-OLD');
  await type(field(again.m.container, 'What you call yourself'), 'Joe');
  await press(button(again.m.container, 'Join'));
  assert.equal(text(again.m.container.querySelector('[role="alert"]')!), 'That code has ended. Ask them for a new one.');
});

test('an exchange left open is picked up on mount, and the screen stops asking once it unmounts', async () => {
  const calls: string[] = [];
  const open = exchange('maker', calls);
  const { trust } = service({ pending: () => open });
  const { m } = screen(trust);
  assert.equal(title(m.container), 'Waiting for them');
  await until('it asks more than once while waiting', () => open.checks >= 2);
  m.unmount();
  const seen = open.checks;
  await tick(100);
  assert.equal(open.checks, seen, 'no ask after unmount');
});

test('a waiting code that ends shows the ended step and forgets the exchange', async () => {
  const calls: string[] = [];
  const open = exchange('maker', calls);
  open.ended = true;
  const { trust } = service({ pending: () => open });
  const { m } = screen(trust);
  await until('the ended message shows', () => text(m.container).includes('This code has ended. Make a new one.'));
  assert.deepEqual(calls, ['close:maker']);
});

test('the close button is drawn only with onClose, and labels replace the words', async () => {
  const { trust } = service();
  const plain = screen(trust, { onClose: undefined });
  assert.equal(plain.m.container.querySelector('[aria-label="Close"]'), null);
  const own = screen(trust, { labels: { trustTitle: 'Ajouter une personne' } });
  assert.equal(title(own.m.container), 'Ajouter une personne');
  assert.ok(own.m.container.querySelector('[aria-label="Close"]'));
});

test('the QR code is the same for the same text, differs for other text, and keeps a four-module quiet zone', () => {
  const path = (value: string): string => {
    const m = mount(h(QrCode, { value, label: 'code' }));
    const d = m.container.querySelector('path')!.getAttribute('d')!;
    m.unmount();
    return d;
  };
  const a = path('KW-7Q4M-ZX2P');
  assert.ok(a.length > 100, 'the code has modules');
  assert.equal(path('KW-7Q4M-ZX2P'), a);
  assert.notEqual(path('KW-7Q4M-ZX2Q'), a);
  const quiet = mount(h(QrCode, { value: 'KW-7Q4M-ZX2P', label: 'code' }));
  const span = Number(quiet.container.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[2]);
  const xs = [...quiet.container.querySelector('path')!.getAttribute('d')!.matchAll(/M(\d+) (\d+)/g)].flatMap((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(Math.min(...xs), 4, 'four light modules before the first dark one on each side');
  assert.equal(Math.max(...xs) + 1 + 4, span, 'and four after the last');
  quiet.unmount();
  const sized = mount(h(QrCode, { value: 'x', label: 'code', size: 96 }));
  assert.equal(sized.container.querySelector('svg')!.getAttribute('width'), '96');
});
