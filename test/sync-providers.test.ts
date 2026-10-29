/** The Dropbox and Google Drive providers against recorded request shapes: no network, a fake fetch per test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncError, dropbox, googleDrive } from '../sync.js';

interface Seen { url: string; init: RequestInit }
const fake = (answer: (url: string, init: RequestInit) => Response) => {
  const seen: Seen[] = [];
  const fetchFn = (async (url: string | URL | Request, init: RequestInit = {}) => {
    seen.push({ url: String(url), init });
    return answer(String(url), init);
  }) as typeof fetch;
  return { seen, fetchFn };
};
const header = (s: Seen | undefined, name: string): string => new Headers(s?.init.headers).get(name) ?? '';
const isConflict = (e: unknown) => e instanceof SyncError && e.code === 'conflict';

test('Dropbox asks for a refresh token at sign-in', () => {
  assert.equal(dropbox({ clientId: 'k' }).oauth.authorizeParams?.token_access_type, 'offline');
});

test('Dropbox lists every page of the app folder, files only', async () => {
  const { fetchFn, seen } = fake((url) =>
    url.endsWith('/continue')
      ? Response.json({ entries: [{ '.tag': 'file', name: 'b.doc', rev: '2' }], has_more: false, cursor: 'c2' })
      : Response.json({ entries: [{ '.tag': 'file', name: 'a.doc', rev: '1' }, { '.tag': 'folder', name: 'x' }], has_more: true, cursor: 'c1' }),
  );
  assert.deepEqual(await dropbox({ clientId: 'k', fetch: fetchFn }).list('t'), [{ name: 'a.doc', rev: '1', modifiedAt: 0 }, { name: 'b.doc', rev: '2', modifiedAt: 0 }]);
  assert.equal(JSON.parse(String(seen[1]?.init.body)).cursor, 'c1');
  assert.equal(header(seen[0], 'authorization'), 'Bearer t');
});

test('Dropbox reads the revision from the result header, and a missing file as null', async () => {
  const hit = fake(() => new Response(new Uint8Array([7]), { headers: { 'dropbox-api-result': '{"rev":"r9","client_modified":"2026-10-29T01:00:00Z"}' } }));
  const file = await dropbox({ clientId: 'k', fetch: hit.fetchFn }).read('t', 'a.doc');
  assert.equal(file?.rev, 'r9');
  assert.equal(file?.modifiedAt, Date.parse('2026-10-29T01:00:00Z'));
  assert.deepEqual([...(file?.bytes ?? [])], [7]);
  assert.equal(JSON.parse(header(hit.seen[0], 'dropbox-api-arg')).path, '/a.doc');
  const miss = fake(() => new Response('{"error_summary":"path/not_found/"}', { status: 409 }));
  assert.equal(await dropbox({ clientId: 'k', fetch: miss.fetchFn }).read('t', 'a.doc'), null);
});

test('Dropbox writes with update mode on a known revision and add mode on a new file', async () => {
  const { fetchFn, seen } = fake(() => Response.json({ rev: 'new' }));
  const p = dropbox({ clientId: 'k', fetch: fetchFn });
  assert.equal(await p.write('t', 'a.doc', new Uint8Array([1]), 'old', 1_500), 'new');
  await p.write('t', 'b.doc', new Uint8Array([1]), null, 0);
  assert.deepEqual(JSON.parse(header(seen[0], 'dropbox-api-arg')).mode, { '.tag': 'update', update: 'old' });
  assert.equal(JSON.parse(header(seen[0], 'dropbox-api-arg')).client_modified, '1970-01-01T00:00:01Z', 'stamped to the whole second');
  assert.equal(JSON.parse(header(seen[1], 'dropbox-api-arg')).mode, 'add');
});

test('Dropbox reports a path conflict as a conflict, and a 401 as unauthorized', async () => {
  const conflict = fake(() => new Response('{"error_summary":"path/conflict/file/.."}', { status: 409 }));
  await assert.rejects(dropbox({ clientId: 'k', fetch: conflict.fetchFn }).write('t', 'a.doc', new Uint8Array(), 'r', 0), isConflict);
  const expired = fake(() => new Response('', { status: 401 }));
  await assert.rejects(dropbox({ clientId: 'k', fetch: expired.fetchFn }).list('t'), (e: unknown) => e instanceof SyncError && e.code === 'unauthorized');
});

test('Drive asks for offline access with the appdata scope and sends its client secret', () => {
  const p = googleDrive({ clientId: 'g', clientSecret: 's' });
  assert.equal(p.oauth.scope, 'https://www.googleapis.com/auth/drive.appdata');
  assert.equal(p.oauth.authorizeParams?.access_type, 'offline');
  assert.equal(p.oauth.clientSecret, 's');
});

test('Drive refuses a write whose revision moved, and creates a new file in appDataFolder', async () => {
  const moved = fake(() => Response.json({ files: [{ id: 'f1', version: '5' }] }));
  await assert.rejects(googleDrive({ clientId: 'g', fetch: moved.fetchFn }).write('t', 'a.doc', new Uint8Array(), '4', 0), isConflict);
  await assert.rejects(googleDrive({ clientId: 'g', fetch: moved.fetchFn }).write('t', 'a.doc', new Uint8Array(), null, 0), isConflict);

  const fresh = fake((url) => (url.includes('/upload/') ? Response.json({ version: '1' }) : Response.json({ files: [] })));
  assert.equal(await googleDrive({ clientId: 'g', fetch: fresh.fetchFn }).write('t', 'a.doc', new Uint8Array([1, 2]), null, 0), '1');
  const upload = fresh.seen[1];
  assert.match(upload?.url ?? '', /uploadType=multipart/);
  assert.match(await (upload?.init.body as Blob | undefined ?? new Blob()).text(), /"parents":\["appDataFolder"\]/);
});

test('Drive updates a file in place when its revision still matches', async () => {
  const { fetchFn, seen } = fake((url) => (url.includes('/upload/') ? Response.json({ version: '6' }) : Response.json({ files: [{ id: 'f1', version: '5' }] })));
  assert.equal(await googleDrive({ clientId: 'g', fetch: fetchFn }).write('t', 'a.doc', new Uint8Array(), '5', 0), '6');
  assert.equal(seen[1]?.init.method, 'PATCH');
  assert.match(seen[1]?.url ?? '', /\/files\/f1\?uploadType=multipart/);
});
