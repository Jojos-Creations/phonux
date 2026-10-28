/** The one fetch wrapper the providers share, so a refused token always surfaces as the same error. */
import { SyncError } from './syncTypes.js';
/** Rejects 401 as `unauthorized` and any other failure except the statuses the caller handles itself. */
export async function call(fetchFn, url, init, handled = []) {
    const res = await fetchFn(url, init);
    if (res.ok || handled.includes(res.status))
        return res;
    if (res.status === 401)
        throw new SyncError('unauthorized', `${url}: access token refused`, 401);
    throw new SyncError('http', `${url}: HTTP ${res.status} ${await res.text().catch(() => '')}`.trim(), res.status);
}
export const bearer = (token) => ({ Authorization: `Bearer ${token}` });
