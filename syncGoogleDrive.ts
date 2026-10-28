/** Google Drive: the hidden appDataFolder, through the Drive API v3. */
import { bearer, call } from './syncHttp.js';
import { SyncError, type SyncProvider, type SyncRemoteEntry } from './syncTypes.js';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

/**
 * Options for {@link googleDrive}.
 * @public
 */
export interface GoogleDriveOptions {
  /** The OAuth client id from Google Cloud Console. */
  readonly clientId: string;
  /** The client secret Google issues even to public clients and requires at its token endpoint; it is not confidential. */
  readonly clientSecret?: string;
  /** Replaces the global `fetch`, for tests. */
  readonly fetch?: typeof fetch;
}

/**
 * A {@link SyncProvider} over the app's Google Drive appDataFolder, with the `drive.appdata` scope. Drive has no
 * conditional upload, so `write` checks the revision just before writing: two devices writing in the same instant can
 * both succeed, and the later one wins.
 * @public
 */
export function googleDrive({ clientId, clientSecret, fetch: fetchFn = (...a) => fetch(...a) }: GoogleDriveOptions): SyncProvider {
  const find = async (token: string, name: string): Promise<{ id: string; version: string } | null> => {
    const q = encodeURIComponent(`name = '${name}' and trashed = false`);
    const res = await call(fetchFn, `${FILES}?spaces=appDataFolder&q=${q}&fields=files(id,version)`, { headers: bearer(token) });
    return ((await res.json()) as { files: { id: string; version: string }[] }).files[0] ?? null;
  };

  return {
    id: 'google-drive',
    oauth: {
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      clientId,
      clientSecret,
      scope: 'https://www.googleapis.com/auth/drive.appdata',
      // Without prompt=consent Google returns a refresh token only on the very first sign-in.
      authorizeParams: { access_type: 'offline', prompt: 'consent' },
    },
    async list(token) {
      const out: SyncRemoteEntry[] = [];
      let pageToken = '';
      do {
        const url = `${FILES}?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(name,version)&q=trashed%20%3D%20false${pageToken && `&pageToken=${pageToken}`}`;
        const page = (await (await call(fetchFn, url, { headers: bearer(token) })).json()) as { files: { name: string; version: string }[]; nextPageToken?: string };
        for (const f of page.files) out.push({ name: f.name, rev: f.version });
        pageToken = page.nextPageToken ?? '';
      } while (pageToken);
      return out;
    },
    async read(token, name) {
      const f = await find(token, name);
      if (!f) return null;
      const res = await call(fetchFn, `${FILES}/${f.id}?alt=media`, { headers: bearer(token) });
      return { name, rev: f.version, bytes: new Uint8Array(await res.arrayBuffer()) };
    },
    async write(token, name, bytes, ifRev) {
      const f = await find(token, name);
      if ((f?.version ?? null) !== ifRev) throw new SyncError('conflict', `${name} changed on another device`);
      if (f) {
        const res = await call(fetchFn, `${UPLOAD}/${f.id}?uploadType=media&fields=version`, { method: 'PATCH', headers: { ...bearer(token), 'Content-Type': 'application/octet-stream' }, body: bytes });
        return ((await res.json()) as { version: string }).version;
      }
      const boundary = 'phonux-sync-boundary';
      const meta = JSON.stringify({ name, parents: ['appDataFolder'] });
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
        bytes,
        `\r\n--${boundary}--`,
      ]);
      const res = await call(fetchFn, `${UPLOAD}?uploadType=multipart&fields=version`, { method: 'POST', headers: { ...bearer(token), 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
      return ((await res.json()) as { version: string }).version;
    },
  };
}
