/** Dropbox: the app's own App Folder, through the HTTP API v2. */
import { bearer, call } from './syncHttp.js';
import { SyncError, type SyncProvider, type SyncRemoteEntry } from './syncTypes.js';

const API = 'https://api.dropboxapi.com/2/files';
const CONTENT = 'https://content.dropboxapi.com/2/files';

/**
 * Options for {@link dropbox}.
 * @public
 */
export interface DropboxOptions {
  /** The App key from the Dropbox App Console, for an app with App Folder access. */
  readonly clientId: string;
  /** Replaces the global `fetch`, for tests. */
  readonly fetch?: typeof fetch;
}

/**
 * A {@link SyncProvider} over the app's Dropbox App Folder, which the user sees under Apps in their Dropbox, named
 * when the Dropbox app is registered. The Dropbox app needs the `files.content.read`,
 * `files.content.write` and `files.metadata.read` permissions, and the host's redirect URI listed.
 * @public
 */
export function dropbox({ clientId, fetch: fetchFn = (...a) => fetch(...a) }: DropboxOptions): SyncProvider {
  const json = (token: string) => ({ ...bearer(token), 'Content-Type': 'application/json' });
  // Header args must be ASCII; sync percent-encodes document names into file names, so plain JSON is enough.
  const arg = (token: string, value: unknown) => ({ ...bearer(token), 'Dropbox-API-Arg': JSON.stringify(value) });
  // Dropbox keeps client_modified to the second and refuses fractions.
  const stamp = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
  const isConflict = async (res: Response): Promise<boolean> => res.status === 409 && /conflict/.test(await res.text());

  return {
    id: 'dropbox',
    oauth: {
      authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
      tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
      clientId,
      authorizeParams: { token_access_type: 'offline' },
    },
    async list(token) {
      const out: SyncRemoteEntry[] = [];
      let res = await call(fetchFn, `${API}/list_folder`, { method: 'POST', headers: json(token), body: JSON.stringify({ path: '' }) });
      for (;;) {
        const page = (await res.json()) as { entries: { '.tag': string; name: string; rev?: string; client_modified?: string }[]; has_more: boolean; cursor: string };
        for (const e of page.entries) if (e['.tag'] === 'file' && e.rev) out.push({ name: e.name, rev: e.rev, modifiedAt: Date.parse(e.client_modified ?? '') || 0 });
        if (!page.has_more) return out;
        res = await call(fetchFn, `${API}/list_folder/continue`, { method: 'POST', headers: json(token), body: JSON.stringify({ cursor: page.cursor }) });
      }
    },
    async read(token, name) {
      const res = await call(fetchFn, `${CONTENT}/download`, { method: 'POST', headers: arg(token, { path: `/${name}` }) }, [409]);
      if (res.status === 409) return null;
      const meta = JSON.parse(res.headers.get('dropbox-api-result') ?? '{}') as { rev?: string; client_modified?: string };
      if (!meta.rev) throw new SyncError('http', 'Dropbox download carried no revision');
      return { name, rev: meta.rev, modifiedAt: Date.parse(meta.client_modified ?? '') || 0, bytes: new Uint8Array(await res.arrayBuffer()) };
    },
    async write(token, name, bytes, ifRev, modifiedAt) {
      const mode = ifRev === null ? 'add' : { '.tag': 'update', update: ifRev };
      const headers = { ...arg(token, { path: `/${name}`, mode, autorename: false, mute: true, client_modified: stamp(modifiedAt) }), 'Content-Type': 'application/octet-stream' };
      const res = await call(fetchFn, `${CONTENT}/upload`, { method: 'POST', headers, body: bytes }, [409]);
      if (res.status === 409) {
        if (await isConflict(res)) throw new SyncError('conflict', `${name} changed on another device`, 409);
        throw new SyncError('http', `Dropbox upload of ${name} failed`, 409);
      }
      return ((await res.json()) as { rev: string }).rev;
    },
  };
}
