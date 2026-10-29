/** Google Drive: the hidden appDataFolder, through the Drive API v3. */
import { bearer, call } from './syncHttp.js';
import { SyncError } from './syncTypes.js';
const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
/**
 * A {@link SyncProvider} over the app's Google Drive appDataFolder, with the `drive.appdata` scope: a space only this
 * app reads, hidden from the user in Drive, so it cannot be deleted by accident. Drive has no
 * conditional upload, so `write` checks the revision just before writing: two devices writing in the same instant can
 * both succeed, and the later one wins.
 * @public
 */
export function googleDrive({ clientId, clientSecret, fetch: fetchFn = (...a) => fetch(...a) }) {
    const find = async (token, name) => {
        const q = encodeURIComponent(`name = '${name.replace(/'/g, "\\'")}' and trashed = false`);
        const res = await call(fetchFn, `${FILES}?spaces=appDataFolder&q=${q}&fields=files(id,version,modifiedTime)`, { headers: bearer(token) });
        return (await res.json()).files[0] ?? null;
    };
    const multipart = (meta, bytes) => {
        const boundary = 'phonux-sync-boundary';
        const body = new Blob([
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
            bytes,
            `\r\n--${boundary}--`,
        ]);
        return { body, type: `multipart/related; boundary=${boundary}` };
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
            const out = [];
            let pageToken = '';
            do {
                const url = `${FILES}?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(name,version,modifiedTime)&q=trashed%20%3D%20false${pageToken && `&pageToken=${pageToken}`}`;
                const page = (await (await call(fetchFn, url, { headers: bearer(token) })).json());
                for (const f of page.files)
                    out.push({ name: f.name, rev: f.version, modifiedAt: Date.parse(f.modifiedTime ?? '') || 0 });
                pageToken = page.nextPageToken ?? '';
            } while (pageToken);
            return out;
        },
        async read(token, name) {
            const f = await find(token, name);
            if (!f)
                return null;
            const res = await call(fetchFn, `${FILES}/${f.id}?alt=media`, { headers: bearer(token) });
            return { name, rev: f.version, modifiedAt: Date.parse(f.modifiedTime ?? '') || 0, bytes: new Uint8Array(await res.arrayBuffer()) };
        },
        async write(token, name, bytes, ifRev, modifiedAt) {
            const f = await find(token, name);
            if ((f?.version ?? null) !== ifRev)
                throw new SyncError('conflict', `${name} changed on another device`);
            const modifiedTime = new Date(modifiedAt).toISOString();
            const { body, type } = multipart(f ? { modifiedTime } : { name, parents: ['appDataFolder'], modifiedTime }, bytes);
            const url = f ? `${UPLOAD}/${f.id}?uploadType=multipart&fields=version` : `${UPLOAD}?uploadType=multipart&fields=version`;
            const res = await call(fetchFn, url, { method: f ? 'PATCH' : 'POST', headers: { ...bearer(token), 'Content-Type': type }, body });
            return (await res.json()).version;
        },
    };
}
