/** phonux/sync: sign-in, newest-edit-wins between two devices, and that each document is one readable file. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYNC_README_FILE, SyncError, createSync, memorySyncProvider } from '../sync.js';
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

async function device(provider: SyncProvider, clock = { t: 1_000_000 }, readme?: string) {
  const sync = createSync({ provider, kv: memoryKv(), redirectUri: 'https://app.example/cb', fetch: tokenFetch(), now: () => clock.t, readme });
  const url = new URL(await sync.signInUrl());
  await sync.finishSignIn(`https://app.example/cb?code=c&state=${url.searchParams.get('state')}`);
  return sync;
}

const text = (provider: ReturnType<typeof memorySyncProvider>, file: string): string => Buffer.from(provider.files.get(file)?.bytes ?? new Uint8Array()).toString();

test('a sign-in URL carries PKCE S256 and the redirect', async () => {
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

test('a document pushed on one device is pulled on another, and only once', async () => {
  const provider = memorySyncProvider();
  const a = await device(provider);
  const b = await device(provider);
  assert.equal(await a.status(), 'ready');
  assert.equal(await a.push({ name: 'workspace-main.json', text: '{"panels":[]}' }), null);
  assert.deepEqual(await b.pull(), [{ name: 'workspace-main.json', text: '{"panels":[]}', updatedAt: 1_000_000 }]);
  assert.deepEqual(await b.pull(), []);
  assert.deepEqual(await a.pull(), [], 'a device does not pull back its own push');
});

test('each document is one plain file under its own name, readable as a backup', async () => {
  const provider = memorySyncProvider();
  const a = await device(provider);
  await a.push({ name: 'workspace-main.json', text: '{"panels":["https://example.com"]}' });
  await a.push({ name: 'odd name/with:marks', text: 'x' });
  assert.equal(text(provider, 'workspace-main.json'), '{"panels":["https://example.com"]}');
  assert.ok(provider.files.has('odd%20name%2Fwith%3Amarks'), 'a name a provider might refuse is percent-encoded');
  const b = await device(provider);
  assert.deepEqual((await b.pull()).map((d) => d.name).sort(), ['odd name/with:marks', 'workspace-main.json']);
});

test('the readme is written once, never pulled, and a user’s own copy is left alone', async () => {
  const provider = memorySyncProvider();
  const a = await device(provider, undefined, 'Phonux keeps your workspaces here. Do not delete.');
  await a.push({ name: 'one', text: '1' });
  assert.equal(text(provider, SYNC_README_FILE), 'Phonux keeps your workspaces here. Do not delete.');
  const b = await device(provider, undefined, 'a different text');
  await b.push({ name: 'two', text: '2' });
  assert.equal(text(provider, SYNC_README_FILE), 'Phonux keeps your workspaces here. Do not delete.');
  assert.deepEqual((await (await device(provider)).pull()).map((d) => d.name).sort(), ['one', 'two']);
});

test('the newer edit wins a conflict, and the older one is handed back', async () => {
  const provider = memorySyncProvider();
  const clock = { t: 1_000_000 };
  const a = await device(provider, clock);
  const b = await device(provider, clock);
  await a.push({ name: 'doc', text: 'base' });
  await b.pull();
  await a.push({ name: 'doc', text: 'a newer', updatedAt: 3_000_000 });
  // b edits the version it pulled, but its edit is older than a's.
  assert.deepEqual(await b.push({ name: 'doc', text: 'b older', updatedAt: 2_000_000 }), { name: 'doc', text: 'a newer', updatedAt: 3_000_000 });
  // b's newer edit overwrites.
  assert.equal(await b.push({ name: 'doc', text: 'b newest', updatedAt: 4_000_000 }), null);
  assert.deepEqual(await a.pull(), [{ name: 'doc', text: 'b newest', updatedAt: 4_000_000 }]);
});

test('a refused refresh signs the device out', async () => {
  const provider = memorySyncProvider();
  const state = { refused: false, calls: [] as string[] };
  const kv = memoryKv();
  const sync = createSync({ provider, kv, redirectUri: 'https://app.example/cb', fetch: tokenFetch(state) });
  const url = new URL(await sync.signInUrl());
  await sync.finishSignIn(`https://app.example/cb?code=c&state=${url.searchParams.get('state')}`);
  const t = JSON.parse(kv.map.get('sync:memory:tokens') ?? '{}');
  kv.map.set('sync:memory:tokens', JSON.stringify({ ...t, expiresAt: 0 }));
  state.refused = true;
  await assert.rejects(sync.pull(), (e: unknown) => e instanceof SyncError && e.code === 'signed-out');
  assert.equal(await sync.status(), 'signed-out');
});
