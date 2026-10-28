/** phonux/sync: sign-in, the passphrase, newest-edit-wins between two devices, and that only ciphertext leaves the device. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncError, createSync, memorySyncProvider } from '../sync.js';
import type { SyncKv, SyncProvider } from '../sync.js';

const memoryKv = (): SyncKv & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, get: async (k) => map.get(k), set: async (k, v) => void map.set(k, v) };
};

/** Answers the token endpoint; `refused` makes every refresh fail as a revoked grant would. */
const tokenFetch = (state: { refused?: boolean; calls: string[] } = { calls: [] }) =>
  (async (_url: string | URL | Request, init?: RequestInit) => {
    const grant = new URLSearchParams(String(init?.body)).get('grant_type') ?? '';
    state.calls.push(grant);
    if (state.refused && grant === 'refresh_token') return new Response('invalid_grant', { status: 400 });
    return Response.json({ access_token: `a-${state.calls.length}`, refresh_token: 'r', expires_in: 3600 });
  }) as typeof fetch;

async function device(provider: SyncProvider, passphrase = 'correct horse', clock = { t: 1000 }) {
  const sync = createSync({ provider, kv: memoryKv(), redirectUri: 'https://app.example/cb', fetch: tokenFetch(), now: () => clock.t });
  const url = new URL(await sync.signInUrl());
  await sync.finishSignIn(`https://app.example/cb?code=c&state=${url.searchParams.get('state')}`);
  await sync.unlock(passphrase);
  return sync;
}

test('a sign-in URL carries PKCE S256 and the provider’s own parameters', async () => {
  const sync = createSync({ provider: memorySyncProvider(), kv: memoryKv(), redirectUri: 'https://app.example/cb', fetch: tokenFetch() });
  const url = new URL(await sync.signInUrl());
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge')?.length, 43);
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example/cb');
  assert.equal(await sync.status(), 'signed-out');
});

test('a redirect whose state this device did not start is refused', async () => {
  const sync = createSync({ provider: memorySyncProvider(), kv: memoryKv(), redirectUri: 'https://app.example/cb', fetch: tokenFetch() });
  await sync.signInUrl();
  await assert.rejects(sync.finishSignIn('https://app.example/cb?code=c&state=forged'), (e: unknown) => e instanceof SyncError && e.code === 'sign-in-failed');
  assert.equal(await sync.status(), 'signed-out');
});

test('signed in but not unlocked is locked, and push says so', async () => {
  const sync = createSync({ provider: memorySyncProvider(), kv: memoryKv(), redirectUri: 'https://app.example/cb', fetch: tokenFetch() });
  const url = new URL(await sync.signInUrl());
  await sync.finishSignIn(`https://app.example/cb?code=c&state=${url.searchParams.get('state')}`);
  assert.equal(await sync.status(), 'locked');
  assert.equal(await sync.isNewAccount(), true);
  await assert.rejects(sync.push({ name: 'a', text: 'x' }), (e: unknown) => e instanceof SyncError && e.code === 'locked');
});

test('a document pushed on one device is pulled on another, and only once', async () => {
  const provider = memorySyncProvider();
  const a = await device(provider);
  const b = await device(provider);
  assert.equal(await a.push({ name: 'workspace', text: '{"panels":[]}' }), null);
  assert.deepEqual(await b.pull(), [{ name: 'workspace', text: '{"panels":[]}', updatedAt: 1000 }]);
  assert.deepEqual(await b.pull(), []);
  assert.deepEqual(await a.pull(), [], 'a device does not pull back its own push');
});

test('a second device with the wrong passphrase cannot unlock', async () => {
  const provider = memorySyncProvider();
  await device(provider, 'right');
  await assert.rejects(device(provider, 'wrong'), (e: unknown) => e instanceof SyncError && e.code === 'wrong-passphrase');
});

test('the newer edit wins a conflict, and the older one is handed back', async () => {
  const provider = memorySyncProvider();
  const clock = { t: 1000 };
  const a = await device(provider, 'p', clock);
  const b = await device(provider, 'p', clock);
  await a.push({ name: 'doc', text: 'base' });
  await b.pull();
  await a.push({ name: 'doc', text: 'a newer', updatedAt: 3000 });
  // b edits the version it pulled, but its edit is older than a's.
  assert.deepEqual(await b.push({ name: 'doc', text: 'b older', updatedAt: 2000 }), { name: 'doc', text: 'a newer', updatedAt: 3000 });
  // b's newer edit overwrites.
  assert.equal(await b.push({ name: 'doc', text: 'b newest', updatedAt: 4000 }), null);
  assert.deepEqual(await a.pull(), [{ name: 'doc', text: 'b newest', updatedAt: 4000 }]);
});

test('the provider sees only opaque names and ciphertext', async () => {
  const provider = memorySyncProvider();
  const a = await device(provider);
  await a.push({ name: 'workspace:secret-name', text: 'my-private-history https://example.com' });
  const names = [...provider.files.keys()];
  assert.equal(names.length, 2);
  assert.ok(names.includes('key.json'));
  const doc = names.find((n) => n !== 'key.json') ?? '';
  assert.match(doc, /^[0-9a-f]{32}\.doc$/);
  const blob = Buffer.from(provider.files.get(doc)?.bytes ?? new Uint8Array()).toString('latin1');
  assert.ok(blob.length > 30, 'the control: the file holds bytes');
  assert.ok(!blob.includes('private') && !blob.includes('example.com') && !blob.includes('workspace'));
  assert.ok(!Buffer.from(provider.files.get('key.json')?.bytes ?? new Uint8Array()).toString().includes('correct horse'));
});

test('a file moved to another document’s name does not open', async () => {
  const provider = memorySyncProvider() as ReturnType<typeof memorySyncProvider> & { files: Map<string, { rev: string; bytes: Uint8Array }> };
  const a = await device(provider);
  const b = await device(provider);
  await a.push({ name: 'one', text: '1' });
  await a.push({ name: 'two', text: '2' });
  assert.equal((await b.pull()).length, 2, 'the control: both open in place');
  const [first, second] = [...provider.files.keys()].filter((n) => n.endsWith('.doc'));
  const moved = provider.files.get(first ?? '');
  if (!moved || !second) throw new Error('fixture');
  provider.files.set(second, { rev: 'swapped', bytes: moved.bytes });
  assert.deepEqual(await b.pull(), []);
});

test('a refused refresh signs the device out', async () => {
  const provider = memorySyncProvider();
  const state = { refused: false, calls: [] as string[] };
  const clock = { t: 1000 };
  const kv = memoryKv();
  const sync = createSync({ provider, kv, redirectUri: 'https://app.example/cb', fetch: tokenFetch(state), now: () => clock.t });
  const url = new URL(await sync.signInUrl());
  await sync.finishSignIn(`https://app.example/cb?code=c&state=${url.searchParams.get('state')}`);
  await sync.unlock('p');
  const t = JSON.parse(kv.map.get('sync:memory:tokens') ?? '{}');
  kv.map.set('sync:memory:tokens', JSON.stringify({ ...t, expiresAt: 0 }));
  state.refused = true;
  await assert.rejects(sync.pull(), (e: unknown) => e instanceof SyncError && e.code === 'signed-out');
  assert.equal(await sync.status(), 'signed-out');
});

test('two devices creating the account at once end with one shared key', async () => {
  const provider = memorySyncProvider();
  const [a, b] = await Promise.all([device(provider, 'same'), device(provider, 'same')]);
  await a.push({ name: 'x', text: 'shared' });
  assert.deepEqual((await b.pull()).map((d) => d.text), ['shared']);
});
